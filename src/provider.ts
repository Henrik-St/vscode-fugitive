import * as vscode from 'vscode';
import { API as GitAPI, Change, Status } from './vscode-git';
import { GitWrapper } from './git-wrapper';
import { mapStatustoString, isEqualResource, setCursorWithView } from './util';

export type ResourceType = 'MergeChange' | 'Untracked' | 'Staged' | 'Unstaged' | 'UnstagedDiff' | 'StagedDiff' | 'UI';
export type ResourceAtCursor = { type: ResourceType, change: Change, changeIndex: number, renderIndex: number, diffIndex?: number }

export class Provider implements vscode.TextDocumentContentProvider {
    static myScheme = 'fugitive';
    static uri = vscode.Uri.parse(Provider.myScheme + ':Fugitive');

    public git: GitWrapper;

    //render data
    private mergeOffset: number;
    private untrackedOffset: number;
    private unstagedOffset: number;
    private stagedOffset: number;
    private unpushedOffset: number;

    //status data
    private renderedChanges: ResourceAtCursor[];
    private renderedIndexChanges: ResourceAtCursor[];
    private line: number;
    private resourceUnderCursor: ResourceAtCursor | null;
    private openedChanges: Set<string>;
    private openedIndexChanges: Set<string>;

    private onDidChangeEmitter = new vscode.EventEmitter<vscode.Uri>();
    onDidChange = this.onDidChangeEmitter.event;
    private subscriptions: vscode.Disposable[];

    constructor(gitAPI: GitAPI) {
        this.git = new GitWrapper(gitAPI);

        this.line = 0;
        this.resourceUnderCursor = null;
        this.openedChanges = new Set();
        this.openedIndexChanges = new Set();

        const offsets = this.calculateOffsets();
        this.mergeOffset = offsets.mergeOffset;
        this.untrackedOffset = offsets.untrackedOffset;
        this.unstagedOffset = offsets.unstagedOffset;
        this.stagedOffset = offsets.stagedOffset;
        this.unpushedOffset = offsets.unpushedOffset;

        this.renderedChanges = this.getMockResources("Unstaged");
        this.renderedIndexChanges = this.getMockResources("Staged");

        // on Git Changed
        const gitDisposable = this.git.repo.state.onDidChange(async () => {
            console.debug('onGitChanged');
            this.setOffsets();
            await this.git.updateBranchInfo();
            await this.updateDiffs();

            this.renderedChanges = this.getMockResources("Unstaged");
            this.renderedIndexChanges = this.getMockResources("Staged");
            if (vscode.window.activeTextEditor?.document.uri.scheme === Provider.myScheme) {
                this.updateCursor();
            }
            const doc = vscode.workspace.textDocuments.find(doc => doc.uri.scheme === Provider.myScheme);
            if (doc) {
                this.onDidChangeEmitter.fire(doc.uri);
            }
        });

        // override cursor behaviour
        const docDispose = vscode.workspace.onDidChangeTextDocument((e: vscode.TextDocumentChangeEvent) => {
            if (vscode.window.activeTextEditor?.document.uri.toString() === Provider.uri.toString() &&
                e.document.uri.toString() === Provider.uri.toString()) {
                console.debug('onDidChangeTextDocument');
                vscode.window.activeTextEditor!.selection =
                    new vscode.Selection(new vscode.Position(this.line, 0), new vscode.Position(this.line, 0));
            }
        });
        this.subscriptions = [gitDisposable, docDispose];

    }

    private setOffsets() {
        const offsets = this.calculateOffsets();
        this.mergeOffset = offsets.mergeOffset;
        this.untrackedOffset = offsets.untrackedOffset;
        this.unstagedOffset = offsets.unstagedOffset;
        this.stagedOffset = offsets.stagedOffset;
        this.unpushedOffset = offsets.unpushedOffset;
    }

