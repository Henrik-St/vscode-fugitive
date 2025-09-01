import * as vscode from "vscode";
import * as assert from "assert";
import { cmd, cmdAtLine, getLine } from "./utils.test";

/**
 * Stage all files one by one in the untracked area
 */
export async function cursorStage(): Promise<void> {
    await cmdAtLine(6, "fugitive.stage");
    assert.strictEqual(vscode.window.activeTextEditor?.selection.active.line, 6, "Cursor does not stay at line 7");
    await cmdAtLine(6, "fugitive.toggle"); // same as stage
    assert.strictEqual(getLine(), 5, "Cursor does not stay in bounds of changes");
    await cmdAtLine(5, "fugitive.stage");
    assert.strictEqual(getLine(), 5, "Cursor does not stay at beginning of change category");
    assert(true, "Cursor stage test not implemented");
}

/**
 * Unstage all one by one in the staged area
 * Use the tree view
 * --------- Expected Initial Document Content -----------
    00: Head: main
    01: Merge: origin/main
    02: Help: g h
    03: 
    04: Unstaged (1):
    05: M unstaged.txt
    06: 
    07: Staged (4):
    08: M staged.txt
    09: A untracked1.txt
    >>: A untracked2.txt
    11: A untracked3.txt
    12: 
    13: Unpushed to origin/main (1):
    14: fbcd88e3 fix: set test basis
 */
export async function cursorUnstage(): Promise<void> {
    await vscode.commands.executeCommand("fugitive.toggleView", "list");
    assert.strictEqual(
        vscode.workspace.getConfiguration("fugitive").get("viewStyle"),
        "list",
        "View style is not list"
    );
    await vscode.commands.executeCommand("fugitive.toggleView");
    assert.strictEqual(
        vscode.workspace.getConfiguration("fugitive").get("viewStyle"),
        "tree",
        "View style is not tree"
    );

    await cmdAtLine(5, "fugitive.goStaged");
    await vscode.commands.executeCommand("fugitive.goDown");
    await vscode.commands.executeCommand("fugitive.goDown");
    await vscode.commands.executeCommand("fugitive.goDown");

    // find the line of the staged category
    const document = vscode.window.activeTextEditor?.document;
    assert(document, "No active document");
    let line_of_header = document
        .getText()
        .split("\n")
        .findIndex((t: string) => /Staged.*/.test(t));

    const line_number = getLine();
    assert.strictEqual(line_number, line_of_header + 3, "Line number is not correct");
    await cmd("fugitive.unstage");
    line_of_header = document
        .getText()
        .split("\n")
        .findIndex((t: string) => /Staged.*/.test(t));
    assert.strictEqual(getLine(), line_of_header + 3, "1. Cursor does not go down one line after unstaging");
    await cmd("fugitive.toggle"); // same as unstage
    line_of_header = document
        .getText()
        .split("\n")
        .findIndex((t: string) => /Staged.*/.test(t));
    assert.strictEqual(getLine(), line_of_header + 2, "2. Cursor does not go down one line after unstaging");
    await cmd("fugitive.unstage");
    assert.strictEqual(getLine(), line_of_header + 2, "Cursor does not stay at line after unstaging at end");
    await cmd("fugitive.unstage");
    line_of_header = document
        .getText()
        .split("\n")
        .findIndex((t: string) => /Unstaged.*/.test(t));
    assert.strictEqual(getLine(), line_of_header + 1, "Cursor does not go to category above");
}
