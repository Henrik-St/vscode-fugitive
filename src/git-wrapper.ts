import * as vscode from "vscode";
import {
    API as GitAPI,
    Repository,
    Commit,
    Status,
    DiffEditorSelectionHunkToolbarContext,
    Change,
    Branch,
    UpstreamRef,
} from "./vscode-git";
import { readFile } from "./util";
import { ChangeType, ResourceType, diffTypeToChangeType, isChangeType, isDiffType } from "./resource";
import { LOGGER } from "./extension";

export class GitWrapper {
    api: GitAPI;
    repo: Repository;
    rootUri: string;

    diffViewRefName: string | null = null;
    diffViewMergeBaseCommit: string | null = null;

    cachedBranchInfo: Branch | null;
    cachedUnpushedCommits: Commit[];
    cachedUnstagedDiffs: Map<string, string[]>;
    cachedStagedDiffs: Map<string, string[]>;
    cachedDiffViewDiffs: Map<string, string[]>;
    cachedDiffViewChanges: Change[];

    constructor(git_api: GitAPI) {
        this.api = git_api;
        this.repo = this.api.repositories[0];
        this.rootUri = this.repo.rootUri.path;
        this.cachedBranchInfo = null;
        this.cachedUnpushedCommits = [];
        this.cachedUnstagedDiffs = new Map<string, string[]>();
        this.cachedStagedDiffs = new Map<string, string[]>();
        this.cachedDiffViewDiffs = new Map<string, string[]>();
        this.cachedDiffViewChanges = [];
    }

    getRepositories(): [string, Repository][] {
        return this.api.repositories.map((i): [string, Repository] => [i.rootUri.path, i]); // name, repository pairs
    }

    async setRepository(new_repo: Repository): Promise<void> {
        LOGGER.trace("setRepository:", new_repo.rootUri.path);
        this.repo = new_repo;
        this.rootUri = this.repo.rootUri.path;
    }

    async updateBranchInfo(): Promise<void> {
        LOGGER.trace("updateBranchInfo");
        if (!this.repo.state.HEAD?.name) {
            LOGGER.debug("updateBranchInfo: detached HEAD");
            this.cachedUnpushedCommits = [];
            return;
        }
        this.cachedBranchInfo = await this.repo.getBranch(this.repo.state.HEAD.name).catch(() => null);
        if (!this.cachedBranchInfo) {
            this.cachedUnpushedCommits = [];
            return;
        }
        if (this.cachedBranchInfo.upstream) {
            this.cachedUnpushedCommits = await this.repo.log({
                range: getUpstreamBranchName(this.cachedBranchInfo.upstream) + "..HEAD",
                maxEntries: 50,
            });
        } else {
            LOGGER.debug("updateBranchInfo: no upstream for branch", this.repo.state.HEAD.name);
            const branchbase = await this.repo
                .getBranchBase(this.repo.state.HEAD.name)
                .then((branch) => branch?.commit)
                .catch(() => undefined);
            if (!branchbase) {
                LOGGER.debug("updateBranchInfo: no branch base found");
                this.cachedUnpushedCommits = [];
                return;
            }

            this.cachedUnpushedCommits = await this.repo.log({ range: branchbase + "..HEAD", maxEntries: 50 });
        }
    }

    getCachedBranchInfo(): Branch | null {
        LOGGER.trace("getCachedBranchInfo");
        return this.cachedBranchInfo;
    }

    getCachedUpstreamBranchName(): string | null {
        LOGGER.trace("getCachedBranchName");
        if (!this.cachedBranchInfo?.upstream) {
            return null;
        }
        return getUpstreamBranchName(this.cachedBranchInfo.upstream);
    }
    getCachedHasRemoteBranch(): boolean {
        LOGGER.trace("getCachedHasRemoteBranch");
        return this.cachedBranchInfo?.upstream ? true : false;
    }

    async updateDiffView(branch: string): Promise<void> {
        LOGGER.trace("updateDiffView:", branch);
        if (!this.repo.state.HEAD?.name) {
            vscode.window.showErrorMessage("Cannot create diff view from detached HEAD state.");
            return Promise.reject("Cannot create diff view from detached HEAD state.");
        }
        const merge_base = await this.repo.getMergeBase(this.repo.state.HEAD.name, branch);
        if (!merge_base) {
            vscode.window.showErrorMessage(
                `Cannot find merge base between ${this.repo.state.HEAD.name} and ${branch}.`
            );
            return Promise.reject(`Cannot find merge base between ${this.repo.state.HEAD.name} and ${branch}.`);
        }
        this.diffViewRefName = branch;
        this.diffViewMergeBaseCommit = merge_base;
        this.cachedDiffViewChanges = await this.repo.diffWith(merge_base);
    }

