import * as vscode from "vscode";

export type ViewStyle = "list" | "tree";
export function getViewStyle(): ViewStyle {
    return vscode.workspace.getConfiguration("fugitive").get<ViewStyle>("viewStyle", "list");
}

export async function toggleViewStyle(view_style?: ViewStyle): Promise<ViewStyle> {
    const new_view_style = view_style ?? (getViewStyle() === "list" ? "tree" : "list");
    const conf_name = "viewStyle";

    const conf = vscode.workspace.getConfiguration("fugitive");
    const insp = conf.inspect(conf_name);

    let conf_scope = vscode.ConfigurationTarget.Global;
    if (insp?.workspaceFolderValue) {
        conf_scope = vscode.ConfigurationTarget.WorkspaceFolder;
    } else if (insp?.workspaceValue) {
        conf_scope = vscode.ConfigurationTarget.Workspace;
    }
    await conf.update(conf_name, new_view_style, conf_scope);
    return new_view_style;
}
