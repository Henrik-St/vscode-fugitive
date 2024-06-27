import * as vscode from 'vscode';
import { window, workspace, commands, Uri } from 'vscode';
import { Provider, checkForRepository } from './provider';

export function activate({ subscriptions }: vscode.ExtensionContext) {

	console.log('fugitive.activate');
	let provider: Provider | null = null;
	if (checkForRepository()) {
		provider = new Provider()
		subscriptions.push(workspace.registerTextDocumentContentProvider(Provider.myScheme, provider));
	}


	subscriptions.push(commands.registerCommand('fugitive.open', async () => {
		console.log('fugitive.open');
		if (!provider?.repo) {
			if (!checkForRepository()) {
				return;
			}
			provider = new Provider();
			subscriptions.push(workspace.registerTextDocumentContentProvider(Provider.myScheme, provider));
		}
		const uri = Uri.parse('fugitive:Fugitive');
		const doc = await provider.getDocOrRefreshIfExists(uri);
		await window.showTextDocument(doc, { preview: false });
	}));

	subscriptions.push(commands.registerCommand('fugitive.stage', async () => {
		console.log('fugitive.stage');
		await provider!.stageFile();
	}));

	subscriptions.push(commands.registerCommand('fugitive.unstage', async () => {
		console.log('fugitive.unstage');
		await provider!.unstageFile();
	}));

	subscriptions.push(commands.registerCommand('fugitive.toggle', async () => {
		console.log('fugitive.toggle');
		await provider!.toggle();
	}));

	subscriptions.push(commands.registerCommand('fugitive.unstageAll', async () => {
		console.log('fugitive.unstageAll');
		await provider!.unstageAll();
	}));

	subscriptions.push(commands.registerCommand('fugitive.clean', async () => {
		console.log('fugitive.clean');
		await provider!.cleanFile();
	}));

	subscriptions.push(commands.registerCommand('fugitive.openDiff', async () => {
		console.log('fugitive.openDiff');
		await provider!.openDiff();
	}));

	subscriptions.push(commands.registerCommand('fugitive.openFileSplit', async () => {
		console.log('fugitive.openFileSplit');
		await provider!.openFile(true);
	}));

	subscriptions.push(commands.registerCommand('fugitive.openFile', async () => {
		console.log('fugitive.openFile');
		await provider!.openFile(false);
	}));

	subscriptions.push(commands.registerCommand('fugitive.commit', async () => {
		console.log('fugitive.commit');
		if (provider!.repo.state.indexChanges.length > 0) {
			await provider!.repo.commit('', { useEditor: true });
		} else {
			window.showWarningMessage("Fugitive: Nothing to commit");
		}
	}));

	subscriptions.push(commands.registerCommand('fugitive.amend', async () => {
		console.log('fugitive.amend');
		await provider!.repo.commit('', { useEditor: true, amend: true });
	}));
	subscriptions.push(commands.registerCommand('fugitive.amendNoEdit', async () => {
		console.log('fugitive.amend');
		await provider!.repo.commit('', { amend: true });
	}));

	subscriptions.push(commands.registerCommand('fugitive.stash', async () => {
		console.log('fugitive.stash');

		vscode.commands.executeCommand('git.stash', []).then((success) => {
			console.debug('success ', success);
		}, (rejected) => {
			console.debug('rejected ', rejected);
		});
	}));

	subscriptions.push(commands.registerCommand('fugitive.stashStaged', async () => {
		console.log('fugitive.stashStaged');
		vscode.commands.executeCommand('git.stashStaged', []).then((success) => {
			console.debug('success ', success);
		}, (rejected) => {
			console.debug('rejected ', rejected);
		});
	}));

	subscriptions.push(commands.registerCommand('fugitive.popLatestStash', async () => {
		console.log('fugitive.popStash');
		vscode.commands.executeCommand('git.stashPopLatest', []).then((success) => {
			console.debug('success ', success);
		}, (rejected) => {
			console.debug('rejected ', rejected);
		});
	}));

	subscriptions.push(commands.registerCommand('fugitive.popStash', async () => {
		console.log('fugitive.popStash');
		vscode.commands.executeCommand('git.stashPop', []).then((success) => {
			console.debug('success ', success);
		}, (rejected) => {
			console.debug('rejected ', rejected);
		});
	}));

	subscriptions.push(commands.registerCommand('fugitive.checkoutBranch', async () => {
		console.log('fugitive.checkoutBranch');
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
		let lineCount = window.activeTextEditor.document.lineCount
		let line = window.activeTextEditor!.selection.active.line;
		let newLine = Math.max(line - 1, 0);
		window.activeTextEditor!.selection =
			new vscode.Selection(new vscode.Position(newLine, 0), new vscode.Position(newLine, 0));
	}));

	subscriptions.push(commands.registerCommand('fugitive.goDown', async () => {
		if (!window.activeTextEditor) {
			return;
		}
		let lineCount = window.activeTextEditor.document.lineCount
		let line = window.activeTextEditor!.selection.active.line;
		let newLine = Math.min(line + 1, lineCount - 1);
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
		console.log('fugitive.goUnstaged');
		provider!.goUnstaged(false);
	}));

	subscriptions.push(commands.registerCommand('fugitive.goUnstaged', async () => {
		console.log('fugitive.goUnstaged');
		provider!.goUnstaged(true);
	}));

	subscriptions.push(commands.registerCommand('fugitive.goUnpushed', async () => {
		console.log('fugitive.goUnpushed');
		provider!.goUnpushed();
	}));

	subscriptions.push(commands.registerCommand('fugitive.goStaged', async () => {
		console.log('fugitive.goUnstaged');
		provider!.goStaged();
	}));

	subscriptions.push(commands.registerCommand('fugitive.help', async () => {
		console.log('fugitive.help');
		vscode.commands.executeCommand("extension.open", "hnrk-str.vscode-fugitive");
	}));

	subscriptions.push(commands.registerCommand('fugitive.close', async () => {
		console.log('fugitive.close');
		vscode.commands.executeCommand('workbench.action.closeActiveEditor');
	}));
}
