import * as vscode from 'vscode';
import { window, workspace, commands } from 'vscode';
import { Provider } from './provider';
import { GitExtension } from './vscode-git';
import { DiffProvider } from './diff-provider';
import { GitWrapper } from './git-wrapper';

//GLOBAL DEPENDENCIES
export let GIT: GitWrapper | null = null;

export function activate({ subscriptions }: vscode.ExtensionContext) {

	const addSubscription = (command: () => Promise<void>, name: string) => {
		subscriptions.push(commands.registerCommand(name, async () => {
			console.debug(name);
			try {
				await command();
			} catch (error) {
				console.error('Error on ', name,':', error);
				vscode.window.showErrorMessage('Fugitive: Error on ' + name);
			}
		}));
	};

	const thenableToPromise = async <T>(thenable: Thenable<T>): Promise<T> => {
		return new Promise<T>((resolve, reject) => {
			thenable.then(
				(success) => resolve(success), 
				(error) =>  reject(error)
			);
		});
	};

	console.debug('fugitive.activate');
	let provider: Provider | null = null;
	let diffProvider: DiffProvider | null = null;
	const dependencies = getDependencies();
	if (dependencies) {
		diffProvider = new DiffProvider();
		provider = new Provider();
		subscriptions.push(workspace.registerTextDocumentContentProvider(DiffProvider.scheme, diffProvider));
		subscriptions.push(workspace.registerTextDocumentContentProvider(Provider.myScheme, provider));
	}


	subscriptions.push(commands.registerCommand('fugitive.open', async () => {
		console.debug('fugitive.open');

		if (!provider) {
			const dependencies = getDependencies();
			if (!dependencies) {
				return;
			}
			diffProvider = new DiffProvider();
			provider = new Provider();
			subscriptions.push(workspace.registerTextDocumentContentProvider(DiffProvider.scheme, diffProvider));
			subscriptions.push(workspace.registerTextDocumentContentProvider(Provider.myScheme, provider));
		}
		const current_doc_path = window.activeTextEditor?.document.uri.path || "";
		const fugitive_doc = await provider.getDocOrRefreshIfExists(current_doc_path);
		await window.showTextDocument(fugitive_doc, { preview: false });
	}));

	addSubscription(() => provider!.stageFile(), 'fugitive.stage');
	addSubscription(() => provider!.unstageFile(), 'fugitive.unstage');
	addSubscription(() => provider!.toggle(), 'fugitive.toggle');
	addSubscription(() => provider!.unstageAll(), 'fugitive.unstageAll');
	addSubscription(() => provider!.cleanFile(), 'fugitive.clean');
	addSubscription(() => provider!.toggleInlineDiff(), 'fugitive.toggleInlineDiff');
	addSubscription(() => provider!.openDiff(), 'fugitive.openDiff');
	addSubscription(() => provider!.setRepository(), 'fugitive.setRepo');
	addSubscription(() => provider!.commit(), 'fugitive.commit');
	addSubscription(() => provider!.open(true), 'fugitive.openFileSplit');
	addSubscription(() => provider!.open(false), 'fugitive.openFile');
	addSubscription(() => provider!.git.repo.commit('', { useEditor: true, amend: true }), 'fugitive.amend');
	addSubscription(() => provider!.git.repo.commit('', { amend: true }), 'fugitive.amendNoEdit');
	addSubscription(() => provider!.gitExclude(false), 'fugitive.gitExclude');
	addSubscription(() => provider!.gitExclude(true), 'fugitive.gitIgnore');
	addSubscription(async () => provider!.refresh(), 'fugitive.refresh');
	addSubscription(async () => provider!.toggleDirectory(), 'fugitive.toggleDirectory');
	addSubscription(async () => provider!.toggleView(), 'fugitive.toggleView');
	addSubscription(async () => provider!.goUp(), 'fugitive.goUp');
	addSubscription(async () => provider!.goDown(), 'fugitive.goDown');
	addSubscription(async () => provider!.goPreviousHunk(), 'fugitive.previousHunk');
	addSubscription(async () => provider!.goNextHunk(), 'fugitive.nextHunk');
	addSubscription(async () => provider!.goUnstaged(false), 'fugitive.goUntracked');
	addSubscription(async () => provider!.goUnstaged(true), 'fugitive.goUnstaged');
	addSubscription(async () => provider!.goUnpushed(), 'fugitive.goUnpushed');
	addSubscription(async () => provider!.goStaged(), 'fugitive.goStaged');
	addSubscription(() => thenableToPromise(vscode.commands.executeCommand("extension.open", "hnrk-str.vscode-fugitive")), 'fugitive.help');
	addSubscription(() => thenableToPromise(vscode.commands.executeCommand('workbench.action.closeActiveEditor')), 'fugitive.close');
	addSubscription(() => thenableToPromise(vscode.commands.executeCommand('git.stash')), 'fugitive.stash');
	addSubscription(() => thenableToPromise(vscode.commands.executeCommand('git.stashStaged')), 'fugitive.stashStaged');
	addSubscription(() => thenableToPromise(vscode.commands.executeCommand('git.stashPopLatest')), 'fugitive.popLatestStash');
	addSubscription(() => thenableToPromise(vscode.commands.executeCommand('git.stashPop')), 'fugitive.popStash');
	addSubscription(() => thenableToPromise(vscode.commands.executeCommand('git.checkout')), 'fugitive.checkoutBranch');

}

function getDependencies(): boolean {
	console.debug("checkForRepository");
	const gitExtension: GitExtension = vscode.extensions.getExtension('vscode.git')?.exports;
	if (!gitExtension || !gitExtension.enabled) {
		window.showWarningMessage('Fugitive: No git extension found or not enabled.');
		return false;
	}
	const api = gitExtension.getAPI(1);
	if (api.repositories.length === 0 && !api.repositories[0]?.state.HEAD?.name) {
		window.showWarningMessage('Fugitive: No git repository initialized');
		return false;
	}
	GIT = new GitWrapper(api);
	return true;
}