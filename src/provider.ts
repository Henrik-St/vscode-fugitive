import * as vscode from 'vscode';
import { window } from 'vscode';
import { API as GitAPI, Change, Repository, Commit, Status } from './vscode-git';

export class Provider implements vscode.TextDocumentContentProvider {
    static myScheme = 'fugitive';
    private gitExtension: any;
    private api: GitAPI;
    repo: Repository;
    private rootUri: string;

    //location data
    private untrackedOffset: number;
    private unstagedOffset: number;
    private stagedOffset: number;
    private unpushedOffset: number;

    //cached data
    private unpushedCommits: Commit[];
    private line: number;

    private onDidChangeEmitter = new vscode.EventEmitter<vscode.Uri>();
    onDidChange = this.onDidChangeEmitter.event;
    private _subscriptions: vscode.Disposable;
    private mapChangeToName: (c: Change) => string;

    constructor() {
        this.gitExtension = vscode.extensions.getExtension('vscode.git')?.exports;
        if (!this.gitExtension) {
            window.showInformationMessage('No git extension found.');
        }
        this.api = this.gitExtension.getAPI(1);
        if (this.api.repositories.length === 0) {
            window.showInformationMessage('No git repository initialized');
        }
        this.repo = this.api.repositories[0];

        this.rootUri = this.repo.rootUri.path;

        // this.unpushedCommits = [];
        this.unpushedCommits = [];
        this.line = 0;

        this.mapChangeToName = (c: Change) => mapStatustoString(c.status) + " " + c.originalUri.path.replace(this.rootUri, '');

        const untrackedOffset = 5;
        const untrackedLen = this.repo.state.workingTreeChanges.filter(c => c.status == Status.UNTRACKED).length;
        const unstagedOffset = untrackedOffset + untrackedLen + Number(untrackedLen > 0) * 2;
        const unstagedLen = this.repo.state.workingTreeChanges.filter(c => c.status != Status.UNTRACKED).length;
        const stagedLen = this.repo.state.indexChanges.length;
        const stagedOffset = unstagedOffset + unstagedLen + Number(unstagedLen > 0) * 2;

        this.untrackedOffset = untrackedOffset;
        this.unstagedOffset = unstagedOffset;
        this.stagedOffset = stagedOffset;
        this.unpushedOffset = stagedOffset + stagedLen + Number(stagedLen > 0) * 2;

        // on Git Changed
        this._subscriptions = this.repo.state.onDidChange(async () => {
            console.debug('onGitChanged');

            const untrackedOffset = 5;
            const untrackedLen = this.repo.state.workingTreeChanges.filter(c => c.status == Status.UNTRACKED).length;
            const unstagedOffset = untrackedOffset + untrackedLen + Number(untrackedLen > 0) * 2;
            const unstagedLen = this.repo.state.workingTreeChanges.filter(c => c.status != Status.UNTRACKED).length;
            const stagedLen = this.repo.state.indexChanges.length;
            const stagedOffset = unstagedOffset + unstagedLen + Number(unstagedLen > 0) * 2;

            this.untrackedOffset = untrackedOffset;
            this.unstagedOffset = unstagedOffset;
            this.stagedOffset = stagedOffset;
            this.unpushedOffset = stagedOffset + stagedLen + Number(stagedLen > 0) * 2;
            this.unpushedCommits = await this.repo.log({ range: this.repo.state.remotes[0].name + "/" + this.repo.state.HEAD?.name + "..HEAD" })
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
        })

    }

    dispose() {
        this._subscriptions.dispose();
    }
    //@TODO: set correct merge name
    provideTextDocumentContent(uri: vscode.Uri): string {
        console.debug('provideTextDocumentContent');
        const head = this.repo.state.HEAD?.name;
        let renderString = `Head: ${head}\nMerge: ${this.repo.state.remotes[0].name}/${head}\nHelp: g?`;
        // render untracked
        const untracked = this.repo.state.workingTreeChanges.filter(c => c.status == Status.UNTRACKED);
        if (untracked.length > 0) {
            const untrackedRender = untracked.map(this.mapChangeToName).join('\n');
            renderString += `\n\nUntracked (${untracked.length}):\n${untrackedRender}`;
        }
        // render unstaged
        const unstaged = this.repo.state.workingTreeChanges.filter(c => c.status != Status.UNTRACKED);
        if (unstaged.length > 0) {
            const unstagedRender = unstaged.map(this.mapChangeToName).join('\n');
            renderString += `\n\nUnstaged (${unstaged.length}):\n${unstagedRender}`;
        }
        // render staged
        const staged = this.repo.state.indexChanges;
        if (staged.length > 0) {
            const stagedRender = staged.map(this.mapChangeToName).join('\n');
            renderString += `\n\nStaged (${staged.length}):\n${stagedRender}`;
        }

        if (this.repo.state.HEAD?.ahead) {
            const len = this.unpushedCommits.length;
            const to = `${this.repo.state.remotes[0].name}/${head}`
            const commits = this.unpushedCommits.map(c =>
                c.hash.slice(0, 8) + " " + c.message
            ).join('\n');
            renderString += `\n\nUnpushed to ${to} (${len}):\n${commits}`;
        }
        return renderString;
    }