    untracked(): Change[] {
        return this.repo.state.workingTreeChanges.filter((c) => c.status === Status.UNTRACKED);
    }

    unstaged(): Change[] {
        return this.repo.state.workingTreeChanges.filter((c) => c.status !== Status.UNTRACKED);
    }

    staged(): Change[] {
        return this.repo.state.indexChanges;
    }

    mergeChanges(): Change[] {
        return this.repo.state.mergeChanges;
    }

    public async updateDiffMap(type: "Unstaged" | "Staged" | "DiffViewChange"): Promise<void> {
        LOGGER.trace("updateDiffMap:", type);
        const index = type === "Staged";
        let current_path = "";
        let diffs: string;

        if (type === "DiffViewChange") {
            if (!this.diffViewMergeBaseCommit) {
                return Promise.reject("No DiffView merge base commit");
            }
            const changes = await this.repo.diffWith(this.diffViewMergeBaseCommit);
            const diffTexts = await Promise.all(
                changes.map((change) => this.repo.diffWith(this.diffViewMergeBaseCommit!, change.uri.path))
            );
            diffs = diffTexts.join("\n");
        } else {
            diffs = await this.repo.diff(index);
        }

        const diffLines = diffs.split("\n");
        diffLines.pop(); // last line is always empty
        const result_map = new Map<string, string[]>();
        let diff_count = -1;
        for (const line of diffLines) {
            if (line.startsWith("diff --git")) {
                const match = line.match(/diff --git \w\/(.*) \w\/(.*)/);
                current_path = match ? this.rootUri + "/" + match[1] : "";
                diff_count = -1;
                continue;
            } else {
                if (line.startsWith("@@")) {
                    diff_count += 1;
                }
                if (diff_count >= 0 && current_path) {
                    const change = result_map.get(current_path);
                    if (change) {
                        if (change.length > diff_count) {
                            change[diff_count] = change[diff_count].concat("\n", line);
                            result_map.set(current_path, change);
                        } else {
                            change.push(line);
                        }
                    } else {
                        result_map.set(current_path, [line]);
                    }
                }
            }
        }
        if (type === "DiffViewChange") {
            this.cachedDiffViewDiffs = result_map;
        } else if (index) {
            this.cachedStagedDiffs = result_map;
        } else {
            this.cachedUnstagedDiffs = result_map;
        }
    }

    async applyPatchToFile(resource_uri: vscode.Uri, diff_index: number, action: "stage" | "unstage"): Promise<void> {
        LOGGER.trace("applyPatchToFile:", resource_uri.path, diff_index, action);
        const diff =
            action === "stage"
                ? this.cachedUnstagedDiffs.get(resource_uri.path)
                : this.cachedStagedDiffs.get(resource_uri.path);
        if (!diff) {
            return Promise.reject("No diff found for " + resource_uri);
        }

        const target_lines = (await this.repo.show(":0", resource_uri.path)).split("\n"); //index
        const source_lines =
            action === "stage"
                ? (await readFile(resource_uri)).split("\n")
                : (await this.repo.show("HEAD", resource_uri.path)).split("\n");
        const patch_lines = diff[diff_index].split("\n");
        const patch_matches = patch_lines.splice(0, 1)[0].match(/^@@ -(\d+),(\d+) \+(\d+),(\d+) @@/);
        if (!patch_matches) {
            throw Error("Fugitive: Could not parse diff");
        }
        let [, patch_target_start, patch_target_length, patch_source_start, patch_source_length] =
            patch_matches.map(Number);
        if (action === "unstage") {
            [patch_target_start, patch_source_start] = [patch_source_start, patch_target_start];
            [patch_target_length, patch_source_length] = [patch_source_length, patch_target_length];
        }

        const patch_at_eof = patch_target_start + patch_target_length >= target_lines.length;
        target_lines.splice(patch_target_start - 1, patch_target_length); // Remove patched Lines
        const new_file_arr = [
            ...target_lines.splice(0, patch_target_start - 1),
            ...source_lines.splice(patch_source_start - 1, patch_source_length),
        ];

        const has_new_line = patchedFileHasNewLine(patch_lines, action);
        if (!patch_at_eof) {
            new_file_arr.push(...target_lines.splice(0, target_lines.length));
        } else if (has_new_line) {
            new_file_arr.push("");
        }

        const new_file = new_file_arr.join("\n");
        const stage_params: DiffEditorSelectionHunkToolbarContext = {
            modifiedUri: resource_uri,
            originalWithModifiedChanges: new_file,
            originalUri: vscode.Uri.parse("Default"), // not needed
            mapping: "", //not needed
        };

        vscode.commands.executeCommand("git.diff.stageHunk", stage_params).then(
            async (success) => {
                LOGGER.debug("git.diff.stageHunk: success: ", success);
            },
            (rejected) => {
                LOGGER.debug("git.diff.stageHunk: rejected: ", rejected);
            }
        );
    }

