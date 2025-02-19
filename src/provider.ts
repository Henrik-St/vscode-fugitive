import * as vscode from 'vscode';
import { API as GitAPI, Change, Status, Commit } from './vscode-git';
import { GitWrapper } from './git-wrapper';
import { mapStatustoString, setCursorWithView } from './util';

type ChangeType = { changeIndex: number };
type DiffType = { changeIndex: number, diffIndex: number, diffLineIndex: number };

export type Resource = 
    {type: 'HeadUI'} | {type: 'MergeUI' }| {type: 'HelpUI' }| {type: 'MergeHeader' }| 
    {type: 'MergeChange'}  & ChangeType | 
    {type: 'UntrackedHeader' } | {type: 'Untracked'} & ChangeType| 
    {type: 'UnstagedHeader' }| {type: 'Unstaged'} & ChangeType| 
    {type: 'UnstagedDiff'} & DiffType  |
    {type: 'StagedHeader' }| {type: 'Staged'} & ChangeType|
    {type: 'StagedDiff'} & DiffType  |
    {type: 'UnpushedHeader' } | {type: 'Unpushed' } & ChangeType |
    {type: 'BlankUI'}
;

export class Provider implements vscode.TextDocumentContentProvider {
    static myScheme = 'fugitive';
    static uri = vscode.Uri.parse(Provider.myScheme + ':Fugitive');

    public git: GitWrapper;

    //render data
    private uiModel: [Resource, string][];

    //status data
    private line: number;
    private previousResource: Resource | null;

    private openedChanges: Set<string>;
    private openedIndexChanges: Set<string>;

    private onDidChangeEmitter = new vscode.EventEmitter<vscode.Uri>();
    onDidChange = this.onDidChangeEmitter.event; // triggers before provideTextDocumentContent
    private subscriptions: vscode.Disposable[];

    constructor(gitAPI: GitAPI) {
        this.git = new GitWrapper(gitAPI);

        this.line = 0;
        this.previousResource = null;
        this.openedChanges = new Set();
        this.openedIndexChanges = new Set();

        this.uiModel = [];

        // on Git Changed
        const gitDisposable = this.git.repo.state.onDidChange(async () => {
            console.debug('onGitChanged');
            await this.git.updateBranchInfo();
            await this.updateDiffs();

            const doc = vscode.workspace.textDocuments.find(doc => doc.uri.scheme === Provider.myScheme);
            if (doc) {
                this.onDidChangeEmitter.fire(doc.uri);
            }
        });

        // triggers after provideTextDocumentContent
        // overrides cursor behaviour
        const docDispose = vscode.workspace.onDidChangeTextDocument((e: vscode.TextDocumentChangeEvent) => {
            if (vscode.window.activeTextEditor?.document.uri.toString() === Provider.uri.toString() &&
                e.document.uri.toString() === Provider.uri.toString()) {
                console.debug('onDidChangeTextDocument');
                vscode.window.activeTextEditor!.selection =
                    new vscode.Selection(new vscode.Position(this.line, 0), new vscode.Position(this.line, 0));
            }
        });
        this.subscriptions = [gitDisposable, docDispose];

    }

    private renderChange(c: Change): string {
        return mapStatustoString(c.status) + " " + c.originalUri.path.replace(this.git.rootUri, '');
    }

    private getDiffModel(c: Change, index: number, changeType: "Staged" | "Unstaged", diffType: "StagedDiff" | "UnstagedDiff"): [Resource, string][] {
        const hasDiff = this.getOpenedDiffMap(changeType).has(c.uri.path);
        if (!hasDiff) {
            return [];
        }

        const arr = (this.getOpenedDiffMap(changeType).get(c.uri.path) ?? []).flatMap( (str, i): [Resource, string][] => {
            return str.split("\n").map((str, lineI): [Resource, string] => {
                return [{type: diffType, changeIndex: index, diffIndex: i, diffLineIndex: lineI}, str];
            });
        });
        return arr;
    }


    dispose() {
        this.subscriptions.forEach(e => e.dispose());
    }

