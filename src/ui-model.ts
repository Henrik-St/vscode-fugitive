import { GIT, LOGGER } from "./extension";
import { TreeModel } from "./tree-model";
import { GitWrapper } from "./git-wrapper";
import { ChangeType, HeaderType, ResourceType, changeTypeToHeaderType } from "./resource";
import { mapStatustoString } from "./util";
import { Change } from "./vscode-git";
import { DiffModel } from "./diff-model";
import { syncCursorWithView } from "./cursor";

export type UIModelItem = [ResourceType, string];

export class UIModel {
    private uiModel: readonly UIModelItem[];
    private readonly git: GitWrapper;
    private previousUIModel: readonly UIModelItem[];

    public diffModel: DiffModel;
    public treeModel: TreeModel;

    constructor() {
        this.previousUIModel = [];
        this.uiModel = [];
        if (!GIT) {
            throw Error("Git API not found!");
        }
        this.git = GIT;
        this.diffModel = new DiffModel();
        this.treeModel = new TreeModel();
    }

    public update(view: "list" | "tree"): void {
        LOGGER.trace("ui-model.update");
        let new_ui_model: UIModelItem[] = [];
        let head = "Detached";
        if (this.git.repo.state.HEAD?.name) {
            head = this.git.repo.state.HEAD.name;
        } else if (this.git.repo.state.HEAD?.commit) {
            head += " at " + this.git.repo.state.HEAD.commit.slice(0, 8);
        }
        new_ui_model.push([{ type: "HeadUI" }, `Head: ${head}`]);

        if (this.git.repo.state.rebaseCommit) {
            head = "Rebasing at " + this.git.repo.state.rebaseCommit.hash.slice(0, 8);
        }
        let merge = "Unpublished";

        if (this.git.getCachedHasRemoteBranch()) {
            merge = `Merge: ${this.git.repo.state.remotes[0].name}/${head}`;
        }
        new_ui_model.push([{ type: "MergeUI" }, merge]);
        new_ui_model.push([{ type: "HelpUI" }, "Help: g h"]);

        this.renderSection("MergeChange", view, new_ui_model, "Merge Changes");
        this.renderSection("Untracked", view, new_ui_model, "Untracked");
        this.renderSection("Unstaged", view, new_ui_model, "Unstaged");
        this.renderSection("Staged", view, new_ui_model, "Staged");

        new_ui_model = this.diffModel.injectDiffs(new_ui_model);

        const unpushed_len = this.git.cachedUnpushedCommits.length;
        if (unpushed_len > 0) {
            new_ui_model.push([{ type: "BlankUI" }, ""]);
            const len = this.git.cachedUnpushedCommits.length;
            let to = "";
            if (this.git.repo.state.remotes[0]?.name) {
                if (this.git.getCachedHasRemoteBranch()) {
                    to = `to ${this.git.repo.state.remotes[0].name}/${head} `;
                } else {
                    to = "to * ";
                }
            }
            const commits = this.git.cachedUnpushedCommits.map(
                (c, i): UIModelItem => [
                    { type: "Unpushed", changeIndex: i, listIndex: i, path: "" },
                    c.hash.slice(0, 8) + " " + c.message.split("\n")[0].slice(0, 80),
                ]
            );
            new_ui_model.push([{ type: "UnpushedHeader" }, `Unpushed ${to}(${len}):`]);
            new_ui_model.push(...commits);
        }
        this.previousUIModel = this.uiModel;
        this.uiModel = new_ui_model;
    }

    public updateDiffview(view: "list" | "tree"): void {
        LOGGER.debug("ui-model.update_diffview");

        // render header
        let new_ui_model: UIModelItem[] = [];
        const branch = this.git.repo.state.HEAD?.name || "DETACHED_HEAD: " + this.git.repo.state.rebaseCommit;
        new_ui_model.push([
            { type: "BlankUI" },
            `DiffView - Changes of ${branch} compared to ${this.git.diffViewRefName || this.git.diffViewMergeBaseCommit}`,
        ]);
        new_ui_model.push([{ type: "BlankUI" }, ""]);

        this.renderSection("DiffViewChange", view, new_ui_model, "Changed Files");

        new_ui_model = this.diffModel.injectDiffs(new_ui_model);

        this.previousUIModel = this.uiModel;
        this.uiModel = new_ui_model;
    }

    public get(): readonly UIModelItem[] {
        return this.uiModel;
    }

    public getPrevious(): readonly UIModelItem[] {
        return this.previousUIModel;
    }

    public findHeader(type: ResourceType["type"]): number {
        return this.uiModel.findIndex(([res]) => res.type === type);
    }

    public findIndex(predicate: (item: UIModelItem) => boolean): number {
        return this.uiModel.findIndex(predicate);
    }

    private renderChange(c: Change): string {
        return mapStatustoString(c.status) + " " + c.originalUri.path.replace(this.git.rootUri + "/", "");
    }

