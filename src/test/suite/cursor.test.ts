import * as vscode from "vscode";
import * as assert from "assert";
import { cmdAtLine, wait } from "./utils.test";

/**
 * Stage all files one by one in the untracked area
 */
export async function cursorStage(): Promise<void> {
    await cmdAtLine(6, "fugitive.stage");
    await wait(50);
    assert.strictEqual(vscode.window.activeTextEditor?.selection.active.line, 6, "Cursor does not stay at line 7");
    await cmdAtLine(6, "fugitive.stage");
    await wait(50);
    assert.strictEqual(
        vscode.window.activeTextEditor?.selection.active.line,
        5,
        "Cursor does not stay in bounds of changes"
    );
    await cmdAtLine(5, "fugitive.stage");
    await wait(50);
    assert.strictEqual(
        vscode.window.activeTextEditor?.selection.active.line,
        5,
        "Cursor does not stay at beginning of change category"
    );
    assert(true, "Cursor stage test not implemented");
}

/**
 * Unstage all one by one in the staged area
 * Use the tree view
 */
export async function cursorUnstage(): Promise<void> {
    await vscode.commands.executeCommand("fugitive.toggleView", "list");
    await vscode.commands.executeCommand("fugitive.toggleView");
    assert.strictEqual(
        vscode.workspace.getConfiguration("fugitive").get("viewStyle"),
        "tree",
        "View style is not tree"
    );
}
