import * as vscode from 'vscode';
import { window, workspace, commands, Uri, TextDocument } from 'vscode';
import { Provider } from './provider';

// see https://github.com/microsoft/vscode-extension-samples/blob/main/contentprovider-sample/locations-syntax.json
// for syntax highlighting
export function activate({ subscriptions }: vscode.ExtensionContext) {

	console.log('activate');
	// register a content provider for the fugitive-scheme
	const myProvider = new Provider();
	subscriptions.push(workspace.registerTextDocumentContentProvider(Provider.myScheme, myProvider));

	// register a command that opens a cowsay-document
	subscriptions.push(commands.registerCommand('fugitive.open', async () => {
		console.log('fugitive.open');
		const uri = Uri.parse('fugitive:Fugitive');
		const doc = await myProvider.getDocOrRefreshIfExists(uri);
		await window.showTextDocument(doc, { preview: false });
	}));

	// register a command that updates the current cowsay
	subscriptions.push(commands.registerCommand('fugitive.stage', async () => {
		console.log('fugitive.stage');
		if (!window.activeTextEditor) {
			return; // no editor
		}
		const { document } = window.activeTextEditor;
		if (document.uri.scheme !== Provider.myScheme) {
			return; // not my scheme
		}
		const loc = window.activeTextEditor.selection.active.line;
		console.log('loc ', loc);
		await myProvider.stageFile(loc);
		const doc = await myProvider.getDocOrRefreshIfExists(document.uri);
		await window.showTextDocument(doc, { preview: false });
	}));

	subscriptions.push(commands.registerCommand('fugitive.unstage', async () => {
		console.log('fugitive.unstage');
		const document = getDocument();
		if (!document) {
			return;
		}
		const loc = window.activeTextEditor!.selection.active.line;
		console.log('loc ', loc);
		await myProvider.unstageFile(loc);
		const doc = await myProvider.getDocOrRefreshIfExists(document.uri);
		await window.showTextDocument(doc, { preview: false });
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
		const doc = await myProvider.getDocOrRefreshIfExists(document.uri);
		await window.showTextDocument(doc, { preview: false });
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
		console.log('after');
		const doc = await myProvider.getDocOrRefreshIfExists(document.uri);
		await window.showTextDocument(doc, { preview: false });
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