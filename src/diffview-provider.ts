import * as vscode from "vscode";
import * as path from "path";
import { GitWrapper } from "./git-wrapper";
import { GIT, LOGGER } from "./extension";
import { ResourceType } from "./resource";
import { UIModel } from "./ui-model";
import { getViewStyle, toggleViewStyle, ViewStyle } from "./configurations";
import { Cursor } from "./cursor";
import { Status } from "./vscode-git";

export class DiffViewProvider implements vscode.TextDocumentContentProvider {
    static scheme = "Fugitive-DiffView";
    static uri = vscode.Uri.parse(DiffViewProvider.scheme + ":DiffView");

    private onDidChangeEmitter = new vscode.EventEmitter<vscode.Uri>();
    private subscriptions: vscode.Disposable[] = [];
    private refName: string = "";
    private uiModel: UIModel;
    private cursor: Cursor;

    onDidChange = this.onDidChangeEmitter.event; // triggers before provideTextDocumentContent

    public git: GitWrapper;

    constructor() {
        if (!GIT) {
            throw Error("Git API not found!");
        }
        this.git = GIT;
        this.uiModel = new UIModel();
        this.cursor = new Cursor();

        const git_disposables = this.git.api.repositories.map((repo) => {
            return repo.state.onDidChange(async () => {
                LOGGER.debug("onGitChanged: ", repo.rootUri.toString());
                const doc = vscode.workspace.textDocuments.find((doc) => doc.uri.scheme === DiffViewProvider.scheme);
                if (doc) {
                    await this.git.updateBranchInfo();
                    await this.git.updateDiffView(this.refName);
                    await this.git.updateDiffMap("DiffViewChange");

                    // Clean up opened diffs that are no longer in the diff view
                    const delete_opened_diffview_diffs = Array.from(
                        this.uiModel.diffModel.getOpenedDiffViewChanges().keys()
                    ).filter((k) => !this.git.cachedDiffViewDiffs.has(k));
                    for (const key of delete_opened_diffview_diffs) {
                        this.uiModel.diffModel.getOpenedDiffViewChanges().delete(key);
                    }

                    this.onDidChangeEmitter.fire(doc.uri);
                }
            });
        });

        const doc_dispose = vscode.workspace.onDidChangeTextDocument(async (e: vscode.TextDocumentChangeEvent) => {
            if (
                vscode.window.activeTextEditor?.document.uri.toString() === DiffViewProvider.uri.toString() &&
                e.document.uri.toString() === DiffViewProvider.uri.toString()
            ) {
                LOGGER.debug("DiffView.onDidChangeTextDocument");
                this.cursor.syncCursorLine(DiffViewProvider.uri.toString());
            }
        });
        this.subscriptions = [...git_disposables, doc_dispose];
    }

    async updateInfo(): Promise<void> {
        LOGGER.debug("DiffViewProvider.updateInfo");
    }

    dispose(): void {
        this.subscriptions.forEach((e) => e.dispose());
    }

    refresh(): void {
        vscode.commands.executeCommand("git.refresh", this.git.rootUri).then(
            (succ) => {
                LOGGER.debug("git.refresh success", succ);
            },
            (err) => {
                LOGGER.debug("git.refresh error", err);
            }
        );
    }

    provideTextDocumentContent(_uri: vscode.Uri): string {
        LOGGER.debug("DiffViewProvider.provideTextDocumentContent");

        const view_style = getViewStyle();
        this.uiModel.updateDiffview(view_style);
        if (view_style === "tree") {
            this.cursor.updateCursorTreeView(this.uiModel);
        } else {
            this.cursor.updateCursor(this.uiModel);
        }

        return this.uiModel.toString();
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
        if (repo_list.length > 0) {
            await this.git.setRepository(repo_list[0][1]);
        }
        await this.git.updateBranchInfo();

        const conf = vscode.workspace.getConfiguration("fugitive").get<string>("mainBranchName");

        const refs = (await this.git.repo.getRefs({})).map((i) => i.name);
        ref = ref || this.refName;
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

        if (!this.git.repo.state.HEAD?.name) {
            vscode.window.showErrorMessage("Cannot create diff view from detached HEAD state.");
            return Promise.reject("Cannot create diff view from detached HEAD state.");
        }

        await this.git.updateDiffView(branch);
        this.refName = branch;

        await this.git.updateDiffMap("DiffViewChange");

        // Clean up opened diffs that are no longer in the diff view
        const delete_opened_diffview_diffs = Array.from(
            this.uiModel.diffModel.getOpenedDiffViewChanges().keys()
        ).filter((k) => !this.git.cachedDiffViewDiffs.has(k));
        for (const key of delete_opened_diffview_diffs) {
            this.uiModel.diffModel.getOpenedDiffViewChanges().delete(key);
        }

        let doc = vscode.workspace.textDocuments.find((doc) => doc.uri === DiffViewProvider.uri);
        if (!doc) {
            this.uiModel.diffModel.clearOpenedDiffViewChanges();
            doc = await vscode.workspace.openTextDocument(DiffViewProvider.uri);
        }

        this.onDidChangeEmitter.fire(DiffViewProvider.uri);
        await vscode.window.showTextDocument(doc, { preview: false });
    }

