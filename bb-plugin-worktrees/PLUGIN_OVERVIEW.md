Run each agent task on its own branch, in its own git worktree, and see those worktrees
in the sidebar with the threads working in them.

## What you get

- A **Worktrees** sidebar thread list: projects, then every git worktree of the project
  (including ones created outside bb), then their threads. Rows show uncommitted changes,
  ahead/behind counts, and how much `.scratch` work is ready to run.
- A **New task** dialog that creates a worktree on a new branch and starts the thread in
  it, using bb's own prompt, provider and model pickers.
- A **Remove worktree** dialog that archives the threads, runs your teardown command, and
  removes the worktree and optionally its branch.
- A **Workflow** dialog for `.scratch` maps and issues: run a ready ticket, orchestrate a
  batch of issues, chart a new map, or hand a finished map off.
- Per-project settings: default base ref, an overlay of agent files copied or linked into
  each new worktree, setup and teardown commands, and `git gtr` or plain `git worktree`.

## For agents

The bundled skill documents `bb task`: `bb task new <branch> "<prompt>"` starts a task in a
fresh worktree, `bb task list` shows worktrees and their threads, `bb task rm` cleans one
up, and `bb task scratch | run | orchestrate | chart | handoff` drive the `.scratch`
workflow from a thread.

## How it works

Everything runs on this machine with `git` (and `git gtr` when installed). Worktrees are
never deleted implicitly: archiving a thread leaves its worktree, and removal is always an
explicit action.
