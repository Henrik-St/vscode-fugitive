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

        this.mapChangeToName = (c: Change) => mapStatustoString(c.status) + " " + c.originalUri.path.replace(this.rootUri, '');


        this.unstagedOffset = 3;
        this.stagedOffset = 3 + this.repo.state.workingTreeChanges.length + 2;
        this.unpushedOffset = 3 + this.repo.state.workingTreeChanges.length + 2
            + this.repo.state.indexChanges.length + 2;

        // on Git Changed
        this._subscriptions = this.repo.state.onDidChange(async () => {
            console.log('onGitChanged');

            this.unpushedCommits = await this.repo.log({ range: this.repo.state.remotes[0].name + "/" + this.repo.state.HEAD?.name + "..HEAD" })
            const doc = vscode.workspace.textDocuments.find(doc => doc.uri.scheme === Provider.myScheme);
            if (doc) {
                this.onDidChangeEmitter.fire(doc.uri);
            }
        });
    }

    dispose() {
        this._subscriptions.dispose();
    }
    //@TODO: set correct merge name
    provideTextDocumentContent(uri: vscode.Uri): string {
        console.log('provideTextDocumentContent');
        const head = this.repo.state.HEAD?.name;
        let renderString = `Head: ${head}\nMerge: ${this.repo.state.remotes[0].name}/${head}\nHelp: g?`;
        // render unstaged
        if (this.repo.state.workingTreeChanges.length > 0) {
            const unstaged = this.repo.state.workingTreeChanges.map(this.mapChangeToName).join('\n');
            const unstagedCount = this.repo.state.workingTreeChanges.length;
            renderString += `\n\nUnstaged (${unstagedCount}):\n${unstaged}`;
            this.unstagedOffset = 5;
        } else {
            this.unstagedOffset = 3;
        }
        // render staged
        if (this.repo.state.indexChanges.length > 0) {
            const staged = this.repo.state.indexChanges.map(this.mapChangeToName).join('\n');
            const stagedCount = this.repo.state.indexChanges.length;
            renderString += `\n\nStaged (${stagedCount}):\n${staged}`;
        }

        if (this.repo.state.HEAD?.ahead) {
            console.log("ahead" + this.unpushedCommits.length)
            const len = this.unpushedCommits.length;
            const to = `${this.repo.state.remotes[0].name}/${head}`
            const commits = this.unpushedCommits.map(c =>
                c.hash.slice(0, 8) + " " + c.message
            ).join('\n');
            renderString += `\n\nUnpushed to ${to} (${len}):\n${commits}`;
        }
        this.stagedOffset = this.unstagedOffset + this.repo.state.workingTreeChanges.length + 2;
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

    async stageFile(line: number) {
        const ressourceIndex = line - this.unstagedOffset;

        if (ressourceIndex >= 0 && ressourceIndex < this.repo.state.workingTreeChanges.length) {
            const ressource = this.repo.state.workingTreeChanges[ressourceIndex].uri.path;
            console.log('stage ', ressource);
            await this.repo.add([ressource]);
            this.stagedOffset--;
        }
    }
    async unstageFile(line: number) {
        const ressourceIndex = line - this.stagedOffset;
        console.log('ressourceIndex ', ressourceIndex);
        if (ressourceIndex >= 0 && ressourceIndex < this.repo.state.indexChanges.length) {
            const ressource = this.repo.state.indexChanges[ressourceIndex].uri.path;
            console.log('unstage ', ressource);
            await this.repo.revert([ressource]);
            this.stagedOffset++;
        }
    }

    async cleanFile(line: number) {
        let ressourceIndex = line - this.unstagedOffset;

        if (ressourceIndex >= 0 && ressourceIndex < this.repo.state.workingTreeChanges.length) {
            const ressource = this.repo.state.workingTreeChanges[ressourceIndex].uri.path;
            console.log('clean ', ressource);
            await this.repo.clean([ressource]);
            return;
        }
        ressourceIndex = line - this.stagedOffset;
        if (ressourceIndex >= 0 && ressourceIndex < this.repo.state.indexChanges.length) {
            const ressource = this.repo.state.indexChanges[ressourceIndex].uri.path;
            console.log('clean ', ressource);
            await this.repo.revert([ressource]);
            await this.repo.clean([ressource]);
            return;
        }
    }

    async openDiff(line: number) {
        let ressourceIndex = line - this.unstagedOffset;

        console.log('ressourceIndex ', ressourceIndex);
        if (ressourceIndex >= 0 && ressourceIndex < this.repo.state.workingTreeChanges.length) {
            const ressource = this.repo.state.workingTreeChanges[ressourceIndex].uri;
            console.log('diff ', ressource);
            vscode.commands.executeCommand('git.openChange', ressource).then((success) => {
                console.log('success ', success);
            }, (rejected) => {
                console.log('rejected ', rejected);
            });
            return;
        }
        ressourceIndex = line - this.stagedOffset;
        if (ressourceIndex >= 0 && ressourceIndex < this.repo.state.indexChanges.length) {
            const ressource = this.repo.state.indexChanges[ressourceIndex].uri;
            console.log('diff ', ressource);
            vscode.commands.executeCommand('git.openChange', ressource).then((success) => {
                console.log('success ', success);
            }, (rejected) => {
                console.log('rejected ', rejected);
            });
            return;

        }
    }

    async openCommitDiff() {
        // const result = await this.repo.diffWithHEAD(ressource);
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