# bb-plugin-subagents — design

Makes pi subagents (`@tintinweb/pi-subagents`: the `Agent`, `get_subagent_result`, `steer_subagent`
tools) transparent inside bb. Plugin id `subagents`, display name "Subagents".

## The gap (measured, bb 0.45)

bb's pi bridge turns an `Agent` call into a core delegation row ("Ran subagent: count files
(Explore)") and shows `get_subagent_result { agent_id: 27e7abbc-45cf-47d, wait: true } 24s` while
waiting. You can't see what a subagent is doing or how far along it is, the transcript isn't
viewable, nothing maps an agent id to its description, and when the turn ends it all folds
into "Worked for 41s". Core rows can't be re-rendered by plugins, so transparency has to come
from plugin surfaces next to them.

## Data sources (all on the server's machine)

1. **bb event history**: `bb.sdk.threads.events.list({ threadId, ... })`. `item/started` and
   `item/completed` events whose `data.item` is `{ type: "toolCall", tool: "Agent", arguments:
   { description, subagent_type, name?, run_in_background?, prompt, model? }, result? }`.
   `result` text carries `Agent ID: <id>`, `Type:`, `Description:`, `Output file: <path>`
   (background launches), or the final report (foreground). `data.providerThreadId` is
   `pi_<uuid>` (or `thr_<id>`). `get_subagent_result` / `steer_subagent` calls carry `agent_id`.
2. **Subagent transcript**: the `.output` file. JSONL, Claude-Code task format: `{ isSidechain,
   agentId, type: "user"|"assistant"|"toolResult", timestamp, message: { role, content } }`, where
   content is a string or blocks `{type:"text"}` / `{type:"toolCall", name, arguments}`. It's
   written per turn (each LLM response plus its tool results), not per token.
3. **pi session file**: `~/.bb/pi-bridge-sessions/<providerThreadId>.jsonl`. A `{"type":"custom",
   "customType":"subagents:record","data":{id,type,description,status,result,...}}` entry is
   appended when an agent finishes, and gives the authoritative final status and result.

Status precedence: a session `subagents:record` beats a terminal `get_subagent_result` reading
(`Status: <s>` in its result), which beats the final report from a foreground `Agent` result, which
beats a transcript whose last assistant message ended the loop (`stopReason` stop/error/aborted),
which beats `running` (launched, no record, transcript modified within 10 min, or a thread turn
still active), which beats `unknown`. pi statuses map as queued/running → running,
completed/steered → completed, error/aborted (turn limit) → failed, stopped → stopped.
(Revised while building: the get_subagent_result and transcript-end sources were added; the
agreed draft had only record > foreground > running > unknown.)

Measured details the join relies on:

- A foreground `Agent` result has no agent id (`Agent completed in 29.7s (…).\n\n<report>` or
  `Agent failed: …`). The id comes from the session's persisted toolResult (`details.agentId`,
  matched by description + type in order); while it still runs, from the unclaimed `.output` in
  the session's task dir (`<tmp>/pi-subagents-<uid>/<encodeCwd(session cwd)>/<session id>/tasks`)
  whose first line is the launch prompt.
- `run_in_background` is often absent (agent frontmatter default); `background` comes from the
  result text (`Agent started|queued|resumed in background.`).
- A thread can switch session files (`thread/identity` → `pi_<uuid>` then `thr_<id>`); every
  providerThreadId seen in events is read.
- `subagents:record` is written for top-level agents only, foreground included. Nested agents
  get their status from the parent transcript: the nested `Agent` result (`Nested agent started
  in background. Agent ID: <id>` or the inline report) and nested `get_subagent_result` results.
  Their `.output` lives in the same `tasks/` dir as the parent's.
- `threads.events.list` rejects `limit` above 100; paging stops on a short page.
- pi's file tools are `write` / `edit` with a `path` argument, absolute or relative to the session
  cwd (Claude-Code-style `Write`/`Edit`/`MultiEdit` `file_path` and `NotebookEdit` `notebook_path` are
  also read). A call counts toward `filesTouched` once its non-error result is in the transcript.
- The thread's environment (`threads.get({ include: "environment" })`: id, hostId, path) is fetched
  once per thread. Paths under it or the session cwd (`/tmp` and `/private/tmp` are the same) are
  shown relative; tool summaries drop a leading `cd <that dir> &&` and abbreviate other `cd`
  targets to `…/<basename>`. The full text stays in the expanded args.