    private renderChange(c: Change, type: ResourceType) {
        let diffString: string = "";
        switch (type) {
            case 'Unstaged':
                diffString = (this.getOpenedDiffMap("Unstaged").get(c.uri.path) ?? []).join("\n");
                break;
            case 'Staged':
                diffString = (this.getOpenedDiffMap("Staged").get(c.uri.path) ?? []).join("\n");
                break;
        }
        if (diffString) {
            diffString = "\n" + diffString;
        }
        return mapStatustoString(c.status) + " " + c.originalUri.path.replace(this.git.rootUri, '') + diffString;
    }


    dispose() {
        this.subscriptions.forEach(e => e.dispose());
    }

    provideTextDocumentContent(_uri: vscode.Uri): string {
        console.debug('provideTextDocumentContent');
        let head = "Detached";
        if (this.git.repo.state.HEAD?.name) {
            head = this.git.repo.state.HEAD.name;
        } else if (this.git.repo.state.HEAD?.commit) {
            head += " at " + this.git.repo.state.HEAD.commit.slice(0, 8);
        }

        if (this.git.repo.state.rebaseCommit) {
            head = "Rebasing at " + this.git.repo.state.rebaseCommit.hash.slice(0, 8);
        }
        let merge = "Unpublished";

        if (this.git.getCachedHasRemoteBranch()) {
            merge = `Merge: ${this.git.repo.state.remotes[0].name}/${head}`;
        }
        let renderString = `Head: ${head}\n${merge}\nHelp: g h`;
        // render untracked
        const mergeChanges = this.git.repo.state.mergeChanges;
        if (mergeChanges.length > 0) {
            const untrackedRender = mergeChanges.map((c) => this.renderChange(c, "MergeChange")).join('\n');
            renderString += `\n\nMerge Changes (${mergeChanges.length}):\n${untrackedRender}`;
        }
        const untracked = this.git.untracked();
        if (untracked.length > 0) {
            const untrackedRender = untracked.map((c) => this.renderChange(c, "Untracked")).join('\n');
            renderString += `\n\nUntracked (${untracked.length}):\n${untrackedRender}`;
        }
        // render unstaged
        const unstaged = this.git.unstaged();
        if (unstaged.length > 0) {
            const unstagedRender = unstaged.map((c) => this.renderChange(c, "Unstaged")).join('\n');
            renderString += `\n\nUnstaged (${unstaged.length}):\n${unstagedRender}`;
        }
        // render staged
        const staged = this.git.staged();
        if (staged.length > 0) {
            const stagedRender = staged.map((c) => this.renderChange(c, "Staged")).join('\n');
            renderString += `\n\nStaged (${staged.length}):\n${stagedRender}`;
        }

        const unpushedLen = this.git.cachedUnpushedCommits.length;
        if (unpushedLen > 0) {
            const len = this.git.cachedUnpushedCommits.length;
            let to = "";
            if (this.git.repo.state.remotes[0]?.name) {
                to = `to ${this.git.repo.state.remotes[0].name}/${head} `;
            }
            const commits = this.git.cachedUnpushedCommits.map(c =>
                c.hash.slice(0, 8) + " " + c.message.split("\n")[0].slice(0, 80)
            ).join('\n');
            renderString += `\n\nUnpushed ${to}(${len}):\n${commits}`;
        }
        return renderString;
    }

    async getDocOrRefreshIfExists() {
        console.debug("getDocOrRefreshIfExists");
        await this.git.updateBranchInfo();
        await this.updateDiffs();
        this.renderedChanges = this.getMockResources("Unstaged");
        this.renderedIndexChanges = this.getMockResources("Staged");

        let doc = vscode.workspace.textDocuments.find(doc => doc.uri === Provider.uri);
        if (doc) {
            this.onDidChangeEmitter.fire(Provider.uri);
        } else {
            this.openedChanges.clear();
            this.openedIndexChanges.clear();
            doc = await vscode.workspace.openTextDocument(Provider.uri);
        }
        return doc;
    }

