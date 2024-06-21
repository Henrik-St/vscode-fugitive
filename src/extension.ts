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
		// const loc = window.activeTextEditor!.selection.active.line;
		const Oldloc = window.activeTextEditor!.selection.active;
		const loc = new vscode.Position(Oldloc.line, Oldloc.character);
		console.log('loc ', Oldloc.line);
		await myProvider.unstageFile(Oldloc.line);
		// window.activeTextEditor!.selection.active = loc;
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
		// const doc = await myProvider.getDocOrRefreshIfExists(document.uri);
		// await window.showTextDocument(doc, { preview: false });
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

	subscriptions.push(commands.registerCommand('fugitive.commit', async () => {
		console.log('fugitive.commit');
		const document = getDocument();
		if (!document) {
			return;
		}
		await myProvider.repo.commit('', { useEditor: true });
		// const doc = await myProvider.getDocOrRefreshIfExists(document.uri);
		// await window.showTextDocument(doc, { preview: false });
	}));

	subscriptions.push(commands.registerCommand('fugitive.goUnstaged', async () => {
		console.log('fugitive.goUnstaged');
		const document = getDocument();
		if (!document) {
			return;
		}
		myProvider.goUnstaged();
		// window.activeTextEditor!.selection = new vscode.Selection(new vscode.Position(5, 0), new vscode.Position(5, 0));
		// await myProvider.repo.commit('', { useEditor: true });
	}));

	subscriptions.push(commands.registerCommand('fugitive.goStaged', async () => {
		console.log('fugitive.goUnstaged');
		const document = getDocument();
		if (!document) {
			return;
		}
		myProvider.goStaged();
		// await myProvider.repo.commit('', { useEditor: true });
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