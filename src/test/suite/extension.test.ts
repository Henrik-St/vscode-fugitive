import * as assert from "assert";
import * as vscode from "vscode";
import { execSync } from "child_process";
import { cmdAtLine, wait } from "./utils.test";
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
import { GitWrapper } from "../../git-wrapper";
import { API as GitAPI, Repository } from "../../vscode-git";

function exec(command: string) {
    try {
        const stdout = execSync(command, { encoding: "utf-8" });
        if (stdout) console.info(stdout);
    } catch (error) {
        console.error(error);
    }
}
const test_repo_path = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
const test_repo_remote_path = vscode.workspace.workspaceFolders?.[0].uri.fsPath + "../git-remote-test";

suite("Extension Test Suite", () => {
    suiteSetup(async function () {
        console.info("Running suiteSetup");
        console.info(`Setting up test repo at ${test_repo_path}`);
        exec(`rm -rf ${test_repo_remote_path}`);
        exec(`mkdir -p ${test_repo_remote_path}`);
        exec(`cd ${test_repo_remote_path} && git init --initial-branch=egal`);
        exec(`find ${test_repo_path} -mindepth 1 -delete`);
        exec(`mkdir -p ${test_repo_path}`);
        exec(`touch ${test_repo_path}/.gitkeep`);
        exec(
            `cd ${test_repo_path} && git init --initial-branch=main && git remote add rem ${test_repo_remote_path} && git commit --allow-empty -m "m" && git push --set-upstream rem main`
        );
        await wait(500);
        exec(`yes change | head -n 10 >> ${test_repo_path}/unstaged.txt`);
        exec(`yes change | head -n 10 >> ${test_repo_path}/staged.txt`);
        exec(`cd ${test_repo_path} && git add --all`);
        exec(`cd ${test_repo_path} && git commit -m 'Initial_commit'`);
        exec(`cd ${test_repo_path} && touch untracked1.txt untracked2.txt untracked3.txt`);
        exec(`echo change >> ${test_repo_path}/unstaged.txt`);
        exec(`echo change >> ${test_repo_path}/staged.txt`);
        exec(`cd ${test_repo_path} && git add staged.txt`);
        await vscode.commands.executeCommand("git.refresh", vscode.Uri.file(test_repo_path!));
        await vscode.commands.executeCommand("fugitive.open");
        await wait(500);
    });
    suiteTeardown(function () {
        console.info("Running suiteTeardown");
        execSync(`rm -rf ${test_repo_remote_path}`);
        execSync(`cd ${test_repo_path} && find . -mindepth 1 -delete`);
        execSync(`touch ${test_repo_path}/.gitkeep`);
        console.info("All tests done!");
    });

    const extension = vscode.extensions.getExtension("hnrk-str.vscode-fugitive");
    test("Extension is loaded", () => {
        assert.ok(extension, "Extension hnrk-str.vscode-fugitive is not loaded");
    });

    test("Latest diff refresh wins", async () => {
        let resolve_stale!: (diff: string) => void;
        let resolve_latest!: (diff: string) => void;
        let diff_call = 0;
        const stale_diff = new Promise<string>((resolve) => (resolve_stale = resolve));
        const latest_diff = new Promise<string>((resolve) => (resolve_latest = resolve));
        const repo = {
            rootUri: vscode.Uri.file("/repo"),
            diff: () => (diff_call++ === 0 ? stale_diff : latest_diff),
        } as unknown as Repository;
        const git = new GitWrapper({ repositories: [repo] } as unknown as GitAPI);

        const stale_refresh = git.updateDiffMap("Unstaged");
        const latest_refresh = git.updateDiffMap("Unstaged");
        resolve_latest("diff --git a/latest.txt b/latest.txt\n@@ -1 +1 @@\n-old\n+new\n");
        await latest_refresh;
        resolve_stale("diff --git a/stale.txt b/stale.txt\n@@ -1 +1 @@\n-old\n+new\n");
        await stale_refresh;

        assert.deepStrictEqual([...git.cachedUnstagedDiffs.keys()], ["/repo/latest.txt"]);
    });

    test("Old repository diff refresh is ignored", async () => {
        let resolve_old!: (diff: string) => void;
        const old_diff = new Promise<string>((resolve) => (resolve_old = resolve));
        const old_repo = {
            rootUri: vscode.Uri.file("/old-repo"),
            diff: () => old_diff,
        } as unknown as Repository;
        const current_repo = {
            rootUri: vscode.Uri.file("/current-repo"),
            diff: async () => "diff --git a/current.txt b/current.txt\n@@ -1 +1 @@\n-old\n+new\n",
        } as unknown as Repository;
        const git = new GitWrapper({ repositories: [old_repo] } as unknown as GitAPI);

        const old_refresh = git.updateDiffMap("Unstaged", old_repo);
        await git.setRepository(current_repo);
        await git.updateDiffMap("Unstaged", current_repo);
        resolve_old("diff --git a/old.txt b/old.txt\n@@ -1 +1 @@\n-old\n+new\n");
        await old_refresh;

        assert.deepStrictEqual([...git.cachedUnstagedDiffs.keys()], ["/current-repo/current.txt"]);
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
