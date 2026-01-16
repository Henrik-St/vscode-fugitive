export type BlankUI = { type: "BlankUI" };
export type ChangePayload = {
    changeIndex: number; // the array index of the git change
    listIndex: number; // the index of the change in a list i.e. directory for list view changeIndex = listIndex
    path: string; // full uri.path of the underlying change
};
export type DiffPayload = ChangePayload & { diffIndex: number; diffLineIndex: number };

const change_types = ["Unstaged", "Staged", "Untracked", "MergeChange", "DiffViewChange"] as const;
export type ChangeCategory = (typeof change_types)[number];
export type ChangeType = { type: ChangeCategory } & ChangePayload;

const diff_types = ["UnstagedDiff", "StagedDiff", "DiffViewDiff"] as const;
export type DiffCategory = (typeof diff_types)[number];
export type DiffType = { type: DiffCategory } & DiffPayload;

const header_types = [
    "UntrackedHeader",
    "UnstagedHeader",
    "StagedHeader",
    "MergeHeader",
    "UnpushedHeader",
    "DiffViewHeader",
] as const;
export type HeaderType = (typeof header_types)[number];

export type UnpushedType = { type: "Unpushed" } & ChangePayload;

export type DirectoryType = { type: "DirectoryHeader" } & { path: string; changeType: ChangeType["type"] };

export type ResourceType =
    | { type: "HeadUI" }
    | { type: "MergeUI" }
    | { type: "HelpUI" }
    | { type: HeaderType }
    | UnpushedType
    | BlankUI
    | DirectoryType
    | ChangeType
    | DiffType;

export function isChangeType(type: ResourceType): type is ChangeType {
    return (change_types as readonly ResourceType["type"][]).includes(type.type);
}

export function isChangeCategory(type: ResourceType["type"]): type is ChangeCategory {
    return (change_types as readonly ResourceType["type"][]).includes(type);
}

export function isDiffType(type: ResourceType): type is DiffType {
    return (diff_types as readonly ResourceType["type"][]).includes(type.type);
}

export function isHeaderType(type: ResourceType["type"]): type is HeaderType {
    return (header_types as readonly ResourceType["type"][]).includes(type);
}

export function changeTypeToHeaderType(type: ChangeType["type"]): HeaderType {
    switch (type) {
        case "Untracked":
            return "UntrackedHeader";
        case "Unstaged":
            return "UnstagedHeader";
        case "Staged":
            return "StagedHeader";
        case "MergeChange":
            return "MergeHeader";
        case "DiffViewChange":
            return "DiffViewHeader";
        default:
            throw new Error("Invalid Change Type: " + type);
    }
}

export function diffTypeToHeaderType(type: ResourceType["type"]): HeaderType {
    switch (type) {
        case "UnstagedDiff":
            return "UnstagedHeader";
        case "StagedDiff":
            return "StagedHeader";
        case "DiffViewDiff":
            return "DiffViewHeader";
        case "Unstaged":
            return "UnstagedHeader";
        case "Staged":
            return "StagedHeader";
        case "Untracked":
            return "UntrackedHeader";
        case "MergeChange":
            return "MergeHeader";
        case "DiffViewChange":
            return "DiffViewHeader";
        default:
            throw new Error("Invalid Diff Type");
    }
}

export function diffTypeToChangeType(type: ResourceType["type"]): ChangeType["type"] {
    if (isChangeCategory(type)) {
        return type;
    }
    switch (type) {
        case "UnstagedDiff":
            return "Unstaged";
        case "StagedDiff":
            return "Staged";
        case "DiffViewDiff":
            return "DiffViewChange";
        default:
            throw new Error("Invalid Diff Type");
    }
}

export function headerTypeToChangeType(type: HeaderType): ChangeType["type"] {
    switch (type) {
        case "UntrackedHeader":
            return "Untracked";
        case "UnstagedHeader":
            return "Unstaged";
        case "StagedHeader":
            return "Staged";
        case "MergeHeader":
            return "MergeChange";
        default:
            throw new Error("Invalid Header Type");
    }
}
