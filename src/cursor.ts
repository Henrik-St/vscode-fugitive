import * as vscode from "vscode";
import { GIT, LOGGER } from "./extension";
import { GitWrapper } from "./git-wrapper";
import {
    ChangeType,
    changeTypeToHeaderType,
    diffTypeToChangeType,
    diffTypeToHeaderType,
    HeaderType,
    isChangeType,
    ResourceType,
} from "./resource";
import { Change } from "./vscode-git";
import { Provider } from "./provider";
import { UIModel } from "./ui-model";
import { dirname } from "path";

/**
 * Programming the cursor movement is unexpectedly complex
 * This class handles the logic for keeping the cursor in the right place
 */
export class Cursor {
    private line: number;
    private previousResource: ResourceType | null;
    private previousChange: Change | null;

    public git: GitWrapper;

    constructor() {
        if (!GIT) {
            throw Error("Git API not found!");
        }
        this.git = GIT;
        this.line = 0;
        this.previousResource = null;
        this.previousChange = null;
    }

    /**
     * @throws if no buffer is open
     * @returns the information for the current set line
     */
    public getResourceUnderCursor(ui_model: UIModel): ResourceType {
        if (!vscode.window.activeTextEditor) {
            throw new Error("Fugitive: No active text editor found");
        }
        const line = vscode.window.activeTextEditor.selection.active.line;
        this.line = line;
        this.previousResource = ui_model.index(line)[0];
        this.previousChange = this.git.changeFromResource(this.previousResource);
        return ui_model.index(line)[0];
    }

    public syncCursorLine(line?: number): void {
        if (vscode.window.activeTextEditor?.document.uri.toString() !== Provider.uri.toString()) {
            return;
        }
        const new_line = line || this.line;
        vscode.window.activeTextEditor!.selection = new vscode.Selection(
            new vscode.Position(new_line, 0),
            new vscode.Position(new_line, 0)
        );
    }

    public getLine(): number {
        return this.line;
    }

    public setLine(line: number): void {
        this.line = line;
    }

    /**
     * updates the cursor position, else it will jump almost randomly
     * at this point the uimodel is updated and git is updated
     * only the actual buffer is not updated yet
     */
    public updateCursor(ui_model: UIModel): void {
        LOGGER.debug("updateCursor");
        if (!this.previousResource) {
            this.line = vscode.window.activeTextEditor?.selection.active.line || (ui_model.length() >= 5 ? 5 : 0); //go to first item if present

            return;
        }
        switch (this.previousResource.type) {
            case "UntrackedHeader":
            case "UnstagedHeader":
            case "StagedHeader": {
                const offset = ui_model.getCategoryOffset(this.previousResource.type) + 1;
                this.line = offset + 0;
                break;
            }
            case "MergeChange":
            case "Untracked":
            case "UnstagedDiff":
            case "Unstaged":
            case "DiffViewChange":
            case "StagedDiff":
            case "Staged": {
                const type = diffTypeToChangeType(this.previousResource.type);
                const changes = this.git.getChanges(type);
                const index =
                    changes.length == 0
                        ? 0
                        : this.previousResource.changeIndex > changes.length - 1
                          ? changes.length - 1
                          : this.previousResource.changeIndex;
                const new_line = ui_model.findIndex(([res]) => res.type === type && res.changeIndex === index);
                const category_offset = ui_model.getCategoryOffset(changeTypeToHeaderType(type)) + 1;
                this.line = new_line === -1 ? category_offset : new_line;
                break;
            }
            default:
                LOGGER.error("updateCursor: " + this.previousResource.type + " not implemented");
        }
    }

