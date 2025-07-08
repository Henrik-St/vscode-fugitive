import { ChangeTypes, headerTypeToChangeType, Resource } from "./resource";
import { UIModel, UIModelItem } from "./ui-model";
import { mapStatustoString } from "./util";
import { Change } from "./vscode-git";

export type FileTree = {
    children: Map<string, FileTree & {type: "Tree"} | ChangeTypes>
    name: string;
    parentDir: string;
}

enum MenuSymbol {
    OPEN = "▽",
    CLOSED = "▷"
}

type ClosedDirectories = {
        [key in ChangeTypes["type"]]: Set<string>
    };

export class TreeModel {
    private closedDirectories: ClosedDirectories;
    
    constructor() {
        this.closedDirectories = {
            "MergeChange": new Set<string>(),
            "Untracked": new Set<string>(),
            "Unstaged": new Set<string>(),
            "Staged": new Set<string>(),
        };
    }

    public getOpenedDirectories(): ClosedDirectories {
        return this.closedDirectories;
    }

    public clearOpenedDirectories(): void {
        for(const type of Object.keys(this.closedDirectories) as ChangeTypes["type"][]){
            this.closedDirectories[type].clear();
        }
    }

    public toggleDirectory(dir: string, type: ChangeTypes["type"]): void {
        if(this.closedDirectories[type].has(dir)){
            this.closedDirectories[type].delete(dir);
        } else {
            this.closedDirectories[type].add(dir);
        }
    }

    public changesToTreeModel(changes: Change[], root_uri: string, type: ChangeTypes["type"]): UIModelItem[] {
        const tree = changesToTree(changes, root_uri, type);
        return this.treeToModel(tree, type);
    }

    private treeToModel(tree: FileTree, type: ChangeTypes["type"]): UIModelItem[] {
        return this._treeToModel(tree, 0, type);
    }

    private isClosedDirectory(tree: FileTree, type: ChangeTypes["type"]): boolean {
        return this.closedDirectories[type].has(tree.parentDir + "/" + tree.name);
    }

    private _treeToModel(tree: FileTree, depth: number, type: ChangeTypes["type"]): UIModelItem[] {
        const model: UIModelItem[] = [];
        for(const e of tree.children.values()){
            if(e.type == "Tree"){
                const open_symbol = this.isClosedDirectory(e, type) ? MenuSymbol.CLOSED : MenuSymbol.OPEN;
                const ui_text =  "  ".repeat(depth) + open_symbol + " " + e.name;
                model.push([new Resource({type: "DirectoryHeader", path: e.parentDir + "/" + e.name}), ui_text]);
                !this.isClosedDirectory(e, type) && model.push(...this._treeToModel(e as FileTree, depth + 1, type));
            }
        }
        !this.isClosedDirectory(tree, type) && model.push(...listFiles(tree, depth));

        return model;
    }
}

function getOrCreate(tree: FileTree, dir: string): FileTree {
    if(!tree.children.has(dir)){
        tree.children.set(dir, {name: dir, children: new Map(), type: "Tree", parentDir: tree.parentDir ? (tree.parentDir + "/" + tree.name): tree.name});
    }
    const child = tree.children.get(dir);
    if(!child || child.type !== "Tree"){
        throw new Error("Expected Directory, got File");
    }
    return child;
}

function changesToTree(changes: Change[], root_uri: string, type: ChangeTypes["type"]): FileTree {
    const tree: FileTree = {children: new Map(), name: "", parentDir: ""};
    for(let i=0; i<changes.length; i++){
        const c = changes[i];
        const status = mapStatustoString(c.status) + " ";
        const path_list = c.originalUri.path.replace(root_uri.toString() + "/", "").split("/");
        const file_name = status + path_list.pop(); // remove filename
        if(!file_name){
            continue;
        }
        let current_tree = tree;
        for(const dir of path_list){
            current_tree = getOrCreate(current_tree, dir);
        }
        current_tree.children.set(file_name, {changeIndex: i, type: type});
    }
    return tree;
}

function listFiles(tree: FileTree, depth: number): UIModelItem[]{
    const result: UIModelItem[] = []; 
    for(const e of tree.children.entries()){
        if (e[1].type !== "Tree"){
            const ui_text = "  ".repeat(depth) + e[0];
            const new_item: UIModelItem = [new Resource(e[1]), ui_text];
            result.push(new_item);
        }
    }
    return result;
}

export function getDirectoryType(ui: UIModel, line: number): ChangeTypes["type"] {
    const item = ui.index(line);
    if (!item) {
        throw new Error("No item found at line " + line);
    }
    
    for (let i=line; i>=0; i--) {
        const ui_item = ui.index(i);
        if(!ui_item) throw new Error("No item found at line " + i);
        const type = ui_item[0].item.type;
        if (type === "UnstagedHeader" || type === "StagedHeader" || type === "UntrackedHeader" || type === "MergeHeader") {
            return headerTypeToChangeType(type);
        }
    }
    throw new Error("No directory type found for line " + line);
}

