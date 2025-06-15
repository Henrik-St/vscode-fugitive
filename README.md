# Fugitive for VS Code

This is a simple extension that adds a subset of the [fugitive plugin](https://github.com/tpope/vim-fugitive.git) to VS Code.

## Recommended Setup

This extension is meant to be used with the [vscodevim.vim](https://marketplace.visualstudio.com/items?itemName=vscodevim.vim) plugin.
You can register the fugitive.open as a vim mapping like the following in your settings.json:
```json
  "vim.normalModeKeyBindings": [
    {
      // Opens the Fugitive UI
      "before": [ "<Leader>", "g", "s" ],
      "commands": [ "fugitive.open" ]
    },
    ///...
  ]
```

## Keymaps
The following table shows the available keymaps.
Keymaps with an asterisk are done with a VS Code specific customization.
The default mappings assume QUERTZ as the keyboard layout. See below for how to configure different layouts.

| Command                   | Keymapping            | Description                                            |
| ------------------------- | --------------------- | ------------------------------------------------------ |
| fugitive.stage            | s                     | Stage (add) the file or hunk under the cursor.         |
| fugitive.unstage          | u                     | Unstage (reset) the file or hunk under the cursor.     |
| fugitive.toggleIndex      | -                     | Stage or unstage the file or hunk under the cursor.    |
| fugitive.unstageAll       | U                     | Unstage everything.                                    |
| fugitive.clean            | X                     | Discard the change under the cursor.                   |
| fugitive.toggleInlineDiff | shift+0 (QUERTZ: =)   | Toggle an inline diff on the file under the cursor.    |
| fugitive.openDiff         | d v                   | Opens the change under the cursor in a vertical split. |
| fugitive.commit           | c c                   | Create a commit.                                       |
| fugitive.amend            | c a                   | Amend the last commit and edit the message.            |
| fugitive.amendNoEdit      | c e                   | Amend the last commit without editing the message.     |
| fugitive.stash            | c z z                 | Push stash.                                            |
| fugitive.stashStaged      | c z s                 | Push stash of the stage.                               |
| fugitive.popLatestStash   | c z P                 | Pop topmost stash.                                     |
| fugitive.popStash*        | c z p                 | Pop a selected stash.                                  |
| fugitive.checkoutBranch*  | c o b                 | Checkout a selected branch.                            |
| fugitive.goUntracked      | g u                   | Jump to the Untracked / Unstaged section.              |
| fugitive.goUnstaged       | g U                   | Jump to the Unstaged section.                          |
| fugitive.goStaged         | g s                   | Jump to the Staged section.                            |
| fugitive.goUnpushed       | g p                   | Jump to the Unpushed section.                          |
| fugitive.gitExclude*      | g i                   | Open .git/info/exclude. Add the file under the cursor. |
| fugitive.gitIgnore*       | g I                   | Open .gitignore. Add the file under the cursor         |
| fugitive.openFile         | O                     | Open the file under the cursor in a new tab.           |
| fugitive.openFileSplit    | o                     | Open the file under the cursor in a new split.         |
| fugitive.previousHunk     | shift+8 (QUERTZ: '(') | Jump to the previous hunk.                             |
| fugitive.nextHunk         | shift+9 (QUERTZ: ')') | Jump to the next hunk.                                 |
| fugitive.help             | g h                   | Open the README of this extension                      |
| fugitive.close            | g q                   | Close Fugitive                                         |
| fugitive.refresh          | g r                   | Refresh the git status                                 |
| fugitive.setRepository    |                       | Switch between multiple subrepositories                |

Additionally, j/k are mapped to up/down in non vim mode.


## Using different keyboard layouts
To change the keymapping to i.e. QUERTY the following entry needs to be added to the keyboard.json

```
{
"command": "fugitive.toggleInlineDiff",
"key": "=",
"when": "(vim.mode == 'Normal' || !vim.mode) && resourceScheme == fugitive && editorTextFocus"
}
{
"command": "fugitive.previousHunk",
"key": "shift+9",
"when": "(vim.mode == 'Normal' || !vim.mode) && resourceScheme == fugitive && editorTextFocus"
}
{
"command": "fugitive.nextHunk",
"key": "shift+0",
"when": "(vim.mode == 'Normal' || !vim.mode) && resourceScheme == fugitive && editorTextFocus"
}
# ...
```

## Out of scope
1. At the moment the vim extension does not support registering custom commands.
Hence the Git statusline commands are not part of this scope.
If you are interested in this functionality, i have opened an issue on the vim extension github [here](https://github.com/VSCodeVim/Vim/issues/9103).
2. The vscode git api does not have first-class support for interactive rebasing.
Therefore, functionality relying on rebasing is not provided in this extension.