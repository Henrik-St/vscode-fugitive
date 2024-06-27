# Fugitive for VS Code

This extension ports the [Fugitive](https://github.com/tpope/vim-fugitive.git) plugin for vim/neovim to VS Code.

## Recommended extensions.

This extension is meant to be used with the [vscodevim.vim](https://marketplace.visualstudio.com/items?itemName=vscodevim.vim) plugin.

## Keymaps
The following table shows available keymaps.
Keymaps with an asterisk are done with a VS Code specific customization.

| Command                 | Keymapping | Description                                            |
| ----------------------- | ---------- | ------------------------------------------------------ |
| fugitive.stage          | s          | Stage (add) the file or hunk under the cursor.         |
| fugitive.unstage        | u          | Unstage (reset) the file or hunk under the cursor.     |
| fugitive.toggleIndex    | -          | Stage or unstage the file or hunk under the cursor.    |
| fugitive.unstageAll     | U          | Unstage everything.                                    |
| fugitive.clean          | X          | Discard the change under the cursor.                   |
| fugitive.openDiff       | d v        | Opens the change under the cursor in a vertical split. |
| fugitive.commit         | c c        | Create a commit.                                       |
| fugitive.amend          | c a        | Amend the last commit and edit the message.            |
| fugitive.amendNoEdit    | c e        | Amend the last commit without editing the message.     |
| fugitive.stash          | c z z      | Push stash.                                            |
| fugitive.stashStaged    | c z s      | Push stash of the stage.                               |
| fugitive.popLatestStash | c z P      | Pop topmost stash.                                     |
| fugitive.popStash*      | c z p      | Pop a selected stash.                                  |
| fugitive.goUntracked    | g u        | Jump to the Untracked / Unstaged section.              |
| fugitive.goUnstaged     | g U        | Jump to the Unstaged section.                          |
| fugitive.goStaged       | g s        | Jump to the Staged section.                            |
| fugitive.goUnpushed     | g p        | Jump to the Unpushed section.                          |
| fugitive.openFile       | O          | Open the file under the cursor in a new tab.           |
| fugitive.openFileSplit  | o          | Open the file under the cursor in a new split.         |
| fugitive.help           | g ?        | Open the README of this extension                      |
| fugitive.close          | g q        | Close Fugitive                                         |


## Current scope
The current scope of this plugin contains only the status buffer maps from the fugitive plugin.
The Git command functionality is not currently planned.

## Out of scope
The vscode git api does not support interactive rebasing.
Therefore, functionality relying on rebasing is not supported.