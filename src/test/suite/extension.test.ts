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

    // Not testable or not yet implemented
    test("Batch base tests", async function () {
        await cmdAtLine(1, "fugitive.stage");
        await cmdAtLine(1, "fugitive.unstage");
        await cmdAtLine(1, "fugitive.toggle");
        // await cmdAtLine(1, 'fugitive.unstageAll');
        await cmdAtLine(1, "fugitive.clean");
        await cmdAtLine(1, "fugitive.toggleInlineDiff");
        await cmdAtLine(1, "fugitive.openDiff");
        // await cmdAtLine(1, "fugitive.amendNoEdit");
        await cmdAtLine(1, "fugitive.popLatestStash");
        await cmdAtLine(1, "fugitive.gitExclude");
        await cmdAtLine(1, "fugitive.gitIgnore");
        await cmdAtLine(1, "fugitive.openFile");
        await cmdAtLine(1, "fugitive.openFileSplit");
        await cmdAtLine(1, "fugitive.toggleView");
        await cmdAtLine(1, "fugitive.toggleDirectory");
        assert.strictEqual(true, true, "Batch base tests passed");
    });

    // test('Check status contents', async function () {
    //     this.timeout(10_000);
    //     const document = await getDocument();
    //     const assert_line = (line: number, expected_text: string) => {
    //         const line_text = document.lineAt(line).text;
    //         assert.strictEqual(line_text, expected_text, `Line ${line} does not contain expected text`);
    //     };
    //     console.debug("-------check initial document contents-----");
    //     const untracked =  'U untracked.txt';
    //     const untracked_staged =  'A untracked.txt';
    //     const unstaged = 'M unstaged.txt';
    //     const staged = 'M staged.txt';
    //     assert_line(5, untracked);
    //     assert_line(9, unstaged);
    //     assert_line(12, staged);

    //     console.debug("-------check cursor behavior-----");
    //     await cmdAtLine(6, 'fugitive.stage');
    //     await wait(500);
    //     assert.strictEqual(
    //         vscode.window.activeTextEditor?.selection.active.line,
    //         5,
    //         "Cursor stays at line 5 when there are still unstaged items"
    //     );
    //     await wait(500);
    //     assert_line(13, staged);

    //     assert_line(9, untracked_staged);
    //     await cmdAtLine(9, 'fugitive.clean');
    //     await wait(500);
    //     assert.strictEqual(
    //         vscode.window.activeTextEditor?.selection.active.line,
    //         5,
    //         "Cursor goes from staged to unstaged"
    //     );

    // });

    test("Close", close); // Do at end
});