    goStaged() {
        console.debug("goStaged");
        if (this.git.staged().length > 0) {
            vscode.window.activeTextEditor!.selection =
                new vscode.Selection(new vscode.Position(this.stagedOffset, 0), new vscode.Position(this.stagedOffset, 0));
        }
    }

    goUnstaged(goUnstaged: boolean) {
        if (!goUnstaged && this.git.untracked().length > 0) {
            vscode.window.activeTextEditor!.selection =
                new vscode.Selection(new vscode.Position(this.untrackedOffset, 0), new vscode.Position(this.untrackedOffset, 0));
            return;
        }
        if (this.git.unstaged().length > 0) {
            vscode.window.activeTextEditor!.selection =
                new vscode.Selection(new vscode.Position(this.unstagedOffset, 0), new vscode.Position(this.unstagedOffset, 0));
            return;
        }
    }

    goUnpushed() {
        if (this.git.cachedUnpushedCommits.length > 0) {
            vscode.window.activeTextEditor!.selection =
                new vscode.Selection(new vscode.Position(this.unpushedOffset, 0), new vscode.Position(this.unpushedOffset, 0));
        }
    }
    goPreviousHunk() {
        const currentLine = vscode.window.activeTextEditor?.selection.active.line;
        if (!currentLine) {
            console.log('no current line');
            return;
        }
        const mock = this.getAllMockRessources();

        let diffIndex: number | undefined = undefined;
        for (let i = currentLine - 1; i >= 0; i--) {
            if (mock[i].type === 'UI') {
                continue;
            }

            if (mock[i].diffIndex === undefined) {
                this.line = i;
                setCursorWithView(this.line);
                return;
            } else if (diffIndex === undefined && mock[i].diffIndex !== undefined) {
                diffIndex = mock[i].diffIndex;
                while (i >= 0 && mock[i].diffIndex === diffIndex) {
                    i--;
                }
                this.line = i + 1;
                setCursorWithView(this.line);
                return;
            } else if (diffIndex !== undefined && diffIndex !== mock[i].diffIndex) {
                this.line = i + 1;
                setCursorWithView(this.line);
                return;
            }
        }
    }

    goNextHunk() {
        const currentLine = vscode.window.activeTextEditor?.selection.active.line;
        if (!currentLine) {
            console.log('no current line');
            return;
        }
        const mock = this.getAllMockRessources();

        const diffIndex = mock[currentLine].diffIndex;
        for (let i = currentLine + 1; i < mock.length; i++) {
            if (mock[i].type === 'UI') {
                continue;
            }
            if (mock[i].diffIndex === undefined) {
                this.line = i;
                setCursorWithView(this.line);
                return;
            } else if (diffIndex !== mock[i].diffIndex) {
                this.line = i;
                setCursorWithView(this.line);
                return;
            }
        }
    }


    async stageFile() {
        const resource = this.getResourceUnderCursor();
        if (!resource) {
            return;
        }
        if (resource.type === "MergeChange") {
            console.debug('merge add ', resource.change.uri.path);
            const uri = vscode.Uri.parse(resource.change.uri.path);
            if (await this.checkForConflictMarker(uri)) {
                await this.git.repo.add([resource.change.uri.path]);
            }
            return;
        }
        if (resource.type === "Untracked") {
            console.debug('track ', resource.change.uri.path);
            await this.git.repo.add([resource.change.uri.path]);
            return;
        }
        if (resource.type === "Unstaged") {
            console.debug('stage ', resource.change.uri.path);
            await this.git.repo.add([resource.change.uri.path]);
            this.openedChanges.delete(resource.change.uri.path);
            return;
        }
        if (resource.type === "UnstagedDiff") {
            if (resource.diffIndex === undefined) {
                return Promise.reject("No diff index: " + resource.diffIndex);
            }
            await this.git.applyPatchToFile(resource.change.uri, resource.diffIndex, "stage");
        }
    }

