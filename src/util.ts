import * as vscode from 'vscode';
import { Status } from './vscode-git';
import { ResourceAtCursor } from './provider';

export async function readFile(uri: vscode.Uri): Promise<string> {
    return (new TextDecoder())
        .decode(await vscode.workspace.fs.readFile(uri));
}

export function mapStatustoString(status: number) {
    switch (status) {
        case Status.INDEX_ADDED:
        case Status.INTENT_TO_ADD:
        case Status.ADDED_BY_US:
        case Status.ADDED_BY_THEM:
        case Status.BOTH_ADDED:
            return 'A';
        case Status.INDEX_COPIED:
            return 'C';
        case Status.INDEX_DELETED:
        case Status.DELETED:
        case Status.DELETED_BY_US:
        case Status.DELETED_BY_THEM:
        case Status.BOTH_DELETED:
            return 'D';
        case Status.IGNORED:
            return 'I';
        case Status.INDEX_MODIFIED:
        case Status.MODIFIED:
        case Status.BOTH_MODIFIED:
            return 'M';
        case Status.INDEX_RENAMED:
        case Status.INTENT_TO_RENAME:
            return 'R';
        case Status.TYPE_CHANGED:
            return 'T';
        case Status.UNTRACKED:
            return 'U';
        default:
            return status;
    }
}
export function isEqualResource(a: ResourceAtCursor, b: ResourceAtCursor): boolean {
    return a.type === b.type && a.renderIndex === b.renderIndex; // is enough
}

export function setCursorWithView(line: number) {
    const position = new vscode.Position(line, 0);
    const range = new vscode.Range(position, position);
    const windowContainsCursor = vscode.window.activeTextEditor?.visibleRanges[0].contains(position);
    if (!windowContainsCursor) {
        vscode.window.activeTextEditor!.revealRange(range);
    }
    vscode.window.activeTextEditor!.selection =
        new vscode.Selection(position, position);
}