    async getDocOrRefreshIfExists(uri: vscode.Uri) {
        let doc = vscode.workspace.textDocuments.find(doc => doc.uri.scheme === Provider.myScheme);
        this.unpushedCommits = await this.repo.log({ range: this.repo.state.remotes[0].name + "/" + this.repo.state.HEAD?.name + "..HEAD" });
        if (doc) {
            this.onDidChangeEmitter.fire(uri);
        } else {
            doc = await vscode.workspace.openTextDocument(uri); // calls back into the provider
        }
        return doc;
    }

    goStaged() {
        if (this.repo.state.indexChanges.length > 0) {
            window.activeTextEditor!.selection =
                new vscode.Selection(new vscode.Position(this.stagedOffset, 0), new vscode.Position(this.stagedOffset, 0));
        }
    }

    goUnstaged(goUnstaged: boolean) {
        if (!goUnstaged && this.repo.state.workingTreeChanges.filter(c => c.status == Status.UNTRACKED).length > 0) {
            window.activeTextEditor!.selection =
                new vscode.Selection(new vscode.Position(this.untrackedOffset, 0), new vscode.Position(this.untrackedOffset, 0));
            return;
        }
        if (this.repo.state.workingTreeChanges.filter(c => c.status != Status.UNTRACKED).length > 0) {
            window.activeTextEditor!.selection =
                new vscode.Selection(new vscode.Position(this.unstagedOffset, 0), new vscode.Position(this.unstagedOffset, 0));
            return;
        }
    }
    goUnpushed() {
        if (this.repo.state.HEAD?.ahead) {
            window.activeTextEditor!.selection =
                new vscode.Selection(new vscode.Position(this.unpushedOffset, 0), new vscode.Position(this.unpushedOffset, 0));
        }
    }

    async stageFile(line: number) {
        // is untracked
        let ressourceIndex = line - this.untrackedOffset;
        const untracked = this.repo.state.workingTreeChanges.filter(c => c.status === Status.UNTRACKED);
        console.debug('index ', ressourceIndex);
        if (ressourceIndex >= 0 && ressourceIndex < untracked.length) {
            this.setNewCursor('track', ressourceIndex);
            const ressource = untracked[ressourceIndex].uri.path;
            console.debug('track ', ressource);
            await this.repo.add([ressource]);
            return;
        }
        // is unstaged
        ressourceIndex = line - this.unstagedOffset;
        console.debug('index ', ressourceIndex);
        const unstaged = this.repo.state.workingTreeChanges.filter(c => c.status !== Status.UNTRACKED);
        if (ressourceIndex >= 0 && ressourceIndex < unstaged.length) {
            this.setNewCursor('stage', ressourceIndex);
            const ressource = unstaged[ressourceIndex].uri.path;
            console.debug('stage ', ressource);
            await this.repo.add([ressource]);
            return;
        }
    }

    async unstageFile(line: number) {
        const ressourceIndex = line - this.stagedOffset;
        console.debug('ressourceIndex ', ressourceIndex);
        if (ressourceIndex >= 0 && ressourceIndex < this.repo.state.indexChanges.length) {
            this.setNewCursor('unstage', ressourceIndex);
            const ressource = this.repo.state.indexChanges[ressourceIndex].uri.path;
            console.debug('unstage ', ressource);
            await this.repo.revert([ressource]);
        }
    }

    async unstageAll() {
        const files = this.repo.state.indexChanges.map((c) => c.uri.path);
        await this.repo.revert(files);
    }

    async cleanFile(line: number) {
        let ressourceIndex = line - this.unstagedOffset;

        if (ressourceIndex >= 0 && ressourceIndex < this.repo.state.workingTreeChanges.length) {
            const ressource = this.repo.state.workingTreeChanges[ressourceIndex].uri.path;
            console.debug('clean ', ressource);
            await this.repo.clean([ressource]);
            return;
        }
        ressourceIndex = line - this.stagedOffset;
        if (ressourceIndex >= 0 && ressourceIndex < this.repo.state.indexChanges.length) {
            const ressource = this.repo.state.indexChanges[ressourceIndex].uri.path;
            console.debug('clean ', ressource);
            await this.repo.revert([ressource]);
            await this.repo.clean([ressource]);
            return;
        }
    }

