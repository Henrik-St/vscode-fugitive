import * as vscode from 'vscode';
import { Provider } from './provider';

// see https://github.com/microsoft/vscode-extension-samples/blob/main/contentprovider-sample/locations-syntax.json
// for syntax highlighting
export function activate({ subscriptions }: vscode.ExtensionContext) {

	console.log('activate');
	// register a content provider for the fugitive-scheme
	const myProvider = new Provider();
	subscriptions.push(vscode.workspace.registerTextDocumentContentProvider(Provider.myScheme, myProvider));

	// register a command that opens a cowsay-document
	subscriptions.push(vscode.commands.registerCommand('fugitive.open', async () => {
		console.log('fugitive.open');
		const uri = vscode.Uri.parse('fugitive:fugitive');
		const doc = await myProvider.getDocOrRefreshIfExists(uri);
		await vscode.window.showTextDocument(doc, { preview: false });
	}));

	// register a command that updates the current cowsay
	subscriptions.push(vscode.commands.registerCommand('fugitive.stage', async () => {
		console.log('fugitive.stage');
		if (!vscode.window.activeTextEditor) {
			return; // no editor
		}
		const { document } = vscode.window.activeTextEditor;
		if (document.uri.scheme !== Provider.myScheme) {
			return; // not my scheme
		}
		// get location of the cursor
		const loc = vscode.window.activeTextEditor.selection.active.line;
		console.log('loc ', loc);
		await myProvider.stageFile(loc);
		// get path-components, reverse it, and create a new uri
		const doc = await myProvider.getDocOrRefreshIfExists(document.uri);
		await vscode.window.showTextDocument(doc, { preview: false });
	}));

	subscriptions.push(vscode.commands.registerCommand('fugitive.unstage', async () => {
		console.log('fugitive.unstage');
		if (!vscode.window.activeTextEditor) {
			return; // no editor
		}
		const { document } = vscode.window.activeTextEditor;
		if (document.uri.scheme !== Provider.myScheme) {
			return; // not my scheme
		}
		// get location of the cursor
		const loc = vscode.window.activeTextEditor.selection.active.line;
		console.log('loc ', loc);
		await myProvider.unstageFile(loc);
		// get path-components, reverse it, and create a new uri
		const doc = await myProvider.getDocOrRefreshIfExists(document.uri);
		await vscode.window.showTextDocument(doc, { preview: false });
	}));

	subscriptions.push(vscode.commands.registerCommand('fugitive.commit', async () => {
		console.log('fugitive.commit');
		if (!vscode.window.activeTextEditor) {
			return; // no editor
		}
		const { document } = vscode.window.activeTextEditor;
		if (document.uri.scheme !== Provider.myScheme) {
			return; // not my scheme
		}
		await myProvider.repo.commit('', { useEditor: true });
		console.log('after');
		const doc = await myProvider.getDocOrRefreshIfExists(document.uri);
		await vscode.window.showTextDocument(doc, { preview: false });
	}));
}

