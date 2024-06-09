# Fugitive for VS Code

This extension ports the [Fugitive](https://github.com/tpope/vim-fugitive.git) plugin for vim/neovim to VS Code.

## Recommended extensions.

This extension is meant to be used with the [vscodevim.vim](https://marketplace.visualstudio.com/items?itemName=vscodevim.vim) plugin.

## Keymaps
There are keymaps for and without the vim plugin:
```json
    {
        "command": "fugitive.stage",
        "key": "s", "mac": "s",
        "when": "vim.mode == 'Normal' && resourceScheme == fugitive"
    }, {
        "command": "fugitive.stage",
        "key": "ctrl+s", "mac": "cmd+s",
        "when": "!vim.mode && resourceScheme == fugitive"
    }, {
        "command": "fugitive.unstage",
        "key": "u", "mac": "u",
        "when": "vim.mode == 'Normal' && resourceScheme == fugitive"
    }, {
        "command": "fugitive.unstage",
        "key": "ctrl+s", "mac": "cmd+s",
        "when": "!vim.mode && resourceScheme == fugitive"
    }, {
        "command": "fugitive.clean",
        "key": "shift+x", "mac": "shift+x",
        "when": "vim.mode == 'Normal' && resourceScheme == fugitive"
    }, {
        "command": "fugitive.clean",
        "key": "ctrl+x", "mac": "cmd+x",
        "when": "!vim.mode && resourceScheme == fugitive"
    }, {
        "command": "fugitive.openDiff",
        "key": "d v", "mac": "cmd+d",
        "when": "vim.mode == 'Normal' && resourceScheme == fugitive"
    }, {
        "command": "fugitive.openDiff",
        "key": "ctrl+d", "mac": "cmd+d",
        "when": "!vim.mode && resourceScheme == fugitive"
    }, {
        "command": "fugitive.commit",
        "key": "c c", "mac": "c c",
        "when": "vim.mode == 'Normal' && resourceScheme == fugitive"
    }, {
        "command": "fugitive.commit",
        "key": "ctrl+c", "mac": "cmd+c",
        "when": "!vim.mode && resourceScheme == fugitive"
    }

```

## WIP

This extension is still a work in progress.
Many of the original fugitive plugins' functionality is not yet implemented.