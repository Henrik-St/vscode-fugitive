import * as vscode from 'vscode';
import { API as GitAPI, Repository, Commit, Status, Ref, DiffEditorSelectionHunkToolbarContext } from './vscode-git';
import { readFile } from './util';

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

    getCachedRefs(): Ref[] {
        return this.cachedRefs;
    }

    async updateBranchInfo(): Promise<void> {
        this.cachedRefs = await this.repo.getRefs({});
        if (this.getCachedHasRemoteBranch()) {
            this.cachedUnpushedCommits = await this.repo.log({ range: this.repo.state.remotes[0].name + "/" + this.repo.state.HEAD?.name + "..HEAD" });
        } else {
            this.cachedUnpushedCommits = [];
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

    public async updateDiffMap(index: boolean): Promise<void> {
        let currentPath = "";
        const diffs = (await this.repo.diff(index)).split("\n");
        diffs.pop(); // last line is always empty
        const resultMap = new Map<string, string[]>();
        let diffCount = -1;
        for (const line of diffs) {
            if (line.startsWith("diff --git")) {
                const match = line.match(/diff --git a\/(.*) b\/(.*)/);
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
        const patchMatches = patchLines.splice(0, 1)[0].match(/^@@ -(\d+),(\d+) \+(\d+),(\d) @@/);
        if (!patchMatches) {
            throw Error("Could not parse diff");
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
}

function patchedFileHasNewLine(patchLines: string[], action: "stage" | "unstage"): boolean {
    const noNewLineIndex = patchLines.findIndex(line => line.startsWith("\\ No newline at end of file"));
    const newLineIsAdded = patchLines[noNewLineIndex - 1].charAt(0) === "+";
    if (noNewLineIndex === -1) {
        return true;
    }
    if (action === "stage") {
        return noNewLineIndex !== patchLines.length - 1;
    } else if (action === "unstage") {
        return newLineIsAdded && noNewLineIndex === patchLines.length - 1;
    }
    throw Error("Fugitive: Invalid action");
}