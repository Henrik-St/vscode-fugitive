import * as assert from "assert";
import * as vscode from "vscode";
import { execSync } from "child_process";
import { cmdAtLine } from "./utils.test";
import {
    close,
    goDown,
    goNextHunk,
    goPreviousHunk,
    goStaged,
    goTop,
    goUnpushed,
    goUnstaged,
    goUntracked,
    goUp,
    refresh,
} from "./movement.test";
import { cursorStage, cursorUnstage } from "./cursor.test";
import { gitIgnore } from "./open_files.test";

const test_repo_path = vscode.workspace.workspaceFolders?.[0].uri.fsPath;

suite("Extension Test Suite", () => {
    suiteSetup(async function () {
        console.info("Running suiteSetup");
        execSync(`cd ${test_repo_path} && git reset && git checkout -- . && git clean -fd`);
        this.timeout(5000);
        execSync(`touch ${test_repo_path}/untracked1.txt`);
        execSync(`touch ${test_repo_path}/untracked2.txt`);
        execSync(`touch ${test_repo_path}/untracked3.txt`);
        execSync(`echo change >> ${test_repo_path}/unstaged.txt`);
        execSync(`echo change >> ${test_repo_path}/staged.txt`);
        execSync(`cd ${test_repo_path} && git add staged.txt`);
        await vscode.commands.executeCommand("fugitive.open");
    });
    suiteTeardown(function () {
        console.info("Running suiteTeardown");
        execSync(`cd ${test_repo_path} && git reset && git checkout -- . && git clean -fd`);
        console.info("All tests done!");
    });

    const extension = vscode.extensions.getExtension("hnrk-str.vscode-fugitive");
    test("Extension is loaded", () => {
        assert.ok(extension, "Extension hnrk-str.vscode-fugitive is not loaded");
    });

    test("Go to Untracked", goUntracked);
    test("Go to Unstaged", goUnstaged);
    test("Go to Staged", goStaged);
    test("Go to Unpushed", goUnpushed);
    test("Go up", goUp);
    test("Go down", goDown);
    test("Go top", goTop);
    test("Refresh", refresh);

    // cursor tests
    test("Cursor staging", cursorStage);
    test("Go Next Hunk", goNextHunk);
    test("Go Previous Hunk", goPreviousHunk);
    test("Cursor unstaging", cursorUnstage);
    test("Git ignore", gitIgnore);

    // Not testable or not yet implemented
    test("Batch base tests", async function () {
        await cmdAtLine(1, "fugitive.unstage");
        await cmdAtLine(1, "fugitive.toggle");
        // await cmdAtLine(1, 'fugitive.unstageAll');
        await cmdAtLine(1, "fugitive.clean");
        await cmdAtLine(1, "fugitive.openDiff");
        // await cmdAtLine(1, "fugitive.amendNoEdit");
        await cmdAtLine(1, "fugitive.popLatestStash");
        await cmdAtLine(1, "fugitive.openFile");
        await cmdAtLine(1, "fugitive.openFileSplit");
        await cmdAtLine(1, "fugitive.toggleView");
        await cmdAtLine(1, "fugitive.toggleDirectory");
        assert.strictEqual(true, true, "Batch base tests passed");
    });

    test("Close", close);
});
