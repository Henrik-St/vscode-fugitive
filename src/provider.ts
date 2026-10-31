import * as vscode from "vscode";
import { Status, Repository } from "./vscode-git";
import { GitWrapper } from "./git-wrapper";
import { encodeCommit } from "./diff-provider";
import { ResourceType } from "./resource";
import { UIModel } from "./ui-model";
import { GIT, LOGGER } from "./extension";
import { Cursor, syncCursorWithView } from "./cursor";
import { getViewStyle, toggleViewStyle, ViewStyle } from "./configurations";

export class Provider implements vscode.TextDocumentContentProvider {
    static myScheme = "fugitive";
    static uri = vscode.Uri.parse(Provider.myScheme + ":Fugitive");

    public readonly git: GitWrapper;

    private uiModel: UIModel;
    private cursor: Cursor;
    private refreshGeneration = 0;

    //status data
    private onDidChangeEmitter = new vscode.EventEmitter<vscode.Uri>();
    onDidChange = this.onDidChangeEmitter.event; // triggers before provideTextDocumentContent
    private subscriptions: vscode.Disposable[];

    constructor() {
        if (!GIT) {
            throw Error("Git API not found!");
        }
        this.git = GIT;
        this.uiModel = new UIModel();
        this.cursor = new Cursor();

        // on Git Changed on all repositories
        const git_disposables = this.git.api.repositories.map((repo) => {
            return repo.state.onDidChange(async () => {
                LOGGER.debug("onGitChanged: ", repo.rootUri.toString());
                await this.refreshAndRender(repo);
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
                this.cursor.syncCursorLine(Provider.uri.toString());
            }
        });

        const dispo = vscode.workspace.onDidOpenTextDocument(async (doc) => {
            if (doc.uri.path.endsWith("/COMMIT_EDITMSG")) {
                LOGGER.debug("Override COMMIT_EDITMSG cursor");
                syncCursorWithView(0);
            }
        });
        this.subscriptions = [...git_disposables, doc_dispose, dispo];
    }

    private fireOnDidChange(): void {
        this.onDidChangeEmitter.fire(Provider.uri);
    }

    private async refreshRepository(repo: Repository): Promise<boolean> {
        const generation = ++this.refreshGeneration;
        await this.git.updateBranchInfo(repo);
        if (repo !== this.git.repo || generation !== this.refreshGeneration) {
            return false;
        }
        await this.updateDiffs(repo, generation);
        return repo === this.git.repo && generation === this.refreshGeneration;
    }

    async refresh(): Promise<void> {
        await this.refreshAndRender(this.git.repo);
    }

    private async refreshAndRender(repo: Repository): Promise<void> {
        if (repo !== this.git.repo || !(await this.refreshRepository(repo))) {
            return;
        }
        const doc = vscode.workspace.textDocuments.find((doc) => doc.uri.scheme === Provider.myScheme);
        if (doc) {
            this.fireOnDidChange();
        }
    }

    dispose(): void {
        this.subscriptions.forEach((e) => e.dispose());
    }

    provideTextDocumentContent(_uri: vscode.Uri): string {
        LOGGER.debug("Provider.provideTextDocumentContent");
        const view_style = getViewStyle();
        this.uiModel.update(view_style);
        if (view_style === "tree") {
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
        if (repo_list.length > 0) {
            await this.git.setRepository(repo_list[0][1]);
        }
        await this.refreshRepository(this.git.repo);

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
        this.cursor.syncCursorLine(Provider.uri.toString(), new_line);
    }

    goDown(): void {
        if (!vscode.window.activeTextEditor) {
            return;
        }
        const line_count = vscode.window.activeTextEditor.document.lineCount;
        const line = vscode.window.activeTextEditor!.selection.active.line;
        const new_line = Math.min(line + 1, line_count - 1);
        this.cursor.syncCursorLine(Provider.uri.toString(), new_line);
    }

    goStaged(): void {
        const index = this.uiModel.findHeader("StagedHeader");
        if (index >= 0) {
            this.cursor.syncCursorLine(Provider.uri.toString(), index);
        }
    }

    goUnstaged(go_unstaged: boolean): void {
        const untracked_index = this.uiModel.findHeader("UntrackedHeader");
        if (!go_unstaged && untracked_index >= 0) {
            this.cursor.syncCursorLine(Provider.uri.toString(), untracked_index);
            return;
        }
        const unstaged_index = this.uiModel.findHeader("UnstagedHeader");
        if (unstaged_index >= 0) {
            this.cursor.syncCursorLine(Provider.uri.toString(), unstaged_index);
            return;
        }
    }

    goUnpushed(): void {
        const index = this.uiModel.findHeader("UnpushedHeader");
        if (index >= 0) {
            this.cursor.syncCursorLine(Provider.uri.toString(), index);
        }
    }

    goPreviousHunk(): void {
        const current_line = vscode.window.activeTextEditor?.selection.active.line;
        if (!current_line && current_line !== 0) {
            LOGGER.info("no current line");
            return;
        }
        this.uiModel.goPreviousHunk(current_line!);
    }

    goNextHunk(): void {
        const current_line = vscode.window.activeTextEditor?.selection.active.line;
        if (!current_line && current_line !== 0) {
            LOGGER.info("no current line");
            return;
        }
        this.uiModel.goNextHunk(current_line!);
    }

    async setRepository(): Promise<void> {
        const repos = this.git.getRepositories().map((i): [string, Repository] => [i[0].split("/").pop() || "", i[1]]);
        const repo_names = repos.map((i) => i[0]);

        const options: vscode.QuickPickOptions = {
            title: "Select the repository",
        };

        const value = await vscode.window.showQuickPick(repo_names, options);
        if (!value) {
            return;
        }
        const repo = repos.filter((i) => i[0] === value)[0][1];
        await this.git.setRepository(repo);

        if (!(await this.refreshRepository(repo))) {
            return;
        }

        const doc = vscode.workspace.textDocuments.find((doc) => doc.uri.scheme === Provider.myScheme);
        if (doc) {
            this.fireOnDidChange();
        }
    }

    async toggleView(view_style?: ViewStyle): Promise<void> {
        this.getResourceUnderCursor(); // updates previouse resource
        await toggleViewStyle(view_style);
        this.fireOnDidChange();
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
            this.fireOnDidChange();
        }
    }

    async stageFile(): Promise<void> {
        const repo = this.git.repo;
        const resource = this.getResourceUnderCursor();
        if (!resource) {
            return;
        }
        if (resource.type === "MergeChange") {
            const change = this.git.changeFromResource(resource);
            if (!change) {
                LOGGER.warn("stageFile: No MergeChange found for index " + resource.changeIndex);
                return;
            }
            LOGGER.debug("merge add ", change.uri.path);
            const uri = vscode.Uri.parse(change.uri.path);
            if (await this.checkForConflictMarker(uri)) {
                await repo.add([change.uri.path]);
                return;
            }
        }
        if (resource.type === "Untracked") {
            const change = this.git.changeFromResource(resource);
            if (!change) {
                LOGGER.warn("stageFile: No Untracked change found for index " + resource.changeIndex);
                return;
            }
            LOGGER.debug("track ", change.uri.path);
            await repo.add([change.uri.path]);
            return;
        }
        if (resource.type === "UntrackedHeader") {
            const changes = this.git.untracked().map((c) => c.uri.path);
            LOGGER.debug(`track ${changes.length} files`);
            await repo.add(changes);
            return;
        }
        if (resource.type === "Unstaged") {
            const change = this.git.changeFromResource(resource);
            if (!change) {
                LOGGER.warn("stageFile: No Unstaged change found for index " + resource.changeIndex);
                return;
            }
            LOGGER.debug("stage ", change.uri.path);
            await repo.add([change.uri.path]);
            this.uiModel.diffModel.getOpenedChanges().delete(change.uri.path);
            return;
        }
        if (resource.type === "UnstagedHeader") {
            const changes = this.git.unstaged().map((c) => c.uri.path);
            LOGGER.debug(`track ${changes.length} files`);
            await repo.add(changes);
            for (const change of changes) {
                this.uiModel.diffModel.getOpenedChanges().delete(change);
            }
            return;
        }
        if (resource.type === "UnstagedDiff") {
            const change = this.git.changeFromResource(resource);
            if (!change) {
                LOGGER.warn("stageFile: No UnstagedDiff change found for index " + resource.changeIndex);
                return Promise.reject("No change for UnstagedDiff index: " + resource.changeIndex);
            }
            if (resource.diffIndex === undefined) {
                return Promise.reject("No diff index: " + resource.diffIndex);
            }
            await this.git.applyPatchToFile(change.uri, resource.diffIndex, "stage", repo);
            return;
        }
        if (resource.type === "DirectoryHeader") {
            const type = resource.changeType;
            const affected_changes = this.git
                .getChanges(type)
                .filter((c) => {
                    return c.uri.path.replace(this.git.rootUri, "").startsWith(resource.path + "/");
                })
                .map((c) => c.uri.path);

            LOGGER.debug(`stage ${affected_changes.length} ${type} files in directory ${resource.path}`);
            if (affected_changes.length === 0) {
                return;
            }
            await repo.add(affected_changes);
            for (const change of affected_changes) {
                this.uiModel.diffModel.getOpenedChanges().delete(change);
            }
            return;
        }
    }

    async commit(): Promise<void> {
        const repo = this.git.repo;
        if (repo.state.indexChanges.length > 0) {
            await repo
                .commit("", { useEditor: true })
                .catch((err) => vscode.window.showWarningMessage(err.stderr));
        } else {
            vscode.window.showWarningMessage("Fugitive: Nothing to commit");
        }
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
            return false;
        }
    }