    async checkForConflictMarker(uri: vscode.Uri): Promise<boolean> {
        const buffer = await vscode.workspace.fs.readFile(uri);
        if (buffer.toString().includes("<<<<<<<")) {
            const options: vscode.QuickPickOptions = {
                title: "Merge with conflicts?",
            };

            const success_text = "Merge conflicts";
            const value = await vscode.window.showQuickPick(["cancel", success_text], options);
            return value === success_text;
        }
        return true;
    }

    async unstageFile() {
        const resource = this.getResourceUnderCursor();
        if (!resource) {
            return;
        }
        switch (resource.type) {
            case "Staged": {
                console.debug('unstage ', resource.change.uri.path);
                await this.git.repo.revert([resource.change.uri.path]);
                this.openedIndexChanges.delete(resource.change.uri.path);
                break;
            }
            case "StagedDiff": {
                if (resource.diffIndex === undefined) {
                    return Promise.reject("No diff index: " + resource.diffIndex);
                }
                await this.git.applyPatchToFile(resource.change.uri, resource.diffIndex, "unstage");
                break;
            }
        }
    }

    async toggle() {
        const resource = this.getResourceUnderCursor();
        if (!resource) {
            return;
        }
        switch (resource.type) {
            case "Untracked":
            case "Unstaged":
                await this.stageFile();
                break;
            case "Staged":
                await this.unstageFile();
                return;
        }
    }

    async unstageAll() {
        const files = this.git.staged().map((c) => c.uri.path);
        await this.git.repo.revert(files);
    }

    async cleanFile() {
        const resource = this.getResourceUnderCursor();
        if (!resource) {
            return;
        }
        switch (resource.type) {
            case "Untracked":
                console.debug('clean ', resource);
                await this.git.repo.clean([resource.change.uri.path]);
                this.openedChanges.delete(resource.change.uri.path);
                return;
            case "Unstaged":
                console.debug('clean ', resource);
                await this.git.repo.clean([resource.change.uri.path]);
                this.openedChanges.delete(resource.change.uri.path);
                return;
            case "Staged":
                console.debug('clean ', resource);
                await this.git.repo.revert([resource.change.uri.path]);
                await this.git.repo.clean([resource.change.uri.path]);
                this.openedIndexChanges.delete(resource.change.uri.path);
                return;
        }
    }

    async toggleInlineDiff() {
        const resource = this.getResourceUnderCursor();
        if (!resource?.change) {
            return;
        }

        switch (resource.type) {
            case "Unstaged":
                if (this.openedChanges.has(resource.change.uri.path)) {
                    this.openedChanges.delete(resource.change.uri.path);
                } else {
                    this.openedChanges.add(resource.change.uri.path);
                }
                break;
            case "Staged":
                if (this.openedIndexChanges.has(resource.change.uri.path)) {
                    this.openedIndexChanges.delete(resource.change.uri.path);
                } else {
                    this.openedIndexChanges.add(resource.change.uri.path);
                }
                break;
            case "StagedDiff":
                this.openedIndexChanges.delete(resource.change.uri.path);
                break;
            case "UnstagedDiff":
                this.openedChanges.delete(resource.change.uri.path);
                break;
        }
        this.renderedChanges = this.getMockResources("Unstaged");
        this.renderedIndexChanges = this.getMockResources("Staged");
        this.updateCursor();
        this.onDidChangeEmitter.fire(Provider.uri);
    }

    async updateDiffs() {
        await this.git.updateDiffMap(false);
        await this.git.updateDiffMap(true);
        const deleteOpenedDiffs = Array.from(this.openedChanges.keys()).filter(k => !this.git.cachedUnstagedDiffs.has(k));
        const deleteOpenedIndexDiffs = Array.from(this.openedIndexChanges.keys()).filter(k => !this.git.cachedStagedDiffs.has(k));
        for (const key of deleteOpenedDiffs) {
            this.openedChanges.delete(key);
        }
        for (const key of deleteOpenedIndexDiffs) {
            this.openedIndexChanges.delete(key);
        }
    }

