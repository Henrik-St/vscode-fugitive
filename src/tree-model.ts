import { ChangeTypes, headerTypeToChangeType } from "./resource";
import { UIModelItem } from "./ui-model";
import { mapStatustoString } from "./util";
import { Change } from "./vscode-git";

type FileTree = {
    children: Map<string, (FileTree & { type: "Tree" }) | ChangeTypes>;
    name: string;
    parentDir: string;
};

enum MenuSymbol {
    OPEN = "▽",
    CLOSED = "▷",
}

type ClosedDirectories = {
    [key in ChangeTypes["type"]]: Set<string>;
};

type TreePerChangeType = {
    [key in ChangeTypes["type"]]: FileTree;
};

export class TreeModel {
    private closedDirectories: ClosedDirectories;
    private tree: TreePerChangeType = {
        Untracked: { children: new Map(), name: "/", parentDir: "" },
        Unstaged: { children: new Map(), name: "/", parentDir: "" },
        Staged: { children: new Map(), name: "/", parentDir: "" },
        MergeChange: { children: new Map(), name: "/", parentDir: "" },
    };

    constructor() {
        this.closedDirectories = {
            MergeChange: new Set<string>(),
            Untracked: new Set<string>(),
            Unstaged: new Set<string>(),
            Staged: new Set<string>(),
        };
    }

    public getOpenedDirectories(): ClosedDirectories {
        return this.closedDirectories;
    }

    public clearOpenedDirectories(): void {
        for (const type of Object.keys(this.closedDirectories) as ChangeTypes["type"][]) {
            this.closedDirectories[type].clear();
        }
    }

    public toggleDirectory(dir: string, type: ChangeTypes["type"]): void {
        if (this.closedDirectories[type].has(dir)) {
            this.closedDirectories[type].delete(dir);
        } else {
            this.closedDirectories[type].add(dir);
        }
    }

    public changesToTreeModel(changes: Change[], root_uri: string, type: ChangeTypes["type"]): UIModelItem[] {
        const tree = this.changesToTree(changes, root_uri, type);
        this.tree[type] = tree;
        return this.treeToModel(tree, type);
    }

    // Traverse to the closest above node
    // public getPreviousNodes(type: ChangeTypes["type"]): UIModelItem | null {
    //     const tree = this.tree[type];
    // }

    private treeToModel(tree: FileTree, type: ChangeTypes["type"]): UIModelItem[] {
        return this._treeToModel(tree, 0, type);
    }

    private isClosedDirectory(tree: FileTree, type: ChangeTypes["type"]): boolean {
        return this.closedDirectories[type].has(tree.parentDir + tree.name);
    }

    private _treeToModel(tree: FileTree, depth: number, type: ChangeTypes["type"]): UIModelItem[] {
        const model: UIModelItem[] = [];
        for (const e of tree.children.values()) {
            if (e.type == "Tree") {
                const open_symbol = this.isClosedDirectory(e, type) ? MenuSymbol.CLOSED : MenuSymbol.OPEN;
                const ui_text = "  ".repeat(depth) + open_symbol + " " + e.name;
                model.push([{ type: "DirectoryHeader", path: e.parentDir + e.name, changeType: type }, ui_text]);
                model.push(...this._treeToModel(e as FileTree, depth + 1, type));
            }
        }
        model.push(...listFiles(tree, depth));

        return model;
    }

    private changesToTree(changes: Change[], root_uri: string, type: ChangeTypes["type"]): FileTree {
        const tree: FileTree = { children: new Map(), name: "/", parentDir: "" };
        for (let i = 0; i < changes.length; i++) {
            const c = changes[i];
            const status = mapStatustoString(c.status) + " ";

            const path_list = c.originalUri.path.replace(root_uri + "/", "").split("/");
            const file_name = status + path_list.pop(); // remove filename
            if (!file_name) {
                continue;
            }
            let current_tree = tree;
            let is_closed = false;
            for (const dir of path_list) {
                is_closed = [...this.closedDirectories[type].keys()].some(
                    (closed_dir) => current_tree.parentDir + current_tree.name === closed_dir
                );
                if (is_closed) {
                    break; // skip closed directories
                }
                current_tree = getOrCreate(current_tree, dir);
            }
            is_closed = [...this.closedDirectories[type].keys()].some(
                (closed_dir) => current_tree.parentDir + current_tree.name === closed_dir
            );

            !is_closed && current_tree.children.set(file_name, { changeIndex: i, type: type });
        }
        return tree;
    }
}

function getOrCreate(tree: FileTree, dir: string): FileTree {
    if (!tree.children.has(dir)) {
        tree.children.set(dir, {
            name: dir,
            children: new Map(),
            type: "Tree",
            parentDir: tree.parentDir ? tree.parentDir + tree.name + "/" : tree.name,
        });
    }
    const child = tree.children.get(dir);
    if (!child || child.type !== "Tree") {
        throw new Error("Expected Directory, got File");
    }
    return child;
}

function listFiles(tree: FileTree, depth: number): UIModelItem[] {
    const result: UIModelItem[] = [];
    for (const e of tree.children.entries()) {
        if (e[1].type !== "Tree") {
            const ui_text = "  ".repeat(depth) + e[0];
            const new_item: UIModelItem = [e[1], ui_text];
            result.push(new_item);
        }
    }
    return result;
}

export function getDirectoryType(ui: readonly UIModelItem[], line: number): ChangeTypes["type"] {
    const item = ui[line];
    if (!item) {
        throw new Error("No item found at line " + line);
    }

    for (let i = line; i >= 0; i--) {
        const ui_item = ui[i];
        if (!ui_item) throw new Error("No item found at line " + i);
        const type = ui_item[0].type;
        if (
            type === "UnstagedHeader" ||
            type === "StagedHeader" ||
            type === "UntrackedHeader" ||
            type === "MergeHeader"
        ) {
            return headerTypeToChangeType(type);
        }
    }
    throw new Error("No directory type found for line " + line);
}