    async constructCommitDiff(commit: Commit): Promise<string> {
        LOGGER.trace("constructCommitDiff:", commit.hash);
        const commit_changes = (await this.repo.diffBetween(commit.parents[0], commit.hash)).map(
            (diff) => diff.uri.path
        );
        const commit_diff = (
            await Promise.all(
                commit_changes.map((uri) => {
                    return this.repo.diffBetween(commit.parents[0], commit.hash, uri);
                })
            )
        ).join("\n");

        return (
            `tree  ${commit.hash} \n` +
            `parent  ${commit.parents[0]} \n` +
            `author ${commit.authorName} <${commit.authorEmail}> ${commit.authorDate} \n` +
            `\n` +
            `${commit.message}` +
            `\n` +
            commit_diff
        );
    }

    getChanges(type: ChangeType["type"]): Change[] {
        LOGGER.trace("getChanges:", type);
        switch (type) {
            case "Untracked":
                return this.untracked();
            case "Unstaged":
                return this.unstaged();
            case "Staged":
                return this.staged();
            case "MergeChange":
                return this.mergeChanges();
            case "DiffViewChange":
                return this.cachedDiffViewChanges;
            default:
                throw new Error("Invalid Change Type: " + type);
        }
    }

    public changeFromResource(resource: ResourceType): Change | null {
        LOGGER.trace("changeFromResource:", resource);
        if (!isChangeType(resource) && !isDiffType(resource)) {
            return null;
        }
        const resource_type = diffTypeToChangeType(resource.type);
        const changes = this.getChanges(resource_type);

        // First, try to use the stored index if it is still valid
        if (resource.changeIndex >= 0 && resource.changeIndex < changes.length) {
            const by_index = changes[resource.changeIndex];
            if (!resource.path || by_index.uri.path === resource.path) {
                return by_index;
            }
        }

        // Fallback: resolve by path if available
        if (resource.path) {
            const index = this.findChangeIndexByPath(resource.path, resource_type);
            if (index !== null) {
                LOGGER.warn("changeFromResource: resolved change by path fallback", resource_type, resource.path);
                LOGGER.warn("changeFromResource: resource:", resource);
                LOGGER.warn("changeFromResource: repo:", this.repo.rootUri);
                return changes[index];
            }
            LOGGER.warn("changeFromResource: could not resolve change for path", resource_type, resource.path);
        }

        return null;
    }

    public changeFromChangeType(resource: ChangeType): Change | null {
        LOGGER.trace("changeFromChangeType:", resource);
        const changes = this.getChanges(resource.type);

        if (resource.changeIndex >= 0 && resource.changeIndex < changes.length) {
            const by_index = changes[resource.changeIndex];
            if (!resource.path || by_index.uri.path === resource.path) {
                return by_index;
            }
        }

        if (resource.path) {
            const index = this.findChangeIndexByPath(resource.path, resource.type);
            if (index !== null) {
                LOGGER.debug("changeFromChangeType: resolved change by path fallback", resource.type, resource.path);
                return changes[index];
            }
            LOGGER.warn("changeFromChangeType: could not resolve change for path", resource.type, resource.path);
        }

        return null;
    }

    public commitFromResource(resource: ResourceType): Commit | null {
        LOGGER.trace("commitFromResource:", resource);
        if (resource.type !== "Unpushed") {
            return null;
        }
        const commit = this.cachedUnpushedCommits[resource.changeIndex];
        return commit;
    }

    findChangeIndexByPath(path: string, type: ChangeType["type"]): number | null {
        LOGGER.trace("findChangeIndexByPath:", path, type);
        const changes = this.getChanges(type);
        const index = changes.findIndex((c) => c.uri.path === path);
        if (index !== -1) {
            return index;
        }
        return null;
    }
}

function patchedFileHasNewLine(patch_lines: string[], action: "stage" | "unstage"): boolean {
    const no_new_line_index = patch_lines.findIndex((line) => line.startsWith("\\ No newline at end of file"));
    if (no_new_line_index <= 0) {
        return true;
    }
    const new_line_is_added = patch_lines[no_new_line_index - 1].charAt(0) === "+";
    if (action === "stage") {
        return no_new_line_index !== patch_lines.length - 1;
    } else if (action === "unstage") {
        return new_line_is_added && no_new_line_index === patch_lines.length - 1;
    }
    throw Error("Fugitive: Invalid action");
}

function getUpstreamBranchName(upstream: UpstreamRef): string {
    return upstream.remote + "/" + upstream.name;
}
