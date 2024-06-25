import * as vscode from 'vscode';
import { window, workspace, commands, Uri, TextDocument } from 'vscode';
import { Provider, checkForRepository } from './provider';

// for syntax highlighting
// see https://github.com/microsoft/vscode-extension-samples/blob/main/contentprovider-sample/locations-syntax.json
export function activate({ subscriptions }: vscode.ExtensionContext) {

	console.log('activate');
	// register a content provider for the fugitive-scheme

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
		const line = await provider.getDocOrRefreshIfExists(uri);
		await window.showTextDocument(line, { preview: false });
	}));

	subscriptions.push(commands.registerCommand('fugitive.stage', async () => {
		console.log('fugitive.stage');
		const line = window.activeTextEditor!.selection.active.line;
		await provider!.stageFile(line);
	}));

	subscriptions.push(commands.registerCommand('fugitive.unstage', async () => {
		console.log('fugitive.unstage');
		const line = window.activeTextEditor!.selection.active.line;
		await provider!.unstageFile(line);
	}));

	subscriptions.push(commands.registerCommand('fugitive.toggle', async () => {
		console.log('fugitive.toggle');
		const line = window.activeTextEditor!.selection.active.line;
		await provider!.toggle(line);
	}));

	subscriptions.push(commands.registerCommand('fugitive.unstageAll', async () => {
		console.log('fugitive.unstageAll');
		await provider!.unstageAll();
	}));

	subscriptions.push(commands.registerCommand('fugitive.clean', async () => {
		console.log('fugitive.clean');
		const line = window.activeTextEditor!.selection.active.line;
		await provider!.cleanFile(line);
	}));

	subscriptions.push(commands.registerCommand('fugitive.openDiff', async () => {
		console.log('fugitive.openDiff');
		const line = window.activeTextEditor!.selection.active.line;
		await provider!.openDiff(line);
	}));

	subscriptions.push(commands.registerCommand('fugitive.openFileSplit', async () => {
		console.log('fugitive.openFileSplit');
		const line = window.activeTextEditor!.selection.active.line;
		await provider!.openFile(line, true);
	}));

	subscriptions.push(commands.registerCommand('fugitive.openFile', async () => {
		console.log('fugitive.openFile');
		const line = window.activeTextEditor!.selection.active.line;
		await provider!.openFile(line, false);
	}));

	subscriptions.push(commands.registerCommand('fugitive.commit', async () => {
		console.log('fugitive.commit');
		await provider!.repo.commit('', { useEditor: true });
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
