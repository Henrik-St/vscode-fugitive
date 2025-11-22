import * as vscode from "vscode";

type ViewStyle = "list" | "tree";
export function getViewStyle(): ViewStyle {
    return vscode.workspace.getConfiguration("fugitive").get<ViewStyle>("viewStyle", "list");
}
