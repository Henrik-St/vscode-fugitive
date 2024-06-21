import * as vscode from 'vscode';
import { window } from 'vscode';
import { API as GitAPI, Change, Repository, Commit } from './vscode-git';

export class Provider implements vscode.TextDocumentContentProvider {
    // emitter and its event
    static myScheme = 'fugitive';
    private gitExtension: any;
    private api: GitAPI;
    repo: Repository;
    rootUri: string;

    unstagedOffset: number;
    stagedOffset: number;
    unpushedOffset: number;

    unpushedCommits: Commit[];
    line: number;

    onDidChangeEmitter = new vscode.EventEmitter<vscode.Uri>();
    onDidChange = this.onDidChangeEmitter.event;
    private _subscriptions: vscode.Disposable;
    mapChangeToName: (c: Change) => string;

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


        const unstagedOffset = 5;
        const unstagedLen = this.repo.state.workingTreeChanges.length;
        const stagedLen = this.repo.state.indexChanges.length;
        const stagedOffset = unstagedOffset + unstagedLen + Number(unstagedLen > 0) * 2;

        this.unstagedOffset = unstagedOffset;
        this.stagedOffset = stagedOffset;
        this.unpushedOffset = stagedOffset + stagedLen + Number(stagedLen > 0) * 2;

        // on Git Changed
        this._subscriptions = this.repo.state.onDidChange(async () => {
            console.debug('onGitChanged');

            const unstagedOffset = 5;
            const unstagedLen = this.repo.state.workingTreeChanges.length;
            const stagedLen = this.repo.state.indexChanges.length;
            const stagedOffset = unstagedOffset + unstagedLen + Number(unstagedLen > 0) * 2;

            this.unstagedOffset = unstagedOffset;
            this.stagedOffset = stagedOffset;
            this.unpushedOffset = stagedOffset + stagedLen + Number(stagedLen > 0) * 2;
            console.log(this.stagedOffset + " " + this.unpushedOffset)
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
        // render unstaged
        if (this.repo.state.workingTreeChanges.length > 0) {
            const unstaged = this.repo.state.workingTreeChanges.map(this.mapChangeToName).join('\n');
            const unstagedCount = this.repo.state.workingTreeChanges.length;
            renderString += `\n\nUnstaged (${unstagedCount}):\n${unstaged}`;
        }
        // render staged
        if (this.repo.state.indexChanges.length > 0) {
            const staged = this.repo.state.indexChanges.map(this.mapChangeToName).join('\n');
            const stagedCount = this.repo.state.indexChanges.length;
            renderString += `\n\nStaged (${stagedCount}):\n${staged}`;
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

    goUnstaged() {
        if (this.repo.state.workingTreeChanges.length > 0) {
            window.activeTextEditor!.selection =
                new vscode.Selection(new vscode.Position(this.unstagedOffset, 0), new vscode.Position(this.unstagedOffset, 0));
        }
    }
    goUnpushed() {
        if (this.repo.state.HEAD?.ahead) {
            window.activeTextEditor!.selection =
                new vscode.Selection(new vscode.Position(this.unpushedOffset, 0), new vscode.Position(this.unpushedOffset, 0));
        }
    }

    async stageFile(line: number) {
        const ressourceIndex = line - this.unstagedOffset;
        console.debug('ressourceIndex ', ressourceIndex);
        this.setNewCursor('stage', ressourceIndex);
        if (ressourceIndex >= 0 && ressourceIndex < this.repo.state.workingTreeChanges.length) {
            const ressource = this.repo.state.workingTreeChanges[ressourceIndex].uri.path;
            console.debug('stage ', ressource);
            await this.repo.add([ressource]);
        }
    }

    async unstageFile(line: number) {
        const ressourceIndex = line - this.stagedOffset;
        console.debug('ressourceIndex ', ressourceIndex);
        this.setNewCursor('unstage', ressourceIndex);
        if (ressourceIndex >= 0 && ressourceIndex < this.repo.state.indexChanges.length) {
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
        const file = vscode.Uri.parse(ressource.path);
        const doc = await vscode.workspace.openTextDocument(file);
        if (split) {
            await window.showTextDocument(doc, { preview: false, viewColumn: vscode.ViewColumn.Beside });
        } else {
            await window.showTextDocument(doc, { preview: false });
        }
    }

    async openCommitDiff() {
        // const result = await this.repo.diffWithHEAD(ressource);
    }

    setNewCursor(operation: 'stage' | 'unstage', index: number) {
        if (operation === 'stage') {
            if (index == this.repo.state.workingTreeChanges.length - 1) {
                if (index == 0) {
                    console.debug("stage first and last item")
                    this.line = this.unstagedOffset;
                } else {
                    console.debug("stage last item")
                    this.line = this.unstagedOffset + index - 1;
                }
            } else {
                this.line = this.unstagedOffset + index;
            }
        } else {
            let addUnstagedOffset = 0
            if (this.repo.state.workingTreeChanges.length == 0) {
                addUnstagedOffset = 2;
            }
            if (index == this.repo.state.indexChanges.length - 1) {
                if (index == 0) {
                    console.debug("unstage first and last item")
                    this.line = this.unstagedOffset + addUnstagedOffset;
                } else {
                    console.debug("unstage last item")
                    this.line = this.stagedOffset + index + addUnstagedOffset;
                }
            } else {
                this.line = this.stagedOffset + index + 1 + addUnstagedOffset;
            }
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
