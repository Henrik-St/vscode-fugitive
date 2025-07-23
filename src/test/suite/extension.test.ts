import * as assert from 'assert';

import * as vscode from 'vscode';
import { execSync } from 'child_process';

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

async function getDocument(): Promise<vscode.TextDocument> {
        console.debug('fugitive.open executed');
        const editor = vscode.window.activeTextEditor;
        assert.ok(editor, 'No active text editor after executing fugitive.open command');
        assert.strictEqual(editor.document.uri.toString(), 'fugitive:Fugitive', 'Active text editor does not have the expected URI');
        return editor.document;
}

const test_repo_path = vscode.workspace.workspaceFolders?.[0].uri.fsPath;

suite('Extension Test Suite', () => {
    suiteSetup(async function (){
        console.info('Running suiteSetup');
        this.timeout(5000);
        const l = execSync(`touch ${test_repo_path}/untracked.txt`);
        console.debug("Touch:", l);
        const m = execSync(`echo change >> ${test_repo_path}/unstaged.txt`);
        console.debug("unstaged: ", m); 
        const n = execSync(`echo change >> ${test_repo_path}/staged.txt`);
        console.debug("staged:", n); 
        await vscode.commands.executeCommand('fugitive.open');

    });
    suiteTeardown(function (){
        console.info('Running suiteTeardown');
        execSync(`cd ${test_repo_path} && git reset && git checkout -- . && git clean -fd`);
        console.debug(`cd ${test_repo_path} && git reset && git checkout -- . && git clean -fd`);
        console.info('All tests done!');
    });

    const extension = vscode.extensions.getExtension('hnrk-str.vscode-fugitive');
    test('Extension is loaded', () => {
        assert.ok(extension, 'Extension hnrk-str.vscode-fugitive is not loaded');
    });

    test('Check status contents', async function () {
        this.timeout(10_000);
        const document = await getDocument();
        const assert_line = (line: number, expected_text: string) => {
            const line_text = document.lineAt(line).text;
            assert.strictEqual(line_text, expected_text, `Line ${line} does not contain expected text`);
        };
        console.debug("-------check initial document contents-----");
        const untracked =  'U untracked.txt';
        const untracked_staged =  'A untracked.txt';
        const unstaged = 'M unstaged.txt';
        const staged = 'M staged.txt';
        assert_line(5, untracked);
        assert_line(8, staged);
        assert_line(9, unstaged);
        
        console.debug("-------check cursor behavior-----");
        await cmdAtLine(5, 'fugitive.stage');
        assert.strictEqual(
            vscode.window.activeTextEditor?.selection.active.line, 
            5, 
            "Cursor stays at line 5 when there are still unstaged items"
        );
        await wait(1000);
        assert_line(5, staged);
        
        assert_line(9, untracked_staged);
        await cmdAtLine(9, 'fugitive.clean');
        await wait(3000);
        assert.strictEqual(
            vscode.window.activeTextEditor?.selection.active.line, 
            5, 
            "Cursor goes from staged to unstaged"
        );
        
    });

    test('Go to Unstaged', async function() {
        const document = await getDocument();
        await cmdAtLine(10, 'fugitive.goUnstaged');
        assert(
            vscode.window.activeTextEditor?.selection.active.line,
            "No active cursor"
        );
        const text = document.lineAt(
            vscode.window.activeTextEditor?.selection.active.line, 
        ).text;
        console.debug(text);
        assert.match(
            text,
            /Unstaged.*/
        );
    });
    
});