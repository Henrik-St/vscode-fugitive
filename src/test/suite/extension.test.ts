import * as assert from "assert";
import * as vscode from "vscode";
import { exec, execSync } from "child_process";
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
import { gitIgnore, openDiff, openFile } from "./open_files.test";

const test_repo_path =
    vscode.workspace.workspaceFolders?.[0].uri.fsPath ?? `${execSync(`pwd`).toString().trim()}/git-test`;
const test_repo_remote_path =
    vscode.workspace.workspaceFolders?.[0].uri.fsPath ?? `${execSync(`pwd`).toString().trim()}/git-test`;

suite("Extension Test Suite", () => {
    suiteSetup(async function () {
        console.info("Running suiteSetup");
        console.info(`Setting up test repo at ${test_repo_path}`);
        execSync(
            `rm -rf ${test_repo_remote_path} && mkdir -p ${test_repo_remote_path} && cd ${test_repo_remote_path} && git init --initial-branch=egal`
        );
        execSync(
            `rm -rf ${test_repo_path} && mkdir -p ${test_repo_path} && cd ${test_repo_path} && git init && git remote add rem ${test_repo_remote_path} && git commit --allow-empty -m "m" && git push --set-upstream rem main`
        );
        this.timeout(5000);
        execSync(`yes change | head -n 10 >> ${test_repo_path}/unstaged.txt`);
        execSync(`yes change | head -n 10 >> ${test_repo_path}/staged.txt`);
        execSync(`cd ${test_repo_path} && git add --all`);
        try {
            const stdout = execSync(`cd ${test_repo_path} && git commit -m 'Initial_commit'`, { encoding: "utf-8" });
            console.info(stdout);
        } catch (error) {
            console.error("Error during initial commit:", error);
        }
        execSync(`cd ${test_repo_path} && touch untracked1.txt untracked2.txt untracked3.txt`);
        execSync(`echo change >> ${test_repo_path}/unstaged.txt`);
        execSync(`echo change >> ${test_repo_path}/staged.txt`);
        execSync(`cd ${test_repo_path} && git add staged.txt`);
        await vscode.commands.executeCommand("fugitive.open");
    });
    suiteTeardown(function () {
        console.info("Running suiteTeardown");
        execSync(`rm -rf ${test_repo_path}`);
        execSync(`rm -rf ${test_repo_remote_path}`);
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
    test("Open Diff", openDiff);
    test("Open File", openFile);

    // cursor tests
    test("Cursor staging", cursorStage);
    test("Go Next Hunk", goNextHunk);
    test("Go Previous Hunk", goPreviousHunk);
    test("Cursor unstaging", cursorUnstage);
    test("Git ignore", gitIgnore);

    // Not testable or not yet implemented as test
    test("Batch base tests", async function () {
        // await cmdAtLine(1, 'fugitive.unstageAll');
        await cmdAtLine(1, "fugitive.clean");
        // await cmdAtLine(1, "fugitive.amendNoEdit");
        await cmdAtLine(1, "fugitive.popLatestStash");
        await cmdAtLine(1, "fugitive.openFileSplit");
        await cmdAtLine(1, "fugitive.toggleDirectory");
    });

    test("Close", close);
});
