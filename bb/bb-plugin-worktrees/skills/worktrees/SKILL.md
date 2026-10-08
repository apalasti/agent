---
name: worktrees
description: Start agent tasks in fresh git worktrees and manage those worktrees with `bb task`, and drive a worktree's `.scratch/` workflow (wayfinder map tickets, issue batches, charting, handoff) as bb threads. Use when asked to spin off a task on its own branch, hand work to a parallel agent, list worktrees and their threads, remove a finished worktree, change a project's base ref, overlay, setup or teardown command, or run a wayfinder ticket / orchestrate issues / chart a map in bb (where pi's /wayfinder and /orchestrate cannot prompt).
---

# Worktrees (`bb task`)

`bb task` runs on the bb server. `--project` takes a project id or name and defaults to the
project of the thread you run it from. Every command accepts `--json`; `--help` works at
every level.

## Start a task

```
bb task new <branch> "<prompt>" [--from <ref>] [--title <title>]
bb task new <branch> --prompt-stdin < prompt.md
bb task new <branch> --prompt-file /abs/path/prompt.md
```

Prints the new thread id on the first line and returns at once. The worktree is created
afterwards by the "Task worktree" environment provider: `git gtr new` (or `git worktree
add` into `<repo>-worktrees/<branch with / as ->`), then the project's overlay (personal
`AGENTS.md` files copied in, other overlay files symlinked), then the setup command. A
branch that already has a worktree reuses it. `--from` defaults to the project's base ref
(`bb task config`). Follow progress with `bb thread show <id>`.

Write the prompt as a complete hand-off: the new agent starts with no memory of your
conversation.

## Inspect

`bb task list` prints every git worktree of the project (`*` marks the main checkout) with
the live threads running in it.

## Remove

```
bb task rm <branch|dir-name|path> [--delete-branch] [--force]
```

Archives every thread in the worktree, runs the project's teardown command from the main
checkout, then removes the worktree (`git gtr rm` or `git worktree remove`). It refuses a
worktree with uncommitted changes unless `--force`, and always refuses the main checkout.
`--delete-branch` runs `git branch -D`, which drops unmerged commits: confirm with the user
before using it or `--force`.

## Configure

```
bb task config [--base <ref>] [--overlay <dir>] [--setup <cmd>] [--teardown <cmd>] [--tool auto|gtr|git]
```

With no flags it prints the current settings and their effective defaults. `""` resets a
value. Setup and teardown commands run in `sh` with `SOURCE_ROOT`, `WORKTREE_PATH` and
`BRANCH` set.

## `.scratch/` workflow

Each worktree has its own `.scratch/<effort>/`: a wayfinder map (`MAP.md` +
`tickets/NN-slug.md`) and/or `issues/NN-slug.md`. These commands compose the same prompts
as pi's `/wayfinder` and `/orchestrate` (from the templates in the plugin's `templatesDir`
setting, default `~/fun/agent/extensions`) and start a thread in that worktree.

```
bb task scratch                          # efforts: ▸ frontier tickets, · blocked ones, open issues
bb task run <effort>/<NN>                # one frontier ticket, prompt by its type
bb task orchestrate <effort> [NN ...]    # issue batch; no numbers = every open issue
bb task chart "<idea>"                   # chart a new map under this worktree's .scratch
bb task handoff <effort>                 # every map ticket closed → to-prd / to-issues
```

`--path <path|branch|dir-name>` picks the worktree; it defaults to the worktree of the
thread you run it from, else the main checkout. `run` refuses closed and blocked tickets
(it names the blockers); a claimed ticket can still be run and the new thread takes the
claim over. `orchestrate` refuses `done` issues. Each spawn prints the thread id; follow it
with `bb thread show <id>`.

