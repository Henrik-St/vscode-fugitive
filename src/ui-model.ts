import { GIT } from "./extension";
import { GitWrapper } from "./git-wrapper";
import { Resource, ResourceType } from "./resource";
import { mapStatustoString} from './util';
import { Change } from "./vscode-git";

export class UIModel {
    private uiModel: [Resource, string][];
    private git: GitWrapper;

    private openedChanges: Set<string>;
    private openedIndexChanges: Set<string>;


    constructor() {
        this.uiModel = [];
        if (!GIT) {
            throw Error("Git API not found!");
        }
        this.git = GIT;

        this.openedChanges = new Set();
        this.openedIndexChanges = new Set();
    }

    public updateUIModel() {
        console.debug('Provider.provideTextDocumentContent');
        const newUIModel: [Resource, string][] = [];
        let head = "Detached";
        if (this.git.repo.state.HEAD?.name) {
            head = this.git.repo.state.HEAD.name;
        } else if (this.git.repo.state.HEAD?.commit) {
            head += " at " + this.git.repo.state.HEAD.commit.slice(0, 8);
        }
        newUIModel.push([new Resource({type: 'HeadUI'}), `Head: ${head}`]);

        if (this.git.repo.state.rebaseCommit) {
            head = "Rebasing at " + this.git.repo.state.rebaseCommit.hash.slice(0, 8);
        }
        let merge = "Unpublished";

        if (this.git.getCachedHasRemoteBranch()) {
            merge = `Merge: ${this.git.repo.state.remotes[0].name}/${head}`;
        }
        newUIModel.push([new Resource({ type: 'MergeUI'}), merge]);
        newUIModel.push([new Resource({ type: 'HelpUI'}), "Help: g h"]);

        // render untracked
        const mergeChanges = this.git.repo.state.mergeChanges;
        if (mergeChanges.length > 0) {
            newUIModel.push([new Resource({ type: "BlankUI"}), ""]);
            newUIModel.push([new Resource({ type: 'MergeHeader'}), `Merge Changes (${mergeChanges.length}):`]);
            const m = mergeChanges.map((c, i): [Resource, string] => ([new Resource({ type: "MergeChange", changeIndex: i}),this.renderChange(c)]));
            newUIModel.push(...m);
        }
        const untracked = this.git.untracked();
        if (untracked.length > 0) {
            newUIModel.push([new Resource({ type: "BlankUI"}), ""]);
            newUIModel.push([new Resource({type: "UntrackedHeader"}), `Untracked (${untracked.length}):`]);
            const m = untracked.map((c, i): [Resource, string] => [new Resource({type: "Untracked", changeIndex: i}),this.renderChange(c)]);
            newUIModel.push(...m);
        }
        // render unstaged
        const unstaged = this.git.unstaged();
        if (unstaged.length > 0) {
            newUIModel.push([new Resource({ type: "BlankUI"}), ""]);
            newUIModel.push([new Resource({ type: "UnstagedHeader"}), `Unstaged (${unstaged.length}):`]);
            const m = unstaged.flatMap((c, i): [Resource, string][] => (
                [
                    this.getChangeModel(c, i, "Unstaged"),
                    ...this.getDiffModel(c, i, "Unstaged", "UnstagedDiff")
                ]
            ));
            newUIModel.push(...m);
        }
        // render staged
        const staged = this.git.staged();
        if (staged.length > 0) {
            newUIModel.push([new Resource({ type: "BlankUI"}), ""]);
            newUIModel.push([new Resource({ type: "StagedHeader"}), `Staged (${staged.length}):`]);
            const m = staged.flatMap((c, i): [Resource, string][] => (
                [
                    this.getChangeModel(c, i, "Staged"),
                    ...this.getDiffModel(c, i, "Staged", "StagedDiff")
                ]
            ));
            newUIModel.push(...m);
        }

        const unpushedLen = this.git.cachedUnpushedCommits.length;
        if (unpushedLen > 0) {
            newUIModel.push([new Resource({ type: "BlankUI"}), ""]);
            const len = this.git.cachedUnpushedCommits.length;
            let to = "";
            if (this.git.repo.state.remotes[0]?.name) {
                if (this.git.getCachedHasRemoteBranch()) {
                    to = `to ${this.git.repo.state.remotes[0].name}/${head} `;
                } else {
                    to = "to * ";
                }
            }
            const commits = this.git.cachedUnpushedCommits.map((c, i): [Resource, string] => [
                new Resource({ type: "Unpushed", changeIndex: i}),
                c.hash.slice(0, 8) + " " + c.message.split("\n")[0].slice(0, 80)
            ]);
            newUIModel.push([new Resource({ type: "UnpushedHeader"}), `Unpushed ${to}(${len}):`]);
            newUIModel.push(...commits);
        }
        this.uiModel = newUIModel;
    }