    async unstageFile(): Promise<void> {
        const repo = this.git.repo;
        const resource = this.getResourceUnderCursor();
        if (!resource) {
            return;
        }
        switch (resource.type) {
            case "StagedHeader": {
                const changes = this.git.staged().map((c) => c.uri.path);
                LOGGER.debug(`unstage ${changes.length}`);
                await repo.revert(changes);
                for (const change of changes) {
                    this.uiModel.diffModel.getOpenedIndexChanges().delete(change);
                }
                return;
            }
            case "Staged": {
                const change = this.git.changeFromResource(resource);
                if (!change) {
                    LOGGER.warn("unstageFile: No Staged change found for index " + resource.changeIndex);
                    return;
                }
                LOGGER.debug("unstage ", change.uri.path);
                await repo.revert([change.uri.path]);
                this.uiModel.diffModel.getOpenedIndexChanges().delete(change.uri.path);
                return;
            }
            case "StagedDiff": {
                const change = this.git.changeFromResource(resource);
                if (!change) {
                    LOGGER.warn("unstageFile: No StagedDiff change found for index " + resource.changeIndex);
                    return Promise.reject("No change for StagedDiff index: " + resource.changeIndex);
                }
                if (resource.diffIndex === undefined) {
                    return Promise.reject("No diff index: " + resource.diffIndex);
                }
                await this.git.applyPatchToFile(change.uri, resource.diffIndex, "unstage", repo);
                return;
            }
            case "DirectoryHeader": {
                const type = resource.changeType;
                const affected_changes = this.git
                    .getChanges(type)
                    .filter((c) => {
                        return c.uri.path.replace(this.git.rootUri, "").startsWith(resource.path + "/");
                    })
                    .map((c) => c.uri.path);

                LOGGER.debug(`unstage ${affected_changes.length} ${type} files in directory ${resource.path}`);
                if (affected_changes.length === 0) {
                    return;
                }
                await repo.revert(affected_changes);
                for (const change of affected_changes) {
                    this.uiModel.diffModel.getOpenedIndexChanges().delete(change);
                }
                return;
            }
            default: {
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
        const repo = this.git.repo;
        const files = this.git.staged().map((c) => c.uri.path);
        await repo.revert(files);
    }

    async cleanFile(): Promise<void> {
        const repo = this.git.repo;
        const resource = this.getResourceUnderCursor();
        if (!resource) {
            return;
        }
        switch (resource.type) {
            case "Untracked": {
                const change = this.git.changeFromResource(resource);
                if (!change) {
                    LOGGER.warn("cleanFile: No Untracked change found for index " + resource.changeIndex);
                    return;
                }
                LOGGER.debug("clean ", resource);
                await repo.clean([change.uri.path]);
                this.uiModel.diffModel.getOpenedChanges().delete(change.uri.path);
                return;
            }
            case "Unstaged": {
                const change = this.git.changeFromResource(resource);
                if (!change) {
                    LOGGER.warn("cleanFile: No Unstaged change found for index " + resource.changeIndex);
                    return;
                }
                LOGGER.debug("clean ", resource);
                await repo.clean([change.uri.path]);
                this.uiModel.diffModel.getOpenedChanges().delete(change.uri.path);
                return;
            }
            case "Staged": {
                const change = this.git.changeFromResource(resource);
                if (!change) {
                    LOGGER.warn("cleanFile: No Staged change found for index " + resource.changeIndex);
                    return;
                }
                LOGGER.debug("clean ", resource);
                await repo.revert([change.uri.path]);
                await repo.clean([change.uri.path]);
                this.uiModel.diffModel.getOpenedIndexChanges().delete(change.uri.path);
                return;
            }
            case "DirectoryHeader": {
                const type = resource.changeType;
                if (type !== "Untracked" && type !== "Unstaged" && type !== "Staged") {
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
                    return;
                }
                LOGGER.debug(`clean ${affected_changes.length} ${type} files in directory ${resource.path}`);
                if (affected_changes.length === 0) {
                    return;
                }
                if (type === "Staged") {
                    await repo.revert(affected_changes);
                }
                await repo.clean(affected_changes);
                for (const change of affected_changes) {
                    this.uiModel.diffModel.getOpenedIndexChanges().delete(change);
                }
                return;
            }
        }
    }

    async toggleInlineDiff(): Promise<void> {
        const resource = this.getResourceUnderCursor();

        switch (resource.type) {
            case "Unstaged": {
                const change = this.git.changeFromResource(resource);
                if (!change) {
                    LOGGER.warn("toggleInlineDiff: No Unstaged change found for index " + resource.changeIndex);
                    return;
                }
                if (this.uiModel.diffModel.getOpenedChanges().has(change.uri.path)) {
                    this.uiModel.diffModel.getOpenedChanges().delete(change.uri.path);
                } else {
                    this.uiModel.diffModel.getOpenedChanges().add(change.uri.path);
                }
                break;
            }
            case "Staged": {
                const change = this.git.changeFromResource(resource);
                if (!change) {
                    LOGGER.warn("toggleInlineDiff: No Staged change found for index " + resource.changeIndex);
                    return;
                }
                if (this.uiModel.diffModel.getOpenedIndexChanges().has(change.uri.path)) {
                    this.uiModel.diffModel.getOpenedIndexChanges().delete(change.uri.path);
                } else {
                    this.uiModel.diffModel.getOpenedIndexChanges().add(change.uri.path);
                }
                break;
            }
            case "StagedDiff": {
                const change = this.git.changeFromResource(resource);
                if (!change) {
                    LOGGER.warn("toggleInlineDiff: No StagedDiff change found for index " + resource.changeIndex);
                    return;
                }
                this.uiModel.diffModel.getOpenedIndexChanges().delete(change.uri.path);
                break;
            }
            case "UnstagedDiff": {
                const change = this.git.changeFromResource(resource);
                if (!change) {
                    LOGGER.warn("toggleInlineDiff: No UnstagedDiff change found for index " + resource.changeIndex);
                    return;
                }
                this.uiModel.diffModel.getOpenedChanges().delete(change.uri.path);
                break;
            }
        }
        this.fireOnDidChange();
    }

    private async updateDiffs(repo: Repository, generation: number) {
        LOGGER.trace("updateDiffs");
        await this.git.updateDiffMap("Unstaged", repo);
        if (repo !== this.git.repo || generation !== this.refreshGeneration) {
            return;
        }
        await this.git.updateDiffMap("Staged", repo);
        if (repo !== this.git.repo || generation !== this.refreshGeneration) {
            return;
        }
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
        const ressource = this.getResourceUnderCursor();
        if (!ressource) {
            return;
        }
        let uri_left = null;
        let uri_right = null;
        let title_type = "(Working Tree)";
        switch (ressource.type) {
            case "Unstaged": {
                const change = this.git.changeFromResource(ressource);
                if (!change) {
                    LOGGER.warn("openDiff: No Unstaged change found for index " + ressource.changeIndex);
                    return;
                }
                uri_left = this.git.api.toGitUri(change.uri, "~"); // index
                // For deleted files, show diff against empty URI
                if (change.status === Status.DELETED) {
                    uri_right = change.uri.with({ scheme: "data", path: change.uri.path });
                } else {
                    uri_right = change.uri; // local file
                }
                title_type = "(Working Tree)";
                break;
            }
            case "Staged": {
                const change = this.git.changeFromResource(ressource);
                if (!change) {
                    LOGGER.warn("openDiff: No Staged change found for index " + ressource.changeIndex);
                    return;
                }
                uri_left = this.git.api.toGitUri(change.uri, "HEAD"); // last commit
                // For deleted files, show diff against empty URI
                if (change.status === Status.INDEX_DELETED) {
                    uri_right = change.uri.with({ scheme: "data", path: change.uri.path });
                } else {
                    uri_right = this.git.api.toGitUri(change.uri, "~"); //index
                }
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
        const change = this.git.changeFromResource(resource);
        if (!change) {
            return;
        }
        let file: vscode.Uri;
        // For deleted files, open the last known version from git
        if (change.status === Status.DELETED) {
            // File deleted in working tree, show version from index
            file = this.git.api.toGitUri(change.uri, "~");
        } else if (change.status === Status.INDEX_DELETED) {
            // File deleted in index, show version from HEAD
            file = this.git.api.toGitUri(change.uri, "HEAD");
        } else {
            // Normal file, open from working tree
            file = vscode.Uri.parse(change.uri.path);
        }
        const doc = await vscode.workspace.openTextDocument(file);
        if (split) {
            await vscode.window.showTextDocument(doc, { preview: false, viewColumn: vscode.ViewColumn.Beside });
        } else {
            await vscode.window.showTextDocument(doc, { preview: false });
        }
    }

    private async openCommitDiff(resource: ResourceType, split: boolean) {
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
        const repo = this.git.repo;
        const resource = this.getResourceUnderCursor();
        const change = this.git.changeFromResource(resource);
        let path = change?.originalUri.path.replace(repo.rootUri.path, "");
        if (!path) {
            if (resource.type === "DirectoryHeader") {
                path = resource.path;
            } else {
                LOGGER.warn("No path found to exclude");
                return;
            }
        }
        const file_path = git_ignore ? ".gitignore" : ".git/info/exclude";
        const uri = repo.rootUri.with({
            path: `${repo.rootUri.path.replace(/\/$/, "")}/${file_path}`,
        });

        try {
            await vscode.workspace.fs.stat(uri);
        } catch {
            await vscode.workspace.fs.writeFile(uri, new Uint8Array());
        }
        const contents = await vscode.workspace.fs.readFile(uri);
        const addition = encodeUtf8(`\n${path}`);
        const new_contents = new Uint8Array(contents.length + addition.length);
        new_contents.set(contents);
        new_contents.set(addition, contents.length);
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

function encodeUtf8(value: string): Uint8Array {
    const encoded = encodeURIComponent(value);
    const bytes: number[] = [];
    for (let index = 0; index < encoded.length; index++) {
        if (encoded[index] === "%") {
            bytes.push(Number.parseInt(encoded.slice(index + 1, index + 3), 16));
            index += 2;
        } else {
            bytes.push(encoded.charCodeAt(index));
        }
    }
    return Uint8Array.from(bytes);
}
