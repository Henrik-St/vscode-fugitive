import * as vscode from "vscode";
import { GitWrapper } from "./git-wrapper";
import { GIT, LOGGER } from "./extension";
import { Change } from "./vscode-git";
import { mapStatustoString } from "./util";
import { BlankUI } from "./resource";

type DiffViewChangePayload = {
    type: "DiffViewChange";
    changeIndex: number;
};

type UIModelItem = [BlankUI | DiffViewChangePayload, string]; // Using number for ResourceType for simplicity

export class DiffViewProvider implements vscode.TextDocumentContentProvider {
    static scheme = "Fugitive-DiffView";
    static uri = vscode.Uri.parse(DiffViewProvider.scheme + ":DiffView");

    private onDidChangeEmitter = new vscode.EventEmitter<vscode.Uri>();
    private subscriptions: vscode.Disposable[] = [];
    private ref: string = "";
    private changes: Change[] = [];
    private uiModel: readonly UIModelItem[] = [];

    onDidChange = this.onDidChangeEmitter.event; // triggers before provideTextDocumentContent

    public git: GitWrapper;

    constructor() {
        if (!GIT) {
            throw Error("Git API not found!");
        }
        this.git = GIT;
    }

    dispose(): void {
        this.subscriptions.forEach((e) => e.dispose());
    }

    generateUIModel(): void {
        LOGGER.debug("DiffViewProvider.generateUIModel");

        let ui_model: UIModelItem[] = [];

        const branch = this.git.repo.state.HEAD?.name || "DETACHED_HEAD: " + this.git.repo.state.rebaseCommit;
        ui_model.push([{ type: "BlankUI" }, `DiffView - Changes of ${branch} compared to ${this.ref}`]);
        ui_model.push([{ type: "BlankUI" }, ""]);

        const len = this.changes.length;

        ui_model.push([{ type: "BlankUI" }, `Changed Files (${len}):`]);
        this.changes.forEach((change, index) => {
            const str = `${mapStatustoString(change.status)} ${change.uri.fsPath.replace(this.git.rootUri + "/", "")}`;
            ui_model.push([{ type: "DiffViewChange", changeIndex: index }, str]);
        });
        this.uiModel = ui_model;
    }

    provideTextDocumentContent(_uri: vscode.Uri): string {
        LOGGER.debug("DiffViewProvider.provideTextDocumentContent");
        return this.uiModel.map((item) => item[1]).join("\n");
    }

    async getDiffViewChooseBranch(): Promise<void> {
        LOGGER.debug("DiffViewProvider.getDiffViewChooseBranch");

        const refs = (await this.git.repo.getRefs({})).map((i) => i.name || "").filter((name) => name);
        const branch = await vscode.window.showQuickPick(refs, {
            placeHolder: "Select a branch to diff against",
        });
        if (!branch) {
            return Promise.reject("No branch selected");
        }
        this.getDiffView(branch);
    }

    async getDiffView(ref?: string): Promise<void> {
        LOGGER.debug("DiffViewProvider.getDocOrRefreshIfExists");

        let repo_list = this.git.getRepositories().sort((a, b) => a[0].length - b[0].length);

        const filepath = vscode.window.activeTextEditor?.document.uri.path || "";
        if (filepath) {
            repo_list = this.git
                .getRepositories()
                .filter((r) => filepath.includes(r[0]))
                .sort((r1, r2) => r1[0].length - r2[0].length);
        }
        await this.git.setRepository(repo_list[0][1]);
        await this.git.updateBranchInfo();

        const conf = vscode.workspace.getConfiguration("fugitive").get<string>("mainBranchName");

        const refs = (await this.git.repo.getRefs({})).map((i) => i.name);
        let branch = "";
        if (ref && refs.includes(ref)) {
            branch = ref;
        } else if (conf && refs.includes(conf)) {
            branch = conf;
        } else if (refs.includes("origin/main")) {
            branch = "origin/main";
        } else if (refs.includes("origin/master")) {
            branch = "origin/master";
        } else if (refs.includes("main")) {
            branch = "main";
        } else if (refs.includes("master")) {
            branch = "master";
        } else {
            vscode.window.showErrorMessage("Cannot find main branch for diff view. Please set it in settings.");
            return Promise.reject("Cannot find main branch for diff view.");
        }

        this.changes = await this.git.repo.diffWith(branch);
        this.ref = branch;
        this.generateUIModel();

        let doc = vscode.workspace.textDocuments.find((doc) => doc.uri === DiffViewProvider.uri);
        if (!doc) {
            doc = await vscode.workspace.openTextDocument(DiffViewProvider.uri);
        }

        this.onDidChangeEmitter.fire(DiffViewProvider.uri);
        await vscode.window.showTextDocument(doc, { preview: false });
    }

    openFile(): void {
        LOGGER.debug("DiffViewProvider.openFile");
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return;
        }
        const file_line = editor.selection.active.line;
        const resource = this.getResourceAtLine(file_line);

        if (!resource) {
            return;
        }

        const change = this.changes[resource.changeIndex];
        if (!change) {
            return;
        }

        const uri_right = change.uri;
        const uri_left = this.git.api.toGitUri(change.uri, this.ref);

        if (!uri_left || !uri_right) {
            return;
        }
        vscode.commands.executeCommand("vscode.diff", uri_left, uri_right, `${change.uri.fsPath} (Diff)`);
    }

    getResourceAtLine(line: number): DiffViewChangePayload | null {
        LOGGER.debug("DiffViewProvider.getResourceAtLine");
        if (line < 0 || line >= this.uiModel.length) {
            return null;
        }
        const item = this.uiModel[line];
        if (item[0].type === "DiffViewChange") {
            return item[0];
        }
        return null;
    }
}