    async openFile(): Promise<void> {
        LOGGER.debug("DiffViewProvider.openFile");
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return;
        }
        const resource = this.getResourceUnderCursor();

        if (!resource || resource.type !== "DiffViewChange") {
            return;
        }

        const change = this.git.changeFromResource(resource);
        if (!change || !this.git.diffViewMergeBaseCommit) {
            return;
        }

        const uri_right = change.uri;
        const uri_left = this.git.api.toGitUri(change.uri, this.git.diffViewMergeBaseCommit);

        const doc_right = await vscode.workspace.openTextDocument(uri_right).then(
            (doc) => doc,
            () => undefined
        );

        const doc_left = await vscode.workspace.openTextDocument(uri_left).then(
            (doc) => doc,
            () => undefined
        );
        if (!doc_right) {
            const doc_name = path.basename(change.uri.fsPath);
            vscode.commands.executeCommand(
                "vscode.open",
                uri_left,
                { override: change.status === Status.BOTH_MODIFIED ? false : undefined },
                `${doc_name} (Deleted)`
            );
            return;
        }
        if (!doc_left) {
            const doc_name = path.basename(change.uri.fsPath);
            vscode.commands.executeCommand("git.openFile", uri_right, `${doc_name} (Added)`);
            return;
        }
        vscode.commands.executeCommand("vscode.diff", uri_left, uri_right, `${change.uri.fsPath} (Diff)`);
    }

    toggleDirectory(): void {
        const resource = this.getResourceUnderCursor();
        if (!resource) {
            return;
        }
        if (resource.type === "DirectoryHeader") {
            const path = resource.path;
            this.cursor.setLine(vscode.window.activeTextEditor!.selection.active.line);
            this.uiModel.treeModel.toggleDirectory(path, resource.changeType);
            this.onDidChangeEmitter.fire(DiffViewProvider.uri);
        }
    }

    async toggleView(view_style?: ViewStyle): Promise<void> {
        this.getResourceUnderCursor(); // updates previouse resource
        await toggleViewStyle(view_style);
        this.onDidChangeEmitter.fire(DiffViewProvider.uri);
    }

    async toggleInlineDiff(): Promise<void> {
        LOGGER.debug("DiffViewProvider.toggleInlineDiff");
        const resource = this.getResourceUnderCursor();

        switch (resource.type) {
            case "DiffViewChange": {
                const change = this.git.changeFromResource(resource);
                if (!change) {
                    LOGGER.warn("toggleInlineDiff: No DiffViewChange found for index " + resource.changeIndex);
                    return;
                }
                if (this.uiModel.diffModel.getOpenedDiffViewChanges().has(change.uri.path)) {
                    this.uiModel.diffModel.getOpenedDiffViewChanges().delete(change.uri.path);
                } else {
                    this.uiModel.diffModel.getOpenedDiffViewChanges().add(change.uri.path);
                }
                break;
            }
            case "DiffViewDiff": {
                const change = this.git.changeFromResource(resource);
                if (!change) {
                    LOGGER.warn("toggleInlineDiff: No DiffViewDiff found for index " + resource.changeIndex);
                    return;
                }
                this.uiModel.diffModel.getOpenedDiffViewChanges().delete(change.uri.path);
                break;
            }
        }
        this.onDidChangeEmitter.fire(DiffViewProvider.uri);
    }

    /**
     * @throws if no buffer is open
     * @returns the information for the current set line
     */
    private getResourceUnderCursor(): ResourceType {
        return this.cursor.getResourceUnderCursor(this.uiModel);
    }
}
