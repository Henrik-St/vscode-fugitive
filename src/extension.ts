import * as vscode from 'vscode';
import { window, workspace, commands, Uri, TextDocument } from 'vscode';
import { Provider } from './provider';

// for syntax highlighting
// see https://github.com/microsoft/vscode-extension-samples/blob/main/contentprovider-sample/locations-syntax.json
export function activate({ subscriptions }: vscode.ExtensionContext) {

	console.log('activate');
	// register a content provider for the fugitive-scheme
	const myProvider = new Provider();
	subscriptions.push(workspace.registerTextDocumentContentProvider(Provider.myScheme, myProvider));

	subscriptions.push(commands.registerCommand('fugitive.open', async () => {
		console.log('fugitive.open');
		const uri = Uri.parse('fugitive:Fugitive');
		const doc = await myProvider.getDocOrRefreshIfExists(uri);
		await window.showTextDocument(doc, { preview: false });
	}));

	subscriptions.push(commands.registerCommand('fugitive.stage', async () => {
		console.log('fugitive.stage');
		const document = getDocument();
		if (!document) {
			return;
		}
		const loc = window.activeTextEditor!.selection.active.line;
		console.log('loc ', loc);
		await myProvider.stageFile(loc);
	}));

	subscriptions.push(commands.registerCommand('fugitive.unstage', async () => {
		console.log('fugitive.unstage');
		const document = getDocument();
		if (!document) {
			return;
		}
		const Oldloc = window.activeTextEditor!.selection.active;
		await myProvider.unstageFile(Oldloc.line);
	}));
	subscriptions.push(commands.registerCommand('fugitive.unstageAll', async () => {
		console.log('fugitive.unstageAll');
		const document = getDocument();
		if (!document) {
			return;
		}
		const loc = window.activeTextEditor!.selection.active.line;
		await myProvider.unstageAll();
	}));

	subscriptions.push(commands.registerCommand('fugitive.clean', async () => {
		console.log('fugitive.clean');
		const document = getDocument();
		if (!document) {
			return;
		}
		const loc = window.activeTextEditor!.selection.active.line;
		console.log('loc ', loc);
		await myProvider.cleanFile(loc);
	}));

	subscriptions.push(commands.registerCommand('fugitive.openDiff', async () => {
		console.log('fugitive.openDiff');
		const document = getDocument();
		if (!document) {
			return;
		}
		const loc = window.activeTextEditor!.selection.active.line;
		console.log('loc ', loc);
		await myProvider.openDiff(loc);
	}));

	subscriptions.push(commands.registerCommand('fugitive.openFileSplit', async () => {
		console.log('fugitive.openFileSplit');
		const document = getDocument();
		if (!document) {
			return;
		}
		const loc = window.activeTextEditor!.selection.active.line;
		console.log('loc ', loc);
		await myProvider.openFile(loc, true);
	}));

	subscriptions.push(commands.registerCommand('fugitive.openFile', async () => {
		console.log('fugitive.openFile');
		const document = getDocument();
		if (!document) {
			return;
		}
		const loc = window.activeTextEditor!.selection.active.line;
		console.log('loc ', loc);
		await myProvider.openFile(loc, false);
	}));

	subscriptions.push(commands.registerCommand('fugitive.commit', async () => {
		console.log('fugitive.commit');
		const document = getDocument();
		if (!document) {
			return;
		}
		await myProvider.repo.commit('', { useEditor: true });
	}));

	subscriptions.push(commands.registerCommand('fugitive.amend', async () => {
		console.log('fugitive.amend');
		const document = getDocument();
		if (!document) {
			return;
		}
		await myProvider.repo.commit('', { useEditor: true, amend: true });
	}));
	subscriptions.push(commands.registerCommand('fugitive.amendNoEdit', async () => {
		console.log('fugitive.amend');
		const document = getDocument();
		if (!document) {
			return;
		}
		await myProvider.repo.commit('', { amend: true });
	}));

	subscriptions.push(commands.registerCommand('fugitive.stash', async () => {
		console.log('fugitive.stash');
		const document = getDocument();
		if (!document) {
			return;
		}
		vscode.commands.executeCommand('git.stash', []).then((success) => {
			console.debug('success ', success);
		}, (rejected) => {
			console.debug('rejected ', rejected);
		});
	}));

	subscriptions.push(commands.registerCommand('fugitive.stashStaged', async () => {
		console.log('fugitive.stashStaged');
		const document = getDocument();
		if (!document) {
			return;
		}
		vscode.commands.executeCommand('git.stashStaged', []).then((success) => {
			console.debug('success ', success);
		}, (rejected) => {
			console.debug('rejected ', rejected);
		});
	}));

	subscriptions.push(commands.registerCommand('fugitive.popLatestStash', async () => {
		console.log('fugitive.popStash');
		const document = getDocument();
		if (!document) {
			return;
		}
		vscode.commands.executeCommand('git.stashPopLatest', []).then((success) => {
			console.debug('success ', success);
		}, (rejected) => {
			console.debug('rejected ', rejected);
		});
	}));

	subscriptions.push(commands.registerCommand('fugitive.popStash', async () => {
		console.log('fugitive.popStash');
		const document = getDocument();
		if (!document) {
			return;
		}
		vscode.commands.executeCommand('git.stashPop', []).then((success) => {
			console.debug('success ', success);
		}, (rejected) => {
			console.debug('rejected ', rejected);
		});
	}));

	subscriptions.push(commands.registerCommand('fugitive.goUnstaged', async () => {
		console.log('fugitive.goUnstaged');
		const document = getDocument();
		if (!document) {
			return;
		}
		myProvider.goUnstaged();
	}));

	subscriptions.push(commands.registerCommand('fugitive.goUnpushed', async () => {
		console.log('fugitive.goUnpushed');
		const document = getDocument();
		if (!document) {
			return;
		}
		myProvider.goUnpushed();
	}));

	subscriptions.push(commands.registerCommand('fugitive.goStaged', async () => {
		console.log('fugitive.goUnstaged');
		const document = getDocument();
		if (!document) {
			return;
		}
		myProvider.goStaged();
	}));

	subscriptions.push(commands.registerCommand('fugitive.help', async () => {
		console.log('fugitive.help');
		vscode.commands.executeCommand("extension.open", "hnrk-str.vscode-fugitive");
	}));
}

function getDocument(): TextDocument | undefined {
	const editor = window.activeTextEditor;
	if (!editor) {
		return;
	}
	const document = editor.document;
	if (document.uri.scheme !== Provider.myScheme) {
		return;
	}
	return document;
}