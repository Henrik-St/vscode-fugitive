import * as vscode from "vscode";
import * as assert from "assert";
import { cmd, cmdAtLine, getDocument, wait } from "./utils.test";

export async function gitExclude(): Promise<void> {
    await cmd("fugitive.goUntracked");
    await cmd("fugitive.gitExclude");

    assert(true);
}

export async function gitIgnore(): Promise<void> {
    await cmd("fugitive.goUntracked");
    await cmd("fugitive.goDown");
    await cmd("fugitive.gitIgnore");
    const uri = vscode.window.activeTextEditor?.document.uri.path;
    assert.ok(uri, "No active text editor or document URI");
    const file_name = uri.split("/").pop();
    assert.strictEqual(file_name, ".gitignore", "File name is not gitignore");
    await cmd("fugitive.open");
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
