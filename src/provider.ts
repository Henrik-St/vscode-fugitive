import * as vscode from 'vscode';
import { window } from 'vscode';
import { API as GitAPI, Change, Repository, Commit, Status, GitExtension, Ref } from './vscode-git';

type ResourceType = 'MergeChange' | 'Untracked' | 'Staged' | 'Unstaged'

export class Provider implements vscode.TextDocumentContentProvider {
    static myScheme = 'fugitive';
    private gitExtension: GitExtension;
    private api: GitAPI;
    repo: Repository;
    private rootUri: string;

    //location data
    private mergeOffset: number;
    private untrackedOffset: number;
    private unstagedOffset: number;
    private stagedOffset: number;
    private unpushedOffset: number;

    //cached data
    private unpushedCommits: Commit[];
    private refs: Ref[];
    private line: number;

    private onDidChangeEmitter = new vscode.EventEmitter<vscode.Uri>();
    onDidChange = this.onDidChangeEmitter.event;
    private subscriptions: vscode.Disposable;
    private mapChangeToName: (c: Change) => string;
    private mergeChanges: () => Change[];
    private untracked: () => Change[];
    private unstaged: () => Change[];
    private staged: () => Change[];

    constructor() {
        this.gitExtension = vscode.extensions.getExtension('vscode.git')?.exports;
        this.api = this.gitExtension.getAPI(1);

        this.repo = this.api.repositories[0];
        this.rootUri = this.repo.rootUri.path;

        this.unpushedCommits = [];
        this.refs = [];
        this.line = 0;

        this.mapChangeToName = (c: Change) => mapStatustoString(c.status) + " " + c.originalUri.path.replace(this.rootUri, '');
        this.mergeChanges = mergeChange.bind(this);
        this.untracked = untracked.bind(this);
        this.unstaged = unstaged.bind(this);
        this.staged = staged.bind(this);

        const mergeLen = this.mergeChanges().length;
        const untrackedLen = this.untracked().length;
        const unstagedLen = this.unstaged().length;
        const stagedLen = this.staged().length;

        this.mergeOffset = 5;
        this.untrackedOffset = this.mergeOffset + mergeLen + Number(mergeLen > 0) * 2;
        this.unstagedOffset = this.untrackedOffset + untrackedLen + Number(untrackedLen > 0) * 2;
        this.stagedOffset = this.unstagedOffset + unstagedLen + Number(unstagedLen > 0) * 2;
        this.unpushedOffset = this.stagedOffset + stagedLen + Number(stagedLen > 0) * 2;

        // on Git Changed
        this.subscriptions = this.repo.state.onDidChange(async () => {
            console.debug('onGitChanged');

            const mergeLen = this.mergeChanges().length;
            const untrackedLen = this.untracked().length;
            const unstagedLen = this.unstaged().length;
            const stagedLen = this.staged().length;

            this.mergeOffset = 5;
            this.untrackedOffset = this.mergeOffset + mergeLen + Number(mergeLen > 0) * 2;
            this.unstagedOffset = this.untrackedOffset + untrackedLen + Number(untrackedLen > 0) * 2;
            this.stagedOffset = this.unstagedOffset + unstagedLen + Number(unstagedLen > 0) * 2;
            this.unpushedOffset = this.stagedOffset + stagedLen + Number(stagedLen > 0) * 2;

            this.refs = await this.repo.getRefs({});
            const hasRemoteBranch = this.repo?.state.remotes[0] &&
                this.refs.some(branch => branch.name === this.repo.state.remotes[0].name + "/" + this.repo.state.HEAD?.name); //e.g. origin/branchname

            if (hasRemoteBranch) {
                this.unpushedCommits = await this.repo.log({ range: this.repo.state.remotes[0].name + "/" + this.repo.state.HEAD?.name + "..HEAD" });
            }
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

    dispose() {
        this.subscriptions.dispose();
    }

    provideTextDocumentContent(_uri: vscode.Uri): string {
        console.debug('provideTextDocumentContent');
        let head = "Detached";
        if (this.repo.state.HEAD?.name) {
            head = this.repo.state.HEAD.name;
        } else if (this.repo.state.HEAD?.commit) {
            head += " at " + this.repo.state.HEAD.commit.slice(0, 8);
        }
        if (this.repo.state.rebaseCommit) {
            head = "Rebasing at " + this.repo.state.rebaseCommit.hash.slice(0, 8);
        }
        let merge = "Unpublished";
        const hasRemoteBranch = this.repo?.state.remotes[0] &&
            this.refs.some(branch => branch.name === this.repo.state.remotes[0].name + "/" + this.repo.state.HEAD?.name); //e.g. origin/branchname

        if (hasRemoteBranch) {
            merge = `Merge: ${this.repo.state.remotes[0].name}/${head}`;
        }
        let renderString = `Head: ${head}\n${merge}\nHelp: g?`;
        // render untracked
        const mergeChanges = this.repo.state.mergeChanges;
        if (mergeChanges.length > 0) {
            const untrackedRender = mergeChanges.map(this.mapChangeToName).join('\n');
            renderString += `\n\nMerge Changes (${mergeChanges.length}):\n${untrackedRender}`;
        }
        const untracked = this.untracked();
        if (untracked.length > 0) {
            const untrackedRender = untracked.map(this.mapChangeToName).join('\n');
            renderString += `\n\nUntracked (${untracked.length}):\n${untrackedRender}`;
        }
        // render unstaged
        const unstaged = this.unstaged();
        if (unstaged.length > 0) {
            const unstagedRender = unstaged.map(this.mapChangeToName).join('\n');
            renderString += `\n\nUnstaged (${unstaged.length}):\n${unstagedRender}`;
        }
        // render staged
        const staged = this.staged();
        if (staged.length > 0) {
            const stagedRender = staged.map(this.mapChangeToName).join('\n');
            renderString += `\n\nStaged (${staged.length}):\n${stagedRender}`;
        }

        const unpushedLen = this.unpushedCommits.length;
        if (unpushedLen > 0) {
            const len = this.unpushedCommits.length;
            let to = "";
            if (this.repo.state.remotes[0]?.name) {
                to = `to ${this.repo.state.remotes[0].name}/${head} `;
            }
            const commits = this.unpushedCommits.map(c =>
                c.hash.slice(0, 8) + " " + c.message.split("\n")[0].slice(0, 80)
            ).join('\n');
            renderString += `\n\nUnpushed ${to}(${len}):\n${commits}`;
        }
        return renderString;
    }

    async getDocOrRefreshIfExists(uri: vscode.Uri) {
        this.refs = await this.repo.getRefs({});
        const hasRemoteBranch = this.repo?.state.remotes[0] &&
            this.refs.some(branch => branch.name === this.repo.state.remotes[0].name + "/" + this.repo.state.HEAD?.name); //e.g. origin/branchname

        if (hasRemoteBranch) {
            this.unpushedCommits = await this.repo.log({ range: this.repo.state.remotes[0].name + "/" + this.repo.state.HEAD?.name + "..HEAD" });
        } else {
            this.unpushedCommits = [];
        }
        let doc = vscode.workspace.textDocuments.find(doc => doc.uri.scheme === Provider.myScheme);
        if (doc) {
            this.onDidChangeEmitter.fire(uri);
        } else {
            doc = await vscode.workspace.openTextDocument(uri); // calls back into the provider
        }
        return doc;
    }

    goStaged() {
        if (this.staged().length > 0) {
            window.activeTextEditor!.selection =
                new vscode.Selection(new vscode.Position(this.stagedOffset, 0), new vscode.Position(this.stagedOffset, 0));
        }
    }

    goUnstaged(goUnstaged: boolean) {
        if (!goUnstaged && this.untracked().length > 0) {
            window.activeTextEditor!.selection =
                new vscode.Selection(new vscode.Position(this.untrackedOffset, 0), new vscode.Position(this.untrackedOffset, 0));
            return;
        }
        if (this.unstaged().length > 0) {
            window.activeTextEditor!.selection =
                new vscode.Selection(new vscode.Position(this.unstagedOffset, 0), new vscode.Position(this.unstagedOffset, 0));
            return;
        }
    }

    goUnpushed() {
        if (this.unpushedCommits.length > 0) {
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
                await this.repo.add([resource.ressource.uri.path]);
            }
            return;
        }
        if (resource.type === "Untracked") {
            this.setNewCursor('track', resource.index);
            console.debug('track ', resource.ressource.uri.path);
            await this.repo.add([resource.ressource.uri.path]);
            return;
        }
        if (resource.type === "Unstaged") {
            this.setNewCursor('stage', resource.index);
            console.debug('stage ', resource.ressource.uri.path);
            await this.repo.add([resource.ressource.uri.path]);
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
            console.debug('unstage ', resource.ressource.uri.path);
            await this.repo.revert([resource.ressource.uri.path]);
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
        const files = this.staged().map((c) => c.uri.path);
        await this.repo.revert(files);
    }

    async cleanFile() {
        const ressource = this.getResourceUnderCursor();
        if (!ressource) {
            return;
        }
        if (["Untracked", "Unstaged"].includes(ressource.type)) {
            console.debug('clean ', ressource);
            await this.repo.clean([ressource.ressource.uri.path]);
            return;
        }

        if (ressource.type === "Staged") {
            console.debug('clean ', ressource);
            await this.repo.revert([ressource.ressource.uri.path]);
            await this.repo.clean([ressource.ressource.uri.path]);
            return;
        }
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
            vscode.Uri.parse(this.rootUri + "/.gitignore") :
            vscode.Uri.parse(this.rootUri + "/.git/info/exclude");

        try {
            await vscode.workspace.fs.stat(uri);
        } catch {
            await vscode.workspace.fs.writeFile(uri, new Uint8Array());
        }

        if (fileUnderCursor) {
            const contents = await vscode.workspace.fs.readFile(uri);
            const enc = new TextEncoder(); // always utf-8
            const filename = enc.encode(fileUnderCursor.ressource.originalUri.path.replace(this.rootUri, ''));

            const newContents = new Uint8Array(contents.length + filename.length + 1);
            newContents.set(contents);
            newContents.set(enc.encode("\n"), contents.length);
            newContents.set(filename, contents.length + 1);
            await vscode.workspace.fs.writeFile(uri, newContents);
        }

        const doc = await vscode.workspace.openTextDocument(uri);
        await window.showTextDocument(doc, { preview: false, viewColumn: vscode.ViewColumn.Beside });
    }

    getResourceUnderCursor(): { type: ResourceType, ressource: Change, index: number } | null {
        let ressource: Change | null = null;
        const line = window.activeTextEditor!.selection.active.line;
        let ressourceIndex = line - this.mergeOffset;
        // check if in merge changes
        const merge = this.repo.state.mergeChanges;
        if (ressourceIndex >= 0 && ressourceIndex < merge.length) {
            ressource = merge[ressourceIndex];
            return { type: 'MergeChange', ressource: ressource, index: ressourceIndex };
        }
        ressourceIndex = line - this.untrackedOffset;
        // check if in untracked
        const untracked = this.untracked();
        if (ressourceIndex >= 0 && ressourceIndex < untracked.length) {
            return { type: 'Untracked', ressource: untracked[ressourceIndex], index: ressourceIndex };
        }
        // check if in unstaged
        ressourceIndex = line - this.unstagedOffset;
        const unstaged = this.unstaged();
        if (ressourceIndex >= 0 && ressourceIndex < unstaged.length) {
            return { type: 'Unstaged', ressource: unstaged[ressourceIndex], index: ressourceIndex };
        }
        // check if in staged
        ressourceIndex = line - this.stagedOffset;
        const staged = this.staged();
        if (ressourceIndex >= 0 && ressourceIndex < staged.length) {
            return {
                type: 'Staged',
                ressource: staged[ressourceIndex],
                index: ressourceIndex
            };
        }
        return null;

    }

    setNewCursor(operation: 'merge' | 'track' | 'stage' | 'unstage', index: number) {
        if (operation === 'merge') {
            console.debug('merge');
            const merge = this.repo.state.mergeChanges;
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
            const untracked = this.untracked();
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
            const unstaged = this.unstaged();
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
            const ressourceStatus = this.repo.state.indexChanges[index].status;
            let addUnstagedOffset = 0;
            const untrackedLen = this.untracked().length;
            const unstagedLen = this.unstaged().length;
            if (ressourceStatus === Status.INDEX_ADDED && untrackedLen === 0 ||
                ressourceStatus !== Status.INDEX_ADDED && unstagedLen === 0
            ) {
                addUnstagedOffset = 2;
            }
            if (index === this.repo.state.indexChanges.length - 1) {
                if (index === 0) {
                    this.line = this.unstagedOffset;
                } else {
                    this.line = this.stagedOffset + index + addUnstagedOffset;
                }
            } else {
                this.line = this.stagedOffset + index + 1 + addUnstagedOffset;
            }
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

export function checkForRepository() {
    console.debug("checkForRepository");
    const gitExtension: GitExtension = vscode.extensions.getExtension('vscode.git')?.exports;
    if (!gitExtension || !gitExtension.enabled) {
        window.showWarningMessage('Fugitive: No git extension found or not enabled.');
        return false;
    }
    const api = gitExtension.getAPI(1);
    if (api.repositories.length === 0 && !api.repositories[0]?.state.HEAD?.name) {
        window.showWarningMessage('Fugitive: No git repository initialized');
        return false;
    }
    return true;
}

function untracked(this: Provider) {
    return this.repo.state.workingTreeChanges.filter(c => c.status === Status.UNTRACKED);
}

function unstaged(this: Provider) {
    const unstagedTypes = [
        Status.ADDED_BY_US,
        Status.DELETED_BY_US,
        Status.DELETED,
        Status.MODIFIED,
        Status.BOTH_MODIFIED,
        Status.BOTH_ADDED,
    ];
    return this.repo.state.workingTreeChanges.filter(c => unstagedTypes.includes(c.status));
}

function staged(this: Provider) {
    return this.repo.state.indexChanges;
}

function mergeChange(this: Provider) {
    return this.repo.state.mergeChanges;
}