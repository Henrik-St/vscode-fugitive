import { GIT, LOGGER } from "./extension";
import { GitWrapper } from "./git-wrapper";
import { DiffType } from "./resource";
import { UIModelItem } from "./ui-model";
import { Change } from "./vscode-git";

type DiffChangeTypes = "Unstaged" | "Staged" | "DiffViewChange";

function changeTypeToDiffType(type: DiffChangeTypes): DiffType["type"] {
    return type === "Unstaged" ? "UnstagedDiff" : type === "Staged" ? "StagedDiff" : "DiffViewDiff";
}

export class DiffModel {
    private readonly git: GitWrapper;
    private openedChanges: Set<string>;
    private openedIndexChanges: Set<string>;
    private openedDiffViewChanges: Set<string>;

    constructor() {
        if (!GIT) {
            throw Error("Git API not found!");
        }
        this.git = GIT;

        this.openedChanges = new Set();
        this.openedIndexChanges = new Set();
        this.openedDiffViewChanges = new Set();
    }

    public getOpenedChanges(): Set<string> {
        return this.openedChanges;
    }

    public getOpenedIndexChanges(): Set<string> {
        return this.openedIndexChanges;
    }

    public getOpenedDiffViewChanges(): Set<string> {
        return this.openedDiffViewChanges;
    }

    public clearOpenedChanges(): void {
        return this.openedChanges.clear();
    }

    public clearOpenedIndexChanges(): void {
        return this.openedIndexChanges.clear();
    }

    public clearOpenedDiffViewChanges(): void {
        return this.openedDiffViewChanges.clear();
    }

    private getDiffModel(
        c: Change,
        change_index: number,
        list_index: number,
        change_type: "Staged" | "Unstaged" | "DiffViewChange",
        diff_type: "StagedDiff" | "UnstagedDiff" | "DiffViewDiff"
    ): UIModelItem[] {
        const has_diff = this.getOpenedDiffMap(change_type).has(c.uri.path);
        if (!has_diff) {
            return [];
        }

        const arr = (this.getOpenedDiffMap(change_type).get(c.uri.path) ?? []).flatMap((str, i): UIModelItem[] => {
            return str.split("\n").map((str, line): UIModelItem => {
                return [
                    {
                        type: diff_type,
                        changeIndex: change_index,
                        listIndex: list_index,
                        path: c.uri.path,
                        diffIndex: i,
                        diffLineIndex: line,
                    },
                    str,
                ];
            });
        });
        return arr;
    }

    private getOpenedDiffMap(type: DiffChangeTypes): Map<string, string[]> {
        const opened_map =
            type === "Staged"
                ? this.openedIndexChanges
                : type === "Unstaged"
                  ? this.openedChanges
                  : this.openedDiffViewChanges;
        const diff_map =
            type === "Staged"
                ? this.git.cachedStagedDiffs
                : type === "Unstaged"
                  ? this.git.cachedUnstagedDiffs
                  : this.git.cachedDiffViewDiffs;
        const map = new Map<string, string[]>();
        for (const m of diff_map) {
            opened_map.has(m[0]) && map.set(m[0], m[1]);
        }
        return map;
    }

    _injectDiffs(new_model: UIModelItem[], type: DiffChangeTypes): void {
        for (const diff of this.getOpenedDiffMap(type)) {
            const change_index = this.git.findChangeIndexByPath(diff[0], type);
            if (change_index === null) {
                LOGGER.error("Could not find change index of diff: " + diff[0]);
                continue;
            }
            const insert_index = new_model.findIndex(([res]) => {
                return res.type === type && res.changeIndex === change_index;
            });
            if (insert_index === -1) {
                LOGGER.error("Could not find change of diff: " + diff[0]);
                continue;
            }
            const change = this.git.getChanges(type)[change_index];
            const ui_item = new_model[insert_index][0];
            if (ui_item.type !== type) {
                LOGGER.error("Could not find change of diff: " + diff[0]);
                continue;
            }
            const list_index = ui_item.listIndex;
            const diff_model = this.getDiffModel(change, change_index, list_index, type, changeTypeToDiffType(type));
            // insert diffModel after index
            new_model.splice(insert_index + 1, 0, ...diff_model);
        }
    }

    public injectDiffs(ui_model: readonly UIModelItem[]): UIModelItem[] {
        const new_model: UIModelItem[] = [...ui_model];
        this._injectDiffs(new_model, "Unstaged");
        this._injectDiffs(new_model, "Staged");
        this._injectDiffs(new_model, "DiffViewChange");
        return new_model;
    }
}