    public getOpenedChanges() {
        return this.openedChanges;
    }

    public getOpenedIndexChanges() {
        return this.openedChanges;
    }

    public clearOpenedChanges() {
        return this.openedChanges.clear();
    }

    public clearOpenedIndexChanges() {
        return this.openedIndexChanges.clear();
    }

    public findHeader(type: ResourceType["type"]) {
        return this.uiModel.findIndex(([res]) => res.item.type === type);
    }

    public findIndex(predicate: (item: [Resource, string]) => boolean) {
        return this.uiModel.findIndex(predicate);
    }
    
    

    private renderChange(c: Change): string {
        return mapStatustoString(c.status) + " " + c.originalUri.path.replace(this.git.rootUri + '/', '');
    }


    private getChangeModel(c: Change, i: number, changeType: "Unstaged" | "Staged"): [Resource, string] {
        return [new Resource({ type: changeType, changeIndex: i }), this.renderChange(c)];
    }

    private getDiffModel(c: Change, index: number, changeType: "Staged" | "Unstaged", diffType: "StagedDiff" | "UnstagedDiff"): [Resource, string][] {
        const hasDiff = this.getOpenedDiffMap(changeType).has(c.uri.path);
        if (!hasDiff) {
            return [];
        }

        const arr = (this.getOpenedDiffMap(changeType).get(c.uri.path) ?? []).flatMap( (str, i): [Resource, string][] => {
            return str.split("\n").map((str, lineI): [Resource, string] => {
                return [new Resource({type: diffType, changeIndex: index, diffIndex: i, diffLineIndex: lineI}), str];
            });
        });
        return arr;
    }


    private getOpenedDiffMap(type: "Staged" | "Unstaged"): Map<string, string[]> {
        const openedMap = type === "Staged" ? this.openedIndexChanges : this.openedChanges;
        const diffMap = type === "Staged" ? this.git.cachedStagedDiffs : this.git.cachedUnstagedDiffs;
        const map = new Map<string, string[]>();
        for (const m of diffMap) {
            openedMap.has(m[0]) && map.set(m[0], m[1]);
        }
        return map;
    }


    public toString() {
        return this.uiModel.map(([_, str]) => str).join("\n");
    }


    public getCategoryOffset(type: ResourceType['type']): number {
        let index = -1;
        /* eslint-disable no-fallthrough */ 
        // Fallthrough is intended here to got to fallback category
        switch (type) {
            case 'UnpushedHeader': 
                index = this.uiModel.findIndex(([res]) => res.item.type === 'UnpushedHeader');
                if (index !== -1) {
                    return index;
                }
            case 'StagedHeader':
                index = this.uiModel.findIndex(([res]) => res.item.type === 'StagedHeader');
                if (index !== -1) {
                    return index;
                }
            case 'UnstagedHeader':
                index = this.uiModel.findIndex(([res]) => res.item.type === 'UnstagedHeader');
                if (index !== -1) {
                    return index;
                }
            case 'UntrackedHeader':
                index = this.uiModel.findIndex(([res]) => res.item.type === 'UntrackedHeader');
                if (index !== -1) {
                    return index;
                }
            case 'MergeHeader':
                index = this.uiModel.findIndex(([res]) => res.item.type === 'MergeHeader');
                if (index !== -1) {
                    return index;
                }
        }
        /* eslint-enable no-fallthrough */
        const containsCategory = this.uiModel.some(([a,_]) => 
            a.item.type === "MergeHeader" || a.item.type === "UntrackedHeader" || 
            a.item.type === "UnstagedHeader" || a.item.type === "StagedHeader" || 
            a.item.type === "UnpushedHeader"
        );
        index = containsCategory ? 4 : 0;
        return index;
    }

    public index(i: number) {
        return this.uiModel[i];
    }

    public length() {
        return this.uiModel.length;
    }
}