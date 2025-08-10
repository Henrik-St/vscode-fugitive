import * as vscode from "vscode";
import * as assert from "assert";
import { cmdAtLine, wait } from "./utils.test";

export async function cursorStage(): Promise<void> {
    await cmdAtLine(6, "fugitive.stage");
    await wait(100);
    assert.strictEqual(vscode.window.activeTextEditor?.selection.active.line, 6, "Cursor does not stay at line 7");
    await cmdAtLine(6, "fugitive.stage");
    await wait(100);
    assert.strictEqual(
        vscode.window.activeTextEditor?.selection.active.line,
        5,
        "Cursor does not stay in bounds of changes"
    );
    await cmdAtLine(5, "fugitive.stage");
    await wait(100);
    assert.strictEqual(
        vscode.window.activeTextEditor?.selection.active.line,
        5,
        "Cursor does not stay at beginning of change category"
    );
    assert(true, "Cursor stage test not implemented");
}