    /**
     * Update the cursor position assuming tree view
     */
    public updateCursorTreeView(ui_model: UIModel): void {
        LOGGER.debug("updateCursorTreeView");
        if (!this.previousResource) {
            const line = vscode.window.activeTextEditor?.selection.active.line;
            const ui_length = ui_model.length();
            this.line = line && line < ui_length ? line : ui_length >= 5 ? 5 : 0; //go to first item if present
            return;
        }

        let path: string | null = null;
        let changes: Change[] = [];
        let header_type: HeaderType | null = null;
        let change_type: ChangeType["type"] | null = null;
        let is_file_type: boolean | null = null;
        switch (this.previousResource.type) {
            case "Untracked":
            case "Unstaged":
            case "UnstagedDiff":
            case "Staged":
            case "DiffViewChange":
            case "StagedDiff": {
                change_type = diffTypeToChangeType(this.previousResource.type);
                changes = this.git.getChanges(change_type);
                header_type = changeTypeToHeaderType(change_type);
                is_file_type = true;
                if (changes.length === 0) {
                    this.line = ui_model.getCategoryOffset(header_type) + 1;
                    return;
                }
                if (!this.previousChange) {
                    LOGGER.warn(
                        "updateCursorTreeView: No previous change found for resource: " + this.previousResource.type
                    );
                    return;
                }

                const offset = this.getNewOffsetFromPreviousChange(ui_model);
                if (offset) {
                    this.line = offset;
                    return;
                }
                path = this.previousChange.originalUri.path;
                const dir = dirname(path).replace(this.git.rootUri, "");
                const first_dir_entry_offset = ui_model.findIndex(
                    ([type]) =>
                        type.type === change_type &&
                        dirname(this.git.changeFromChangeType(type).originalUri.path).replace(this.git.rootUri, "") ===
                            dir
                );
                if (first_dir_entry_offset !== -1) {
                    const num_changes_in_dir = changes.filter(
                        (c) => dirname(c.originalUri.path).replace(this.git.rootUri, "") === dir
                    ).length;
                    this.line =
                        first_dir_entry_offset + Math.min(this.previousResource.listIndex, num_changes_in_dir - 1);
                    return;
                }
                break;
            }
            case "DirectoryHeader": {
                change_type = this.previousResource.changeType;
                header_type = changeTypeToHeaderType(change_type);
                changes = this.git.getChanges(change_type);
                is_file_type = false;
                if (changes.length === 0) {
                    this.line = ui_model.getCategoryOffset(header_type) + 1;
                    return;
                }
                path = this.previousResource.path;
                break;
            }
            case "UntrackedHeader":
            case "UnstagedHeader":
            case "StagedHeader": {
                this.line = ui_model.getCategoryOffset(this.previousResource.type) + 1;
                return;
            }
            default: {
                LOGGER.error("updateCursorTreeView: No path found for resource: " + this.previousResource.type);
                return;
            }
        }
        if (!path) {
            LOGGER.error("updateCursorTreeView: No path found for resource: " + this.previousResource.type);
            return;
        }
        let new_line = -1;
        const path_split = path.split("/");
        is_file_type && path_split.pop(); // remove filename
        const dir = path_split.join("/");

        // get change in same directory
        if (isChangeType(this.previousResource)) {
            const new_change_index = changes.findIndex((c) => c.originalUri.path.startsWith(dir));
            if (new_change_index !== -1) {
                const prev = this.previousResource;
                new_line = ui_model.findIndex(
                    ([res]) => res.type === prev.type && res.changeIndex === new_change_index
                );
                this.line = new_line;
                return;
            }
        }
        // get closest parent
        for (let i = path_split.length - 1; i >= 0; i--) {
            const sub_path = path_split.slice(0, i + 1).join("/");
            new_line = ui_model.findIndex(
                ([res]) => res.type === "DirectoryHeader" && res.changeType === change_type && res.path === sub_path
            );
            if (new_line !== -1) {
                break;
            }
        }

        if (new_line !== -1) {
            this.line = new_line;
            return;
        }

        this.line = ui_model.getCategoryOffset(header_type) + 1;
        return;
    }

    /**
     * Used for cursor updating
     * Checks if the previous change is still present and returns the new offset
     */
    getNewOffsetFromPreviousChange(ui_model: UIModel): number | null {
        if (!this.previousChange || !this.previousResource) {
            return null;
        }
        const len = ui_model.length();
        const previous_change_path = this.previousChange.originalUri.path;

        const prev_type = diffTypeToHeaderType(this.previousResource.type);
        const header_offset = ui_model.getCategoryOffset(prev_type) + 1;
        outer: for (let i = header_offset; i < len; i++) {
            const res = ui_model.index(i)[0];
            switch (res.type) {
                case "Untracked":
                case "Unstaged":
                case "Staged": {
                    const found =
                        this.git.getChanges(res.type)[res.changeIndex].originalUri.path === previous_change_path;
                    if (found) {
                        this.line = i;
                        return i;
                    }
                    break;
                }
                case "BlankUI": {
                    break outer;
                }
                default: {
                    continue;
                }
            }
        }
        return null;
    }
}

/**
 * Use after syncCursorLine
 */
export function syncCursorWithView(line: number): void {
    const position = new vscode.Position(line, 0);
    const range = new vscode.Range(position, position);
    const window_contains_cursor = vscode.window.activeTextEditor?.visibleRanges[0].contains(position);
    if (!window_contains_cursor) {
        vscode.window.activeTextEditor!.revealRange(range);
    }
    vscode.window.activeTextEditor!.selection = new vscode.Selection(position, position);
}
