import * as vscode from "vscode";
import { Status, Repository } from "./vscode-git";
import { GitWrapper } from "./git-wrapper";
import { encodeCommit } from "./diff-provider";
import { ResourceType } from "./resource";
import { UIModel } from "./ui-model";
import { GIT, LOGGER } from "./extension";
import { Cursor } from "./cursor";

export class Provider implements vscode.TextDocumentContentProvider {
    static myScheme = "fugitive";
    static uri = vscode.Uri.parse(Provider.myScheme + ":Fugitive");

    public readonly git: GitWrapper;

    private actionLock: boolean;

    private uiModel: UIModel;
    private cursor: Cursor;

    //status data
    private viewStyle: "list" | "tree" = "list"; // current view mode, list or tree

    private onDidChangeEmitter = new vscode.EventEmitter<vscode.Uri>();
    onDidChange = this.onDidChangeEmitter.event; // triggers before provideTextDocumentContent
    private subscriptions: vscode.Disposable[];

    constructor() {
        if (!GIT) {
            throw Error("Git API not found!");
        }
        this.git = GIT;
        this.actionLock = false;

        this.uiModel = new UIModel();
        this.viewStyle = vscode.workspace.getConfiguration("fugitive").get("viewStyle", "list");
        this.cursor = new Cursor();

        // on Git Changed on all repositories
        const git_disposables = this.git.api.repositories.map((repo) => {
            return repo.state.onDidChange(async () => {
                LOGGER.debug("onGitChanged: ", repo.rootUri.toString());
                await this.git.updateBranchInfo();
                await this.updateDiffs();

                const doc = vscode.workspace.textDocuments.find((doc) => doc.uri.scheme === Provider.myScheme);
                if (doc) {
                    this.fireOnDidChange();
                }
            });
        });

        // triggers after provideTextDocumentContent
        const doc_dispose = vscode.workspace.onDidChangeTextDocument((e: vscode.TextDocumentChangeEvent) => {
            if (
                vscode.window.activeTextEditor?.document.uri.toString() === Provider.uri.toString() &&
                e.document.uri.toString() === Provider.uri.toString()
            ) {
                LOGGER.debug("onDidChangeTextDocument");
                // overrides cursor behaviour
                this.cursor.syncCursorLine();
                this.actionLock = false; // reset action lock
                LOGGER.debug("release lock");
            }
        });
        this.subscriptions = [...git_disposables, doc_dispose];
    }

    private fireOnDidChange(): void {
        this.onDidChangeEmitter.fire(Provider.uri);
    }

    private getLock(): boolean {
        LOGGER.debug("Aquire lock");
        if (this.actionLock) {
            return false;
        }
        this.actionLock = true;
        setTimeout(() => {
            if (!this.actionLock) {
                return;
            }
            LOGGER.debug("Reset lock after timeout");
            this.actionLock = false;
        }, 3000);
        return true;
    }

    private readLock(): boolean {
        LOGGER.debug("Read lock");
        return this.actionLock;
    }

    dispose(): void {
        this.subscriptions.forEach((e) => e.dispose());
    }

    provideTextDocumentContent(_uri: vscode.Uri): string {
        LOGGER.debug("Provider.provideTextDocumentContent");
        this.uiModel.update(this.viewStyle);
        if (this.viewStyle === "tree") {
            this.cursor.updateCursorTreeView(this.uiModel);
        } else {
            this.cursor.updateCursor(this.uiModel);
        }

        return this.uiModel.toString();
    }

    /**
     * opens the fugitive document
     * @param filepath determines the repository to open if there a multiple
     */
    async getDocOrRefreshIfExists(filepath?: string): Promise<vscode.TextDocument> {
        LOGGER.debug("getDocOrRefreshIfExists");

        // get the closest repo to the openend document
        // or the closest repo to the / if no document is open
        let repo_list = this.git.getRepositories().sort((a, b) => a[0].length - b[0].length);
        if (filepath) {
            repo_list = this.git
                .getRepositories()
                .filter((r) => filepath.includes(r[0]))
                .sort((r1, r2) => r1[0].length - r2[0].length);
        }
        await this.git.setRepository(repo_list[0][1]);
        await this.git.updateBranchInfo();
        await this.updateDiffs();

        let doc = vscode.workspace.textDocuments.find((doc) => doc.uri === Provider.uri);
        if (!doc) {
            this.uiModel.diffModel.clearOpenedChanges();
            this.uiModel.diffModel.clearOpenedIndexChanges();
            doc = await vscode.workspace.openTextDocument(Provider.uri);
        }
        this.fireOnDidChange();
        return doc;
    }

