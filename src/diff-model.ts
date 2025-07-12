import { GIT } from "./extension";
import { GitWrapper } from "./git-wrapper";
import { UIModelItem } from "./ui-model";
import { Change } from "./vscode-git";

type DiffChangeTypes = "Unstaged" | "Staged";
type DiffTypes = "UnstagedDiff" | "StagedDiff";

function changeTypeToDiffType(type: DiffChangeTypes): DiffTypes {
    return type === "Unstaged" ? "UnstagedDiff" : "StagedDiff";
}

export class DiffModel {
    private git: GitWrapper;
    private openedChanges: Set<string>;
    private openedIndexChanges: Set<string>;

    constructor() {
        if (!GIT) {
            throw Error("Git API not found!");
        }
        this.git = GIT;

        this.openedChanges = new Set();
        this.openedIndexChanges = new Set();
    }

    public getOpenedChanges(): Set<string> {
        return this.openedChanges;
    }

    public getOpenedIndexChanges(): Set<string> {
        return this.openedIndexChanges;
    }

    public clearOpenedChanges(): void {
        return this.openedChanges.clear();
    }

    public clearOpenedIndexChanges(): void {
        return this.openedIndexChanges.clear();
    }

    private getDiffModel(c: Change, index: number, change_type: "Staged" | "Unstaged", diff_type: "StagedDiff" | "UnstagedDiff"): UIModelItem[] {
        const has_diff = this.getOpenedDiffMap(change_type).has(c.uri.path);
        if (!has_diff) {
            return [];
        }

        const arr = (this.getOpenedDiffMap(change_type).get(c.uri.path) ?? []).flatMap( (str, i): UIModelItem[] => {
            return str.split("\n").map((str, line): UIModelItem => {
                return [{type: diff_type, changeIndex: index, diffIndex: i, diffLineIndex: line}, str];
            });
        });
        return arr;
    }

    private getOpenedDiffMap(type: DiffChangeTypes): Map<string, string[]> {
        const opened_map = type === "Staged" ? this.openedIndexChanges : this.openedChanges;
        const diff_map = type === "Staged" ? this.git.cachedStagedDiffs : this.git.cachedUnstagedDiffs;
        const map = new Map<string, string[]>();
        for (const m of diff_map) {
            opened_map.has(m[0]) && map.set(m[0], m[1]);
        }
        return map;
    }

    _injectDiffs(new_model: UIModelItem[], type: DiffChangeTypes): void {
        for (const diff of this.getOpenedDiffMap(type)){
            const change_index = this.git.findChangeIndexByPath(diff[0], type);
            if (change_index === null) {
                console.error("Could not find change index of diff: " + diff[0]);
                continue;
            }
            const insert_index = new_model.findIndex(([res]) => {
                return res.type === type && res.changeIndex === change_index;
            });
            if (insert_index === -1) {
                console.error("Could not find change of diff: " + diff[0]);
                continue;
            }
            const change = this.git.getChanges(type)[change_index];
            const diff_model = this.getDiffModel(change, change_index, type, changeTypeToDiffType(type));
            // insert diffModel after index
            new_model.splice(insert_index + 1, 0, ...diff_model);
        }
    }

    public injectDiffs(ui_model: readonly UIModelItem[]): UIModelItem[] {
        const new_model: UIModelItem[] = [...ui_model];
        this._injectDiffs(new_model, "Unstaged");
        this._injectDiffs(new_model, "Staged");
        return new_model;
    }


}