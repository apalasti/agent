# bb-plugin-worktrees

A bb plugin (id `worktrees`) that makes git worktrees a level of the sidebar —
`Project → Worktree → Thread` — and starts agent tasks in fresh worktrees. It ports the
`task.sh` / `delete-worktree.sh` workflow, and the pi `/wayfinder` and `/orchestrate`
commands, into bb. [DESIGN.md](DESIGN.md) is the source of truth for behaviour and files.

## Surfaces

- **Worktrees thread list** — pick "Worktrees" as the sidebar thread list. Every
  `git worktree` of each project is a row (main checkout first, idle ones folded), with
  dirty/ahead/behind status and a badge counting runnable `.scratch` work. Rows have
  `+` (new thread in this worktree) and a `⋯` menu (copy path/branch, Remove).
- **New task dialog** (project row `+`) — branch, base ref, and bb's own composer; the
  thread starts in a new worktree created by the `task-worktree` environment provider.
- **Task worktree environment provider** — the same thing from bb's ordinary composer.
- **Remove worktree dialog** — archives the worktree's threads, runs the teardown
  command, removes the worktree, optionally deletes the branch.
- **Tasks panel** (a "Tasks" tab in a thread's side panel) — the `.scratch` efforts of the
  worktree the open thread belongs to: tickets grouped Running / Ready / Blocked / Done
  (Done collapsed), a one-button issue batch (Orchestrate), a hand-off section, and
  "Chart a new map". Tickets and batches with a live thread show **Open**; ⌘-click starts
  without leaving. It refreshes every 5s. A **Tasks** button in each worktree thread's
  header shows the runnable count and opens the tab. Replaces the old Workflow dialog.
- **Per-project settings** (the plugin's settings page, or project `⋯` → Worktree settings…) — base ref, overlay
  dir, setup and teardown commands, worktree tool (auto / gtr / git).

## `bb task`

```
bb task new <branch> [prompt] [--from <ref>] [--prompt-stdin | --prompt-file <path>]
bb task list | rm <branch|path> [--delete-branch] [--force]
bb task config [--base <ref>] [--overlay <dir>] [--setup <cmd>] [--teardown <cmd>] [--tool auto|gtr|git]
bb task scratch | run <effort>/<NN> | orchestrate <effort> [NN ...] | chart "<idea>" | handoff <effort>  [--path]
```

Every command takes `--project <id|name>` and `--json`. Agents learn it from
[skills/worktrees/SKILL.md](skills/worktrees/SKILL.md).

## Develop

```
npm install
npm test                       # vitest
npx tsc --noEmit
bb plugin build                # writes dist/
bb plugin install .            # once
bb plugin reload worktrees     # after a build
bb plugin dev                  # or: rebuild + reload on every save
```

The plugin setting `templatesDir` (default `~/fun/agent/extensions`) points at the pi
prompt templates the Tasks panel fills in.
