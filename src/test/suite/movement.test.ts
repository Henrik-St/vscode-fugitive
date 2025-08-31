import * as vscode from "vscode";
import * as assert from "assert";
import { cmdAtLine, wait, getDocument, getLine, cmd } from "./utils.test";

export async function refresh(): Promise<void> {
    await cmdAtLine(5, "fugitive.refresh");
    await wait(100);
    assert.strictEqual(vscode.window.activeTextEditor?.selection.active.line, 5, "Cursor does not stay");
}

export async function close(): Promise<void> {
    await cmdAtLine(5, "fugitive.close");
    assert(vscode.window.activeTextEditor?.document.uri.scheme !== "fugitive", "Fugitive document is still open");
}
export async function goTop(): Promise<void> {
    await cmdAtLine(5, "fugitive.goTop");
    assert.strictEqual(vscode.window.activeTextEditor?.selection.active.line, 0, "Cursor does not got to the top");
}
export async function goDown(): Promise<void> {
    await cmdAtLine(5, "fugitive.goDown");
    assert.strictEqual(vscode.window.activeTextEditor?.selection.active.line, 6, "Cursor does not go down one line");
}
export async function goUp(): Promise<void> {
    await cmdAtLine(5, "fugitive.goUp");
    assert.strictEqual(vscode.window.activeTextEditor?.selection.active.line, 4, "Cursor does not go up one line");
}

export async function goUntracked(): Promise<void> {
    const document = await getDocument();
    await cmdAtLine(5, "fugitive.goUntracked");
    assert(vscode.window.activeTextEditor?.selection.active.line, "No active cursor");
    const text = document.lineAt(vscode.window.activeTextEditor?.selection.active.line).text;
    console.debug(text);
    assert.match(text, /Untracked.*/);
}

export async function goUnstaged(): Promise<void> {
    const document = await getDocument();
    await cmdAtLine(10, "fugitive.goUnstaged");
    assert(vscode.window.activeTextEditor?.selection.active.line, "No active cursor");
    const text = document.lineAt(vscode.window.activeTextEditor?.selection.active.line).text;
    console.debug(text);
    assert.match(text, /Unstaged.*/);
}

export async function goStaged(): Promise<void> {
    const document = await getDocument();
    await cmdAtLine(5, "fugitive.goStaged");
    assert(vscode.window.activeTextEditor?.selection.active.line, "No active cursor");
    const text = document.lineAt(vscode.window.activeTextEditor?.selection.active.line).text;
    console.debug(text);
    assert.match(text, /Staged.*/);
}

export async function goUnpushed(): Promise<void> {
    const document = await getDocument();
    await cmdAtLine(5, "fugitive.goUnpushed");
    assert(vscode.window.activeTextEditor?.selection.active.line, "No active cursor");
    const text = document.lineAt(vscode.window.activeTextEditor?.selection.active.line).text;
    console.debug(text);
    assert.match(text, /Unpushed.*/);
}

export async function goNextHunk(): Promise<void> {
    const document = await getDocument();
    // Check when no inline diff is active
    await vscode.commands.executeCommand("fugitive.goStaged");
    const line_number = getLine();
    await vscode.commands.executeCommand("fugitive.nextHunk");
    assert.strictEqual(getLine(), line_number + 1, "1. Next hunk is not the next line");
    await vscode.commands.executeCommand("fugitive.nextHunk");
    assert.strictEqual(getLine(), line_number + 2, "2. Next hunk is not the next line");

    // Check when inline diff is active
    await vscode.commands.executeCommand("fugitive.goStaged");
    await vscode.commands.executeCommand("fugitive.goDown");
    const line_number_2 = getLine();
    await vscode.commands.executeCommand("fugitive.toggleInlineDiff");
    await wait(100);
    assert.strictEqual(getLine(), line_number_2, "3. toggleInlineDiff moved cursor");
    await vscode.commands.executeCommand("fugitive.nextHunk");
    assert.strictEqual(getLine(), line_number_2 + 1, "4. Next hunk is not the next line");
    const text = document.lineAt(getLine()).text;
    assert.match(text, /@@.*/);
    await vscode.commands.executeCommand("fugitive.toggleInlineDiff");
    await wait(100);
    assert.strictEqual(getLine(), line_number_2, "5. toggleInlineDiff did not move cursor back");
}

export async function goPreviousHunk(): Promise<void> {
    const document = await getDocument();
    await vscode.commands.executeCommand("fugitive.goStaged");
    await vscode.commands.executeCommand("fugitive.goDown");
    await vscode.commands.executeCommand("fugitive.goDown");
    await vscode.commands.executeCommand("fugitive.goDown");
    const line_number = getLine();
    await vscode.commands.executeCommand("fugitive.previousHunk");
    assert.strictEqual(getLine(), line_number - 1, "1. Previous hunk is not the previous line");
    await vscode.commands.executeCommand("fugitive.previousHunk");
    assert.strictEqual(getLine(), line_number - 2, "2. Previous hunk is not the previous line");

    // Check when inline diff is active
    await vscode.commands.executeCommand("fugitive.goStaged");
    await vscode.commands.executeCommand("fugitive.goDown");
    const line_number_2 = getLine();
    await vscode.commands.executeCommand("fugitive.toggleInlineDiff");
    await wait(100);
    assert.strictEqual(getLine(), line_number_2, "3. toggleInlineDiff moved cursor");
    await vscode.commands.executeCommand("fugitive.goDown");
    await vscode.commands.executeCommand("fugitive.goDown");
    await vscode.commands.executeCommand("fugitive.previousHunk");
    await wait(100);
    assert.strictEqual(getLine(), line_number_2 + 1, "4. Previous hunk is not the next line");
    const text = document.lineAt(getLine()).text;
    assert.match(text, /@@.*/);
    await vscode.commands.executeCommand("fugitive.toggleInlineDiff");
    await wait(100);
    assert.strictEqual(getLine(), line_number_2, "5. toggleInlineDiff did not move cursor back");
}

/** --------- Expected Document content -----------
    ...
    09: Unstaged (1):
    10: M unstaged.txt
    11: 
    ...
 */
export async function openDiff(): Promise<void> {
    cmdAtLine(10, "fugitive.openDiff");
    await wait(500);
    const editor = vscode.window.activeTextEditor;
    assert.ok(editor, "No active text editor after executing fugitive.openDiff command");
    const path = editor.document.uri.path;
    assert.ok(path.endsWith("unstaged.txt"), "Diff file is not unstaged.txt: " + path);
    await cmd("workbench.action.closeActiveEditor");
    await getDocument(); // assert again that fugitive is active
}

/** --------- Expected Document content -----------
    ...
    12: Staged (1):
    13: M staged.txt
    ...
 */
export async function openFile(): Promise<void> {
    cmdAtLine(13, "fugitive.openFile");
    await wait(500);
    const editor = vscode.window.activeTextEditor;
    assert.ok(editor, "No active text editor after executing fugitive.openDiff command");
    const path = editor.document.uri.path;
    assert.ok(path.endsWith("staged.txt"), "Opened file is not staged.txt: " + path);
    await cmd("workbench.action.closeActiveEditor");
    await getDocument(); // assert again that fugitive is active
}
