import assert = require("assert");
import * as vscode from "vscode";

export function wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export function getLineText(): string {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        throw new Error("No active text editor");
    }
    const line = editor.selection.active.line;
    return editor.document.lineAt(line).text;
}

export function getLine(): number {
    const l = vscode.window.activeTextEditor?.selection.active.line;
    if (!l) {
        throw new Error("No active text editor or selection");
    }
    return l;
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

export async function cmd(command: string): Promise<unknown> {
    const res = await vscode.commands.executeCommand(command);
    await wait(100);
    return res;
}

export function cmdAtLine(line: number, command: string): Thenable<unknown> {
    setLine(line);
    return cmd(command);
}

export async function getDocument(): Promise<vscode.TextDocument> {
    const editor = vscode.window.activeTextEditor;
    assert.ok(editor, "No active text editor after executing fugitive.open command");
    assert.strictEqual(
        editor.document.uri.toString(),
        "fugitive:Fugitive",
        "Active text editor does not have the expected URI"
    );
    return editor.document;
}

export function logDocument(document: vscode.TextDocument, expected: number): void {
    const doc_text = document.getText();
    const current_line = getLine();
    console.log("\n--------- Document content -----------");
    const new_text = doc_text
        .split("\n")
        .map((line, i) =>
            i === current_line && i === expected
                ? `>>: ${line}`
                : i === current_line
                  ? `AC: ${line}`
                  : i === expected
                    ? `EX: ${line}`
                    : `${i.toString().padStart(2, "0")}: ${line}`
        );
    console.log(new_text.join("\n"));
}
