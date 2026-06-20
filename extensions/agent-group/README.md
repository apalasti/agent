# Agent Group Extension

Run several pi agents on the **same problem**, grouped in one tmux window, and flip
between them with the left arrow — without ever opening a new window or losing the
full pi TUI.

## Mental model

```
one problem  =  one git worktree  =  one tmux window
                                        │
        ┌───────────────────────────────┼───────────────────────────────┐
     pane 0 (pi)                     pane 1 (pi)                     pane 2 (pi)
   "auth-refactor"               "fix flaky test"               "write migration"
        ▲ zoomed                   …working…                      …working…
```

Each agent is a **real `pi` process** in its own tmux pane, so every agent keeps
working whether or not you're attending it. Exactly one pane is **zoomed** at a
time, so it always looks and feels like a single full-screen pi.

## Commands

| Input | What happens |
|-------|--------------|
| `/spawn` | Open a new **blank** agent in this window and jump to it (zoomed). Type its task in its own TUI. |
| `/spawn <task>` | Spawn a **background** agent seeded with `<task>` — it starts working immediately while you stay where you are. |
| `←` (with an empty editor) / `/switch` | Show every agent in this group **with what it's doing** and zoom into the one you pick. With text in the editor, `←` is normal cursor movement. |
| `/kill` | Pick another agent in the group and close it. (Close the current one with pi's own `/exit` or `Ctrl+D`.) |

## The switcher (live dashboard)

Pressing `←` (or running `/switch`) lists every agent with what it's doing, how much
it's done, how long it's run, and how many tokens it's used:

```
                          status               turns/tools  runtime  tokens
● auth-refactor          idle                  2t/5⚙           1m02s    4.1k
  fix-flaky-test         ⚙ bash: npm test      4t/12⚙          2m14s   12.3k
  write-migration        needs you             1t/2⚙             14s     820
```

- `●` marks the agent you're currently in.
- **status** — `⚙ <tool>` = working (running tool + a hint, e.g. file/command);
  `needs you` = an idle background agent waiting on you; `idle` = the current agent;
  `🔔 done` = finished since you last looked.
- **turns/tools** — LLM turns and tool calls in the current run.
- **runtime** — elapsed time (live while working, frozen when idle).
- **tokens** — absolute tokens used (`ctx.getContextUsage().tokens`).

Each agent publishes its own state into its pane options (`@pi_state`, `@pi_tool`,
`@pi_tokens`, `@pi_turns`, `@pi_tools`, `@pi_start`, `@pi_end`) on `agent_start` /
`tool_execution_*` / `turn_start` / `agent_end`; the switcher reads them live.

## Notifications

When a background agent finishes a run (its agent loop ends), a **right-aligned ping
appears just above the footer** of the pi you're looking at — and only when there's
something to report (no permanent row otherwise):

```
                                              🔔 fix-flaky-test finished
─ your input ─────────────────────────────────────────────────────────────
```

The ping clears the moment you **look at** that agent — switch to it however you
like (`←`, `/switch`, or native tmux keys) and it's gone. Switching back and forth
doesn't make it linger. Multiple finishes collapse to a count.

State is shared across processes through tmux **per-pane options** (no files):

- A finishing background pane sets `@pi_finished = 1` on itself.
- Every pi polls focus (~700 ms); the **attended** pane (`#{pane_active}` is `1`)
  clears its *own* flag (you've seen it) and renders a right-aligned `belowEditor`
  widget (`ctx.ui.setWidget(...)`) from the other panes still flagged.

Because the flag lives on the pane, it's cleaned up automatically when an agent is
closed (`/kill` or `/exit`).

> **Why a widget and not the statusline?** pi renders extension statuses
> (`setStatus`) as a single dim, left-aligned line at the very bottom — it can't be
> made prominent or right-aligned. A custom footer (`setFooter`) *replaces* pi's
> built-in footer and isn't given the session data needed to redraw pi's own
> token/cost/model stats, so it would lose them. A `belowEditor` widget is the only
> surface that's prominent, right-alignable, and non-destructive.

## How it works

- **Group = tmux window.** Panes in your current window *are* the registry — no
  state file. Each agent pane is tagged with the tmux per-pane option `@pi_agent`
  (its label, shown in the switcher).
- **Spawn** = `tmux split-window` running `pi` in the same worktree
  (`git rev-parse --show-toplevel`). Seeded agents get the task via the
  `PI_SPAWN_TASK` env var; the extension (loaded in *every* pi) reads it on
  `session_start`, tags the pane, and fires `pi.sendUserMessage()` to start work.
- **Switch** = a raw-input tap (`ctx.ui.onTerminalInput`) that consumes `←` only
  when the editor is empty (also available as `/switch`), shows `ctx.ui.select(...)`,
  then `select-pane` + `resize-pane -Z` to zoom the chosen agent. The tap **coexists**
  with the paste-detector extension — it doesn't replace the editor.
- **`TMUX_PANE`** identifies our own pane, so it works correctly even for an
  unattended background pane.

## Requirements

- Must run **inside tmux** (`/spawn` and `←`/`/switch` no-op with a notice otherwise).
- `tmux` 3.0+ (per-pane user options) and `git`.

## Install

```bash
./setup.sh   # symlinks into ~/.pi/agent/extensions/agent-group/
```

Then `/reload` in pi.

## Tuning

| Setting | Where | Purpose |
|---------|-------|---------|
| `AGENT_OPT` | `index.ts` | tmux per-pane option used as the group tag/label |
| Seeded vs. blank focus | `spawnAgent` | seeded agents use `-d` (stay put); blank agents take focus |
| Label truncation | `truncate(...)` | how long agent labels show in the switcher |
