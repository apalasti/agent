See where a thread's changes are before reading any patch.

## What you get

- A **Diff tree** tab in the thread's right panel (open it from the panel's new-tab
  actions, or with the **Diff tree: show this thread's changes** command, `⌘⇧D` when that
  shortcut is free). Folders show summed `+added −removed`; single-child chains are joined,
  so `frontend/src` is one row.
- Pick the scope: **Uncommitted**, **All changes vs** a base branch, or **Commits vs** a
  base branch, with a searchable branch picker. The choice is remembered per environment.
- Click a file to read its patch inline. Filter by path, expand or collapse everything.
- The tab refreshes while the agent works.
- A warning when bb capped the list at 500 files, which bb's own Diff tab does not show.
- `bb difftree`, the same tree as text for agents and terminals.

## How it works

Everything comes from bb's own environment diff API, so it works for worktrees, project
checkouts, and remote machines without running git itself. With no remembered choice, a
feature branch is compared with `origin/<default branch>` (or the local default branch),
and the default branch shows uncommitted changes. Nothing leaves the bb server.

## For agents

The bundled skill tells agents to run `bb difftree` for an overview of a thread's changes
before reviewing or summarizing them, and how to pick a base with `--base` and
`--committed`.
