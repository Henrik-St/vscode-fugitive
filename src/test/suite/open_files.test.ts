import * as vscode from "vscode";
import * as assert from "assert";
import { cmd } from "./utils.test";

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