    async openDiff() {
        const ressource = this.getResourceUnderCursor();
        if (!ressource) {
            return;
        }
        let uriLeft = ressource.change.uri;
        let uriRight = ressource.change.uri;
        let titleType = "(Working Tree)";
        switch (ressource.type) {
            case "Unstaged": {
                uriLeft = this.git.api.toGitUri(ressource.change.uri, "~"); // index
                uriRight = ressource.change.uri; // local file
                titleType = "(Working Tree)";
                break;
            }
            case "Staged": {
                uriLeft = this.git.api.toGitUri(ressource.change.uri, "HEAD"); // last commit
                uriRight = this.git.api.toGitUri(ressource.change.uri, "~"); //index
                titleType = "(Index)";
                break;
            }
            default: {
                console.error("No diff available");
            }
        }
        const title = (uriLeft.path.split("/").pop() ?? "Diff") + " " + titleType;
        vscode.commands.executeCommand('vscode.diff', uriLeft, uriRight, title).then((success) => {
            console.debug('success ', success);
        }, (rejected) => {
            console.debug('rejected ', rejected);
        });
    }

    async openFile(split: boolean) {
        const resource = this.getResourceUnderCursor()?.change;
        if (!resource) {
            return;
        }
        if ([Status.INDEX_DELETED, Status.DELETED].includes(resource.status)) {
            vscode.window.showWarningMessage("File was deleted");
            return;
        }
        const file = vscode.Uri.parse(resource.uri.path);
        const doc = await vscode.workspace.openTextDocument(file);
        if (split) {
            await vscode.window.showTextDocument(doc, { preview: false, viewColumn: vscode.ViewColumn.Beside });
        } else {
            await vscode.window.showTextDocument(doc, { preview: false });
        }
    }

    async gitExclude(gitIgnore: boolean) {
        const fileUnderCursor = this.getResourceUnderCursor();
        const uri = gitIgnore ?
            vscode.Uri.parse(this.git.rootUri + "/.gitignore") :
            vscode.Uri.parse(this.git.rootUri + "/.git/info/exclude");

        try {
            await vscode.workspace.fs.stat(uri);
        } catch {
            await vscode.workspace.fs.writeFile(uri, new Uint8Array());
        }

        if (fileUnderCursor) {
            const contents = await vscode.workspace.fs.readFile(uri);
            const enc = new TextEncoder(); // always utf-8
            const filename = enc.encode(fileUnderCursor.change.originalUri.path.replace(this.git.rootUri, ''));

            const newContents = new Uint8Array(contents.length + filename.length + 1);
            newContents.set(contents);
            newContents.set(enc.encode("\n"), contents.length);
            newContents.set(filename, contents.length + 1);
            await vscode.workspace.fs.writeFile(uri, newContents);
        }

        const doc = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(doc, { preview: false, viewColumn: vscode.ViewColumn.Beside });
    }

    private getResourceUnderCursor(): ResourceAtCursor | null {
        let ressource: Change | null = null;
        const line = vscode.window.activeTextEditor!.selection.active.line;
        // check if in merge changes
        let ressourceIndex = line - this.mergeOffset;
        const merge = this.git.mergeChanges();
        if (ressourceIndex >= 0 && ressourceIndex < merge.length) {
            ressource = merge[ressourceIndex];
            this.resourceUnderCursor = { type: 'MergeChange', change: ressource, changeIndex: ressourceIndex, renderIndex: ressourceIndex };
            return this.resourceUnderCursor;
        }
        // check if in untracked
        ressourceIndex = line - this.untrackedOffset;
        const untracked = this.git.untracked();
        if (ressourceIndex >= 0 && ressourceIndex < untracked.length) {
            this.resourceUnderCursor = { type: 'Untracked', change: untracked[ressourceIndex], changeIndex: ressourceIndex, renderIndex: ressourceIndex };
            return this.resourceUnderCursor;
        }
        // check if in unstaged
        ressourceIndex = line - this.unstagedOffset;
        if (ressourceIndex >= 0 && ressourceIndex < this.renderedChanges.length) {
            this.resourceUnderCursor = this.renderedChanges[ressourceIndex];
            return this.resourceUnderCursor;
        }
        // check if in staged
        ressourceIndex = line - this.stagedOffset;
        if (ressourceIndex >= 0 && ressourceIndex < this.renderedIndexChanges.length) {
            this.resourceUnderCursor = this.renderedIndexChanges[ressourceIndex];
            return this.resourceUnderCursor;
        }
        return null;

    }

