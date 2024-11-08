import * as vscode from 'vscode';
import { API as GitAPI, Repository, Commit, Status, GitExtension, Ref } from './vscode-git';

export class GitWrapper {

    api: GitAPI;
    repo: Repository;
    rootUri: string;

    cachedRefs: Ref[];
    cachedUnpushedCommits: Commit[];

    constructor(gitAPI: GitAPI) {
        this.api = gitAPI;
        this.repo = this.api.repositories[0];
        this.rootUri = this.repo.rootUri.path;
        this.cachedRefs = [];
        this.cachedUnpushedCommits = [];
    }

    async getRefs(): Promise<Ref[]> {
        this.cachedRefs = await this.repo.getRefs({});
        return this.cachedRefs;
    }

    getCachedRefs(): Ref[] {
        return this.cachedRefs;
    }

    async cacheInfo(): Promise<void> {
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

    async getDiffStrings(path: string, type: "Unstaged" | "Staged") {
        let diff: string = "";
        if (type === "Unstaged") {
            diff = await this.getDiffPerPath(path);
            console.log("diff", diff);
        } else {
            diff = await this.repo.diffIndexWithHEAD(path);
        }
        const diffArr = diff.split('\n');

        const newDiffs: string[][] = [[]];
        let diffIndex = 0;
        for (const line of diffArr) {
            if (line.startsWith("@@")) {
                diffIndex += 1;
                newDiffs.push([]);
            }
            newDiffs[diffIndex].push(line);
        }
        newDiffs.shift(); // remove first empty array
        const newDiffStrings = newDiffs.map(diff => diff.join("\n"));

        return newDiffStrings;
    }


    private async getDiffPerPath(path: string): Promise<string> {
        const shortPath = path.replace(this.rootUri, "");
        const diffs = (await this.repo.diff(false)).split("\n");
        const resultDiff = [];
        let diffStarted = false;
        for (const line of diffs) {
            if (line.startsWith("diff --git")) {
                if (line.search(shortPath) !== -1) {
                    diffStarted = true;
                } else {
                    diffStarted = false;
                }
                continue;
            } else {
                diffStarted && resultDiff.push(line);
            }
        }
        return resultDiff.join("\n");
    }
}