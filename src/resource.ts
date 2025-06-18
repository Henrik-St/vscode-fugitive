import { GIT } from "./extension";
import { GitWrapper } from "./git-wrapper";
import { Change, Commit } from "./vscode-git";

export type ChangeType = { changeIndex: number };
export type DiffType = { changeIndex: number, diffIndex: number, diffLineIndex: number };

export type ResourceType = 
    {type: 'HeadUI'} | {type: 'MergeUI' }| {type: 'HelpUI' }| {type: 'MergeHeader' }| 
    {type: 'MergeChange'}  & ChangeType | 
    {type: 'UntrackedHeader' } | {type: 'Untracked'} & ChangeType| 
    {type: 'UnstagedHeader' }| {type: 'Unstaged'} & ChangeType| 
    {type: 'UnstagedDiff'} & DiffType  |
    {type: 'StagedHeader' }| {type: 'Staged'} & ChangeType|
    {type: 'StagedDiff'} & DiffType  |
    {type: 'UnpushedHeader' } | {type: 'Unpushed' } & ChangeType |
    {type: 'BlankUI'}
;

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