    private getMockResources(type: "Staged" | "Unstaged"): ResourceAtCursor[] {
        const changes: Change[] = type === "Staged" ? this.git.staged() : this.git.unstaged();
        const unstagedMock: ResourceAtCursor[] = [];
        let changeIndex = 0;
        let renderIndex = 0;
        const map = this.getOpenedDiffMap(type);
        const diffType = type === "Staged" ? "StagedDiff" : "UnstagedDiff";
        for (const c of changes) {
            unstagedMock.push({ type: type, change: c, changeIndex: changeIndex, renderIndex: renderIndex });
            const diffRender = (map.get(c.uri.path) ?? []).map(str => str.split("\n"));
            const mappedArr: ResourceAtCursor[] = diffRender.flatMap((diff, diffIndex) => diff.map((_) => (
                { type: diffType, change: c, changeIndex: changeIndex, renderIndex: renderIndex, diffIndex: diffIndex }
            )));
            unstagedMock.push(...mappedArr);
            changeIndex += 1;
            renderIndex += diffRender.flat().length + 1;
        }
        return unstagedMock;
    }

    private getAllMockRessources(): ResourceAtCursor[] {
        const dummyChange: Change = { uri: vscode.Uri.parse("dummy"), status: Status.INDEX_ADDED, originalUri: vscode.Uri.parse("dummy"), renameUri: vscode.Uri.parse("dummy") };
        const uiHeader = Array(this.mergeOffset - 2).fill(0).map((_, i): ResourceAtCursor => (
            { type: 'UI', change: dummyChange, changeIndex: i, renderIndex: i }
        ));
        const uiSeparator = Array(2).fill(0).map((_, i): ResourceAtCursor => (
            { type: 'UI', change: dummyChange, changeIndex: i, renderIndex: i }
        ));
        const renderedMergeChanges = this.git.mergeChanges().map((c, i): ResourceAtCursor => ({
            type: 'MergeChange', change: c, changeIndex: i, renderIndex: i
        }));
        const renderedUntrackedChanges = this.git.mergeChanges().map((c, i): ResourceAtCursor => ({
            type: 'Untracked', change: c, changeIndex: i, renderIndex: i
        }));
        const renderedUnstagedChanges = this.getMockResources("Unstaged");
        const renderedStagedChanges = this.getMockResources("Staged");
        const renderedUnpushed = this.git.cachedUnpushedCommits.map((c, i): ResourceAtCursor => ({
            type: 'UI', change: dummyChange, changeIndex: i, renderIndex: i
        }));
        const result = [
            ...uiHeader,
            ...(renderedMergeChanges.length > 0 ? uiSeparator : []),
            ...renderedMergeChanges,
            ...(renderedUntrackedChanges.length > 0 ? uiSeparator : []),
            ...renderedUntrackedChanges,
            ...(renderedUnstagedChanges.length > 0 ? uiSeparator : []),
            ...renderedUnstagedChanges,
            ...(renderedStagedChanges.length > 0 ? uiSeparator : []),
            ...renderedStagedChanges,
            ...(renderedUnpushed.length > 0 ? uiSeparator : []),
            ...renderedUnpushed
        ];
        return result;
    }

