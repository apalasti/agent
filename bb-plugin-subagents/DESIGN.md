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

Status precedence: a session `subagents:record` beats the final report from a foreground `Agent`
result, which beats `running` (launched, no record, transcript modified within 10 min, or a
thread turn still active), which beats `unknown`.

## Surfaces

- **Thread header pill** (`experimental_threadHeaderAction`): shown only when the thread has
  subagents. Reads "⟳ 2 running · 3 done", or "5 subagents" when none are running. A click
  opens the panel. It reads `summaries({ threadIds: [threadId] })`, not `threadSubagents`, so
  the always-mounted pill stays cheap.
- **Thread panel "Subagents"** (`threadPanelAction`, layout flush): one card per subagent with
  description, type, model, status, elapsed time, turn and tool-call counts, the last activity
  line (e.g. `bash: sleep 20`) and the short id, so the `get_subagent_result` rows can be
  matched up. A card expands to its live transcript: prompt, then a compact tool-call line per
  call (expandable args and result), assistant text as markdown, and the final result. Nested
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
- **CLI** `bb subagents list [--thread <id>|--self]` and `bb subagents show <agentId> [--tail N]`,
  so a lead agent (or the user) can inspect workers. Bounded output, with `--json`.

## Files

```
bb-plugin-subagents/
  package.json, server.ts, app.tsx
  src/contract.ts        shared rpc contract + types (owned by the lead)
  src/events.ts          pure: bb timeline events → SubagentLaunch[] (+ agent_id refs)
  src/transcript.ts      pure: .output JSONL text → TranscriptEntry[] + stats; incremental by byte offset
  src/session.ts         pure: pi session JSONL → Map<agentId, SessionRecord>
  src/collect.ts         server: joins the three per thread; caches by file size/mtime
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
