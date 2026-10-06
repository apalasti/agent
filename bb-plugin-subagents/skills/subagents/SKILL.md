---
name: subagents
description: Inspect pi subagents (the Agent tool) that a bb thread launched — status, progress, transcript and result — with `bb subagents`. Use when you lead subagents and want to check on them without blocking on get_subagent_result, or when the user asks what a thread's subagents are doing.
---

# Subagents

`bb subagents` reads the same data as the Subagents panel: the thread's `Agent` tool calls,
each subagent's `.output` transcript, and pi's final record. It only reads; it never steers
or stops an agent (use `steer_subagent` / `get_subagent_result` for that).

| Command | Shows |
| --- | --- |
| `bb subagents list` | The calling thread's subagents: id, status, type, fg/bg, description, turns and tool calls. |
| `bb subagents list --thread <id>` | Another thread's subagents. Without any thread: recent threads that have subagents. |
| `bb subagents show <agentId> [--tail N]` | One subagent: model, timestamps, nested children, the prompt, the last N transcript entries (default 20) and the result. |

- `<agentId>` is the id from the `Agent` result (`Agent ID: 3a2ff4b2-3d37-45c`); a unique prefix
  works, and so does the bb tool call id. Add `--thread <id>` when it isn't your own thread.
- Add `--json` for the full records.
- Statuses: `running`, `completed`, `failed` (error or turn limit), `stopped` (by the user),
  `unknown` (no final record and the transcript has gone quiet; the agent may have died).
- The transcript is written once per agent turn, so during a long tool call (`sleep`, a build)
  the last activity shows the previous step until that turn finishes.
