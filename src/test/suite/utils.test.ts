import assert = require("assert");
import * as vscode from "vscode";

export function wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export function setLine(line: number): void {
    if (line < 0) {
        throw new Error("Line number must be non-negative");
    }
    vscode.window.activeTextEditor!.selection = new vscode.Selection(
        new vscode.Position(line, 0),
        new vscode.Position(line, 0)
    );
}

export function cmdAtLine(line: number, command: string): Thenable<unknown> {
    setLine(line);
    return vscode.commands.executeCommand(command);
}

export async function getDocument(): Promise<vscode.TextDocument> {
    console.debug("fugitive.open executed");
    const editor = vscode.window.activeTextEditor;
    assert.ok(editor, "No active text editor after executing fugitive.open command");
    assert.strictEqual(
        editor.document.uri.toString(),
        "fugitive:Fugitive",
        "Active text editor does not have the expected URI"
    );
    return editor.document;
}
