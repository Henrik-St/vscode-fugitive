import * as assert from 'assert';
import * as vscode from 'vscode';
import { execSync } from 'child_process';
import { cmdAtLine, wait, getDocument } from './test-utils';
import { goDown, goStaged, goTop, goUnstaged, goUp, refresh } from './movement';


const test_repo_path = vscode.workspace.workspaceFolders?.[0].uri.fsPath;

suite('Extension Test Suite', () => {
    suiteSetup(async function (){
        console.info('Running suiteSetup');
        execSync(`cd ${test_repo_path} && git reset && git checkout -- . && git clean -fd`);
        console.debug(`cd ${test_repo_path} && git reset && git checkout -- . && git clean -fd`);
        this.timeout(5000);
        const l = execSync(`touch ${test_repo_path}/untracked.txt`);
        console.debug("Touch:", l);
        const l2 = execSync(`touch ${test_repo_path}/untracked2.txt`);
        console.debug("Touch:", l2);
        const m = execSync(`echo change >> ${test_repo_path}/unstaged.txt`);
        console.debug("unstaged: ", m); 
        const n = execSync(`echo change >> ${test_repo_path}/staged.txt`);
        console.debug("staged:", n); 
        const o = execSync(`cd ${test_repo_path} && git add staged.txt`);
        console.debug("stage:", o); 
        await vscode.commands.executeCommand('fugitive.open');

    });
    suiteTeardown(function (){
        console.info('Running suiteTeardown');
        console.info('All tests done!');
    });

    const extension = vscode.extensions.getExtension('hnrk-str.vscode-fugitive');
    test('Extension is loaded', () => {
        assert.ok(extension, 'Extension hnrk-str.vscode-fugitive is not loaded');
    });

    test('Go to Untracked', );
    test('Go to Unstaged',goUnstaged);
    test('Go to Staged', goStaged);
    test('Go up', goUp);
    test('Go down', goDown);
    test('Go top', goTop);
    test('Refresh', refresh);

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
        assert_line(9, unstaged);
        assert_line(12, staged);
        
        console.debug("-------check cursor behavior-----");
        await cmdAtLine(6, 'fugitive.stage');
        await wait(1000);
        assert.strictEqual(
            vscode.window.activeTextEditor?.selection.active.line, 
            5, 
            "Cursor stays at line 5 when there are still unstaged items"
        );
        await wait(1000);
        assert_line(13, staged);
        
        assert_line(9, untracked_staged);
        await cmdAtLine(9, 'fugitive.clean');
        await wait(1000);
        assert.strictEqual(
            vscode.window.activeTextEditor?.selection.active.line, 
            5, 
            "Cursor goes from staged to unstaged"
        );
        
    });
    
});