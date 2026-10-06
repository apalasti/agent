Makes pi subagents visible in bb. When a pi thread runs the `Agent` tool, bb only shows a
"Ran subagent" row; this plugin shows what each subagent is actually doing.

## What you get

- A pill in the thread header: "2 running · 3 done". Click it to open the Subagents panel.
- A Subagents panel with one card per subagent (status, model, elapsed time, turns, tool
  calls, last activity) that expands into its live transcript, nested subagents included.
- A running-subagents badge on sidebar thread rows.
- `bb subagents list` and `bb subagents show <id>`, so a lead agent can check on its workers.

## How it works

Everything is read locally on the bb server: the thread's event history, pi-subagents'
`.output` transcripts in the system temp directory, and the bb pi bridge's session files.
Nothing is written and nothing leaves the machine.
