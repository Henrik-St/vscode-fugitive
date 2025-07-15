import * as vscode from 'vscode';
import {Status, Repository } from './vscode-git';
import { GitWrapper } from './git-wrapper';
import { setCursorWithView } from './util';
import { encodeCommit } from './diff-provider';
import { changeTypeToHeaderType, isChangeTypes, ResourceType } from './resource';
import { UIModel } from './ui-model';
import { GIT } from './extension';
import { getDirectoryType } from './tree-model';


export class Provider implements vscode.TextDocumentContentProvider {
    static myScheme = 'fugitive';
    static uri = vscode.Uri.parse(Provider.myScheme + ':Fugitive');

    public git: GitWrapper;

    private actionLock: boolean;

    private uiModel: UIModel;

    //status data
    private line: number;
    private previousResource: ResourceType | null;
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

        this.line = 0;
        this.previousResource = null;

        this.uiModel = new UIModel();

        // on Git Changed on all repositories
        const git_disposables = this.git.api.repositories.map( repo => {
            return repo.state.onDidChange(async () => {
                console.debug('onGitChanged');
                await this.git.updateBranchInfo();
                await this.updateDiffs();

                const doc = vscode.workspace.textDocuments.find(doc => doc.uri.scheme === Provider.myScheme);
                if (doc) {
                    this.onDidChangeEmitter.fire(doc.uri);
                }
            });
        });

