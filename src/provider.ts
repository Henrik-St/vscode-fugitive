import * as vscode from 'vscode';
import { window } from 'vscode';
import { API as GitAPI, Change, Status, DiffEditorSelectionHunkToolbarContext } from './vscode-git';
import { GitWrapper } from './git-wrapper';
import { applyPatchToFile } from './util';

type ResourceType = 'MergeChange' | 'Untracked' | 'Staged' | 'Unstaged' | 'UnstagedDiff' | 'StagedDiff'
type RessourceAtCursor = { type: ResourceType, ressource: Change, changeIndex: number, renderIndex: number, diffIndex?: number }

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
    private line: number;
    private openedChangesMap: Map<string, string[]>; // Maps file uri to multiple diff strings
    private openedIndexChangesMap: Map<string, string[]>; // Maps file uri to multiple diff strings

    private onDidChangeEmitter = new vscode.EventEmitter<vscode.Uri>();
    onDidChange = this.onDidChangeEmitter.event;
    private subscriptions: vscode.Disposable;

    constructor(gitAPI: GitAPI) {
        this.git = new GitWrapper(gitAPI);

        this.line = 0;
        this.openedChangesMap = new Map();
        this.openedIndexChangesMap = new Map();

        const offsets = calculateOffsets(this.git, this.openedChangesMap, this.openedIndexChangesMap);
        this.mergeOffset = offsets.mergeOffset;
        this.untrackedOffset = offsets.untrackedOffset;
        this.unstagedOffset = offsets.unstagedOffset;
        this.stagedOffset = offsets.stagedOffset;
        this.unpushedOffset = offsets.unpushedOffset;

        // on Git Changed
        this.subscriptions = this.git.repo.state.onDidChange(async () => {
            console.debug('onGitChanged');
            this.setOffsets();
            await this.git.cacheInfo();
            this.updateDiffString();
            const doc = vscode.workspace.textDocuments.find(doc => doc.uri.scheme === Provider.myScheme);
            if (doc) {
                this.onDidChangeEmitter.fire(doc.uri);
            }
        });

        // override cursor behaviour
        vscode.workspace.onDidChangeTextDocument((e: vscode.TextDocumentChangeEvent) => {
            if (vscode.window.activeTextEditor && e.document.uri.scheme === Provider.myScheme) {
                window.activeTextEditor!.selection =
                    new vscode.Selection(new vscode.Position(this.line, 0), new vscode.Position(this.line, 0));
            }
        });

    }

    private setOffsets() {
        const offsets = calculateOffsets(this.git, this.openedChangesMap, this.openedIndexChangesMap);
        console.log(offsets);
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
                diffString = (this.openedChangesMap.get(c.uri.path) ?? []).join("\n");
                break;
            case 'Staged':
                diffString = (this.openedIndexChangesMap.get(c.uri.path) ?? []).join("\n");
                break;
        }
        if (diffString) {
            diffString = "\n" + diffString;
        }
        return mapStatustoString(c.status) + " " + c.originalUri.path.replace(this.git.rootUri, '') + diffString;
    }


    dispose() {
        this.subscriptions.dispose();
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
        let renderString = `Head: ${head}\n${merge}\nHelp: g?`;
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
        await this.git.cacheInfo();
        let doc = vscode.workspace.textDocuments.find(doc => doc.uri === Provider.uri);
        if (doc) {
            this.onDidChangeEmitter.fire(Provider.uri);
        } else {
            this.openedChangesMap.clear();
            this.openedIndexChangesMap.clear();
            doc = await vscode.workspace.openTextDocument(Provider.uri);
        }
        return doc;
    }

    goStaged() {
        console.debug("goStaged");
        if (this.git.staged().length > 0) {
            window.activeTextEditor!.selection =
                new vscode.Selection(new vscode.Position(this.stagedOffset, 0), new vscode.Position(this.stagedOffset, 0));
        }
    }

    goUnstaged(goUnstaged: boolean) {
        if (!goUnstaged && this.git.untracked().length > 0) {
            window.activeTextEditor!.selection =
                new vscode.Selection(new vscode.Position(this.untrackedOffset, 0), new vscode.Position(this.untrackedOffset, 0));
            return;
        }
        if (this.git.unstaged().length > 0) {
            window.activeTextEditor!.selection =
                new vscode.Selection(new vscode.Position(this.unstagedOffset, 0), new vscode.Position(this.unstagedOffset, 0));
            return;
        }
    }

    goUnpushed() {
        if (this.git.cachedUnpushedCommits.length > 0) {
            window.activeTextEditor!.selection =
                new vscode.Selection(new vscode.Position(this.unpushedOffset, 0), new vscode.Position(this.unpushedOffset, 0));
        }
    }

    async stageFile() {
        const resource = this.getResourceUnderCursor();
        if (!resource) {
            return;
        }
        if (resource.type === "MergeChange") {
            console.debug('merge add ', resource.ressource.uri.path);
            const uri = vscode.Uri.parse(resource.ressource.uri.path);
            if (await this.checkForConflictMarker(uri)) {
                await this.git.repo.add([resource.ressource.uri.path]);
                this.setNewCursor('MergeChange', resource.changeIndex);
            }
            return;
        }
        if (resource.type === "Untracked") {
            console.debug('track ', resource.ressource.uri.path);
            await this.git.repo.add([resource.ressource.uri.path]);
            this.setNewCursor('Untracked', resource.changeIndex);
            return;
        }
        if (resource.type === "Unstaged") {
            console.debug('stage ', resource.ressource.uri.path);
            await this.git.repo.add([resource.ressource.uri.path]);
            this.openedChangesMap.delete(resource.ressource.uri.path);
            this.setNewCursor('Unstaged', resource.changeIndex);
            return;
        }
        if (resource.type === "UnstagedDiff") {
            console.log("test");
            const diff = await this.git.getDiffStrings(resource.ressource.uri.path, "Unstaged"); // remove diff --git ...
            const indexedFileVersion = await this.git.repo.show("", resource.ressource.uri.path);

            if (!resource.diffIndex && resource.diffIndex !== 0) {
                return Promise.reject("No diff index: " + resource.diffIndex);
            }

            const diffAtIndex = diff[resource.diffIndex];
            const patchedFile = await applyPatchToFile(indexedFileVersion, diffAtIndex, false);
            if (!patchedFile) {
                vscode.window.showErrorMessage("Failed to stage hunk");
            }

            const stageParams: DiffEditorSelectionHunkToolbarContext = {
                modifiedUri: resource.ressource.uri,
                originalWithModifiedChanges: patchedFile,
                originalUri: vscode.Uri.parse("Default"), // not needed
                mapping: "", //not needed
            };
            vscode.commands.executeCommand('git.diff.stageHunk', stageParams).then(async (success) => {
                console.debug('git.diff.stageHunk: success: ', success);
                if (this.git.unstaged().filter(r => r.uri === resource.ressource.uri).length > 0) {
                    const diffStrings = await this.getDiffStrings(resource.ressource.uri.path, resource.type);
                    this.openedChangesMap.set(resource.ressource.uri.path, diffStrings);
                } else {
                    this.openedChangesMap.delete(resource.ressource.uri.path);
                }
            }, (rejected) => {
                console.debug('git.diff.stageHunk:rejected: ', rejected);
            });
        }
    }

    async checkForConflictMarker(uri: vscode.Uri): Promise<boolean> {
        const buffer = await vscode.workspace.fs.readFile(uri);
        if (buffer.toString().includes("<<<<<<<")) {
            const options: vscode.QuickPickOptions = {
                title: "Merge with conflicts?",
            };

            const success_text = "Merge conflicts";
            const value = await window.showQuickPick(["cancel", success_text], options);
            return value === success_text;
        }
        return true;
    }

    async unstageFile() {
        const resource = this.getResourceUnderCursor();
        if (!resource) {
            return;
        }
        if (resource.type === "Staged") {
            console.debug('unstage ', resource.ressource.uri.path);
            await this.git.repo.revert([resource.ressource.uri.path]);
            this.openedIndexChangesMap.delete(resource.ressource.uri.path);
            this.setNewCursor('Staged', resource.changeIndex);
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
        const ressource = this.getResourceUnderCursor();
        if (!ressource) {
            return;
        }
        switch (ressource.type) {
            case "Untracked":
                console.debug('clean ', ressource);
                await this.git.repo.clean([ressource.ressource.uri.path]);
                this.openedChangesMap.delete(ressource.ressource.uri.path);
                this.setNewCursor("Untracked", ressource.changeIndex);
                return;
            case "Unstaged":
                console.debug('clean ', ressource);
                await this.git.repo.clean([ressource.ressource.uri.path]);
                this.openedChangesMap.delete(ressource.ressource.uri.path);
                this.setNewCursor("Unstaged", ressource.changeIndex);
                return;
            case "Staged":
                console.debug('clean ', ressource);
                await this.git.repo.revert([ressource.ressource.uri.path]);
                await this.git.repo.clean([ressource.ressource.uri.path]);
                this.openedIndexChangesMap.delete(ressource.ressource.uri.path);
                this.setNewCursor("Staged", ressource.changeIndex);
                return;
        }
    }

    async toggleInlineDiff() {
        const ressource = this.getResourceUnderCursor();
        if (!ressource?.ressource) {
            return;
        }

        switch (ressource.type) {
            case "Unstaged":
                if (this.openedChangesMap.has(ressource.ressource.uri.path)) {
                    this.openedChangesMap.delete(ressource.ressource.uri.path);
                } else {
                    const diffStrings = await this.getDiffStrings(ressource.ressource.uri.path, ressource.type);
                    this.openedChangesMap.set(ressource.ressource.uri.path, diffStrings);
                }
                this.setNewCursor("Unstaged", ressource.renderIndex);
                break;
            case "Staged":
                if (this.openedIndexChangesMap.has(ressource.ressource.uri.path)) {
                    this.openedIndexChangesMap.delete(ressource.ressource.uri.path);
                } else {
                    const diffString = await this.getDiffStrings(ressource.ressource.uri.path, ressource.type);
                    this.openedIndexChangesMap.set(ressource.ressource.uri.path, diffString);
                }
                this.setNewCursor("Staged", ressource.renderIndex);
                break;
            case "StagedDiff":
                this.openedIndexChangesMap.delete(ressource.ressource.uri.path);
                this.setNewCursor("Staged", ressource.renderIndex);
                break;
            case "UnstagedDiff":
                this.openedChangesMap.delete(ressource.ressource.uri.path);
                this.setNewCursor("Unstaged", ressource.renderIndex);
                break;
        }

        this.onDidChangeEmitter.fire(Provider.uri);
    }

    async getDiffStrings(path: string, type: ResourceType): Promise<string[]> {
        switch (type) {
            case "Unstaged":
            case "Staged":
                return await this.git.getDiffStrings(path, type);
            default: return [];
        }
    }

    updateDiffString() {
        const deletedChanges = Array.from(this.openedChangesMap.keys()).filter(uri => !this.git.unstaged().find(c => c.uri.path === uri));
        const deletedIndexChanges = Array.from(this.openedIndexChangesMap.keys()).filter(uri => !this.git.staged().find(c => c.uri.path === uri));
        for (const uri of deletedChanges) {
            this.openedChangesMap.delete(uri);
        }
        for (const uri of deletedIndexChanges) {
            this.openedIndexChangesMap.delete(uri);
        }
    }

    async openDiff() {
        const ressource = this.getResourceUnderCursor();
        if (!ressource) {
            return;
        }
        let uriLeft = ressource.ressource.uri;
        let uriRight = ressource.ressource.uri;
        let titleType = "(Working Tree)";
        switch (ressource.type) {
            case "Unstaged": {
                uriLeft = this.git.api.toGitUri(ressource.ressource.uri, "~"); // ?
                uriRight = ressource.ressource.uri; // local file
                titleType = "(Working Tree)";
                break;
            }
            case "Staged": {
                uriLeft = this.git.api.toGitUri(ressource.ressource.uri, "HEAD"); // last commit
                uriRight = this.git.api.toGitUri(ressource.ressource.uri, ""); //index
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
        const resource = this.getResourceUnderCursor()?.ressource;
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
            await window.showTextDocument(doc, { preview: false, viewColumn: vscode.ViewColumn.Beside });
        } else {
            await window.showTextDocument(doc, { preview: false });
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
            const filename = enc.encode(fileUnderCursor.ressource.originalUri.path.replace(this.git.rootUri, ''));

            const newContents = new Uint8Array(contents.length + filename.length + 1);
            newContents.set(contents);
            newContents.set(enc.encode("\n"), contents.length);
            newContents.set(filename, contents.length + 1);
            await vscode.workspace.fs.writeFile(uri, newContents);
        }

        const doc = await vscode.workspace.openTextDocument(uri);
        await window.showTextDocument(doc, { preview: false, viewColumn: vscode.ViewColumn.Beside });
    }

    private getResourceUnderCursor(): RessourceAtCursor | null {
        let ressource: Change | null = null;
        const line = window.activeTextEditor!.selection.active.line;
        let ressourceIndex = line - this.mergeOffset;
        // check if in merge changes
        const merge = this.git.mergeChanges();
        if (ressourceIndex >= 0 && ressourceIndex < merge.length) {
            ressource = merge[ressourceIndex];
            return { type: 'MergeChange', ressource: ressource, changeIndex: ressourceIndex, renderIndex: ressourceIndex };
        }
        ressourceIndex = line - this.untrackedOffset;
        // check if in untracked
        const untracked = this.git.untracked();
        if (ressourceIndex >= 0 && ressourceIndex < untracked.length) {
            return { type: 'Untracked', ressource: untracked[ressourceIndex], changeIndex: ressourceIndex, renderIndex: ressourceIndex };
        }
        // check if in unstaged
        ressourceIndex = line - this.unstagedOffset;
        const unstaged = this.git.unstaged();
        const unstagedMock: RessourceAtCursor[] = this.getMockRessources(unstaged, "Unstaged");
        if (ressourceIndex >= 0 && ressourceIndex < unstagedMock.length) {
            console.log(ressourceIndex, " in unstaged");
            return unstagedMock[ressourceIndex];
        }
        // check if in staged
        ressourceIndex = line - this.stagedOffset;
        const staged = this.git.staged();
        const stagedMock: RessourceAtCursor[] = this.getMockRessources(staged, "Staged");
        if (ressourceIndex >= 0 && ressourceIndex < stagedMock.length) {
            return stagedMock[ressourceIndex];
        }
        return null;

    }

    private getMockRessources(changes: Change[], type: "Staged" | "Unstaged"): RessourceAtCursor[] {
        const unstagedMock: RessourceAtCursor[] = [];
        let changeIndex = 0;
        let renderIndex = 0;
        const map = type === "Staged" ? this.openedIndexChangesMap : this.openedChangesMap;
        const diffType = type === "Staged" ? "StagedDiff" : "UnstagedDiff";
        for (const c of changes) {
            unstagedMock.push({ type: type, ressource: c, changeIndex: changeIndex, renderIndex: renderIndex });
            const diffRender = (map.get(c.uri.path) ?? []).map(str => str.split("\n"));
            // diffRender.pop();
            const mappedArr: RessourceAtCursor[] = diffRender.flatMap((diff, diffIndex) => diff.map((_) => ({ type: diffType, ressource: c, changeIndex: changeIndex, renderIndex: renderIndex, diffIndex: diffIndex })));
            unstagedMock.push(...mappedArr);
            changeIndex += 1;
            renderIndex += diffRender.length + 1;
        }
        console.log(unstagedMock);
        return unstagedMock;
    }

    private setNewCursor(type: ResourceType, changeIndex: number) {
        this.setOffsets();
        switch (type) {
            case 'MergeChange':
                this.line = this.mergeOffset + changeIndex;
                break;
            case 'Untracked':
                this.line = this.untrackedOffset + changeIndex;
                break;
            case 'Unstaged':
                this.line = this.unstagedOffset + changeIndex;
                break;
            case 'Staged':
                this.line = this.stagedOffset + changeIndex;
                break;
            default:
                console.error("setNewCursor: " + type + " not implemented");
        }
    }
}

function mapStatustoString(status: number) {
    switch (status) {
        case Status.INDEX_MODIFIED:
            return 'M';
        case Status.INDEX_ADDED:
            return 'A';
        case Status.INDEX_DELETED:
            return 'D';
        case Status.INDEX_RENAMED:
            return 'R';
        case Status.INDEX_COPIED:
            return 'C';
        case Status.MODIFIED:
            return 'M';
        case Status.DELETED:
            return 'D';
        case Status.UNTRACKED:
            return 'U';
        case Status.IGNORED:
            return 'I';
        case Status.INTENT_TO_ADD:
            return 'A';
        case Status.INTENT_TO_RENAME:
            return 'R';
        case Status.TYPE_CHANGED:
            return 'T';
        case Status.ADDED_BY_US:
            return 'A';
        case Status.ADDED_BY_THEM:
            return 'A';
        case Status.DELETED_BY_US:
            return 'D';
        case Status.DELETED_BY_THEM:
            return 'D';
        case Status.BOTH_ADDED:
            return 'A';
        case Status.BOTH_DELETED:
            return 'D';
        case Status.BOTH_MODIFIED:
            return 'M';
        default:
            return status;
    }
}


function calculateOffsets(git: GitWrapper, diffs: Map<string, string[]>, indexDiffs: Map<string, string[]>) {
    const mergeLen = git.mergeChanges().length;
    const untrackedLen = git.untracked().length;
    const unstagedLen = git.unstaged().length;
    const stagedLen = git.staged().length;
    const unpushedLen = git.cachedUnpushedCommits.length;

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