- Only `thread/identity`, `turn/*` and `item/*` events are fetched: `provider/unhandled` also
  carries the records but includes the 64 KB system prompt each turn.

## Surfaces

- **Thread header pill** (`experimental_threadHeaderAction`): shown only when the thread has
  subagents. Reads "⟳ 2 running · 3 done", or "5 subagents" when none are running. A click
  opens the panel. It reads `summaries({ threadIds: [threadId] })`, not `threadSubagents`, so
  the always-mounted pill stays cheap.
- **Thread panel "Subagents"** (`threadPanelAction`, layout flush): a top bar summarizing the
  thread ("2 running · 5 done · 3m 12s total", total = summed elapsed time) plus refresh, then one
  card per subagent with description, type, model, status, elapsed time, turn and tool-call
  counts, "edited N files", and the short id (its copy button copies the full pi id, for
  `get_subagent_result` / `steer_subagent`). The last line is the last activity (e.g. `bash:
  sleep 20`) while running and `Result: <first line>` once finished (red when failed). Because the
  transcript is written once per turn, a running card can't know what tool is in flight; when it
  has been quiet for 15 s it says "updated 42s ago", and after 10 min, in amber, "no activity for
  12m". A card expands to the files it touched (relative to the environment, each an
  `experimental_FileLink`: a workspace target under the environment, a host target elsewhere)
  and its live transcript: prompt, then a compact tool-call line per call (expandable args and
  result; local HH:MM:SS on hover), assistant text as markdown, and the final result. Nested
  subagents (an `Agent` call inside a transcript) render as child cards. It polls every 2 s
  while anything is running, every 30 s otherwise, and refreshes on realtime. An expanded
  transcript scrolls inside its own bounded card and sticks to the bottom while the agent runs,
  since several transcripts can be open at once.
- **Sidebar row status** (content script + `experimental_setThreadRowStatus`): any thread with
  running subagents gets `{ icon, label: "2 subagents running", tone: "running" }` in whatever
  thread list is active (bb's or Worktrees), and is cleared when none are running. The content
  script only hands its `experimental_setThreadRowStatus` to a render-nothing
  `experimental_appOverlay` (`RowStatusPoller`), which polls `summaries` every 3 s through
  `useRpc` while the document is visible. This replaces "the content script polls", because a
  content-script context has no rpc client.
- **CLI** `bb subagents list [--thread <id>|--self]` (with files-edited counts) and `bb subagents
  show <agentId> [--tail N]` (lists the files touched, relative to the environment), so a lead
  agent (or the user) can inspect workers. Bounded output, with `--json`.

## Files

```
bb-plugin-subagents/
  package.json, server.ts, app.tsx
  src/contract.ts        shared rpc contract + types (owned by the lead)
  src/events.ts          pure: bb timeline events → SubagentLaunch[] (+ agent_id refs)
  src/transcript.ts      pure: .output JSONL text → TranscriptEntry[] + stats; incremental by byte offset
  src/session.ts         pure: pi session JSONL → Map<agentId, SessionRecord>
  src/collect.ts         server: joins the three per thread; caches by file size/mtime
  src/paths.ts           pure: environment-relative paths, summary shortening (also used by the UI)
  src/ui/HeaderPill.tsx, src/ui/SubagentsPanel.tsx, src/ui/AgentCard.tsx, src/ui/Transcript.tsx
  src/ui/format.ts       pure: ordering, elapsed, labels; src/ui/data.ts polling hooks
  src/rowStatus.ts       content script (setter) + RowStatusPoller overlay + pure diff
  skills/subagents/SKILL.md
  test/*.test.ts         fixtures copied from real files (see test/fixtures/)
```

## Trace: a subagent reaches the panel

pi calls `Agent` → bridge emits `item/started` + `item/completed` (result has the Output file) →
panel `useRpc("threadSubagents", {threadId})` → server `events.list` (cached per thread, newest
seq) → `parseLaunches` → for each launch, `readTranscript(outputFile, fromOffset)` + session
records → `Subagent[]` → `AgentCard`. While a subagent runs, the poll re-reads only the bytes
appended since the last offset.

`summaries` without thread ids covers pi threads (including hidden) that are not idle or were
updated within 24 h, newest 50, and returns only threads with at least one subagent. Idle threads
whose `updatedAt` hasn't moved are not re-fetched; their files are only re-statted.