    goUp(): void {
        if (!vscode.window.activeTextEditor) {
            return;
        }
        const line = vscode.window.activeTextEditor!.selection.active.line;
        const new_line = Math.max(line - 1, 0);
        this.cursor.syncCursorLine(new_line);
    }

    goDown(): void {
        if (!vscode.window.activeTextEditor) {
            return;
        }
        const line_count = vscode.window.activeTextEditor.document.lineCount;
        const line = vscode.window.activeTextEditor!.selection.active.line;
        const new_line = Math.min(line + 1, line_count - 1);
        this.cursor.syncCursorLine(new_line);
    }

    goStaged(): void {
        const index = this.uiModel.findHeader("StagedHeader");
        if (index >= 0) {
            this.cursor.syncCursorLine(index);
        }
    }

    goTop(): void {
        this.cursor.syncCursorWithView(0);
    }

    goUnstaged(go_unstaged: boolean): void {
        const untracked_index = this.uiModel.findHeader("UntrackedHeader");
        if (!go_unstaged && untracked_index >= 0) {
            this.cursor.syncCursorLine(untracked_index);
            return;
        }
        const unstaged_index = this.uiModel.findHeader("UnstagedHeader");
        if (unstaged_index >= 0) {
            this.cursor.syncCursorLine(unstaged_index);
            return;
        }
    }

    goUnpushed(): void {
        const index = this.uiModel.findHeader("UnpushedHeader");
        if (index >= 0) {
            this.cursor.syncCursorLine(index);
        }
    }

    goPreviousHunk(): void {
        const current_line = vscode.window.activeTextEditor?.selection.active.line;

        if (!current_line) {
            LOGGER.debug("no current line");
            return;
        }

        for (let i = current_line - 1; i >= 0; i--) {
            const res = this.uiModel.index(i)[0];
            const type = res.type;
            if (
                type === "HeadUI" ||
                type === "MergeUI" ||
                type === "HelpUI" ||
                type === "BlankUI" ||
                type === "MergeHeader" ||
                type === "UntrackedHeader" ||
                type === "UnstagedHeader" ||
                type === "StagedHeader" ||
                type === "UnpushedHeader" ||
                type === "Unpushed"
            ) {
                continue;
            }

            if (type === "MergeChange" || type === "Untracked" || type === "Unstaged" || type === "Staged") {
                this.cursor.syncCursorWithView(i);
                return;
            } else if ((type === "UnstagedDiff" || type === "StagedDiff") && res.diffLineIndex === 0) {
                this.cursor.syncCursorWithView(i);
                return;
            }
        }
    }

    goNextHunk(): void {
        const current_line = vscode.window.activeTextEditor?.selection.active.line;
        if (!current_line && current_line !== 0) {
            LOGGER.debug("no current line");
            return;
        }

        for (let i = current_line + 1; i < this.uiModel.length(); i++) {
            const res = this.uiModel.index(i)[0];
            const type = res.type;
            if (
                type === "HeadUI" ||
                type === "MergeUI" ||
                type === "HelpUI" ||
                type === "BlankUI" ||
                type === "MergeHeader" ||
                type === "UntrackedHeader" ||
                type === "UnstagedHeader" ||
                type === "StagedHeader" ||
                type === "UnpushedHeader" ||
                type === "Unpushed"
            ) {
                continue;
            }

            if (type === "MergeChange" || type === "Untracked" || type === "Unstaged" || type === "Staged") {
                this.cursor.syncCursorWithView(i);
                return;
            } else if ((type === "UnstagedDiff" || type === "StagedDiff") && res.diffLineIndex === 0) {
                this.cursor.syncCursorWithView(i);
                return;
            }
        }
    }

