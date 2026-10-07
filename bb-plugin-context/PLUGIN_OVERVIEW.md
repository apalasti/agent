See how full a thread's context window is and what fills it.

## What you get

- A slim meter above the prompt: used / window, a bar split by category, and the three
  largest categories. It turns amber, then red, as the thread nears its limit.
- A **Context** panel per thread: every category with its entries (each tool definition,
  each file read, each command's output), the largest items, and how the context grew turn
  by turn.
- Edit, fork, compact or clear from any turn, with how much each would free.
- `bb context show --self`, so agents can check their own context before reading big files.

## How it works

bb measures the total on every LLM call. The plugin reads the thread's pi session file or
Claude Code transcript on the bb server's machine and splits each LLM call's reported usage
across the items it added; anything left unmeasured is estimated and scaled to bb's total. Edited-away branches, compactions and forks are accounted for.
Nothing leaves the machine.
