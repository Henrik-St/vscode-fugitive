import * as vscode from "vscode";
import { Status } from "./vscode-git";

export async function readFile(uri: vscode.Uri): Promise<string> {
    return new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
}

export function mapStatustoString(status: number): string {
    switch (status) {
        case Status.INDEX_ADDED:
        case Status.INTENT_TO_ADD:
        case Status.ADDED_BY_US:
        case Status.ADDED_BY_THEM:
        case Status.BOTH_ADDED:
            return "A";
        case Status.INDEX_COPIED:
            return "C";
        case Status.INDEX_DELETED:
        case Status.DELETED:
        case Status.DELETED_BY_US:
        case Status.DELETED_BY_THEM:
        case Status.BOTH_DELETED:
            return "D";
        case Status.IGNORED:
            return "I";
        case Status.INDEX_MODIFIED:
        case Status.MODIFIED:
        case Status.BOTH_MODIFIED:
            return "M";
        case Status.INDEX_RENAMED:
        case Status.INTENT_TO_RENAME:
            return "R";
        case Status.TYPE_CHANGED:
            return "T";
        case Status.UNTRACKED:
            return "U";
        default:
            return status.toString();
    }
}

export function setCursorWithView(line: number): void {
    const position = new vscode.Position(line, 0);
    const range = new vscode.Range(position, position);
    const window_contains_cursor = vscode.window.activeTextEditor?.visibleRanges[0].contains(position);
    if (!window_contains_cursor) {
        vscode.window.activeTextEditor!.revealRange(range);
    }
    vscode.window.activeTextEditor!.selection = new vscode.Selection(position, position);
}
