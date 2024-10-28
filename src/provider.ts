import * as vscode from 'vscode';
import { window } from 'vscode';
import { API as GitAPI, Change, Commit, Status, Ref } from './vscode-git';
import { GitWrapper } from './git-wrapper';

type ResourceType = 'MergeChange' | 'Untracked' | 'Staged' | 'Unstaged' | 'UnstagedDiff' | 'StagedDiff'
type RessourceAtCursor = { type: ResourceType, ressource: Change, index: number }

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
    private openedChangesMap: Map<string, string>; // Maps file uri to diff string
    private openedIndexChangesMap: Map<string, string>; // Maps file uri to diff string

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

            const offsets = calculateOffsets(this.git, this.openedChangesMap, this.openedIndexChangesMap);
            this.mergeOffset = offsets.mergeOffset;
            this.untrackedOffset = offsets.untrackedOffset;
            this.unstagedOffset = offsets.unstagedOffset;
            this.stagedOffset = offsets.stagedOffset;
            this.unpushedOffset = offsets.unpushedOffset;

            await this.git.cacheInfo();

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
        this.mergeOffset = offsets.mergeOffset;
        this.untrackedOffset = offsets.untrackedOffset;
        this.unstagedOffset = offsets.unstagedOffset;
        this.stagedOffset = offsets.stagedOffset;
        this.unpushedOffset = offsets.unpushedOffset;
    }

    private renderChange(c: Change, type: ResourceType) {
        let diffString = "";
        switch (type) {
            case 'Unstaged':
                diffString = this.openedChangesMap.get(c.uri.path) ?? "";
                break;
            case 'Staged':
                diffString = this.openedIndexChangesMap.get(c.uri.path) ?? "";
                break;
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
            this.setNewCursor('merge', resource.index);
            console.debug('merge add ', resource.ressource.uri.path);
            const uri = vscode.Uri.parse(resource.ressource.uri.path);
            if (await this.checkForConflictMarker(uri)) {
                await this.git.repo.add([resource.ressource.uri.path]);
            }
            return;
        }
        if (resource.type === "Untracked") {
            this.setNewCursor('track', resource.index);
            console.debug('track ', resource.ressource.uri.path);
            await this.git.repo.add([resource.ressource.uri.path]);
            return;
        }
        if (resource.type === "Unstaged") {
            this.setNewCursor('stage', resource.index);
            this.openedChangesMap.delete(resource.ressource.uri.path);
            console.debug('stage ', resource.ressource.uri.path);
            await this.git.repo.add([resource.ressource.uri.path]);
            return;
        }
    }

    async checkForConflictMarker(uri: vscode.Uri): Promise<boolean> {
        const buffer = await vscode.workspace.fs.readFile(uri);
        if (buffer.toString().includes("<<<<<<<")) {
            const options: vscode.QuickPickOptions = {
                title: "Merge with conflicts?",
            };

            const value = await window.showQuickPick(["Merge conflicts", "cancel"], options);
            return value === "Merge with conflicts";
        }
        return true;
    }

    async unstageFile() {
        const resource = this.getResourceUnderCursor();
        if (!resource) {
            return;
        }
        if (resource.type === "Staged") {
            this.setNewCursor('unstage', resource.index);
            this.openedChangesMap.delete(resource.ressource.uri.path);
            console.debug('unstage ', resource.ressource.uri.path);
            await this.git.repo.revert([resource.ressource.uri.path]);
        }
    }

    async toggle() {
        const resource = this.getResourceUnderCursor();
        if (!resource) {
            return;
        }
        if (["Untracked", "Unstaged"].includes(resource.type)) {
            await this.stageFile();
            return;
        }
        if (resource.type === "Staged") {
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
        if (["Untracked", "Unstaged"].includes(ressource.type)) {
            console.debug('clean ', ressource);
            await this.git.repo.clean([ressource.ressource.uri.path]);
            return;
        }

        if (ressource.type === "Staged") {
            console.debug('clean ', ressource);
            await this.git.repo.revert([ressource.ressource.uri.path]);
            await this.git.repo.clean([ressource.ressource.uri.path]);
            return;
        }
    }

    async toggleInlineDiff() {
        const ressource = this.getResourceUnderCursor();
        if (!ressource?.ressource) {
            return;
        }

        if (ressource.type == "Unstaged") {
            if (this.openedChangesMap.has(ressource.ressource.uri.path)) {
                this.openedChangesMap.delete(ressource.ressource.uri.path);
            } else {
                const diffString = await this.getDiffString(ressource.ressource.uri.path, ressource.type);
                this.openedChangesMap.set(ressource.ressource.uri.path, diffString);
            }
            this.setNewCursor("diff", ressource.index);
        }
        if (ressource.type == "Staged") {
            if (this.openedIndexChangesMap.has(ressource.ressource.uri.path)) {
                this.openedIndexChangesMap.delete(ressource.ressource.uri.path);
            } else {
                const diffString = await this.getDiffString(ressource.ressource.uri.path, ressource.type);
                this.openedIndexChangesMap.set(ressource.ressource.uri.path, diffString);
            }
            this.setNewCursor("diffIndex", ressource.index);
        }
        if (ressource.type == "StagedDiff") {
            this.openedIndexChangesMap.delete(ressource.ressource.uri.path);
            this.setNewCursor("diffIndex", ressource.index);
        }
        if (ressource.type == "UnstagedDiff") {
            this.openedChangesMap.delete(ressource.ressource.uri.path);
            this.setNewCursor("diff", ressource.index);
        }
        this.setOffsets();

        this.onDidChangeEmitter.fire(Provider.uri);
    }

    async getDiffString(path: string, type: ResourceType) {
        if (type === "Unstaged") {
            return "\n" + (await this.git.repo.diffWithHEAD(path)).split('\n').slice(4).join("\n");
        }
        if (type === "Staged") {
            return "\n" + (await this.git.repo.diffIndexWithHEAD(path)).split('\n').slice(4).join("\n");
        }
        return "";
    }

    async openDiff() {
        const ressource = this.getResourceUnderCursor()?.ressource;
        if (!ressource) {
            return;
        }
        vscode.commands.executeCommand('git.openChange', ressource.uri).then((success) => {
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
            return { type: 'MergeChange', ressource: ressource, index: ressourceIndex };
        }
        ressourceIndex = line - this.untrackedOffset;
        // check if in untracked
        const untracked = this.git.untracked();
        if (ressourceIndex >= 0 && ressourceIndex < untracked.length) {
            return { type: 'Untracked', ressource: untracked[ressourceIndex], index: ressourceIndex };
        }
        // check if in unstaged
        ressourceIndex = line - this.unstagedOffset;
        const unstaged = this.git.unstaged();
        const unstagedMock: RessourceAtCursor[] = this.getMockRessources(unstaged, "Unstaged");
        if (ressourceIndex >= 0 && ressourceIndex < unstagedMock.length) {
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

    private getMockRessources(changes: Change[], type: ResourceType): RessourceAtCursor[] {
        const unstagedMock: RessourceAtCursor[] = [];
        let index = 0;
        const map = type === "Staged" ? this.openedIndexChangesMap : this.openedChangesMap;
        const diffType = type === "Staged" ? "StagedDiff" : "UnstagedDiff";
        for (const c of changes) {
            unstagedMock.push({ type: type, ressource: c, index: index });
            const arr = (map.get(c.uri.path) ?? "").split("\n");
            arr.pop();
            const mappedArr: RessourceAtCursor[] = arr.map((_, i) => ({ type: diffType, ressource: c, index: index }));
            unstagedMock.push(...mappedArr);
            index += arr.length + 1;
        }
        return unstagedMock;
    }

    private setNewCursor(operation: 'merge' | 'track' | 'stage' | 'unstage' | 'diff' | 'diffIndex', index: number) {
        if (operation === 'merge') {
            console.debug('merge');
            const merge = this.git.repo.state.mergeChanges;
            if (index === merge.length - 1) {
                if (index === 0) {
                    this.line = this.mergeOffset;
                } else {
                    this.line = this.mergeOffset + index - 1;
                }
            } else {
                this.line = this.untrackedOffset + index;
            }
        } else if (operation === 'track') {
            console.debug('track');
            const untracked = this.git.untracked();
            if (index === untracked.length - 1) {
                if (index === 0) {
                    this.line = this.untrackedOffset;
                } else {
                    this.line = this.untrackedOffset + index - 1;
                }
            } else {
                this.line = this.untrackedOffset + index;
            }
        } else if (operation === 'stage') {
            const unstaged = this.git.unstaged();
            if (index === unstaged.length - 1) {
                if (index === 0) {
                    this.line = this.untrackedOffset;
                } else {
                    this.line = this.unstagedOffset + index - 1;
                }
            } else {
                this.line = this.unstagedOffset + index;
            }
        } else if (operation === 'unstage') {
            const ressourceStatus = this.git.staged()[index].status;
            let addUnstagedOffset = 0;
            const untrackedLen = this.git.untracked().length;
            const unstagedLen = this.git.unstaged().length;
            if (ressourceStatus === Status.INDEX_ADDED && untrackedLen === 0 ||
                ressourceStatus !== Status.INDEX_ADDED && unstagedLen === 0
            ) {
                addUnstagedOffset = 2;
            }
            if (index === this.git.staged().length - 1) {
                if (index === 0) {
                    this.line = this.unstagedOffset;
                } else {
                    this.line = this.stagedOffset + index + addUnstagedOffset;
                }
            } else {
                this.line = this.stagedOffset + index + 1 + addUnstagedOffset;
            }
        } else if (operation === 'diff') {
            this.line = this.unstagedOffset + index;
        } else if (operation === 'diffIndex') {
            this.line = this.stagedOffset + index;
        } else {
            throw Error(operation + " not implemented");
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


function calculateOffsets(git: GitWrapper, diffs: Map<string, string>, indexDiffs: Map<string, string>) {
    const mergeLen = git.mergeChanges().length;
    const untrackedLen = git.untracked().length;
    const unstagedLen = git.unstaged().length;
    const stagedLen = git.staged().length;

    const unstagedDiffLen = Array.from(diffs.values()).map(str => str.split("\n").length - 1).reduce((a, b) => a + b, 0);
    const stagedDiffLen = Array.from(indexDiffs.values()).map(str => str.split("\n").length - 1).reduce((a, b) => a + b, 0);

    const mergeOffset = 5;
    const untrackedOffset = mergeOffset + mergeLen + Number(mergeLen > 0) * 2;
    const unstagedOffset = untrackedOffset + untrackedLen + Number(untrackedLen > 0) * 2;
    const stagedOffset = unstagedOffset + unstagedLen + Number(unstagedLen > 0) * 2 + unstagedDiffLen;
    const unpushedOffset = stagedOffset + stagedLen + Number(stagedLen > 0) * 2 + stagedDiffLen;
    return { mergeOffset, untrackedOffset, unstagedOffset, stagedOffset, unpushedOffset };
}