    provideTextDocumentContent(_uri: vscode.Uri): string {
        console.debug('provideTextDocumentContent');
        const newUIModel: [Resource, string][] = [];
        let head = "Detached";
        if (this.git.repo.state.HEAD?.name) {
            head = this.git.repo.state.HEAD.name;
        } else if (this.git.repo.state.HEAD?.commit) {
            head += " at " + this.git.repo.state.HEAD.commit.slice(0, 8);
        }
        newUIModel.push([{type: 'HeadUI'}, `Head: ${head}`]);

        if (this.git.repo.state.rebaseCommit) {
            head = "Rebasing at " + this.git.repo.state.rebaseCommit.hash.slice(0, 8);
        }
        let merge = "Unpublished";

        if (this.git.getCachedHasRemoteBranch()) {
            merge = `Merge: ${this.git.repo.state.remotes[0].name}/${head}`;
        }
        newUIModel.push([{ type: 'MergeUI'}, merge]);
        newUIModel.push([{ type: 'HelpUI'}, "Help: g h"]);

        // render untracked
        const mergeChanges = this.git.repo.state.mergeChanges;
        if (mergeChanges.length > 0) {
            newUIModel.push([{ type: "BlankUI"}, ""]);
            newUIModel.push([{ type: 'MergeHeader'}, `Merge Changes (${mergeChanges.length}):`]);
            const m = mergeChanges.map((c, i): [Resource, string] => ([{ type: "MergeChange", changeIndex: i},this.renderChange(c)]));
            newUIModel.push(...m);
        }
        const untracked = this.git.untracked();
        if (untracked.length > 0) {
            newUIModel.push([{ type: "BlankUI"}, ""]);
            newUIModel.push([{type: "UntrackedHeader"}, `Untracked (${untracked.length}):`]);
            const m = untracked.map((c, i): [Resource, string] => [{type: "Untracked", changeIndex: i},this.renderChange(c)]);
            newUIModel.push(...m);
        }
        // render unstaged
        const unstaged = this.git.unstaged();
        if (unstaged.length > 0) {
            newUIModel.push([{ type: "BlankUI"}, ""]);
            newUIModel.push([{ type: "UnstagedHeader"}, `Unstaged (${unstaged.length}):`]);
            const m = unstaged.flatMap((c, i): [Resource, string][] => (
                [
                    this.getChangeModel(c, i, "Unstaged"),
                    ...this.getDiffModel(c, i, "Unstaged", "UnstagedDiff")
                ]
            ));
            newUIModel.push(...m);
        }
        // render staged
        const staged = this.git.staged();
        if (staged.length > 0) {
            newUIModel.push([{ type: "BlankUI"}, ""]);
            newUIModel.push([{ type: "StagedHeader"}, `Staged (${staged.length}):`]);
            const m = staged.flatMap((c, i): [Resource, string][] => (
                [
                    this.getChangeModel(c, i, "Staged"),
                    ...this.getDiffModel(c, i, "Staged", "StagedDiff")
                ]
            ));
            newUIModel.push(...m);
        }

        const unpushedLen = this.git.cachedUnpushedCommits.length;
        if (unpushedLen > 0) {
            newUIModel.push([{ type: "BlankUI"}, ""]);
            const len = this.git.cachedUnpushedCommits.length;
            let to = "";
            if (this.git.repo.state.remotes[0]?.name) {
                if (this.git.getCachedHasRemoteBranch()) {
                    to = `to ${this.git.repo.state.remotes[0].name}/${head} `;
                } else {
                    to = "to * ";
                }
            }
            const commits = this.git.cachedUnpushedCommits.map((c, i): [Resource, string] => [
                { type: "Unpushed", changeIndex: i},
                c.hash.slice(0, 8) + " " + c.message.split("\n")[0].slice(0, 80)
            ]);
            newUIModel.push([{ type: "UnpushedHeader"}, `Unpushed ${to}(${len}):`]);
            newUIModel.push(...commits);
        }
        this.uiModel = newUIModel;
        this.updateCursor();

        const renderString = newUIModel.map(([_, str]) => str).join("\n");
        return renderString;
    }

    private getChangeModel(c: Change, i: number, changeType: "Unstaged" | "Staged"): [Resource, string] {
        return [{ type: changeType, changeIndex: i }, this.renderChange(c)];
    }

    async getDocOrRefreshIfExists() {
        console.debug("getDocOrRefreshIfExists");
        await this.git.updateBranchInfo();
        await this.updateDiffs();

        let doc = vscode.workspace.textDocuments.find(doc => doc.uri === Provider.uri);
        if (doc) {
            this.onDidChangeEmitter.fire(Provider.uri);
        } else {
            this.openedChanges.clear();
            this.openedIndexChanges.clear();
            doc = await vscode.workspace.openTextDocument(Provider.uri);
        }
        return doc;
    }

    goStaged() {
        console.debug("goStaged");
        const index = this.uiModel.findIndex(([res]) => res.type === "StagedHeader");
        if (index >= 0) {
            vscode.window.activeTextEditor!.selection =
                new vscode.Selection(new vscode.Position(index, 0), new vscode.Position(index, 0));
        }
    }