    async setRepository(): Promise<void> {
        if (!this.getLock()) {
            vscode.window.showWarningMessage("Action in progress. Try again after completion");
            return;
        }

        const repos = this.git.getRepositories().map((i): [string, Repository] => [i[0].split("/").pop() || "", i[1]]);
        const repo_names = repos.map((i) => i[0]);

        const options: vscode.QuickPickOptions = {
            title: "Select the repository",
        };

        const value = await vscode.window.showQuickPick(repo_names, options);
        if (!value) {
            this.actionLock = false;
            return;
        }
        const repo = repos.filter((i) => i[0] === value)[0][1];
        this.git.setRepository(repo);

        await this.git.updateBranchInfo();
        await this.updateDiffs();

        const doc = vscode.workspace.textDocuments.find((doc) => doc.uri.scheme === Provider.myScheme);
        if (doc) {
            this.fireOnDidChange();
        }
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

    async toggleView(view_style?: "list" | "tree"): Promise<void> {
        this.getResourceUnderCursor();
        this.viewStyle = view_style ?? (this.viewStyle === "list" ? "tree" : "list");
        const conf_name = "viewStyle";

        const conf = vscode.workspace.getConfiguration("fugitive");
        const insp = conf.inspect(conf_name);

        let conf_scope = vscode.ConfigurationTarget.Global;
        if (insp?.workspaceFolderValue) {
            conf_scope = vscode.ConfigurationTarget.WorkspaceFolder;
        } else if (insp?.workspaceValue) {
            conf_scope = vscode.ConfigurationTarget.Workspace;
        }
        await conf.update(conf_name, this.viewStyle, conf_scope);

        this.fireOnDidChange();
    }

    toggleDirectory(): void {
        if (!this.getLock()) {
            vscode.window.showWarningMessage("Action in progress. Try again after completion");
            return;
        }
        const resource = this.getResourceUnderCursor();
        if (!resource) {
            this.actionLock = false;
            return;
        }
        if (resource.type === "DirectoryHeader") {
            const path = resource.path;
            this.cursor.setLine(vscode.window.activeTextEditor!.selection.active.line);
            this.uiModel.treeModel.toggleDirectory(path, resource.changeType);
            this.fireOnDidChange();
        }
        this.actionLock = false;
    }

    async stageFile(): Promise<void> {
        if (!this.getLock()) {
            vscode.window.showWarningMessage("Action in progress. Try again after completion");
            return;
        }
        const resource = this.getResourceUnderCursor();
        if (!resource) {
            this.actionLock = false;
            return;
        }
        if (resource.type === "MergeChange") {
            const change = this.git.mergeChanges()[resource.changeIndex];
            LOGGER.debug("merge add ", change.uri.path);
            const uri = vscode.Uri.parse(change.uri.path);
            if (await this.checkForConflictMarker(uri)) {
                await this.git.repo.add([change.uri.path]);
                return;
            }
            this.actionLock = false;
        }
        if (resource.type === "Untracked") {
            const change = this.git.untracked()[resource.changeIndex];
            LOGGER.debug("track ", change.uri.path);
            await this.git.repo.add([change.uri.path]);
            return;
        }
        if (resource.type === "UntrackedHeader") {
            const changes = this.git.untracked().map((c) => c.uri.path);
            LOGGER.debug(`track ${changes.length} files`);
            await this.git.repo.add(changes);
            return;
        }
        if (resource.type === "Unstaged") {
            const change = this.git.unstaged()[resource.changeIndex];
            LOGGER.debug("stage ", change.uri.path);
            await this.git.repo.add([change.uri.path]);
            this.uiModel.diffModel.getOpenedChanges().delete(change.uri.path);
            return;
        }
        if (resource.type === "UnstagedHeader") {
            const changes = this.git.unstaged().map((c) => c.uri.path);
            LOGGER.debug(`track ${changes.length} files`);
            await this.git.repo.add(changes);
            for (const change of changes) {
                this.uiModel.diffModel.getOpenedChanges().delete(change);
            }
            return;
        }
        if (resource.type === "UnstagedDiff") {
            const change = this.git.unstaged()[resource.changeIndex];
            if (resource.diffIndex === undefined) {
                this.actionLock = false;
                return Promise.reject("No diff index: " + resource.diffIndex);
            }
            await this.git.applyPatchToFile(change.uri, resource.diffIndex, "stage");
            return;
        }
        if (resource.type === "DirectoryHeader") {
            const type = resource.changeType;
            const affected_changes = this.git
                .getChanges(type)
                .filter((c) => {
                    return c.originalUri.path.replace(this.git.rootUri, "").startsWith(resource.path + "/");
                })
                .map((c) => c.uri.path);

            LOGGER.debug(`stage ${affected_changes.length} ${type} files in directory ${resource.path}`);
            if (affected_changes.length === 0) {
                this.actionLock = false;
                return;
            }
            await this.git.repo.add(affected_changes);
            for (const change of affected_changes) {
                this.uiModel.diffModel.getOpenedChanges().delete(change);
            }
            return;
        }
        this.actionLock = false;
    }

    async commit(): Promise<void> {
        if (!this.getLock()) {
            vscode.window.showWarningMessage("Action in progress. Try again after completion");
            return;
        }
        if (this.git.repo.state.indexChanges.length > 0) {
            await this.git.repo
                .commit("", { useEditor: true })
                .catch((err) => vscode.window.showWarningMessage(err.stderr));
        } else {
            vscode.window.showWarningMessage("Fugitive: Nothing to commit");
        }
        this.actionLock = false;
    }

    async checkForConflictMarker(uri: vscode.Uri): Promise<boolean> {
        const buffer = await vscode.workspace.fs.readFile(uri);
        if (!buffer.toString().match(/^<<<<<<</)?.length) {
            return true;
        }
        const options: vscode.QuickPickOptions = {
            title: "Conflict Marker detected. Merge with conflicts?",
        };

        const success_text = "Merge conflicts";
        const value = await vscode.window.showQuickPick(["cancel", success_text], options);
        if (value === success_text) {
            return true;
        } else {
            this.actionLock = false;
            return false;
        }
    }

    async unstageFile(): Promise<void> {
        if (!this.getLock()) {
            vscode.window.showWarningMessage("Action in progress. Try again after completion");
            return;
        }
        const resource = this.getResourceUnderCursor();
        if (!resource) {
            this.actionLock = false;
            return;
        }
        switch (resource.type) {
            case "StagedHeader": {
                const changes = this.git.staged().map((c) => c.uri.path);
                LOGGER.debug(`unstage ${changes.length}`);
                await this.git.repo.revert(changes);
                for (const change of changes) {
                    this.uiModel.diffModel.getOpenedIndexChanges().delete(change);
                }
                return;
            }
            case "Staged": {
                const change = this.git.staged()[resource.changeIndex];
                LOGGER.debug("unstage ", change.uri.path);
                await this.git.repo.revert([change.uri.path]);
                this.uiModel.diffModel.getOpenedIndexChanges().delete(change.uri.path);
                return;
            }
            case "StagedDiff": {
                const change = this.git.staged()[resource.changeIndex];
                if (resource.diffIndex === undefined) {
                    this.actionLock = false;
                    return Promise.reject("No diff index: " + resource.diffIndex);
                }
                await this.git.applyPatchToFile(change.uri, resource.diffIndex, "unstage");
                return;
            }
            case "DirectoryHeader": {
                const type = resource.changeType;
                const affected_changes = this.git
                    .getChanges(type)
                    .filter((c) => {
                        return c.originalUri.path.replace(this.git.rootUri, "").startsWith(resource.path + "/");
                    })
                    .map((c) => c.uri.path);

                LOGGER.debug(`unstage ${affected_changes.length} ${type} files in directory ${resource.path}`);
                if (affected_changes.length === 0) {
                    this.actionLock = false;
                    return;
                }
                await this.git.repo.revert(affected_changes);
                for (const change of affected_changes) {
                    this.uiModel.diffModel.getOpenedIndexChanges().delete(change);
                }
                return;
            }
            default: {
                this.actionLock = false;
                return;
            }
        }
    }

    async toggle(): Promise<void> {
        const resource = this.getResourceUnderCursor();
        if (!resource) {
            return;
        }
        switch (resource.type) {
            case "Untracked":
            case "Unstaged":
                await this.stageFile();
                break;
            case "Staged":
                await this.unstageFile();
                return;
        }
    }

    async unstageAll(): Promise<void> {
        if (!this.getLock()) {
            vscode.window.showWarningMessage("Action in progress. Try again after completion");
            return;
        }
        const files = this.git.staged().map((c) => c.uri.path);
        await this.git.repo.revert(files);
    }

    async cleanFile(): Promise<void> {
        if (!this.getLock()) {
            vscode.window.showWarningMessage("Action in progress. Try again after completion");
            return;
        }
        const resource = this.getResourceUnderCursor();
        if (!resource) {
            this.actionLock = false;
            return;
        }
        switch (resource.type) {
            case "Untracked": {
                const change = this.git.untracked()[resource.changeIndex];
                LOGGER.debug("clean ", resource);
                await this.git.repo.clean([change.uri.path]);
                this.uiModel.diffModel.getOpenedChanges().delete(change.uri.path);
                return;
            }
            case "Unstaged": {
                const change = this.git.unstaged()[resource.changeIndex];
                LOGGER.debug("clean ", resource);
                await this.git.repo.clean([change.uri.path]);
                this.uiModel.diffModel.getOpenedChanges().delete(change.uri.path);
                return;
            }
            case "Staged": {
                const change = this.git.staged()[resource.changeIndex];
                LOGGER.debug("clean ", resource);
                await this.git.repo.revert([change.uri.path]);
                await this.git.repo.clean([change.uri.path]);
                this.uiModel.diffModel.getOpenedIndexChanges().delete(change.uri.path);
                return;
            }
            case "DirectoryHeader": {
                const type = resource.changeType;
                if (type !== "Untracked" && type !== "Unstaged" && type !== "Staged") {
                    this.actionLock = false;
                    return;
                }
                const affected_changes = this.git
                    .getChanges(type)
                    .filter((c) => {
                        return c.originalUri.path.replace(this.git.rootUri, "").startsWith(resource.path + "/");
                    })
                    .map((c) => c.uri.path);

                // show confirmation dialog
                const confirm_message = `Are you sure you want to clean ${affected_changes.length} ${type} files in directory ${resource.path}?`;
                const confirm = await vscode.window.showWarningMessage(confirm_message, { modal: true }, "Yes", "No");
                if (confirm !== "Yes") {
                    this.actionLock = false;
                    return;
                }
                LOGGER.debug(`clean ${affected_changes.length} ${type} files in directory ${resource.path}`);
                if (affected_changes.length === 0) {
                    this.actionLock = false;
                    return;
                }
                if (type === "Staged") {
                    await this.git.repo.revert(affected_changes);
                }
                await this.git.repo.clean(affected_changes);
                for (const change of affected_changes) {
                    this.uiModel.diffModel.getOpenedIndexChanges().delete(change);
                }
                return;
            }
        }
    }

    async toggleInlineDiff(): Promise<void> {
        if (!this.getLock()) {
            vscode.window.showWarningMessage("Action in progress. Try again after completion");
            return;
        }
        const resource = this.getResourceUnderCursor();
        const res = resource;

        switch (res.type) {
            case "Unstaged": {
                const change = this.git.unstaged()[res.changeIndex];
                if (this.uiModel.diffModel.getOpenedChanges().has(change.uri.path)) {
                    this.uiModel.diffModel.getOpenedChanges().delete(change.uri.path);
                } else {
                    this.uiModel.diffModel.getOpenedChanges().add(change.uri.path);
                }
                break;
            }
            case "Staged": {
                const change = this.git.staged()[res.changeIndex];
                if (this.uiModel.diffModel.getOpenedIndexChanges().has(change.uri.path)) {
                    this.uiModel.diffModel.getOpenedIndexChanges().delete(change.uri.path);
                } else {
                    this.uiModel.diffModel.getOpenedIndexChanges().add(change.uri.path);
                }
                break;
            }
            case "StagedDiff": {
                const change = this.git.staged()[res.changeIndex];
                this.uiModel.diffModel.getOpenedIndexChanges().delete(change.uri.path);
                break;
            }
            case "UnstagedDiff": {
                const change = this.git.unstaged()[res.changeIndex];
                this.uiModel.diffModel.getOpenedChanges().delete(change.uri.path);
                break;
            }
        }
        this.fireOnDidChange();
    }

    private async updateDiffs() {
        LOGGER.trace("updateDiffs");
        await this.git.updateDiffMap("Unstaged");
        await this.git.updateDiffMap("Staged");
        const delete_opened_diffs = Array.from(this.uiModel.diffModel.getOpenedChanges().keys()).filter(
            (k) => !this.git.cachedUnstagedDiffs.has(k)
        );
        const delete_opened_index_diffs = Array.from(this.uiModel.diffModel.getOpenedIndexChanges().keys()).filter(
            (k) => !this.git.cachedStagedDiffs.has(k)
        );
        for (const key of delete_opened_diffs) {
            this.uiModel.diffModel.getOpenedChanges().delete(key);
        }
        for (const key of delete_opened_index_diffs) {
            this.uiModel.diffModel.getOpenedIndexChanges().delete(key);
        }
    }

    async openDiff(): Promise<void> {
        if (this.readLock()) {
            vscode.window.showWarningMessage("Action in progress. Try again after completion");
            return;
        }

        const ressource = this.getResourceUnderCursor();
        if (!ressource) {
            return;
        }
        let uri_left = null;
        let uri_right = null;
        let title_type = "(Working Tree)";
        switch (ressource.type) {
            case "Unstaged": {
                const change = this.git.unstaged()[ressource.changeIndex];
                uri_left = this.git.api.toGitUri(change.uri, "~"); // index
                uri_right = change.uri; // local file
                title_type = "(Working Tree)";
                break;
            }
            case "Staged": {
                const change = this.git.staged()[ressource.changeIndex];
                uri_left = this.git.api.toGitUri(change.uri, "HEAD"); // last commit
                uri_right = this.git.api.toGitUri(change.uri, "~"); //index
                title_type = "(Index)";
                break;
            }
            default: {
                LOGGER.error("No diff available");
            }
        }
        if (!uri_left || !uri_right) {
            return;
        }
        const title = (uri_left.path.split("/").pop() ?? "Diff") + " " + title_type;
        vscode.commands.executeCommand("vscode.diff", uri_left, uri_right, title).then(
            (success) => {
                LOGGER.debug("success ", success);
            },
            (rejected) => {
                LOGGER.debug("rejected ", rejected);
            }
        );
    }

    async open(split: boolean): Promise<void> {
        if (this.readLock()) {
            vscode.window.showWarningMessage("Action in progress. Try again after completion");
            return;
        }
        const resource = this.getResourceUnderCursor();

        switch (resource.type) {
            case "Unstaged":
            case "Staged":
            case "Untracked":
            case "MergeChange":
            case "UnstagedDiff":
            case "StagedDiff": {
                this.openFile(resource, split);
                return;
            }
            case "Unpushed": {
                this.openCommitDiff(resource, split);
                return;
            }
            default: {
                return;
            }
        }
    }

    private async openFile(resource: ResourceType, split: boolean) {
        if (this.readLock()) {
            vscode.window.showWarningMessage("Action in progress. Try again after completion");
            return;
        }
        const change = this.git.changeFromResource(resource);
        if (!change) {
            return;
        }
        if ([Status.INDEX_DELETED, Status.DELETED].includes(change.status)) {
            vscode.window.showWarningMessage("File was deleted");
            return;
        }
        const file = vscode.Uri.parse(change.uri.path);
        const doc = await vscode.workspace.openTextDocument(file);
        if (split) {
            await vscode.window.showTextDocument(doc, { preview: false, viewColumn: vscode.ViewColumn.Beside });
        } else {
            await vscode.window.showTextDocument(doc, { preview: false });
        }
    }

    private async openCommitDiff(resource: ResourceType, split: boolean) {
        if (this.readLock()) {
            vscode.window.showWarningMessage("Action in progress. Try again after completion");
            return;
        }
        const commit = this.git.commitFromResource(resource);
        if (!commit) {
            return;
        }
        const file = encodeCommit(commit);

        const doc = await vscode.workspace.openTextDocument(file);
        if (split) {
            await vscode.window.showTextDocument(doc, { preview: false, viewColumn: vscode.ViewColumn.Beside });
        } else {
            await vscode.window.showTextDocument(doc, { preview: false });
        }
    }

    async gitExclude(git_ignore: boolean): Promise<void> {
        if (this.readLock()) {
            vscode.window.showWarningMessage("Action in progress. Try again after completion");
            return;
        }
        const resource = this.getResourceUnderCursor();
        const change = this.git.changeFromResource(resource);
        let path = change?.originalUri.path.replace(this.git.rootUri, "");
        if (!path) {
            if (resource.type === "DirectoryHeader") {
                path = resource.path;
            } else {
                LOGGER.warn("No path found to exclude");
                return;
            }
        }
        const uri = git_ignore
            ? vscode.Uri.parse(this.git.rootUri + "/.gitignore")
            : vscode.Uri.parse(this.git.rootUri + "/.git/info/exclude");

        try {
            await vscode.workspace.fs.stat(uri);
        } catch {
            await vscode.workspace.fs.writeFile(uri, new Uint8Array());
        }

        const contents = await vscode.workspace.fs.readFile(uri);
        const enc = new TextEncoder(); // always utf-8
        const filename = enc.encode(path);

        const new_contents = new Uint8Array(contents.length + filename.length + 1);
        new_contents.set(contents);
        new_contents.set(enc.encode("\n"), contents.length);
        new_contents.set(filename, contents.length + 1);
        await vscode.workspace.fs.writeFile(uri, new_contents);

        const doc = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(doc, { preview: false, viewColumn: vscode.ViewColumn.Beside });
    }

    /**
     * @throws if no buffer is open
     * @returns the information for the current set line
     */
    private getResourceUnderCursor(): ResourceType {
        return this.cursor.getResourceUnderCursor(this.uiModel);
    }
}
