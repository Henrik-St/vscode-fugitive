export type ChangePayload = { changeIndex: number };
export type DiffPayload = { changeIndex: number; diffIndex: number; diffLineIndex: number };

const change_types = ["Unstaged", "Staged", "Untracked", "MergeChange"] as const;
export type ChangeCategory = (typeof change_types)[number];
export type ChangeType = { type: ChangeCategory } & ChangePayload;

const diff_types = ["UnstagedDiff", "StagedDiff"] as const;
export type DiffCategory = (typeof diff_types)[number];
export type DiffType = { type: DiffCategory } & DiffPayload;

const header_types = ["UntrackedHeader", "UnstagedHeader", "StagedHeader", "MergeHeader", "UnpushedHeader"] as const;
export type HeaderType = (typeof header_types)[number];

export type UnpushedType = { type: "Unpushed" } & ChangePayload;

export type ResourceType =
    | { type: "HeadUI" }
    | { type: "MergeUI" }
    | { type: "HelpUI" }
    | { type: HeaderType }
    | UnpushedType
    | { type: "BlankUI" }
    | ({ type: "DirectoryHeader" } & { path: string; changeType: ChangeType["type"] })
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
        default:
            throw new Error("Invalid Change Type");
    }
}

export function diffTypeToHeaderType(type: ResourceType["type"]): HeaderType {
    switch (type) {
        case "UnstagedDiff":
            return "UnstagedHeader";
        case "StagedDiff":
            return "StagedHeader";
        case "Unstaged":
            return "UnstagedHeader";
        case "Staged":
            return "StagedHeader";
        case "Untracked":
            return "UntrackedHeader";
        case "MergeChange":
            return "MergeHeader";
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