    goUnstaged(goUnstaged: boolean) {
        const untrackedIndex = this.uiModel.findIndex(([res]) => res.type === "UntrackedHeader");
        if (!goUnstaged && untrackedIndex >= 0) {
            vscode.window.activeTextEditor!.selection =
                new vscode.Selection(new vscode.Position(untrackedIndex, 0), new vscode.Position(untrackedIndex, 0));
            return;
        }
        const unstagedIndex = this.uiModel.findIndex(([res]) => res.type === "UnstagedHeader");
        if (unstagedIndex >= 0) {
            vscode.window.activeTextEditor!.selection =
                new vscode.Selection(new vscode.Position(unstagedIndex, 0), new vscode.Position(unstagedIndex, 0));
            return;
        }
    }

    goUnpushed() {
        const index = this.uiModel.findIndex(([res]) => res.type === "UnpushedHeader");
        if (index >= 0) {
            vscode.window.activeTextEditor!.selection =
                new vscode.Selection(new vscode.Position(index, 0), new vscode.Position(index, 0));
        }
    }
    goPreviousHunk() {
        const currentLine = vscode.window.activeTextEditor?.selection.active.line;

        if (!currentLine) {
            console.log('no current line');
            return;
        }

        for (let i = currentLine - 1; i >= 0; i--) {
            const res = this.uiModel[i][0];
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
            console.log('no current line');
            return;
        }

        for (let i = currentLine + 1; i < this.uiModel.length; i++) {
            const res = this.uiModel[i][0];
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


    async stageFile() {
        const resource = this.getResourceUnderCursor();
        if (!resource) {
            return;
        }
        if (resource.type === "MergeChange") {
            const change = this.git.mergeChanges()[resource.changeIndex];
            console.debug('merge add ', change.uri.path);
            const uri = vscode.Uri.parse(change.uri.path);
            if (await this.checkForConflictMarker(uri)) {
                await this.git.repo.add([change.uri.path]);
            }
            return;
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
            this.openedChanges.delete(change.uri.path);
            return;
        }
        if(resource.type === "UnstagedHeader") {
            const changes = this.git.unstaged().map(c => c.uri.path);
            console.debug(`track ${changes.length} files`);
            await this.git.repo.add(changes);
            for (const change of changes) {
                this.openedChanges.delete(change);
            }
            return;
        }
        if (resource.type === "UnstagedDiff") {
            const change = this.git.unstaged()[resource.changeIndex];
            if (resource.diffIndex === undefined) {
                return Promise.reject("No diff index: " + resource.diffIndex);
            }
            await this.git.applyPatchToFile(change.uri, resource.diffIndex, "stage");
        }
    }

    async checkForConflictMarker(uri: vscode.Uri): Promise<boolean> {
        const buffer = await vscode.workspace.fs.readFile(uri);
        if (buffer.toString().includes("<<<<<<<")) {
            const options: vscode.QuickPickOptions = {
                title: "Merge with conflicts?",
            };

            const success_text = "Merge conflicts";
            const value = await vscode.window.showQuickPick(["cancel", success_text], options);
            return value === success_text;
        }
        return true;
    }

    async unstageFile() {
        const resource = this.getResourceUnderCursor();
        if (!resource) {
            return;
        }
        switch (resource.type) {
            case "StagedHeader": {
                const changes = this.git.staged().map((c) => c.uri.path);
                console.debug(`unstage ${changes.length}`);
                await this.git.repo.revert(changes);
                for (const change of changes) {
                    this.openedIndexChanges.delete(change);
                }
                break;
            }
            case "Staged": {
                const change = this.git.staged()[resource.changeIndex];
                console.debug('unstage ', change.uri.path);
                await this.git.repo.revert([change.uri.path]);
                this.openedIndexChanges.delete(change.uri.path);
                break;
            }
            case "StagedDiff": {
                const change = this.git.staged()[resource.changeIndex];
                if (resource.diffIndex === undefined) {
                    return Promise.reject("No diff index: " + resource.diffIndex);
                }
                await this.git.applyPatchToFile(change.uri, resource.diffIndex, "unstage");
                break;
            }
        }
    }

    async toggle() {
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

    async unstageAll() {
        const files = this.git.staged().map((c) => c.uri.path);
        await this.git.repo.revert(files);
    }

    async cleanFile() {
        const resource = this.getResourceUnderCursor();
        if (!resource) {
            return;
        }
        switch (resource.type) {
            case "Untracked": {
                const change = this.git.untracked()[resource.changeIndex];
                console.debug('clean ', resource);
                await this.git.repo.clean([change.uri.path]);
                this.openedChanges.delete(change.uri.path);
                return;
            }
            case "Unstaged": {
                const change = this.git.unstaged()[resource.changeIndex];
                console.debug('clean ', resource);
                await this.git.repo.clean([change.uri.path]);
                this.openedChanges.delete(change.uri.path);
                return;
            }
            case "Staged": {
                const change = this.git.staged()[resource.changeIndex];
                console.debug('clean ', resource);
                await this.git.repo.revert([change.uri.path]);
                await this.git.repo.clean([change.uri.path]);
                this.openedIndexChanges.delete(change.uri.path);
                return;
            }
        }
    }

    async toggleInlineDiff() {
        const resource = this.getResourceUnderCursor();
        const change = this.getChangeFromResource(resource);
        if (!change) {
            return;
        }

        switch (resource.type) {
            case "Unstaged": {
                const change = this.git.unstaged()[resource.changeIndex];
                if (this.openedChanges.has(change.uri.path)) {
                    this.openedChanges.delete(change.uri.path);
                } else {
                    this.openedChanges.add(change.uri.path);
                }
                break;
            }
            case "Staged": {
                const change = this.git.staged()[resource.changeIndex];
                if (this.openedIndexChanges.has(change.uri.path)) {
                    this.openedIndexChanges.delete(change.uri.path);
                } else {
                    this.openedIndexChanges.add(change.uri.path);
                }
                break;
            }
            case "StagedDiff": {
                const change = this.git.staged()[resource.changeIndex];
                this.openedIndexChanges.delete(change.uri.path);
                break;
            }
            case "UnstagedDiff": {
                const change = this.git.unstaged()[resource.changeIndex];
                this.openedChanges.delete(change.uri.path);
                break;
            }
        }
        this.onDidChangeEmitter.fire(Provider.uri);
    }

    private async updateDiffs() {
        await this.git.updateDiffMap("Unstaged");
        await this.git.updateDiffMap("Staged");
        const deleteOpenedDiffs = Array.from(this.openedChanges.keys()).filter(k => !this.git.cachedUnstagedDiffs.has(k));
        const deleteOpenedIndexDiffs = Array.from(this.openedIndexChanges.keys()).filter(k => !this.git.cachedStagedDiffs.has(k));
        for (const key of deleteOpenedDiffs) {
            this.openedChanges.delete(key);
        }
        for (const key of deleteOpenedIndexDiffs) {
            this.openedIndexChanges.delete(key);
        }
    }

    async openDiff() {
        const ressource = this.getResourceUnderCursor();
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

    private getChangeFromResource(res: Resource): Change | null {
        switch(res.type) {
            case "Unstaged": {
                return this.git.unstaged()[res.changeIndex];
            }
            case "Staged": {
                return this.git.staged()[res.changeIndex]; 
            }
            case "Untracked": {
                return this.git.untracked()[res.changeIndex];
            }
            case "MergeChange": {
                return this.git.mergeChanges()[res.changeIndex];
            }
            case "UnstagedDiff": {
                return this.git.unstaged()[res.changeIndex];
            }
            case "StagedDiff": {
                return this.git.staged()[res.changeIndex];
            }
            default: {
                return null;
            }
        }
    }

    private getCommitFromResource(res: Resource): Commit | null {
        switch(res.type) {
            case "Unpushed": {
                return this.git.cachedUnpushedCommits[res.changeIndex];
            }
            default: {
                return null;
            }
        }
    }

    async open(split: boolean) {
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

    private async openFile(resource: Resource, split: boolean) {
        const change = this.getChangeFromResource(resource);
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
        const commit = this.getCommitFromResource(resource);
        if (!commit) {
            return;
        }
        const content = await this.git.constructCommitDiff(commit);

        const doc = await vscode.workspace.openTextDocument({
            content: content,
            language: "diff",

        });
        if (split) {
            await vscode.window.showTextDocument(doc, { preview: false, viewColumn: vscode.ViewColumn.Beside });
        } else {
            await vscode.window.showTextDocument(doc, { preview: false });
        }
    }

    async gitExclude(gitIgnore: boolean) {
        const fileUnderCursor = this.getResourceUnderCursor();
        const change = this.getChangeFromResource(fileUnderCursor);
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
        this.previousResource = this.uiModel[line][0];
        return this.uiModel[line][0];
    }

    private getOpenedDiffMap(type: "Staged" | "Unstaged"): Map<string, string[]> {
        const openedMap = type === "Staged" ? this.openedIndexChanges : this.openedChanges;
        const diffMap = type === "Staged" ? this.git.cachedStagedDiffs : this.git.cachedUnstagedDiffs;
        const map = new Map<string, string[]>();
        for (const m of diffMap) {
            openedMap.has(m[0]) && map.set(m[0], m[1]);
        }
        return map;
    }

    private updateCursor() {
        console.debug('updateCursor');
        if (!this.previousResource) {
            this.line = vscode.window.activeTextEditor!.selection.active.line;
            return;
        }
        switch (this.previousResource.type) {
            case 'MergeChange': {
                const index = this.git.mergeChanges().length == 0 ? 0 :
                    this.previousResource.changeIndex > this.git.mergeChanges().length - 1 ?
                        this.git.mergeChanges().length - 1 : this.previousResource.changeIndex;
                const mergeOffset = this.getCategoryOffset("MergeHeader") + 1;
                this.line = mergeOffset + index;
                break;
            }
            case 'UntrackedHeader': {
                const untrackedOffset = this.getCategoryOffset("UntrackedHeader") + 1;
                this.line = untrackedOffset + 0;
                break;
            }
            case 'Untracked': {
                const index = this.git.untracked().length == 0 ? 0 :
                    this.previousResource.changeIndex > this.git.untracked().length - 1 ?
                        this.git.untracked().length - 1 : this.previousResource.changeIndex;
                const untrackedOffset = this.getCategoryOffset("UntrackedHeader") + 1;
                this.line = untrackedOffset + index;
                break;
            }
            case 'UnstagedHeader': {
                const unstagedOffset = this.getCategoryOffset("UnstagedHeader") + 1;
                this.line = unstagedOffset + 0;
                break;
            }
            case 'UnstagedDiff':
            case 'Unstaged': {
                const index = this.git.unstaged().length == 0 ? 0 :
                    this.previousResource.changeIndex > this.git.unstaged().length - 1 ?
                        this.git.unstaged().length - 1 : this.previousResource.changeIndex;
                const newLine = this.uiModel.findIndex(([res]) => res.type === "Unstaged" && res.changeIndex === index);
                const unstagedOffset = this.getCategoryOffset("UnstagedHeader") + 1;
                this.line = newLine === -1 ? unstagedOffset : newLine;
                break;
            }
            case 'StagedHeader': {
                const stagedOffset = this.getCategoryOffset("StagedHeader") + 1;
                this.line = stagedOffset + 0;
                break;
            }
            case 'StagedDiff':
            case 'Staged': {
                const index = this.git.staged().length == 0 ? 0 :
                    this.previousResource.changeIndex > this.git.staged().length - 1 ?
                        this.git.staged().length - 1 : this.previousResource.changeIndex;
                const newLine = this.uiModel.findIndex(([res]) => res.type === "Staged" && res.changeIndex === index);
                const stagedOffset = this.getCategoryOffset("StagedHeader") + 1;
                this.line = newLine === -1 ? stagedOffset : newLine;
                break;
            }
            default:
                console.error("updateCursor: " + this.previousResource.type + " not implemented");
        }
    }

    private getCategoryOffset(type: Resource['type']): number {
        let index = -1;
        /* eslint-disable no-fallthrough */ 
        // Fallthrough is intended here to got to fallback category
        switch (type) {
            case 'UnpushedHeader': 
                index = this.uiModel.findIndex(([res]) => res.type === 'UnpushedHeader');
                if (index !== -1) {
                    return index;
                }
            case 'StagedHeader':
                index = this.uiModel.findIndex(([res]) => res.type === 'StagedHeader');
                if (index !== -1) {
                    return index;
                }
            case 'UnstagedHeader':
                index = this.uiModel.findIndex(([res]) => res.type === 'UnstagedHeader');
                if (index !== -1) {
                    return index;
                }
            case 'UntrackedHeader':
                index = this.uiModel.findIndex(([res]) => res.type === 'UntrackedHeader');
                if (index !== -1) {
                    return index;
                }
            case 'MergeHeader':
                index = this.uiModel.findIndex(([res]) => res.type === 'MergeHeader');
                if (index !== -1) {
                    return index;
                }
        }
        /* eslint-enable no-fallthrough */
        const containsCategory = this.uiModel.some(([a,_]) => 
            a.type === "MergeHeader" || a.type === "UntrackedHeader" || 
            a.type === "UnstagedHeader" || a.type === "StagedHeader" || 
            a.type === "UnpushedHeader"
        );
        index = containsCategory ? 4 : 0;
        return index;
    }

}
