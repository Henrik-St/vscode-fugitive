# Feature Backlog (size)

- Deleting hunks with X (medium)
- Provide help (g?) as text document (small)
- collapse untracked files into folders (small)
- release to openvsx (small)
- provide older commit msgs in editor (medium)
- allow actions with selected ranges (medium)
- merge changes: use incoming use current (small)
- add hover over info (medium)

# Bug fixes:

- increase performance of tree view and long list of changes
- vscode.vim bindings with conflicting first letter (g*, c*) do not work anymore (large)
- cursor moves after opening commit message buffer (small)
- optimistic changes, dont wait for git refresh -> soften lock (large)

# Test Additions

| Command                   | Test Status | Description                                            |
| ------------------------- | ----------- | ------------------------------------------------------ |
| fugitive.stage            | Y           | Stage (add) the file or hunk under the cursor.         |
| fugitive.unstage          | Y           | Unstage (reset) the file or hunk under the cursor.     |
| fugitive.toggle           | Y           | Stage or unstage the file or hunk under the cursor.    |
| fugitive.unstageAll       | N           | Unstage everything.                                    |
| fugitive.clean            | N           | Discard the change under the cursor.                   |
| fugitive.toggleInlineDiff | Y           | Toggle an inline diff on the file under the cursor.    |
| fugitive.openDiff         | Y           | Opens the change under the cursor in a vertical split. |
| fugitive.commit           | N           | Create a commit.                                       |
| fugitive.amend            | N           | Amend the last commit and edit the message.            |
| fugitive.amendNoEdit      | N           | Amend the last commit without editing the message.     |
| fugitive.stash            | N           | Push stash.                                            |
| fugitive.stashStaged      | N           | Push stash of the stage.                               |
| fugitive.popLatestStash   | N           | Pop topmost stash.                                     |
| fugitive.popStash         | N           | Pop a selected stash.                                  |
| fugitive.checkoutBranch   | N           | Checkout a selected branch.                            |
| fugitive.goUntracked      | Y           | Jump to the Untracked / Unstaged section.              |
| fugitive.goUnstaged       | Y           | Jump to the Unstaged section.                          |
| fugitive.goStaged         | Y           | Jump to the Staged section.                            |
| fugitive.goUnpushed       | Y           | Jump to the Unpushed section.                          |
| fugitive.gitExclude       | N           | Open .git/info/exclude. Add the file under the cursor. |
| fugitive.gitIgnore        | Y           | Open .gitignore. Add the file under the cursor         |
| fugitive.openFile         | Y           | Open the file under the cursor in a new tab.           |
| fugitive.openFileSplit    | N           | Open the file under the cursor in a new split.         |
| fugitive.previousHunk     | Y           | Jump to the previous hunk.                             |
| fugitive.nextHunk         | Y           | Jump to the next hunk.                                 |
| fugitive.help             | N           | Open the README of this extension                      |
| fugitive.close            | Y           | Close Fugitive                                         |
| fugitive.refresh          | Y           | Refresh the git status                                 |
| fugitive.toggleView       | Y           | Toggle between the tree and list view                  |
| fugitive.toggleDirectory  | N           | Open/Close a directory fold in tree view               |
| fugitive.setRepository    | N           | Switch between multiple subrepositories                |
