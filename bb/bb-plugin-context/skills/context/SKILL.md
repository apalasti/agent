---
name: context
description: Check how full your own context window is and what fills it with `bb context show --self`. Use before reading large files or long command output, during long tasks, and when deciding whether to compact or hand off.
---

# Check your context window

```sh
bb context show --self              # this thread
bb context show --thread <id>       # another thread
bb context show --self --turns 20   # more per-turn history (default 10, max 100)
bb context show --self --json       # the full report
```

## When to run it

- Before reading a large file, a long log, or a command with unbounded output.
- Every few turns of a long task, and before starting a big new step.
- When deciding whether to compact, hand work to a fresh thread, or summarize first.

## Reading the output

- `Context 48k / 200k · 24% (measured)`: used tokens over the model's window. `measured`
  means the total came from bb's last LLM call. `estimated` (shown with `≈`) means there is
  no measurement for the current session yet, for example right after an edit, a fork, or a
  compaction; `recomputing` says the same.
- Categories (system prompt, tool definitions, memory files, skills, your messages,
  assistant text, thinking, tool calls, tool results, compaction summary) and their `%` (of
  the used total) come from the provider's per-call usage: each reply's output tokens, and
  each call's input growth split across the items added before it. Within one step the split
  is by size (about 4 characters per token). Steps that don't fit, such as a cache reset, are
  estimated, and a note counts them.
- `Largest items` names the biggest single conversation items (never the system prompt or
  tool definitions), such as a tool result with the file path or command that produced it,
  and the turn that added it.
- `Turns` lists each user message with `+added → total after`. A `≈` total is estimated.
  `[summarized]` or `[cleared]` turns are no longer in context in full. `--` lines mark an
  edit, a compaction, a skipped compaction, a clear, or a fork.

## Limits

- Breakdowns exist for pi and Claude Code threads on this machine. Other providers and
  threads on remote hosts show bb's total only, as `Unattributed`.
- Thinking can be over-counted when the provider drops earlier thinking blocks.
- Without Claude's own `/context` snapshot, Claude Code's system prompt and tools are
  estimated from the transcript or shown as one residual.