    private getOpenedDiffMap(type: "Staged" | "Unstaged"): Map<string, string[]> {
        const openedMap = type === "Staged" ? this.openedIndexChanges : this.openedChanges;
        const diffMap = type === "Staged" ? this.git.cachedStagedDiffs : this.git.cachedUnstagedDiffs;
        const map = new Map<string, string[]>();
        for (const m of diffMap) {
            openedMap.has(m[0]) && map.set(m[0], m[1]);
        }
        return map;
    }

    private updateCursor() {
        this.setOffsets();
        if (!this.resourceUnderCursor) {
            return;
        }
        switch (this.resourceUnderCursor.type) {
            case 'MergeChange': {
                const index = this.git.mergeChanges().length == 0 ? 0 :
                    this.resourceUnderCursor.changeIndex > this.git.mergeChanges().length - 1 ?
                        this.git.mergeChanges().length - 1 : this.resourceUnderCursor.changeIndex;
                this.line = this.mergeOffset + index;
                break;
            }
            case 'Untracked': {
                const index = this.git.untracked().length == 0 ? 0 :
                    this.resourceUnderCursor.changeIndex > this.git.untracked().length - 1 ?
                        this.git.untracked().length - 1 : this.resourceUnderCursor.changeIndex;
                this.line = this.untrackedOffset + index;
                break;
            }
            case 'UnstagedDiff':
            case 'Unstaged': {
                const index = this.renderedChanges.length == 0 ? 0 :
                    this.resourceUnderCursor.renderIndex > this.renderedChanges.length - 1 ?
                        this.renderedChanges.length - 1 : this.resourceUnderCursor.renderIndex;
                this.line = this.unstagedOffset + index;
                break;
            }
            case 'StagedDiff':
            case 'Staged': {
                const index = this.renderedIndexChanges.length == 0 ? 0 :
                    this.resourceUnderCursor.renderIndex > this.renderedIndexChanges.length - 1 ?
                        this.renderedIndexChanges.length - 1 : this.resourceUnderCursor.renderIndex;
                this.line = this.stagedOffset + index;
                break;
            }
            default:
                console.error("updateCursor: " + this.resourceUnderCursor.type + " not implemented");
        }
    }

    calculateOffsets() {
        const diffs = this.getOpenedDiffMap("Unstaged");
        const indexDiffs = this.getOpenedDiffMap("Staged");

        const mergeLen = this.git.mergeChanges().length;
        const untrackedLen = this.git.untracked().length;
        const unstagedLen = this.git.unstaged().length;
        const stagedLen = this.git.staged().length;
        const unpushedLen = this.git.cachedUnpushedCommits.length;

        if ((mergeLen + untrackedLen + unstagedLen + stagedLen + unpushedLen) === 0) {
            return { mergeOffset: 0, untrackedOffset: 0, unstagedOffset: 0, stagedOffset: 0, unpushedOffset: 0 };
        }

        const offsetArr = [0, mergeLen, untrackedLen, unstagedLen, stagedLen, unpushedLen];
        const lenArr = offsetArr.map(len => len > 0 ? len + 2 : 0);
        offsetArr[0] = 5;

        for (let i = 1; i < offsetArr.length; i++) {
            if (lenArr[i] === 0) {
                offsetArr[i] = offsetArr[i - 1];
                continue;
            }
            let j = i - 1;
            for (; j > 0; j--) {
                if (lenArr[j] > 0) {
                    break;
                }
            }
            offsetArr[i] = offsetArr[j] + lenArr[j];
        }


        const unstagedDiffLen = Array.from(diffs.values()).flatMap(diffs => diffs.map(str => str.split("\n").length)).reduce((a, b) => a + b, 0);
        const stagedDiffLen = Array.from(indexDiffs.values()).flatMap(diffs => diffs.map(str => str.split("\n").length)).reduce((a, b) => a + b, 0);

        return { mergeOffset: offsetArr[1], untrackedOffset: offsetArr[2], unstagedOffset: offsetArr[3], stagedOffset: offsetArr[4] + unstagedDiffLen, unpushedOffset: offsetArr[5] + stagedDiffLen };
    }
}
