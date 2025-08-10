export type ChangePayload = { changeIndex: number };
export type DiffPayload = { changeIndex: number; diffIndex: number; diffLineIndex: number };

export type ChangeCategory = "Unstaged" | "Staged" | "Untracked" | "MergeChange";
export type ChangeType = { type: ChangeCategory } & ChangePayload;

export type DiffCategory = "UnstagedDiff" | "StagedDiff";
export type DiffType = { type: DiffCategory } & DiffPayload;

// const HEADERTYPES = ["UntrackedHeader", "UnstagedHeader", "StagedHeader", "MergeHeader"] as const;
// export type HeaderTypes = (typeof HEADERTYPES)[number];
export type HeaderType = "UntrackedHeader" | "UnstagedHeader" | "StagedHeader" | "MergeHeader" | "UnpushedHeader";

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
    return (
        type.type === "Unstaged" || type.type === "Staged" || type.type === "Untracked" || type.type === "MergeChange"
    );
}

export function isDiffType(type: ResourceType): type is DiffType {
    return type.type === "UnstagedDiff" || type.type === "StagedDiff";
}

export function isHeaderType(type: ResourceType["type"]): type is HeaderType {
    return type === "UntrackedHeader" || type === "UnstagedHeader" || type === "StagedHeader" || type === "MergeHeader";
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
    switch (type) {
        case "UnstagedDiff":
            return "Unstaged";
        case "StagedDiff":
            return "Staged";
        case "Unstaged":
            return "Unstaged";
        case "Staged":
            return "Staged";
        case "MergeChange":
            return "MergeChange";
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
