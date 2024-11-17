import * as vscode from 'vscode';

export async function readFile(uri: vscode.Uri): Promise<string> {
    return (new TextDecoder())
        .decode(await vscode.workspace.fs.readFile(uri));
}