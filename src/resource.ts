export type ChangeType = { changeIndex: number };
export type DiffType = { changeIndex: number, diffIndex: number, diffLineIndex: number };

export type ChangeTypes = 
    {type: 'MergeChange'}  & ChangeType |
    {type: 'Untracked'} & ChangeType | 
    {type: 'Unstaged'} & ChangeType| 
    {type: 'Staged'} & ChangeType
;

// const HEADERTYPES = ["UntrackedHeader" , "UnstagedHeader" , "StagedHeader" , "MergeHeader"] as const;
// export type HeaderTypes = typeof HEADERTYPES[number];
export type HeaderTypes = "UntrackedHeader" | "UnstagedHeader" | "StagedHeader" | "MergeHeader";

export type UnpushedType = {type: 'Unpushed' } & ChangeType;

export type ResourceType = 
    {type: 'HeadUI'} | {type: 'MergeUI' }| {type: 'HelpUI' }| {type: 'MergeHeader' }| 
    {type: 'UntrackedHeader' } | 
    {type: 'UnstagedHeader' }| 
    {type: 'UnstagedDiff'} & DiffType  |
    {type: 'StagedHeader' }|
    {type: 'StagedDiff'} & DiffType  |
    {type: 'UnpushedHeader' } | UnpushedType |
    {type: 'BlankUI'} |
    {type: 'DirectoryHeader'} & {path: string, changeType: ChangeTypes["type"]} | 
    ChangeTypes
;


export function isChangeTypes(type: ResourceType): type is ChangeTypes {
    return type.type === "Unstaged" ||
        type.type === "Staged" ||
        type.type === "Untracked" ||
        type.type === "MergeChange"
    ;
}

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