        // triggers after provideTextDocumentContent
        const doc_dispose = vscode.workspace.onDidChangeTextDocument((e: vscode.TextDocumentChangeEvent) => {
            if (vscode.window.activeTextEditor?.document.uri.toString() === Provider.uri.toString() &&
                e.document.uri.toString() === Provider.uri.toString()) {
                console.debug('onDidChangeTextDocument');
                // overrides cursor behaviour
                vscode.window.activeTextEditor!.selection =
                    new vscode.Selection(new vscode.Position(this.line, 0), new vscode.Position(this.line, 0));
                this.actionLock = false; // reset action lock
                console.debug('release lock');
            }
        });
        this.subscriptions = [...git_disposables, doc_dispose];

    }

    private getLock(): boolean{
        console.debug('Aquire lock');
        if (this.actionLock) {
            return false;
        }
        this.actionLock = true;
        setTimeout(() => {
            if (!this.actionLock) {
                return;
            }
            console.debug('Reset lock after timeout');
            this.actionLock = false;
        }, 3000);
        return true;
    }

    private readLock(): boolean{
        console.debug('Read lock');
        return this.actionLock;
    }

    dispose(): void {
        this.subscriptions.forEach(e => e.dispose());
    }

    provideTextDocumentContent(_uri: vscode.Uri): string {
        console.debug('Provider.provideTextDocumentContent');
        this.uiModel.update(this.viewStyle);
        if(this.viewStyle === "tree") {
            this.updateCursorTreeView();
        } else {
            this.updateCursor();
        }

        return this.uiModel.toString();
    }

    /**
     * opens the fugitive document
     * @param filepath determines the repository to open if there a multiple
     */
    async getDocOrRefreshIfExists(filepath?: string): Promise<vscode.TextDocument> {
        console.debug("getDocOrRefreshIfExists");

        // get the closest repo to the openend document
        // or the closest repo to the / if no document is open
        let repo_list = this.git.getRepositories().sort((a,b) => a[0].length - b[0].length);
        if (filepath) {
            repo_list =  this.git.getRepositories() 
                .filter(r => filepath.includes(r[0]))
                .sort((r1, r2) => (r1[0].length - r2[0].length))
            ;
        }
        await this.git.setRepository(repo_list[0][1]);
        await this.git.updateBranchInfo();
        await this.updateDiffs();

        let doc = vscode.workspace.textDocuments.find(doc => doc.uri === Provider.uri);
        if (doc) {
            this.onDidChangeEmitter.fire(Provider.uri);
        } else {
            this.uiModel.diffModel.clearOpenedChanges();
            this.uiModel.diffModel.clearOpenedIndexChanges();
            doc = await vscode.workspace.openTextDocument(Provider.uri);
            this.onDidChangeEmitter.fire(Provider.uri);
        }
        return doc;
    }

    goUp(): void {
		if (!vscode.window.activeTextEditor) {
			return;
		}
		const line = vscode.window.activeTextEditor!.selection.active.line;
		const new_line = Math.max(line - 1, 0);
		vscode.window.activeTextEditor!.selection =
			new vscode.Selection(new vscode.Position(new_line, 0), new vscode.Position(new_line, 0));
    }

    goDown(): void {
		if (!vscode.window.activeTextEditor) {
			return;
		}
		const line_count = vscode.window.activeTextEditor.document.lineCount;
		const line = vscode.window.activeTextEditor!.selection.active.line;
		const new_line = Math.min(line + 1, line_count - 1);
		vscode.window.activeTextEditor!.selection =
			new vscode.Selection(new vscode.Position(new_line, 0), new vscode.Position(new_line, 0));
    }

    goStaged(): void {
        console.debug("goStaged");
        const index = this.uiModel.findHeader("StagedHeader");
        if (index >= 0) {
            vscode.window.activeTextEditor!.selection =
                new vscode.Selection(new vscode.Position(index, 0), new vscode.Position(index, 0));
        }
    }

    goUnstaged(go_unstaged: boolean): void {
        const untracked_index = this.uiModel.findHeader("UntrackedHeader");
        if (!go_unstaged && untracked_index >= 0) {
            vscode.window.activeTextEditor!.selection =
                new vscode.Selection(new vscode.Position(untracked_index, 0), new vscode.Position(untracked_index, 0));
            return;
        }
        const unstaged_index = this.uiModel.findHeader("UnstagedHeader");
        if (unstaged_index >= 0) {
            vscode.window.activeTextEditor!.selection =
                new vscode.Selection(new vscode.Position(unstaged_index, 0), new vscode.Position(unstaged_index, 0));
            return;
        }
    }

    goUnpushed(): void {
        const index =  this.uiModel.findHeader("UnpushedHeader");
        if (index >= 0) {
            vscode.window.activeTextEditor!.selection =
                new vscode.Selection(new vscode.Position(index, 0), new vscode.Position(index, 0));
        }
    }

    goPreviousHunk(): void {
        const current_line = vscode.window.activeTextEditor?.selection.active.line;

        if (!current_line) {
            console.debug('no current line');
            return;
        }

        for (let i = current_line - 1; i >= 0; i--) {
            const res = this.uiModel.index(i)[0];
            const type = res.type;
            if ( type === "HeadUI" || type === "MergeUI" || type === "HelpUI" || type === "BlankUI" ||
                type === "MergeHeader" || type === "UntrackedHeader" || type === "UnstagedHeader" ||
                type === "StagedHeader" || type === "UnpushedHeader" || type === "Unpushed"
            ) {
                continue;
            }

            if (type === "MergeChange" || type === "Untracked" || type === "Unstaged" || type === "Staged" ) {
                this.line = i;
                setCursorWithView(this.line);
                return;
            } else if ((type === "UnstagedDiff" || type === "StagedDiff") && res.diffLineIndex === 0) {
                this.line = i;
                setCursorWithView(this.line);
                return;
            }
        }
    }

    goNextHunk(): void {
        const current_line = vscode.window.activeTextEditor?.selection.active.line;
        if (!current_line && current_line !== 0) {
            console.debug('no current line');
            return;
        }

        for (let i = current_line + 1; i < this.uiModel.length(); i++) {
            const res = this.uiModel.index(i)[0];
            const type = res.type;
            if ( type === "HeadUI" || type === "MergeUI" || type === "HelpUI" || type === "BlankUI" ||
                type === "MergeHeader" || type === "UntrackedHeader" || type === "UnstagedHeader" ||
                type === "StagedHeader" || type === "UnpushedHeader" || type === "Unpushed"
            ) {
                continue;
            }

            if (type === "MergeChange" || type === "Untracked" || type === "Unstaged" || type === "Staged" ) {
                this.line = i;
                setCursorWithView(this.line);
                return;
            } else if ((type === "UnstagedDiff" || type === "StagedDiff") && res.diffLineIndex === 0) {
                this.line = i;
                setCursorWithView(this.line);
                return;
            }
        }
    }


	async setRepository(): Promise<void> {
        if (!this.getLock()){
            vscode.window.showWarningMessage("Action in progress. Try again after completion");
            return;
        } 

        const repos = this.git.getRepositories().map((i): [string, Repository] => ([i[0].split('/').pop() || '', i[1]]));
        const repo_names = repos.map(i => i[0]);

        const options: vscode.QuickPickOptions = {
            title: "Select the repository",
        };

        const value = await vscode.window.showQuickPick(repo_names, options);
        if (!value) {
            this.actionLock = false;
            return;
        }
        const repo = repos.filter(i => i[0] === value)[0][1];
		this.git.setRepository(repo);

        this.onDidChangeEmitter.fire(Provider.uri);
	}

    refresh(): void {
        vscode.commands.executeCommand('git.refresh', this.git.rootUri).then((succ) => {
            console.debug('git.refresh success', succ);
        }, (err) => {
            console.debug('git.refresh error', err);
        });
    }

    toggleView(): void {
        // fix pointer jumping
        this.viewStyle = this.viewStyle === "list" ? "tree" : "list";
        this.onDidChangeEmitter.fire(Provider.uri);
    }

	toggleDirectory(): void {
        if (!this.getLock()){
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
            this.line = vscode.window.activeTextEditor!.selection.active.line;
            this.uiModel.treeModel.toggleDirectory(path, getDirectoryType(this.uiModel, this.line));
            this.onDidChangeEmitter.fire(Provider.uri);
        }
        this.actionLock = false;
	}

    async stageFile(): Promise<void> {
        if (!this.getLock()){
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
            console.debug('merge add ', change.uri.path);
            const uri = vscode.Uri.parse(change.uri.path);
            if (await this.checkForConflictMarker(uri)) {
                await this.git.repo.add([change.uri.path]);
                return;
            }
            this.actionLock = false;
        }
        if (resource.type === "Untracked") {
            const change = this.git.untracked()[resource.changeIndex];
            console.debug('track ', change.uri.path);
            await this.git.repo.add([change.uri.path]);
            return;
        }
        if(resource.type === "UntrackedHeader") {
            const changes = this.git.untracked().map(c => c.uri.path);
            console.debug(`track ${changes.length} files`);
            await this.git.repo.add(changes);
            return;
        }
        if (resource.type === "Unstaged") {
            const change = this.git.unstaged()[resource.changeIndex];
            console.debug('stage ', change.uri.path);
            await this.git.repo.add([change.uri.path]);
            this.uiModel.diffModel.getOpenedChanges().delete(change.uri.path);
            return;
        }
        if(resource.type === "UnstagedHeader") {
            const changes = this.git.unstaged().map(c => c.uri.path);
            console.debug(`track ${changes.length} files`);
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
            const line = vscode.window.activeTextEditor!.selection.active.line;
            const type = getDirectoryType(this.uiModel, line);
            const affected_changes = this.git
                .getChanges(type)
                .filter(c => {
                    return c.originalUri.path.replace(this.git.rootUri, '').startsWith(resource.path + "/");
                })
                .map(c => c.uri.path);

            console.debug(`stage ${affected_changes.length} ${type} files in directory ${resource.path}`);
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
        if (!this.getLock()){
            vscode.window.showWarningMessage("Action in progress. Try again after completion");
            return;
        } 
		if (this.git.repo.state.indexChanges.length > 0) {
			await this.git.repo.commit('', { useEditor: true }).catch(
                (err) => vscode.window.showWarningMessage(err.stderr)
        );
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
        if (!this.getLock()){
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
                console.debug(`unstage ${changes.length}`);
                await this.git.repo.revert(changes);
                for (const change of changes) {
                    this.uiModel.diffModel.getOpenedIndexChanges().delete(change);
                }
                return;
            }
            case "Staged": {
                const change = this.git.staged()[resource.changeIndex];
                console.debug('unstage ', change.uri.path);
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
                const line = vscode.window.activeTextEditor!.selection.active.line;
                const type = getDirectoryType(this.uiModel, line);
                const affected_changes = this.git
                    .getChanges(type)
                    .filter(c => {
                        return c.originalUri.path.replace(this.git.rootUri, '').startsWith(resource.path + "/");
                    })
                    .map(c => c.uri.path);

                console.debug(`unstage ${affected_changes.length} ${type} files in directory ${resource.path}`);
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
        if (!this.getLock()){
            vscode.window.showWarningMessage("Action in progress. Try again after completion");
            return;
        } 
        const files = this.git.staged().map((c) => c.uri.path);
        await this.git.repo.revert(files);
    }

    async cleanFile(): Promise<void> {
        if (!this.getLock()){
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
                console.debug('clean ', resource);
                await this.git.repo.clean([change.uri.path]);
                this.uiModel.diffModel.getOpenedChanges().delete(change.uri.path);
                return;
            }
            case "Unstaged": {
                const change = this.git.unstaged()[resource.changeIndex];
                console.debug('clean ', resource);
                await this.git.repo.clean([change.uri.path]);
                this.uiModel.diffModel.getOpenedChanges().delete(change.uri.path);
                return;
            }
            case "Staged": {
                const change = this.git.staged()[resource.changeIndex];
                console.debug('clean ', resource);
                await this.git.repo.revert([change.uri.path]);
                await this.git.repo.clean([change.uri.path]);
                this.uiModel.diffModel.getOpenedIndexChanges().delete(change.uri.path);
                return;
            }
            case "DirectoryHeader": {
                const line = vscode.window.activeTextEditor!.selection.active.line;
                const type = getDirectoryType(this.uiModel, line);
                if( type !== "Untracked" && type !== "Unstaged" && type !== "Staged") {
                    this.actionLock = false;
                    return;
                }
                const affected_changes = this.git
                    .getChanges(type)
                    .filter(c => {
                        return c.originalUri.path.replace(this.git.rootUri, '').startsWith(resource.path + "/");
                    })
                    .map(c => c.uri.path);

                // show confirmation dialog
                const confirm_message = `Are you sure you want to clean ${affected_changes.length} ${type} files in directory ${resource.path}?`;
                const confirm = await vscode.window.showWarningMessage(confirm_message, { modal: true }, "Yes", "No");
                if (confirm !== "Yes") {
                    this.actionLock = false;
                    return;
                }
                console.debug(`clean ${affected_changes.length} ${type} files in directory ${resource.path}`);
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
        if (!this.getLock()){
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
        this.onDidChangeEmitter.fire(Provider.uri);
    }

    private async updateDiffs() {
        console.debug("updateDiffs");
        await this.git.updateDiffMap("Unstaged");
        await this.git.updateDiffMap("Staged");
        const delete_opened_diffs = Array.from(this.uiModel.diffModel.getOpenedChanges().keys()).filter(k => !this.git.cachedUnstagedDiffs.has(k));
        const delete_opened_index_diffs = Array.from(this.uiModel.diffModel.getOpenedIndexChanges().keys()).filter(k => !this.git.cachedStagedDiffs.has(k));
        for (const key of delete_opened_diffs) {
            this.uiModel.diffModel.getOpenedChanges().delete(key);
        }
        for (const key of delete_opened_index_diffs) {
            this.uiModel.diffModel.getOpenedIndexChanges().delete(key);
        }
    }

    async openDiff(): Promise<void> {
        if (this.readLock()){
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
                console.error("No diff available");
            }
        }
        if (!uri_left || !uri_right) {
            return;
        }
        const title = (uri_left.path.split("/").pop() ?? "Diff") + " " + title_type;
        vscode.commands.executeCommand('vscode.diff', uri_left, uri_right, title).then((success) => {
            console.debug('success ', success);
        }, (rejected) => {
            console.debug('rejected ', rejected);
        });
    }

    async open(split: boolean): Promise<void> {
        if (this.readLock()){
            vscode.window.showWarningMessage("Action in progress. Try again after completion");
            return;
        }
        const resource = this.getResourceUnderCursor();

        switch(resource.type) {
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
        if (this.readLock()){
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
        if (this.readLock()){
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
        if (this.readLock()){
            vscode.window.showWarningMessage("Action in progress. Try again after completion");
            return;
        }
        const resource = this.getResourceUnderCursor();
        const change = this.git.changeFromResource(resource);
        if (!change) {
            return;
        }
        let path = change.originalUri.path.replace(this.git.rootUri, '');
        if (!path) {
            if( resource.type === "DirectoryHeader") {
                path = resource.path;
            } else {
                return;
            }
        }
        const uri = git_ignore ?
            vscode.Uri.parse(this.git.rootUri + "/.gitignore") :
            vscode.Uri.parse(this.git.rootUri + "/.git/info/exclude");

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

    private getResourceUnderCursor(): ResourceType {
        if (!vscode.window.activeTextEditor) {
            throw new Error("Fugitive: No active text editor found");
        }
        const line = vscode.window.activeTextEditor.selection.active.line;
        this.previousResource = this.uiModel.index(line)[0];
        return this.uiModel.index(line)[0];
    }

    /**
     * updates the cursor position, else it will jump almost randomly
     * at this point the uimodel is updated and git is updated
     * only the actual buffer is not updated yet
     */
    private updateCursor() {
        console.debug('updateCursor');
        if (!this.previousResource) {
            this.line = 
                vscode.window.activeTextEditor?.selection.active.line 
                || (this.uiModel.length() >= 5 ? 5: 0); //go to first item if present
            return;
        }
        switch (this.previousResource.type) {
            case 'UntrackedHeader':
            case 'UnstagedHeader': 
            case 'StagedHeader': {
                const offset = this.uiModel.getCategoryOffset(this.previousResource.type) + 1;
                this.line = offset + 0;
                break;
            }
            case 'MergeChange':
            case 'Untracked': {
                const index = this.git.getChanges(this.previousResource.type).length == 0 ? 0 :
                    this.previousResource.changeIndex > this.git.getChanges(this.previousResource.type).length - 1 ?
                        this.git.getChanges(this.previousResource.type).length - 1 : this.previousResource.changeIndex;
                const category_offset = this.uiModel.getCategoryOffset(changeTypeToHeaderType(this.previousResource.type)) + 1;
                this.line = category_offset + index;
                break;
            }
            case 'UnstagedDiff':
            case 'Unstaged': {
                const index = this.git.unstaged().length == 0 ? 0 :
                    this.previousResource.changeIndex > this.git.unstaged().length - 1 ?
                        this.git.unstaged().length - 1 : this.previousResource.changeIndex;
                const new_line = this.uiModel.findIndex(([res]) => res.type === "Unstaged" && res.changeIndex === index);
                const unstaged_offset = this.uiModel.getCategoryOffset("UnstagedHeader") + 1;
                this.line = new_line === -1 ? unstaged_offset : new_line;
                break;
            }
            case 'StagedDiff':
            case 'Staged': {
                const index = this.git.staged().length == 0 ? 0 :
                    this.previousResource.changeIndex > this.git.staged().length - 1 ?
                        this.git.staged().length - 1 : this.previousResource.changeIndex;
                const new_line = this.uiModel.findIndex(([res]) => res.type === "Staged" && res.changeIndex === index);
                const staged_offset = this.uiModel.getCategoryOffset("StagedHeader") + 1;
                this.line = new_line === -1 ? staged_offset : new_line;
                break;
            }
            default:
                console.error("updateCursor: " + this.previousResource.type + " not implemented");
        }
    }

    /**
     * Todo: this is just a temporary solution
     */
    private updateCursorTreeView() {
        console.debug('updateCursor');
        if (!this.previousResource) {
            this.line = 
                vscode.window.activeTextEditor?.selection.active.line 
                || (this.uiModel.length() >= 5 ? 5: 0); //go to first item if present
            return;
        }
        const type = this.previousResource; // fixate type for assertion
        if (!isChangeTypes(type)) {
            this.line = 
                vscode.window.activeTextEditor?.selection.active.line 
                || (this.uiModel.length() >= 5 ? 5: 0);
            return;
        }
        const offset = this.uiModel.getCategoryOffset(changeTypeToHeaderType(type.type)) + 1;
        this.line = offset;
    }

}