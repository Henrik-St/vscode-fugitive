import * as vscode from 'vscode';
import { API as GitAPI, Commit } from './vscode-git';
import { GitWrapper } from './git-wrapper';

export class DiffProvider implements vscode.TextDocumentContentProvider {
    static scheme = 'Fugitive-Diff';

    private onDidChangeEmitter = new vscode.EventEmitter<vscode.Uri>();
    onDidChange = this.onDidChangeEmitter.event; // triggers before provideTextDocumentContent
    private subscriptions: vscode.Disposable[] = [];
    public git: GitWrapper;

    constructor(gitAPI: GitAPI) {
        this.git = new GitWrapper(gitAPI);
    }

    dispose() {
        this.subscriptions.forEach(e => e.dispose());
    }

    provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
        return this.git.constructCommitDiff(decodeCommit(uri));
    }

}

let seq = 0;

export function encodeCommit(commit: Commit): vscode.Uri {
	const query = JSON.stringify(commit);
    const shortHash = commit.hash.slice(0, 8);
	return vscode.Uri.parse(`${DiffProvider.scheme}:${shortHash}.diff?${query}#${seq++}`);
}

export function decodeCommit(uri: vscode.Uri): Commit {
	const commit = JSON.parse(uri.query) as Commit;
	return commit;
}