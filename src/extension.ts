import * as vscode from "vscode";
import { window, workspace, commands } from "vscode";
import { Provider } from "./provider";
import { GitExtension } from "./vscode-git";
import { DiffProvider } from "./diff-provider";
import { GitWrapper } from "./git-wrapper";
import { DiffViewProvider } from "./diffview-provider";
import { syncCursorWithView } from "./cursor";
import { ViewStyle } from "./configurations";

//GLOBAL DEPENDENCIES
export let GIT: GitWrapper | null = null;
export const LOGGER: vscode.LogOutputChannel = vscode.window.createOutputChannel("Fugitive", { log: true });

export function activate({ subscriptions }: vscode.ExtensionContext): void {
    let active_operation_count = 0;
    const operation_status = window.createStatusBarItem(vscode.StatusBarAlignment.Right, -100);
    operation_status.name = "Fugitive operations";
    subscriptions.push(operation_status);

    const update_operation_status = () => {
        if (active_operation_count === 0) {
            operation_status.hide();
            return;
        }
        operation_status.text = `$(sync~spin) ${active_operation_count}`;
        operation_status.tooltip = `Fugitive: ${active_operation_count} operation${
            active_operation_count === 1 ? "" : "s"
        } in progress`;
        operation_status.show();
    };

    const add_subscription = (command: () => Promise<void>, name: string) => {
        subscriptions.push(
            commands.registerCommand(name, async () => {
                LOGGER.debug(name);
                try {
                    await command();
                } catch (error) {
                    if (error instanceof Error) {
                        LOGGER.error("Error on ", name, ":", error.stack);
                        LOGGER.error("Please report this issue at https://github.com/Henrik-St/vscode-fugitive/issues");
                    } else {
                        LOGGER.error("Error on ", name, ":", error);
                        LOGGER.error("Please report this issue at https://github.com/Henrik-St/vscode-fugitive/issues");
                    }

                    vscode.window.showErrorMessage("Fugitive: Error on " + name);
                }
            })
        );
    };

    const add_mutation_subscription = (command: () => Promise<unknown>, name: string) => {
        add_subscription(async () => {
            active_operation_count++;
            update_operation_status();
            try {
                try {
                    await command();
                } finally {
                    const repo = provider?.git.repo;
                    if (repo) {
                        try {
                            await vscode.commands.executeCommand("git.refresh", repo.rootUri);
                        } finally {
                            await provider?.refresh();
                        }
                    }
                }
            } finally {
                active_operation_count--;
                update_operation_status();
            }
        }, name);
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
    let diffview_provider: DiffViewProvider | null = null;
    const dependencies = getDependencies();
    if (dependencies) {
        diff_provider = new DiffProvider();
        provider = new Provider();
        diffview_provider = new DiffViewProvider();
        subscriptions.push(workspace.registerTextDocumentContentProvider(DiffViewProvider.scheme, diffview_provider));
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

    add_mutation_subscription(() => provider!.stageFile(), "fugitive.stage");
    add_mutation_subscription(() => provider!.unstageFile(), "fugitive.unstage");
    add_mutation_subscription(() => provider!.toggle(), "fugitive.toggle");
    add_mutation_subscription(() => provider!.unstageAll(), "fugitive.unstageAll");
    add_mutation_subscription(() => provider!.cleanFile(), "fugitive.clean");
    add_subscription(() => provider!.toggleInlineDiff(), "fugitive.toggleInlineDiff");
    add_subscription(() => provider!.openDiff(), "fugitive.openDiff");
    add_subscription(() => provider!.setRepository(), "fugitive.setRepo");
    add_mutation_subscription(() => provider!.commit(), "fugitive.commit");
    add_subscription(() => provider!.open(true), "fugitive.openFileSplit");
    add_subscription(() => provider!.open(false), "fugitive.openFile");
    add_mutation_subscription(
        () => provider!.git.repo.commit("", { useEditor: true, amend: true }),
        "fugitive.amend"
    );
    add_mutation_subscription(() => provider!.git.repo.commit("", { amend: true }), "fugitive.amendNoEdit");
    add_mutation_subscription(() => provider!.gitExclude(false), "fugitive.gitExclude");
    add_mutation_subscription(() => provider!.gitExclude(true), "fugitive.gitIgnore");
    add_subscription(async () => {
        if (!provider) return;
        try {
            await vscode.commands.executeCommand("git.refresh", provider.git.repo.rootUri);
        } finally {
            await provider.refresh();
        }
    }, "fugitive.refresh");
    add_subscription(async () => provider!.toggleDirectory(), "fugitive.toggleDirectory");
    add_subscription(async () => diffview_provider!.toggleDirectory(), "fugitive.toggleDirectoryDiffView");
    add_subscription(async () => diffview_provider!.toggleInlineDiff(), "fugitive.toggleInlineDiffDiffView");
    add_subscription(async () => provider!.goUp(), "fugitive.goUp");
    add_subscription(async () => provider!.goDown(), "fugitive.goDown");
    add_subscription(async () => provider!.goPreviousHunk(), "fugitive.previousHunk");
    add_subscription(async () => provider!.goNextHunk(), "fugitive.nextHunk");
    add_subscription(async () => diffview_provider!.goPreviousHunk(), "fugitive.previousHunkDiffView");
    add_subscription(async () => diffview_provider!.goNextHunk(), "fugitive.nextHunkDiffView");
    add_subscription(async () => provider!.goUnstaged(false), "fugitive.goUntracked");
    add_subscription(async () => provider!.goUnstaged(true), "fugitive.goUnstaged");
    add_subscription(async () => provider!.goUnpushed(), "fugitive.goUnpushed");
    add_subscription(async () => provider!.goStaged(), "fugitive.goStaged");
    add_subscription(async () => syncCursorWithView(0), "fugitive.goTop");
    add_subscription(
        () => thenable_to_promise(vscode.commands.executeCommand("extension.open", "hnrk-str.vscode-fugitive")),
        "fugitive.help"
    );
    add_subscription(
        () => thenable_to_promise(vscode.commands.executeCommand("workbench.action.closeActiveEditor")),
        "fugitive.close"
    );
    add_mutation_subscription(() => thenable_to_promise(vscode.commands.executeCommand("git.stash")), "fugitive.stash");
    add_mutation_subscription(
        () => thenable_to_promise(vscode.commands.executeCommand("git.stashStaged")),
        "fugitive.stashStaged"
    );
    add_mutation_subscription(
        () => thenable_to_promise(vscode.commands.executeCommand("git.stashPopLatest")),
        "fugitive.popLatestStash"
    );
    add_mutation_subscription(() => thenable_to_promise(vscode.commands.executeCommand("git.stashPop")), "fugitive.popStash");
    add_mutation_subscription(
        () => thenable_to_promise(vscode.commands.executeCommand("git.checkout")),
        "fugitive.checkoutBranch"
    );
    add_subscription(async () => {
        if (!diffview_provider) {
            const dependencies = getDependencies();
            if (!dependencies) {
                return;
            }
            diffview_provider = new DiffViewProvider();
            subscriptions.push(
                workspace.registerTextDocumentContentProvider(DiffViewProvider.scheme, diffview_provider)
            );
        }
        await diffview_provider?.getDiffView();
    }, "fugitive.diffview");

    add_subscription(async () => {
        if (!diffview_provider) {
            const dependencies = getDependencies();
            if (!dependencies) {
                return;
            }
            diffview_provider = new DiffViewProvider();
            subscriptions.push(
                workspace.registerTextDocumentContentProvider(DiffViewProvider.scheme, diffview_provider)
            );
        }
        await diffview_provider?.getDiffViewChooseBranch();
    }, "fugitive.diffviewChooseBranch");
    add_subscription(async () => diffview_provider?.openFile(), "fugitive.diffviewOpenFile");

    // Register toggleView command
    {
        const name = "fugitive.toggleView";
        subscriptions.push(
            commands.registerCommand(name, async (view_style?: ViewStyle) => {
                LOGGER.debug(name);
                try {
                    const doc_scheme = window.activeTextEditor?.document.uri.scheme;
                    if (doc_scheme == DiffViewProvider.scheme) {
                        LOGGER.trace("Toggling DiffViewProvider view style");
                        await diffview_provider!.toggleView(view_style);
                        return;
                    } else if (doc_scheme == Provider.myScheme) {
                        LOGGER.trace("Toggling Provider view style");
                        await provider!.toggleView(view_style);
                        return;
                    }
                } catch (error) {
                    LOGGER.error("Error on ", name, ":", error);
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
