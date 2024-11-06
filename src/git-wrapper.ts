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
            diff = await this.repo.diffWithHEAD(path); // remove diff --git ...
        } else {
            diff = await this.repo.diffIndexWithHEAD(path);
        }
        const diffArr = diff.split('\n'); // remove diff --git ...

        const newDiffs: string[][] = [[]];
        let diffIndex = 0;
        for (const line in diffArr) {
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

}