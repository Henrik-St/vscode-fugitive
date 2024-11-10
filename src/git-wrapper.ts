import { API as GitAPI, Repository, Commit, Status, Ref } from './vscode-git';

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
}
