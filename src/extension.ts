import * as vscode from 'vscode';
import { window, workspace, commands, Uri } from 'vscode';
import { Provider } from './provider';
import { GitExtension } from './vscode-git';

export function activate({ subscriptions }: vscode.ExtensionContext) {

	console.debug('fugitive.activate');
	let provider: Provider | null = null;
	const dependencies = getDependencies();
	if (dependencies) {
		provider = new Provider(dependencies.gitAPI);
		subscriptions.push(workspace.registerTextDocumentContentProvider(Provider.myScheme, provider));
	}


	subscriptions.push(commands.registerCommand('fugitive.open', async () => {
		console.debug('fugitive.open');

		if (!provider) {
			const dependencies = getDependencies();
			if (!dependencies) {
				return;
			}
			provider = new Provider(dependencies.gitAPI);
			subscriptions.push(workspace.registerTextDocumentContentProvider(Provider.myScheme, provider));
		}
		const doc = await provider.getDocOrRefreshIfExists();
		await window.showTextDocument(doc, { preview: false });
	}));

	subscriptions.push(commands.registerCommand('fugitive.stage', async () => {
		console.debug('fugitive.stage');
		await provider!.stageFile();
	}));

	subscriptions.push(commands.registerCommand('fugitive.unstage', async () => {
		console.debug('fugitive.unstage');
		await provider!.unstageFile();
	}));

	subscriptions.push(commands.registerCommand('fugitive.toggle', async () => {
		console.debug('fugitive.toggle');
		await provider!.toggle();
	}));

	// subscriptions.push(commands.registerCommand('fugitive.populateCommit', async () => {
	// 	console.debug('fugitive.populateCommit');
	// 	const term: vscode.Terminal = getTerminal();
	// 	term.show();
	// 	term.sendText("git commit ", false);
	// }));

	// subscriptions.push(commands.registerCommand('fugitive.populateMerge', async () => {
	// 	console.debug('fugitive.populateCommit');
	// 	const term: vscode.Terminal = getTerminal();
	// 	term.show();
	// 	term.sendText("git merge ", false);
	// }));

	// subscriptions.push(commands.registerCommand('fugitive.populateRevert', async () => {
	// 	console.debug('fugitive.populateRevert');
	// 	const term: vscode.Terminal = getTerminal();
	// 	term.show();
	// 	term.sendText("git revert ", false);
	// }));

	subscriptions.push(commands.registerCommand('fugitive.unstageAll', async () => {
		console.debug('fugitive.unstageAll');
		await provider!.unstageAll();
	}));

	subscriptions.push(commands.registerCommand('fugitive.clean', async () => {
		console.debug('fugitive.clean');
		await provider!.cleanFile();
	}));

	subscriptions.push(commands.registerCommand('fugitive.toggleInlineDiff', async () => {
		console.debug('fugitive.toggleInlineDiff');
		provider!.toggleInlineDiff();
	}));



	subscriptions.push(commands.registerCommand('fugitive.openDiff', async () => {
		console.debug('fugitive.openDiff');
		await provider!.openDiff();
	}));

	subscriptions.push(commands.registerCommand('fugitive.openFileSplit', async () => {
		console.debug('fugitive.openFileSplit');
		await provider!.openFile(true);
	}));

	subscriptions.push(commands.registerCommand('fugitive.openFile', async () => {
		console.debug('fugitive.openFile');
		await provider!.openFile(false);
	}));

	subscriptions.push(commands.registerCommand('fugitive.commit', async () => {
		console.debug('fugitive.commit');
		if (provider!.git.repo.state.indexChanges.length > 0) {
			await provider!.git.repo.commit('', { useEditor: true });
		} else {
			window.showWarningMessage("Fugitive: Nothing to commit");
		}
	}));

	subscriptions.push(commands.registerCommand('fugitive.amend', async () => {
		console.debug('fugitive.amend');
		await provider!.git.repo.commit('', { useEditor: true, amend: true });
	}));
	subscriptions.push(commands.registerCommand('fugitive.amendNoEdit', async () => {
		console.debug('fugitive.amend');
		await provider!.git.repo.commit('', { amend: true });
	}));

	subscriptions.push(commands.registerCommand('fugitive.stash', async () => {
		console.debug('fugitive.stash');

		vscode.commands.executeCommand('git.stash', []).then((success) => {
			console.debug('success ', success);
		}, (rejected) => {
			console.debug('rejected ', rejected);
		});
	}));

	subscriptions.push(commands.registerCommand('fugitive.stashStaged', async () => {
		console.debug('fugitive.stashStaged');
		vscode.commands.executeCommand('git.stashStaged', []).then((success) => {
			console.debug('success ', success);
		}, (rejected) => {
			console.debug('rejected ', rejected);
		});
	}));

	subscriptions.push(commands.registerCommand('fugitive.popLatestStash', async () => {
		console.debug('fugitive.popStash');
		vscode.commands.executeCommand('git.stashPopLatest', []).then((success) => {
			console.debug('success ', success);
		}, (rejected) => {
			console.debug('rejected ', rejected);
		});
	}));

	subscriptions.push(commands.registerCommand('fugitive.popStash', async () => {
		console.debug('fugitive.popStash');
		vscode.commands.executeCommand('git.stashPop', []).then((success) => {
			console.debug('success ', success);
		}, (rejected) => {
			console.debug('rejected ', rejected);
		});
	}));

	subscriptions.push(commands.registerCommand('fugitive.checkoutBranch', async () => {
		console.debug('fugitive.checkoutBranch');
		vscode.commands.executeCommand('git.checkout', []).then((success) => {
			console.debug('success ', success);
		}, (rejected) => {
			console.debug('rejected ', rejected);
		});
	}));

	subscriptions.push(commands.registerCommand('fugitive.goUp', async () => {
		if (!window.activeTextEditor) {
			return;
		}
		const line = window.activeTextEditor!.selection.active.line;
		const newLine = Math.max(line - 1, 0);
		window.activeTextEditor!.selection =
			new vscode.Selection(new vscode.Position(newLine, 0), new vscode.Position(newLine, 0));
	}));

	subscriptions.push(commands.registerCommand('fugitive.goDown', async () => {
		if (!window.activeTextEditor) {
			return;
		}
		const lineCount = window.activeTextEditor.document.lineCount;
		const line = window.activeTextEditor!.selection.active.line;
		const newLine = Math.min(line + 1, lineCount - 1);
		window.activeTextEditor!.selection =
			new vscode.Selection(new vscode.Position(newLine, 0), new vscode.Position(newLine, 0));
	}));

	subscriptions.push(commands.registerCommand('fugitive.gitExclude', async () => {
		provider!.gitExclude(false);
	}));

	subscriptions.push(commands.registerCommand('fugitive.gitIgnore', async () => {
		provider!.gitExclude(true);
	}));

	subscriptions.push(commands.registerCommand('fugitive.goUntracked', async () => {
		console.debug('fugitive.goUnstaged');
		provider!.goUnstaged(false);
	}));

	subscriptions.push(commands.registerCommand('fugitive.goUnstaged', async () => {
		console.debug('fugitive.goUnstaged');
		provider!.goUnstaged(true);
	}));

	subscriptions.push(commands.registerCommand('fugitive.goUnpushed', async () => {
		console.debug('fugitive.goUnpushed');
		provider!.goUnpushed();
	}));

	subscriptions.push(commands.registerCommand('fugitive.goStaged', async () => {
		console.debug('fugitive.goUnstaged');
		provider!.goStaged();
	}));

	subscriptions.push(commands.registerCommand('fugitive.help', async () => {
		console.debug('fugitive.help');
		vscode.commands.executeCommand("extension.open", "hnrk-str.vscode-fugitive");
	}));

	subscriptions.push(commands.registerCommand('fugitive.close', async () => {
		console.debug('fugitive.close');
		vscode.commands.executeCommand('workbench.action.closeActiveEditor');
	}));
}

function _getTerminal(): vscode.Terminal {
	const query = vscode.window.terminals.filter(c => c.name === Provider.myScheme);
	const term: vscode.Terminal =
		query.length > 0 ?
			query[0]
			:
			vscode.window.createTerminal(Provider.myScheme);
	term.sendText("Ctrl+c");
	return term;
}


function getDependencies() {
	console.debug("checkForRepository");
	const gitExtension: GitExtension = vscode.extensions.getExtension('vscode.git')?.exports;
	if (!gitExtension || !gitExtension.enabled) {
		window.showWarningMessage('Fugitive: No git extension found or not enabled.');
		return null;
	}
	const api = gitExtension.getAPI(1);
	if (api.repositories.length === 0 && !api.repositories[0]?.state.HEAD?.name) {
		window.showWarningMessage('Fugitive: No git repository initialized');
		return null;
	}
	return { gitAPI: api };
}