    private renderSection(
        type: ChangeType["type"],
        view: "list" | "tree",
        new_ui_model: UIModelItem[],
        section_title: string
    ) {
        const changes = this.git.getChanges(type);
        if (changes.length > 0) {
            new_ui_model.push([{ type: "BlankUI" }, ""]);
            new_ui_model.push([{ type: changeTypeToHeaderType(type) }, `${section_title} (${changes.length}):`]);
            let m: UIModelItem[] = [];
            if (view === "tree") {
                m = this.treeModel.changesToTreeModel(changes, this.git.rootUri, type);
            } else if (view === "list") {
                m = this.changesToListModel(changes, type);
            }
            new_ui_model.push(...m);
        }
    }

    private changesToListModel(changes: Change[], type: ChangeType["type"]): UIModelItem[] {
        return changes.map(
            (c, i): UIModelItem => [
                { type: type, changeIndex: i, listIndex: i, path: c.uri.path },
                this.renderChange(c),
            ]
        );
    }

    public toString(): string {
        return this.uiModel.map(([_, str]) => str).join("\n");
    }

    public toStringDebug(): string {
        return this.uiModel.map(([_, str], i) => `${i.toString().padStart(2, "0")}: ${str}`).join("\n");
    }

    /**
     * @param type Category type to find
     * Gets the line number of the start of a category, based on the current UI model.
     * This can deviate from the current git state
     */
    public getCategoryOffset(type: HeaderType): number {
        let index = -1;
        /* eslint-disable no-fallthrough */
        // Fallthrough is intended here to got to fallback category
        switch (type) {
            case "UnpushedHeader":
                index = this.uiModel.findIndex(([res]) => res.type === "UnpushedHeader");
                if (index !== -1) {
                    return index;
                }
            case "StagedHeader":
                index = this.uiModel.findIndex(([res]) => res.type === "StagedHeader");
                if (index !== -1) {
                    return index;
                }
            case "UnstagedHeader":
                index = this.uiModel.findIndex(([res]) => res.type === "UnstagedHeader");
                if (index !== -1) {
                    return index;
                }
            case "UntrackedHeader":
                index = this.uiModel.findIndex(([res]) => res.type === "UntrackedHeader");
                if (index !== -1) {
                    return index;
                }
            case "MergeHeader":
                index = this.uiModel.findIndex(([res]) => res.type === "MergeHeader");
                if (index !== -1) {
                    return index;
                }
        }
        /* eslint-enable no-fallthrough */
        const contains_category = this.uiModel.some(
            ([a, _]) =>
                a.type === "MergeHeader" ||
                a.type === "UntrackedHeader" ||
                a.type === "UnstagedHeader" ||
                a.type === "StagedHeader" ||
                a.type === "UnpushedHeader"
        );
        index = contains_category ? 4 : 0;
        return index;
    }

    public index(i: number): UIModelItem {
        return this.uiModel[i];
    }

    public length(): number {
        return this.uiModel.length;
    }

    goPreviousHunk(current_line: number): void {
        if (current_line <= 0) {
            LOGGER.debug("no current line");
            return;
        }

        for (let i = current_line - 1; i >= 0; i--) {
            const res = this.index(i)[0];
            const type = res.type;
            if (
                type === "HeadUI" ||
                type === "MergeUI" ||
                type === "HelpUI" ||
                type === "BlankUI" ||
                type === "MergeHeader" ||
                type === "UntrackedHeader" ||
                type === "UnstagedHeader" ||
                type === "StagedHeader" ||
                type === "UnpushedHeader" ||
                type === "Unpushed"
            ) {
                continue;
            }

            if (
                type === "MergeChange" ||
                type === "Untracked" ||
                type === "Unstaged" ||
                type === "Staged" ||
                type === "DiffViewChange"
            ) {
                syncCursorWithView(i);
                return;
            } else if (
                (type === "UnstagedDiff" || type === "StagedDiff" || type === "DiffViewDiff") &&
                res.diffLineIndex === 0
            ) {
                syncCursorWithView(i);
                return;
            }
        }
    }

    goNextHunk(current_line: number): void {
        if (!current_line && current_line !== 0) {
            LOGGER.debug("no current line");
            return;
        }

        for (let i = current_line + 1; i < this.length(); i++) {
            const res = this.index(i)[0];
            const type = res.type;
            if (
                type === "HeadUI" ||
                type === "MergeUI" ||
                type === "HelpUI" ||
                type === "BlankUI" ||
                type === "MergeHeader" ||
                type === "UntrackedHeader" ||
                type === "UnstagedHeader" ||
                type === "StagedHeader" ||
                type === "UnpushedHeader" ||
                type === "Unpushed" ||
                type === "DiffViewHeader"
            ) {
                continue;
            }

            if (
                type === "MergeChange" ||
                type === "Untracked" ||
                type === "Unstaged" ||
                type === "Staged" ||
                type === "DiffViewChange"
            ) {
                syncCursorWithView(i);
                return;
            } else if (
                (type === "UnstagedDiff" || type === "StagedDiff" || type === "DiffViewDiff") &&
                res.diffLineIndex === 0
            ) {
                syncCursorWithView(i);
                return;
            }
        }
    }
}
