import * as vscode from 'vscode';
import { API as GitAPI, Repository, Commit, Status, Ref, DiffEditorSelectionHunkToolbarContext, Change } from './vscode-git';
import { readFile } from './util';
import { ChangeTypes } from './resource';

export class GitWrapper {

    api: GitAPI;
    repo: Repository;
    rootUri: string;

    cachedRefs: Ref[];
    cachedUnpushedCommits: Commit[];
    cachedUnstagedDiffs: Map<string, string[]>;
    cachedStagedDiffs: Map<string, string[]>;

    constructor(gitAPI: GitAPI) {
        this.api = gitAPI;
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

    async setRepository(new_repo: Repository) {
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

    untracked() {
        return this.repo.state.workingTreeChanges.filter(c => c.status === Status.UNTRACKED);
    }

    unstaged() {
        return this.repo.state.workingTreeChanges.filter(c => c.status !== Status.UNTRACKED);
    }

    staged() {
        return this.repo.state.indexChanges;
    }

    mergeChanges() {
        return this.repo.state.mergeChanges;
    }

    public async updateDiffMap(type: "Unstaged" | "Staged"): Promise<void> {
        const index = type === "Staged";
        let currentPath = "";
        const diffs = (await this.repo.diff(index)).split("\n");
        diffs.pop(); // last line is always empty
        const resultMap = new Map<string, string[]>();
        let diffCount = -1;
        for (const line of diffs) {
            if (line.startsWith("diff --git")) {
                const match = line.match(/diff --git \w\/(.*) \w\/(.*)/);
                currentPath = match ? (this.rootUri + "/" + match[1]) : "";
                diffCount = -1;
                continue;
            } else {
                if (line.startsWith("@@")) {
                    diffCount += 1;
                }
                if (diffCount >= 0 && currentPath) {
                    const change = resultMap.get(currentPath);
                    if (change) {
                        if (change.length > diffCount) {
                            change[diffCount] = change[diffCount].concat("\n", line);
                            resultMap.set(currentPath, change);
                        } else {
                            change.push(line);
                        }
                    } else {
                        resultMap.set(currentPath, [line]);
                    }
                }
            }
        }
        if (index) {
            this.cachedStagedDiffs = resultMap;
        } else {
            this.cachedUnstagedDiffs = resultMap;
        }
    }

    async applyPatchToFile(resourceUri: vscode.Uri, diffIndex: number, action: "stage" | "unstage"): Promise<void> {
        const diff = action === "stage" ?
            this.cachedUnstagedDiffs.get(resourceUri.path) :
            this.cachedStagedDiffs.get(resourceUri.path)
            ;
        if (!diff) {
            return Promise.reject("No diff found for " + resourceUri);
        }

        const targetLines = (await this.repo.show(":0", resourceUri.path)).split("\n"); //index
        const sourceLines = action === "stage" ?
            (await readFile(resourceUri)).split("\n") :
            (await this.repo.show("HEAD", resourceUri.path)).split("\n")
            ;
        const patchLines = diff[diffIndex].split("\n");
        const patchMatches = patchLines.splice(0, 1)[0].match(/^@@ -(\d+),(\d+) \+(\d+),(\d+) @@/);
        if (!patchMatches) {
            throw Error("Fugitive: Could not parse diff");
        }
        let [, patchTargetStart, patchTargetLength, patchSourceStart, patchSourceLength] = patchMatches.map(Number);
        if (action === "unstage") {
            [patchTargetStart, patchSourceStart] = [patchSourceStart, patchTargetStart];
            [patchTargetLength, patchSourceLength] = [patchSourceLength, patchTargetLength];
        }

        const patchAtEoF = (patchTargetStart + patchTargetLength >= targetLines.length);
        targetLines.splice(patchTargetStart - 1, patchTargetLength); // Remove patched Lines
        const newFileArr = [
            ...targetLines.splice(0, patchTargetStart - 1),
            ...sourceLines.splice(patchSourceStart - 1, patchSourceLength),
        ];

        const hasNewLine = patchedFileHasNewLine(patchLines, action);
        if (!patchAtEoF) {
            newFileArr.push(...targetLines.splice(0, targetLines.length));
        } else if (hasNewLine) {
            newFileArr.push("");
        }

        const newFile = newFileArr.join("\n");
        const stageParams: DiffEditorSelectionHunkToolbarContext = {
            modifiedUri: resourceUri,
            originalWithModifiedChanges: newFile,
            originalUri: vscode.Uri.parse("Default"), // not needed
            mapping: "", //not needed
        };

        vscode.commands.executeCommand('git.diff.stageHunk', stageParams).then(async (success) => {
            console.debug('git.diff.stageHunk: success: ', success);
        }, (rejected) => {
            console.debug('git.diff.stageHunk: rejected: ', rejected);
        });
    }

    async constructCommitDiff(commit: Commit): Promise<string> {
        const commitChanges = (await this.repo.diffBetween(commit.parents[0], commit.hash)).map(diff => diff.uri.path);
        const commitDiff = (await Promise.all(commitChanges.map(uri => {
            return this.repo.diffBetween(commit.parents[0], commit.hash, uri);
        }))).join("\n");

        return `tree  ${commit.hash} \n` 
            + `parent  ${commit.parents[0]} \n` 
            + `author ${commit.authorName} <${commit.authorEmail}> ${commit.authorDate} \n` 
            + `\n` 
            + `${commit.message}` 
            + `\n` 
            + commitDiff
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

    findChangeIndexByPath(path: string, type: ChangeTypes["type"]): number | null {
        const changes = this.getChanges(type);
        const index = changes.findIndex(c => c.uri.path === path);
        if (index !== -1) {
            return index;
        }
        return null;
    }
}

function patchedFileHasNewLine(patchLines: string[], action: "stage" | "unstage"): boolean {
    const noNewLineIndex = patchLines.findIndex(line => line.startsWith("\\ No newline at end of file"));
    if (noNewLineIndex <= 0) {
        return true;
    }
    const newLineIsAdded = patchLines[noNewLineIndex - 1].charAt(0) === "+";
    if (action === "stage") {
        return noNewLineIndex !== patchLines.length - 1;
    } else if (action === "unstage") {
        return newLineIsAdded && noNewLineIndex === patchLines.length - 1;
    }
    throw Error("Fugitive: Invalid action");
}