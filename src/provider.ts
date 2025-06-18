import * as vscode from 'vscode';
import {Status, Repository } from './vscode-git';
import { GitWrapper } from './git-wrapper';
import { setCursorWithView } from './util';
import { encodeCommit } from './diff-provider';
import { Resource } from './resource';
import { UIModel } from './ui-model';
import { GIT } from './extension';


export class Provider implements vscode.TextDocumentContentProvider {
    static myScheme = 'fugitive';
    static uri = vscode.Uri.parse(Provider.myScheme + ':Fugitive');

    public git: GitWrapper;

    private actionLock: boolean;

    private uiModel: UIModel;

    //status data
    private line: number;
    private previousResource: Resource | null;

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
        const gitDisposables = this.git.api.repositories.map( repo => {
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
        const docDispose = vscode.workspace.onDidChangeTextDocument((e: vscode.TextDocumentChangeEvent) => {
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
        this.subscriptions = [...gitDisposables, docDispose];

    }

    private getLock(): boolean{
        console.debug('Aquire lock');
        if (this.actionLock) {
            return false;
        }
        this.actionLock = true;
        setTimeout(() => {
            console.debug('Reset lock after timeout');
            this.actionLock = false;
        }, 3000);
        return true;
    }

    private readLock(): boolean{
        console.debug('Read lock');
        return this.actionLock;
    }

    dispose() {
        this.subscriptions.forEach(e => e.dispose());
    }

    provideTextDocumentContent(_uri: vscode.Uri): string {
        console.debug('Provider.provideTextDocumentContent');
        this.uiModel.updateUIModel();
        this.updateCursor();

        return this.uiModel.toString();
    }

    /**
     * opens the fugitive document
     * @param filepath determines the repository to open if there a multiple
     */
    async getDocOrRefreshIfExists(filepath?: string) {
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
            this.uiModel.clearOpenedChanges();
            this.uiModel.clearOpenedIndexChanges();
            doc = await vscode.workspace.openTextDocument(Provider.uri);
            this.onDidChangeEmitter.fire(Provider.uri);
        }
        return doc;
    }

    goUp() {
		if (!vscode.window.activeTextEditor) {
			return;
		}
		const line = vscode.window.activeTextEditor!.selection.active.line;
		const newLine = Math.max(line - 1, 0);
		vscode.window.activeTextEditor!.selection =
			new vscode.Selection(new vscode.Position(newLine, 0), new vscode.Position(newLine, 0));
    }

    goDown() {
		if (!vscode.window.activeTextEditor) {
			return;
		}
		const lineCount = vscode.window.activeTextEditor.document.lineCount;
		const line = vscode.window.activeTextEditor!.selection.active.line;
		const newLine = Math.min(line + 1, lineCount - 1);
		vscode.window.activeTextEditor!.selection =
			new vscode.Selection(new vscode.Position(newLine, 0), new vscode.Position(newLine, 0));
    }

    goStaged() {
        console.debug("goStaged");
        const index = this.uiModel.findHeader("StagedHeader");
        if (index >= 0) {
            vscode.window.activeTextEditor!.selection =
                new vscode.Selection(new vscode.Position(index, 0), new vscode.Position(index, 0));
        }
    }

    goUnstaged(goUnstaged: boolean) {
        const untrackedIndex = this.uiModel.findHeader("UntrackedHeader");
        if (!goUnstaged && untrackedIndex >= 0) {
            vscode.window.activeTextEditor!.selection =
                new vscode.Selection(new vscode.Position(untrackedIndex, 0), new vscode.Position(untrackedIndex, 0));
            return;
        }
        const unstagedIndex = this.uiModel.findHeader("UnstagedHeader");
        if (unstagedIndex >= 0) {
            vscode.window.activeTextEditor!.selection =
                new vscode.Selection(new vscode.Position(unstagedIndex, 0), new vscode.Position(unstagedIndex, 0));
            return;
        }
    }

    goUnpushed() {
        const index =  this.uiModel.findHeader("UnpushedHeader");
        if (index >= 0) {
            vscode.window.activeTextEditor!.selection =
                new vscode.Selection(new vscode.Position(index, 0), new vscode.Position(index, 0));
        }
    }

    goPreviousHunk() {
        const currentLine = vscode.window.activeTextEditor?.selection.active.line;

        if (!currentLine) {
            console.debug('no current line');
            return;
        }

        for (let i = currentLine - 1; i >= 0; i--) {
            const res = this.uiModel.index(i)[0].item;
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

    goNextHunk() {
        const currentLine = vscode.window.activeTextEditor?.selection.active.line;
        if (!currentLine && currentLine !== 0) {
            console.debug('no current line');
            return;
        }

        for (let i = currentLine + 1; i < this.uiModel.length(); i++) {
            const res = this.uiModel.index(i)[0].item;
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


	async setRepository() {
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

    refresh() {
        vscode.commands.executeCommand('git.refresh', this.git.rootUri).then((succ) => {
            console.debug('git.refresh success', succ);
        }, (err) => {
            console.debug('git.refresh error', err);
        });
    }

    async stageFile() {
        if (!this.getLock()){
            vscode.window.showWarningMessage("Action in progress. Try again after completion");
            return;
        } 
        const resource = this.getResourceUnderCursor().item;
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
            this.uiModel.getOpenedChanges().delete(change.uri.path);
            return;
        }
        if(resource.type === "UnstagedHeader") {
            const changes = this.git.unstaged().map(c => c.uri.path);
            console.debug(`track ${changes.length} files`);
            await this.git.repo.add(changes);
            for (const change of changes) {
                this.uiModel.getOpenedChanges().delete(change);
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
        this.actionLock = false;
    }

    async commit() {
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

    async unstageFile() {
        if (!this.getLock()){
            vscode.window.showWarningMessage("Action in progress. Try again after completion");
            return;
        } 
        const resource = this.getResourceUnderCursor().item;
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
                    this.uiModel.getOpenedIndexChanges().delete(change);
                }
                return;
            }
            case "Staged": {
                const change = this.git.staged()[resource.changeIndex];
                console.debug('unstage ', change.uri.path);
                await this.git.repo.revert([change.uri.path]);
                this.uiModel.getOpenedIndexChanges().delete(change.uri.path);
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
            default: {
                this.actionLock = false;
                return;
            }
        }
    }

    async toggle() {
        const resource = this.getResourceUnderCursor().item;
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

    async unstageAll() {
        if (!this.getLock()){
            vscode.window.showWarningMessage("Action in progress. Try again after completion");
            return;
        } 
        const files = this.git.staged().map((c) => c.uri.path);
        await this.git.repo.revert(files);
    }

    async cleanFile() {
        if (!this.getLock()){
            vscode.window.showWarningMessage("Action in progress. Try again after completion");
            return;
        } 
        const resource = this.getResourceUnderCursor().item;
        if (!resource) {
            this.actionLock = false;
            return;
        }
        switch (resource.type) {
            case "Untracked": {
                const change = this.git.untracked()[resource.changeIndex];
                console.debug('clean ', resource);
                await this.git.repo.clean([change.uri.path]);
                this.uiModel.getOpenedChanges().delete(change.uri.path);
                return;
            }
            case "Unstaged": {
                const change = this.git.unstaged()[resource.changeIndex];
                console.debug('clean ', resource);
                await this.git.repo.clean([change.uri.path]);
                this.uiModel.getOpenedChanges().delete(change.uri.path);
                return;
            }
            case "Staged": {
                const change = this.git.staged()[resource.changeIndex];
                console.debug('clean ', resource);
                await this.git.repo.revert([change.uri.path]);
                await this.git.repo.clean([change.uri.path]);
                this.uiModel.getOpenedIndexChanges().delete(change.uri.path);
                return;
            }
        }
    }

    async toggleInlineDiff() {
        if (!this.getLock()){
            vscode.window.showWarningMessage("Action in progress. Try again after completion");
            return;
        } 
        const resource = this.getResourceUnderCursor();
        const change = resource.getChange();
        if (!change) {
            return;
        }
        const res = resource.item;

        switch (res.type) {
            case "Unstaged": {
                const change = this.git.unstaged()[res.changeIndex];
                if (this.uiModel.getOpenedChanges().has(change.uri.path)) {
                    this.uiModel.getOpenedChanges().delete(change.uri.path);
                } else {
                    this.uiModel.getOpenedChanges().add(change.uri.path);
                }
                break;
            }
            case "Staged": {
                const change = this.git.staged()[res.changeIndex];
                if (this.uiModel.getOpenedIndexChanges().has(change.uri.path)) {
                    this.uiModel.getOpenedIndexChanges().delete(change.uri.path);
                } else {
                    this.uiModel.getOpenedIndexChanges().add(change.uri.path);
                }
                break;
            }
            case "StagedDiff": {
                const change = this.git.staged()[res.changeIndex];
                this.uiModel.getOpenedIndexChanges().delete(change.uri.path);
                break;
            }
            case "UnstagedDiff": {
                const change = this.git.unstaged()[res.changeIndex];
                this.uiModel.getOpenedChanges().delete(change.uri.path);
                break;
            }
        }
        this.onDidChangeEmitter.fire(Provider.uri);
    }

    private async updateDiffs() {
        console.debug("updateDiffs");
        await this.git.updateDiffMap("Unstaged");
        await this.git.updateDiffMap("Staged");
        const deleteOpenedDiffs = Array.from(this.uiModel.getOpenedChanges().keys()).filter(k => !this.git.cachedUnstagedDiffs.has(k));
        const deleteOpenedIndexDiffs = Array.from(this.uiModel.getOpenedIndexChanges().keys()).filter(k => !this.git.cachedStagedDiffs.has(k));
        for (const key of deleteOpenedDiffs) {
            this.uiModel.getOpenedChanges().delete(key);
        }
        for (const key of deleteOpenedIndexDiffs) {
            this.uiModel.getOpenedIndexChanges().delete(key);
        }
    }

    async openDiff() {
        if (!this.readLock()){
            vscode.window.showWarningMessage("Action in progress. Try again after completion");
            return;
        } 
    
        const ressource = this.getResourceUnderCursor().item;
        if (!ressource) {
            return;
        }
        let uriLeft = null;
        let uriRight = null;
        let titleType = "(Working Tree)";
        switch (ressource.type) {
            case "Unstaged": {
                const change = this.git.unstaged()[ressource.changeIndex];
                uriLeft = this.git.api.toGitUri(change.uri, "~"); // index
                uriRight = change.uri; // local file
                titleType = "(Working Tree)";
                break;
            }
            case "Staged": {
                const change = this.git.staged()[ressource.changeIndex];
                uriLeft = this.git.api.toGitUri(change.uri, "HEAD"); // last commit
                uriRight = this.git.api.toGitUri(change.uri, "~"); //index
                titleType = "(Index)";
                break;
            }
            default: {
                console.error("No diff available");
            }
        }
        if (!uriLeft || !uriRight) {
            return;
        }
        const title = (uriLeft.path.split("/").pop() ?? "Diff") + " " + titleType;
        vscode.commands.executeCommand('vscode.diff', uriLeft, uriRight, title).then((success) => {
            console.debug('success ', success);
        }, (rejected) => {
            console.debug('rejected ', rejected);
        });
    }

    async open(split: boolean) {
        if (!this.readLock()){
            vscode.window.showWarningMessage("Action in progress. Try again after completion");
            return;
        }
        const resource = this.getResourceUnderCursor();

        switch(resource.item.type) {
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

    private async openFile(resource: Resource, split: boolean) {
        if (!this.readLock()){
            vscode.window.showWarningMessage("Action in progress. Try again after completion");
            return;
        }
        const change = resource.getChange();
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

    private async openCommitDiff(resource: Resource, split: boolean) {
        if (!this.readLock()){
            vscode.window.showWarningMessage("Action in progress. Try again after completion");
            return;
        }
        const commit = resource.getCommit();
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

    async gitExclude(gitIgnore: boolean) {
        if (!this.readLock()){
            vscode.window.showWarningMessage("Action in progress. Try again after completion");
            return;
        }
        const resource = this.getResourceUnderCursor();
        const change = resource.getChange();
        if (!change) {
            return;
        }
        const uri = gitIgnore ?
            vscode.Uri.parse(this.git.rootUri + "/.gitignore") :
            vscode.Uri.parse(this.git.rootUri + "/.git/info/exclude");

        try {
            await vscode.workspace.fs.stat(uri);
        } catch {
            await vscode.workspace.fs.writeFile(uri, new Uint8Array());
        }

        const contents = await vscode.workspace.fs.readFile(uri);
        const enc = new TextEncoder(); // always utf-8
        const filename = enc.encode(change.originalUri.path.replace(this.git.rootUri, ''));

        const newContents = new Uint8Array(contents.length + filename.length + 1);
        newContents.set(contents);
        newContents.set(enc.encode("\n"), contents.length);
        newContents.set(filename, contents.length + 1);
        await vscode.workspace.fs.writeFile(uri, newContents);

        const doc = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(doc, { preview: false, viewColumn: vscode.ViewColumn.Beside });
    }

    private getResourceUnderCursor(): Resource {
        const line = vscode.window.activeTextEditor!.selection.active.line;
        this.previousResource = this.uiModel.index(line)[0];
        return this.uiModel.index(line)[0];
    }

    private updateCursor() {
        console.debug('updateCursor');
        if (!this.previousResource) {
            this.line = 
                vscode.window.activeTextEditor?.selection.active.line 
                || this.uiModel.length() >= 5 ? 5: 0; //go to first item if present
            return;
        }
        switch (this.previousResource.item.type) {
            case 'MergeChange': {
                const index = this.git.mergeChanges().length == 0 ? 0 :
                    this.previousResource.item.changeIndex > this.git.mergeChanges().length - 1 ?
                        this.git.mergeChanges().length - 1 : this.previousResource.item.changeIndex;
                const mergeOffset = this.uiModel.getCategoryOffset("MergeHeader") + 1;
                this.line = mergeOffset + index;
                break;
            }
            case 'UntrackedHeader': {
                const untrackedOffset = this.uiModel.getCategoryOffset("UntrackedHeader") + 1;
                this.line = untrackedOffset + 0;
                break;
            }
            case 'Untracked': {
                const index = this.git.untracked().length == 0 ? 0 :
                    this.previousResource.item.changeIndex > this.git.untracked().length - 1 ?
                        this.git.untracked().length - 1 : this.previousResource.item.changeIndex;
                const untrackedOffset = this.uiModel.getCategoryOffset("UntrackedHeader") + 1;
                this.line = untrackedOffset + index;
                break;
            }
            case 'UnstagedHeader': {
                const unstagedOffset = this.uiModel.getCategoryOffset("UnstagedHeader") + 1;
                this.line = unstagedOffset + 0;
                break;
            }
            case 'UnstagedDiff':
            case 'Unstaged': {
                const index = this.git.unstaged().length == 0 ? 0 :
                    this.previousResource.item.changeIndex > this.git.unstaged().length - 1 ?
                        this.git.unstaged().length - 1 : this.previousResource.item.changeIndex;
                const newLine = this.uiModel.findIndex(([res]) => res.item.type === "Unstaged" && res.item.changeIndex === index);
                const unstagedOffset = this.uiModel.getCategoryOffset("UnstagedHeader") + 1;
                this.line = newLine === -1 ? unstagedOffset : newLine;
                break;
            }
            case 'StagedHeader': {
                const stagedOffset = this.uiModel.getCategoryOffset("StagedHeader") + 1;
                this.line = stagedOffset + 0;
                break;
            }
            case 'StagedDiff':
            case 'Staged': {
                const index = this.git.staged().length == 0 ? 0 :
                    this.previousResource.item.changeIndex > this.git.staged().length - 1 ?
                        this.git.staged().length - 1 : this.previousResource.item.changeIndex;
                const newLine = this.uiModel.findIndex(([res]) => res.item.type === "Staged" && res.item.changeIndex === index);
                const stagedOffset = this.uiModel.getCategoryOffset("StagedHeader") + 1;
                this.line = newLine === -1 ? stagedOffset : newLine;
                break;
            }
            default:
                console.error("updateCursor: " + this.previousResource.item.type + " not implemented");
        }
    }

}
