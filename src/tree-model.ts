import { ChangeType } from "./resource";
import { UIModelItem } from "./ui-model";
import { mapStatustoString } from "./util";
import { Change } from "./vscode-git";

type FileTree = {
    children: Map<string, (FileTree & { type: "Tree" }) | ChangeType>;
    name: string;
    parentDir: string;
    path: string; // cached parentDir + name
};

enum MenuSymbol {
    OPEN = "▽",
    CLOSED = "▷",
}

type ClosedDirectories = {
    [key in ChangeType["type"]]: Set<string>;
};

type TreePerChangeType = {
    [key in ChangeType["type"]]: FileTree;
};

export class TreeModel {
    private closedDirectories: ClosedDirectories;
    private tree: TreePerChangeType = {
        Untracked: { children: new Map(), name: "/", parentDir: "", path: "/" },
        Unstaged: { children: new Map(), name: "/", parentDir: "", path: "/" },
        Staged: { children: new Map(), name: "/", parentDir: "", path: "/" },
        MergeChange: { children: new Map(), name: "/", parentDir: "", path: "/" },
        DiffViewChange: { children: new Map(), name: "/", parentDir: "", path: "/" },
    };

    constructor() {
        this.closedDirectories = {
            MergeChange: new Set<string>(),
            Untracked: new Set<string>(),
            Unstaged: new Set<string>(),
            Staged: new Set<string>(),
            DiffViewChange: new Set<string>(),
        };
    }

    public getOpenedDirectories(): ClosedDirectories {
        return this.closedDirectories;
    }

    public clearOpenedDirectories(): void {
        for (const type of Object.keys(this.closedDirectories) as ChangeType["type"][]) {
            this.closedDirectories[type].clear();
        }
    }

    public toggleDirectory(dir: string, type: ChangeType["type"]): void {
        if (this.closedDirectories[type].has(dir)) {
            this.closedDirectories[type].delete(dir);
        } else {
            this.closedDirectories[type].add(dir);
        }
    }

    public changesToTreeModel(changes: Change[], root_uri: string, type: ChangeType["type"]): UIModelItem[] {
        const tree = this.changesToTree(changes, root_uri, type);
        this.tree[type] = tree;
        return this.treeToModel(tree, type);
    }

    // Traverse to the closest above node
    // public getPreviousNodes(type: ChangeTypes["type"]): UIModelItem | null {
    //     const tree = this.tree[type];
    // }

    private treeToModel(tree: FileTree, type: ChangeType["type"]): UIModelItem[] {
        const result: UIModelItem[] = [];
        this._treeToModel(tree, 0, type, result);
        return result;
    }

    private isClosedDirectory(tree: FileTree, type: ChangeType["type"]): boolean {
        return this.closedDirectories[type].has(tree.path);
    }

    private _treeToModel(tree: FileTree, depth: number, type: ChangeType["type"], result: UIModelItem[]): void {
        for (const [label, e] of tree.children.entries()) {
            if (e.type === "Tree") {
                const open_symbol = this.isClosedDirectory(e, type) ? MenuSymbol.CLOSED : MenuSymbol.OPEN;
                const ui_text = "  ".repeat(depth) + open_symbol + " " + e.name;
                result.push([{ type: "DirectoryHeader", path: e.path, changeType: type }, ui_text]);
                this._treeToModel(e as FileTree, depth + 1, type, result);
            }
        }
        for (const [label, e] of tree.children.entries()) {
            if (e.type !== "Tree") {
                result.push([e, "  ".repeat(depth) + label]);
            }
        }
    }

    private changesToTree(changes: Change[], root_uri: string, type: ChangeType["type"]): FileTree {
        const rootPrefix = root_uri + "/";
        const tree: FileTree = { children: new Map(), name: "/", parentDir: "", path: "/" };
        for (let i = 0; i < changes.length; i++) {
            const c = changes[i];
            const status = mapStatustoString(c.status);

            const newRelPath = (c.renameUri ?? c.uri).path.replace(rootPrefix, "");
            const oldRelPath = c.originalUri.path.replace(rootPrefix, "");
            const path_list = newRelPath.split("/");
            const newBaseName = path_list.pop(); // remove filename
            if (!newBaseName) {
                continue;
            }

            let fileLabel = `${status} ${newBaseName}`;
            if (status === "R" && c.renameUri) {
                const oldParts = oldRelPath.split("/");
                const oldBaseName = oldParts.pop() ?? oldRelPath;
                const oldDir = oldParts.join("/");
                const newDir = path_list.join("/");
                fileLabel =
                    oldDir === newDir
                        ? `${status} ${oldBaseName} → ${newBaseName}`
                        : `${status} ${oldRelPath} → ${newRelPath}`;
            }

            const file_name = fileLabel;
            if (!file_name) {
                continue;
            }
            let current_tree = tree;
            let is_closed = false;
            const closedSet = this.closedDirectories[type];
            for (const dir of path_list) {
                is_closed = closedSet.has(current_tree.path);
                if (is_closed) {
                    break; // skip closed directories
                }
                current_tree = getOrCreate(current_tree, dir);
            }
            is_closed = closedSet.has(current_tree.path);

            if (!is_closed) {
                current_tree.children.set(file_name, {
                    changeIndex: i,
                    type: type,
                    listIndex: current_tree.children.size, // assumes the list is sorted lexicographically
                    path: c.uri.path,
                });
            }
        }
        return tree;
    }
}

function getOrCreate(tree: FileTree, dir: string): FileTree {
    if (!tree.children.has(dir)) {
        const parentDir = tree.parentDir ? tree.path + "/" : tree.name;
        tree.children.set(dir, {
            name: dir,
            children: new Map(),
            type: "Tree",
            parentDir,
            path: parentDir + dir,
        });
    }
    const child = tree.children.get(dir);
    if (!child || child.type !== "Tree") {
        throw new Error("Expected Directory, got File");
    }
    return child;
}
