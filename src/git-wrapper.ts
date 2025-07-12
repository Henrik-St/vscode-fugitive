import * as vscode from 'vscode';
import { API as GitAPI, Repository, Commit, Status, Ref, DiffEditorSelectionHunkToolbarContext, Change } from './vscode-git';
import { readFile } from './util';
import { ChangeTypes, ResourceType, toChangeTypes } from './resource';

export class GitWrapper {

    api: GitAPI;
    repo: Repository;
    rootUri: string;

    cachedRefs: Ref[];
    cachedUnpushedCommits: Commit[];
    cachedUnstagedDiffs: Map<string, string[]>;
    cachedStagedDiffs: Map<string, string[]>;

    constructor(git_api: GitAPI) {
        this.api = git_api;
        this.repo = this.api.repositories[0];
        this.rootUri = this.repo.rootUri.path;
        this.cachedRefs = [];
        this.cachedUnpushedCommits = [];
        this.cachedUnstagedDiffs = new Map<string, string[]>();
        this.cachedStagedDiffs = new Map<string, string[]>();
    }

    async getRefs(): Promise<Ref[]> {
        this.cachedRefs = await this.repo.getRefs({});
        return this.cachedRefs;
    }


    getRepositories(): [string, Repository][]{
        return this.api.repositories.map((i): [string, Repository] => [i.rootUri.path, i]); // name, repository pairs
    }

    async setRepository(new_repo: Repository): Promise<void> {
        this.repo = new_repo;
        this.rootUri = this.repo.rootUri.path;
    }

    getCachedRefs(): Ref[] {
        return this.cachedRefs;
    }

    async updateBranchInfo(): Promise<void> {
        console.debug("updateBranchInfo");
        this.cachedRefs = await this.repo.getRefs({});
        if (this.getCachedHasRemoteBranch()) {
            this.cachedUnpushedCommits = await this.repo.log({ range: this.repo.state.remotes[0].name + "/" + this.repo.state.HEAD?.name + "..HEAD" });
        } else {
            if (!this.repo.state.HEAD?.name) {
                this.cachedUnpushedCommits = [];
                return;
            }
            const branchbase = await
                this.repo.getBranchBase(this.repo.state.HEAD?.name)
                .then((branch) => branch?.commit)
                .catch(() => undefined)
            ;
            if (!branchbase) {
                this.cachedUnpushedCommits = [];
                return;
            }

            this.cachedUnpushedCommits = await this.repo.log({range: branchbase + "..HEAD"});
        }
    }

    getCachedHasRemoteBranch(): boolean {
        return this.repo.state.remotes[0] &&
            this.cachedRefs.some(branch => branch.name === this.repo.state.remotes[0].name + "/" + this.repo.state.HEAD?.name); //e.g. origin/branchname
    }

    untracked(): Change[] {
        return this.repo.state.workingTreeChanges.filter(c => c.status === Status.UNTRACKED);
    }

    unstaged(): Change[] {
        return this.repo.state.workingTreeChanges.filter(c => c.status !== Status.UNTRACKED);
    }

    staged(): Change[] {
        return this.repo.state.indexChanges;
    }

    mergeChanges(): Change[] {
        return this.repo.state.mergeChanges;
    }

    public async updateDiffMap(type: "Unstaged" | "Staged"): Promise<void> {
        const index = type === "Staged";
        let current_path = "";
        const diffs = (await this.repo.diff(index)).split("\n");
        diffs.pop(); // last line is always empty
        const result_map = new Map<string, string[]>();
        let diff_count = -1;
        for (const line of diffs) {
            if (line.startsWith("diff --git")) {
                const match = line.match(/diff --git \w\/(.*) \w\/(.*)/);
                current_path = match ? (this.rootUri + "/" + match[1]) : "";
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
        if (index) {
            this.cachedStagedDiffs = result_map;
        } else {
            this.cachedUnstagedDiffs = result_map;
        }
    }

    async applyPatchToFile(resource_uri: vscode.Uri, diff_index: number, action: "stage" | "unstage"): Promise<void> {
        const diff = action === "stage" ?
            this.cachedUnstagedDiffs.get(resource_uri.path) :
            this.cachedStagedDiffs.get(resource_uri.path)
            ;
        if (!diff) {
            return Promise.reject("No diff found for " + resource_uri);
        }

        const target_lines = (await this.repo.show(":0", resource_uri.path)).split("\n"); //index
        const source_lines = action === "stage" ?
            (await readFile(resource_uri)).split("\n") :
            (await this.repo.show("HEAD", resource_uri.path)).split("\n")
            ;
        const patch_lines = diff[diff_index].split("\n");
        const patch_matches = patch_lines.splice(0, 1)[0].match(/^@@ -(\d+),(\d+) \+(\d+),(\d+) @@/);
        if (!patch_matches) {
            throw Error("Fugitive: Could not parse diff");
        }
        let [, patch_target_start, patch_target_length, patch_source_start, patch_source_length] = patch_matches.map(Number);
        if (action === "unstage") {
            [patch_target_start, patch_source_start] = [patch_source_start, patch_target_start];
            [patch_target_length, patch_source_length] = [patch_source_length, patch_target_length];
        }

        const patch_at_eof = (patch_target_start + patch_target_length >= target_lines.length);
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

        vscode.commands.executeCommand('git.diff.stageHunk', stage_params).then(async (success) => {
            console.debug('git.diff.stageHunk: success: ', success);
        }, (rejected) => {
            console.debug('git.diff.stageHunk: rejected: ', rejected);
        });
    }

    async constructCommitDiff(commit: Commit): Promise<string> {
        const commit_changes = (await this.repo.diffBetween(commit.parents[0], commit.hash)).map(diff => diff.uri.path);
        const commit_diff = (await Promise.all(commit_changes.map(uri => {
            return this.repo.diffBetween(commit.parents[0], commit.hash, uri);
        }))).join("\n");

        return `tree  ${commit.hash} \n` 
            + `parent  ${commit.parents[0]} \n` 
            + `author ${commit.authorName} <${commit.authorEmail}> ${commit.authorDate} \n` 
            + `\n` 
            + `${commit.message}` 
            + `\n` 
            + commit_diff
        ;

    }

    getChanges(type: ChangeTypes["type"]): Change[] {
        switch (type) {
            case "Untracked":
                return this.untracked();
            case "Unstaged":
                return this.unstaged();
            case "Staged":
                return this.staged();
            case "MergeChange":
                return this.mergeChanges();
            default:
                throw new Error("Invalid Change Type: " + type);
        }
    }

    public changeFromResource(resource: ResourceType): Change | null{
        const converted = toChangeTypes(resource);
        if (!converted) {
            return null;
        }
        const change = this.getChanges(converted.type)[converted.changeIndex];
        return change;
    }

    public commitFromResource(resource: ResourceType): Commit | null {
        if (resource.type !== "Unpushed") {
            return null;
        }
        const commit = this.cachedUnpushedCommits[resource.changeIndex];
        return commit;
    }

    findChangeIndexByPath(path: string, type: ChangeTypes["type"]): number | null {
        const changes = this.getChanges(type);
        const index = changes.findIndex(c => c.uri.path === path);
        if (index !== -1) {
            return index;
        }
        return null;
    }
}

function patchedFileHasNewLine(patch_lines: string[], action: "stage" | "unstage"): boolean {
    const no_new_line_index = patch_lines.findIndex(line => line.startsWith("\\ No newline at end of file"));
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