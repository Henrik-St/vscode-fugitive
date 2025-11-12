import * as vscode from "vscode";
import { window, workspace, commands } from "vscode";
import { Provider } from "./provider";
import { GitExtension } from "./vscode-git";
import { DiffProvider } from "./diff-provider";
import { GitWrapper } from "./git-wrapper";

//GLOBAL DEPENDENCIES
// eslint-disable-next-line @typescript-eslint/naming-convention
export let GIT: GitWrapper | null = null;
// eslint-disable-next-line @typescript-eslint/naming-convention
export const LOGGER: vscode.LogOutputChannel = vscode.window.createOutputChannel("Fugitive", { log: true });

export function activate({ subscriptions }: vscode.ExtensionContext): void {
    const add_subscription = (command: () => Promise<void>, name: string) => {
        subscriptions.push(
            commands.registerCommand(name, async () => {
                LOGGER.debug(name);
                try {
                    await command();
                } catch (error) {
                    LOGGER.debug("Error on ", name, ":", error);
                    vscode.window.showErrorMessage("Fugitive: Error on " + name);
                }
            })
        );
    };

    const thenable_to_promise = async <T>(thenable: Thenable<T>): Promise<T> => {
        return new Promise<T>((resolve, reject) => {
            thenable.then(
                (success) => resolve(success),
                (error) => reject(error)
            );
        });
    };

    LOGGER.debug("fugitive.activate");
    let provider: Provider | null = null;
    let diff_provider: DiffProvider | null = null;
    const dependencies = getDependencies();
    if (dependencies) {
        diff_provider = new DiffProvider();
        provider = new Provider();
        subscriptions.push(workspace.registerTextDocumentContentProvider(DiffProvider.scheme, diff_provider));
        subscriptions.push(workspace.registerTextDocumentContentProvider(Provider.myScheme, provider));
    }

    subscriptions.push(
        commands.registerCommand("fugitive.open", async () => {
            LOGGER.debug("fugitive.open");

            if (!provider) {
                const dependencies = getDependencies();
                if (!dependencies) {
                    return;
                }
                diff_provider = new DiffProvider();
                provider = new Provider();
                subscriptions.push(workspace.registerTextDocumentContentProvider(DiffProvider.scheme, diff_provider));
                subscriptions.push(workspace.registerTextDocumentContentProvider(Provider.myScheme, provider));
            }
            const current_doc_path = window.activeTextEditor?.document.uri.path || "";
            const fugitive_doc = await provider.getDocOrRefreshIfExists(current_doc_path);
            await window.showTextDocument(fugitive_doc, { preview: false });
        })
    );

    add_subscription(() => provider!.stageFile(), "fugitive.stage");
    add_subscription(() => provider!.unstageFile(), "fugitive.unstage");
    add_subscription(() => provider!.toggle(), "fugitive.toggle");
    add_subscription(() => provider!.unstageAll(), "fugitive.unstageAll");
    add_subscription(() => provider!.cleanFile(), "fugitive.clean");
    add_subscription(() => provider!.toggleInlineDiff(), "fugitive.toggleInlineDiff");
    add_subscription(() => provider!.openDiff(), "fugitive.openDiff");
    add_subscription(() => provider!.setRepository(), "fugitive.setRepo");
    add_subscription(() => provider!.commit(), "fugitive.commit");
    add_subscription(() => provider!.open(true), "fugitive.openFileSplit");
    add_subscription(() => provider!.open(false), "fugitive.openFile");
    add_subscription(() => provider!.git.repo.commit("", { useEditor: true, amend: true }), "fugitive.amend");
    add_subscription(() => provider!.git.repo.commit("", { amend: true }), "fugitive.amendNoEdit");
    add_subscription(() => provider!.gitExclude(false), "fugitive.gitExclude");
    add_subscription(() => provider!.gitExclude(true), "fugitive.gitIgnore");
    add_subscription(async () => provider!.refresh(), "fugitive.refresh");
    add_subscription(async () => provider!.toggleDirectory(), "fugitive.toggleDirectory");
    add_subscription(async () => provider!.goUp(), "fugitive.goUp");
    add_subscription(async () => provider!.goDown(), "fugitive.goDown");
    add_subscription(async () => provider!.goPreviousHunk(), "fugitive.previousHunk");
    add_subscription(async () => provider!.goNextHunk(), "fugitive.nextHunk");
    add_subscription(async () => provider!.goUnstaged(false), "fugitive.goUntracked");
    add_subscription(async () => provider!.goUnstaged(true), "fugitive.goUnstaged");
    add_subscription(async () => provider!.goUnpushed(), "fugitive.goUnpushed");
    add_subscription(async () => provider!.goStaged(), "fugitive.goStaged");
    add_subscription(async () => provider!.goTop(), "fugitive.goTop");
    add_subscription(
        () => thenable_to_promise(vscode.commands.executeCommand("extension.open", "hnrk-str.vscode-fugitive")),
        "fugitive.help"
    );
    add_subscription(
        () => thenable_to_promise(vscode.commands.executeCommand("workbench.action.closeActiveEditor")),
        "fugitive.close"
    );
    add_subscription(() => thenable_to_promise(vscode.commands.executeCommand("git.stash")), "fugitive.stash");
    add_subscription(
        () => thenable_to_promise(vscode.commands.executeCommand("git.stashStaged")),
        "fugitive.stashStaged"
    );
    add_subscription(
        () => thenable_to_promise(vscode.commands.executeCommand("git.stashPopLatest")),
        "fugitive.popLatestStash"
    );
    add_subscription(() => thenable_to_promise(vscode.commands.executeCommand("git.stashPop")), "fugitive.popStash");
    add_subscription(
        () => thenable_to_promise(vscode.commands.executeCommand("git.checkout")),
        "fugitive.checkoutBranch"
    );

    // Register toggleView command
    {
        const name = "fugitive.toggleView";
        subscriptions.push(
            commands.registerCommand(name, async (view_style?: "list" | "tree") => {
                LOGGER.debug(name);
                try {
                    await provider!.toggleView(view_style);
                } catch (error) {
                    LOGGER.debug("Error on ", name, ":", error);
                    vscode.window.showErrorMessage("Fugitive: Error on " + name);
                }
            })
        );
    }
}

function getDependencies(): boolean {
    LOGGER.debug("checkForRepository");
    const git_extension: GitExtension = vscode.extensions.getExtension("vscode.git")?.exports;
    if (!git_extension || !git_extension.enabled) {
        window.showWarningMessage("Fugitive: No git extension found or not enabled.");
        return false;
    }

    // Handle by UI to for smooth experience
    const api = git_extension.getAPI(1);
    if (api.repositories.length === 0 && !api.repositories[0]?.state.HEAD?.name) {
        window.showWarningMessage("Fugitive: No git repository initialized");
        return false;
    }
    GIT = new GitWrapper(api);
    return true;
}
