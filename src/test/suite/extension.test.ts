import * as assert from 'assert';

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
import * as vscode from 'vscode';
import { exec } from 'child_process';

function wait(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}


function setLine(line: number) {
    if (line < 0) {
        throw new Error('Line number must be non-negative');
    }
    vscode.window.activeTextEditor!.selection =
        new vscode.Selection(new vscode.Position(line, 0), new vscode.Position(line, 0));
}

function cmdAtLine(line: number, command: string) {
    setLine(line);
    return vscode.commands.executeCommand(command);
}

suite('Extension Test Suite', () => {
    suiteSetup(() => {
        console.log('Running suiteSetup');
        // get directory of test-repo
        const testRepoPath = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
        exec(`touch ${testRepoPath}/untracked.txt`, (error, stdout, stderr) => {
            console.log(error, stdout, stderr); 
        });
        exec(`echo change >> ${testRepoPath}/unstaged.txt`, (error, stdout, stderr) => {
            console.log(error, stdout, stderr); 
        });
        exec(`echo change >> ${testRepoPath}/staged.txt`, (error, stdout, stderr) => {
            console.log(error, stdout, stderr); 
        });
    });
    suiteTeardown(() => {
        vscode.commands.executeCommand('');
        console.log('Running suiteTeardown');
        // get directory of test-repo
        console.log('test-repo git reset executed');
        const testRepoPath = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
        console.log(`cd ${testRepoPath} && git reset && git checkout -- . && git clean -fd`);
        exec(`cd ${testRepoPath} && git reset && git checkout -- . && git clean -fd`, (error, stdout, stderr) => {
            console.log(error);
            console.log(stdout);
            console.log(stderr);
        });
        vscode.window.showInformationMessage('All tests done!');
    });

	vscode.window.showInformationMessage('Start all tests.');
    const extension = vscode.extensions.getExtension('hnrk-str.vscode-fugitive');
    test('Extension is loaded', () => {
        assert.ok(extension, 'Extension hnrk-str.vscode-fugitive is not loaded');
    });

    test('Check status contents', async () => {
        await vscode.commands.executeCommand('fugitive.open');
        console.debug('fugitive.open executed');
        // get string of line 6
        const editor = vscode.window.activeTextEditor;
        assert.ok(editor, 'No active text editor after executing fugitive.open command');
        assert.strictEqual(editor.document.uri.toString(), 'fugitive:Fugitive', 'Active text editor does not have the expected URI');
        const document = editor.document;
        const assertLine = (line: number, expectedText: string) => {
            const lineText = document.lineAt(line).text;
            assert.strictEqual(lineText, expectedText, `Line ${line} does not contain expected text`);
        };
        console.debug("-------check initial document contents-----");
        const untracked =  'U untracked.txt';
        const untracked_staged =  'A untracked.txt';
        const unstaged = 'M unstaged.txt';
        const staged = 'M staged.txt';
        assertLine(5, untracked);
        assertLine(8, staged);
        assertLine(9, unstaged);
        
        console.debug("-------check cursor behavior-----");
        await cmdAtLine(5, 'fugitive.stage');
        assert.strictEqual(
            vscode.window.activeTextEditor?.selection.active.line, 
            5, 
            "Cursor stays at line 5 when there are still unstaged items"
        );
        await wait(1000);
        assertLine(5, staged);
        
        assertLine(9, untracked_staged);
        await cmdAtLine(9, 'fugitive.clean');
        await wait(3000);
        assert.strictEqual(
            vscode.window.activeTextEditor?.selection.active.line, 
            5, 
            "Cursor goes from staged to unstaged"
        );
    }).timeout(100000);
    
});