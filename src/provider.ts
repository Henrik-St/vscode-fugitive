import * as vscode from 'vscode';
import { window } from 'vscode';
import { API as GitAPI, Change, Repository } from './vscode-git';
import { Selection } from 'vscode';

export class Provider implements vscode.TextDocumentContentProvider {
    // emitter and its event
    static myScheme = 'fugitive';
    private gitExtension: any;
    private api: GitAPI;
    repo: Repository;
    rootUri: string;
    head: string | undefined;
    unstagedOffset: number;
    stagedOffset: number;
    onDidChangeEmitter = new vscode.EventEmitter<vscode.Uri>();
    onDidChange = this.onDidChangeEmitter.event;
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
        this.head = this.repo.state.HEAD?.name;

        this.mapChangeToName = (c: Change) => c.originalUri.path.replace(this.rootUri, '');


        this.unstagedOffset = 3;
        this.stagedOffset = 3 + this.repo.state.workingTreeChanges.length + 2;
    }


    provideTextDocumentContent(uri: vscode.Uri): string {
        const head = this.repo.state.HEAD?.name;
        let renderString = `head: ${head}`;
        // render unstaged
        if (this.repo.state.workingTreeChanges.length > 0) {
            const unstaged = this.repo.state.workingTreeChanges.map(this.mapChangeToName).join('\n');
            renderString += `\n\nunstaged:\n${unstaged}`;
            this.unstagedOffset = 3;
        } else {
            this.unstagedOffset = 1;
        }
        // render staged
        if (this.repo.state.indexChanges.length > 0) {
            const staged = this.repo.state.indexChanges.map(this.mapChangeToName).join('\n');
            renderString += `\n\nstaged:\n${staged}`;
        }
        this.stagedOffset = this.unstagedOffset + this.repo.state.workingTreeChanges.length + 2;
        return renderString;
    }

    async getDocOrRefreshIfExists(uri: vscode.Uri) {
        let doc = vscode.workspace.textDocuments.find(doc => doc.uri.scheme === Provider.myScheme);
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