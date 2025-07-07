import { GIT } from "./extension";
import { GitWrapper } from "./git-wrapper";
import { Change, Commit } from "./vscode-git";

export type ChangeType = { changeIndex: number };
export type DiffType = { changeIndex: number, diffIndex: number, diffLineIndex: number };

export type ChangeTypes = 
    {type: 'MergeChange'}  & ChangeType |
    {type: 'Untracked'} & ChangeType | 
    {type: 'Unstaged'} & ChangeType| 
    {type: 'Staged'} & ChangeType
;

export type HeaderTypes = "UntrackedHeader" | "UnstagedHeader" | "StagedHeader" | "MergeHeader";

export type ResourceType = 
    {type: 'HeadUI'} | {type: 'MergeUI' }| {type: 'HelpUI' }| {type: 'MergeHeader' }| 
    {type: 'UntrackedHeader' } | 
    {type: 'UnstagedHeader' }| 
    {type: 'UnstagedDiff'} & DiffType  |
    {type: 'StagedHeader' }|
    {type: 'StagedDiff'} & DiffType  |
    {type: 'UnpushedHeader' } | {type: 'Unpushed' } & ChangeType |
    {type: 'BlankUI'} |
    {type: 'DirectoryHeader'} & {path: string} | 
    ChangeTypes
;

export function changeTypeToHeaderType(type: ChangeTypes["type"]): HeaderTypes {
    switch(type) {
        case "Untracked": return "UntrackedHeader";
        case "Unstaged": return "UnstagedHeader";
        case "Staged": return "StagedHeader";
        case "MergeChange": return "MergeHeader";
        default: throw new Error("Invalid Change Type");
    }
}

export function headerTypeToChangeType(type: HeaderTypes): ChangeTypes["type"] {
    switch(type) {
        case "UntrackedHeader": return "Untracked";
        case "UnstagedHeader": return "Unstaged";
        case "StagedHeader": return "Staged";
        case "MergeHeader": return "MergeChange";
        default: throw new Error("Invalid Header Type");
    }
}

export class Resource {
    readonly item: ResourceType;
    readonly git: GitWrapper;

    constructor(resource: ResourceType) {
        this.item = resource;
        if (!GIT) {
            throw Error("Git API not found!");
        }
        this.git = GIT;
    }

    public getChange(): Change | null {
        switch(this.item.type) {
            case "Unstaged": {
                return this.git.unstaged()[this.item.changeIndex];
            }
            case "Staged": {
                return this.git.staged()[this.item.changeIndex]; 
            }
            case "Untracked": {
                return this.git.untracked()[this.item.changeIndex];
            }
            case "MergeChange": {
                return this.git.mergeChanges()[this.item.changeIndex];
            }
            case "UnstagedDiff": {
                return this.git.unstaged()[this.item.changeIndex];
            }
            case "StagedDiff": {
                return this.git.staged()[this.item.changeIndex];
            }
            default: {
                return null;
            }
        }
    }


    public getCommit(): Commit | null {
        switch(this.item.type) {
            case "Unpushed": {
                return this.git.cachedUnpushedCommits[this.item.changeIndex];
            }
            default: {
                return null;
            }
        }
    }
}