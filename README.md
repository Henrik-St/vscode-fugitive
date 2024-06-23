# Fugitive for VS Code

This extension ports the [Fugitive](https://github.com/tpope/vim-fugitive.git) plugin for vim/neovim to VS Code.

## Recommended extensions.

This extension is meant to be used with the [vscodevim.vim](https://marketplace.visualstudio.com/items?itemName=vscodevim.vim) plugin.

## Keymaps
There are keymaps for and without the vim plugin:
```json
{
    "command": "fugitive.stage",
    "key": "s",
}, {
    "command": "fugitive.unstage",
    "key": "u",
}, {
    "command": "fugitive.unstageAll",
    "key": "shift+u",
}, {
    "command": "fugitive.clean",
    "key": "shift+x",
}, {
    "command": "fugitive.openDiff",
    "key": "d v",
}, {
    "command": "fugitive.commit",
    "key": "c c",
}, {
    "command": "fugitive.amend",
    "key": "c a",
}, {
    "command": "fugitive.amendNoEdit",
    "key": "c e",
}, {
    "command": "fugitive.stash",
    "key": "c z z",
}, {
    "command": "fugitive.stashStaged",
    "key": "c z s",
}, {
    "command": "fugitive.popLatestStash",
    "key": "c z shift+p",
}, {
    "command": "fugitive.popStash",
    "key": "c z p",
}, {
    "command": "fugitive.goUnstaged",
    "key": "g u",
}, {
    "command": "fugitive.goStaged",
    "key": "g s",
}, {
    "command": "fugitive.goUnpushed",
    "key": "g p",
}, {
    "command": "fugitive.openFile",
    "key": "shift+o",
}, {
    "command": "fugitive.openFileSplit",
    "key": "o",
}, {
    "command": "fugitive.help",
    "key": "g shift+oem_4",
}

```

## Current scope
The current scope of this plugin contains only the status buffer maps from the fugitive plugin.
The Git command functionality is not currently planned.

## Out of scope
The vscode git api does not support rebasing.
Therefore, functionality relying on rebasing is not supported.