    async openDiff(line: number) {
        let ressourceIndex = line - this.unstagedOffset;
        let ressource: vscode.Uri | null = null;

        console.debug('ressourceIndex ', ressourceIndex);
        if (ressourceIndex >= 0 && ressourceIndex < this.repo.state.workingTreeChanges.length) {
            ressource = this.repo.state.workingTreeChanges[ressourceIndex].uri;
        }
        ressourceIndex = line - this.stagedOffset;
        if (ressourceIndex >= 0 && ressourceIndex < this.repo.state.indexChanges.length) {
            ressource = this.repo.state.indexChanges[ressourceIndex].uri;

        }
        if (!ressource) {
            return;
        }
        vscode.commands.executeCommand('git.openChange', ressource).then((success) => {
            console.debug('success ', success);
        }, (rejected) => {
            console.debug('rejected ', rejected);
        });
    }

    async openFile(line: number, split: boolean) {
        let ressource: Change | null = null;
        let ressourceIndex = line - this.untrackedOffset;
        // check if in untracked
        const untracked = this.repo.state.workingTreeChanges.filter(c => c.status === Status.UNTRACKED);
        if (ressourceIndex >= 0 && ressourceIndex < untracked.length) {
            ressource = untracked[ressourceIndex];
        }
        // check if in unstaged
        ressourceIndex = line - this.unstagedOffset;
        const unstaged = this.repo.state.workingTreeChanges.filter(c => c.status !== Status.UNTRACKED);
        if (ressourceIndex >= 0 && ressourceIndex < unstaged.length) {
            ressource = unstaged[ressourceIndex];
        }
        // check if in staged
        ressourceIndex = line - this.stagedOffset;
        if (ressourceIndex >= 0 && ressourceIndex < this.repo.state.indexChanges.length) {
            ressource = this.repo.state.indexChanges[ressourceIndex];
        }
        if (!ressource) {
            return;
        }
        if ([Status.INDEX_DELETED, Status.DELETED].includes(ressource.status)) {
            vscode.window.showWarningMessage("File was deleted");
            return;
        }
        const file = vscode.Uri.parse(ressource.uri.path);
        const doc = await vscode.workspace.openTextDocument(file);
        if (split) {
            await window.showTextDocument(doc, { preview: false, viewColumn: vscode.ViewColumn.Beside });
        } else {
            await window.showTextDocument(doc, { preview: false });
        }
    }

    setNewCursor(operation: 'track' | 'stage' | 'unstage', index: number) {
        if (operation === 'track') {
            console.log('track')
            const untracked = this.repo.state.workingTreeChanges.filter(c => c.status === Status.UNTRACKED);
            if (index == untracked.length - 1) {
                if (index == 0) {
                    this.line = this.untrackedOffset;
                } else {
                    this.line = this.untrackedOffset + index - 1;
                }
            } else {
                this.line = this.untrackedOffset + index;
            }
        } else if (operation === 'stage') {
            const unstaged = this.repo.state.workingTreeChanges.filter(c => c.status !== Status.UNTRACKED);
            if (index == unstaged.length - 1) {
                if (index == 0) {
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
            const untrackedLen = this.repo.state.workingTreeChanges.filter(c => c.status === Status.UNTRACKED).length;
            const unstagedLen = this.repo.state.workingTreeChanges.filter(c => c.status !== Status.UNTRACKED).length;
            if (ressourceStatus === Status.INDEX_ADDED && untrackedLen === 0 ||
                ressourceStatus !== Status.INDEX_ADDED && unstagedLen === 0
            ) {
                addUnstagedOffset = 2;
            }
            if (index == this.repo.state.indexChanges.length - 1) {
                if (index == 0) {
                    this.line = this.unstagedOffset;
                } else {
                    this.line = this.stagedOffset + index;
                }
            } else {
                this.line = this.stagedOffset + index + 1;
            }
            this.line += addUnstagedOffset
        } else {
            throw Error(operation + " not implemented");
        }
    }
}

function mapStatustoString(status: number) {
    switch (status) {
        case 0:
            return 'M';
        case 1:
            return 'A';
        case 2:
            return 'D';
        case 3:
            return 'R';
        case 4:
            return 'C';
        case 5:
            return 'M';
        case 6:
            return 'D';
        case 7:
            return 'U';
        default:
            return status;
    }
}
