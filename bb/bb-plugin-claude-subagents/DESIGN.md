# bb-plugin-claude-subagents — design

Makes Claude Code subagents (the `Agent` tool in a bb thread running the Claude Code provider) observable
and actionable. Plugin id `claude-subagents`, display name "Claude subagents". Chosen from the
`bb-plugin-subagents-prototype` variants (B, "Monitor"); the swimlane timeline, per-agent colors,
parallelism stats and the feed/audit variants were dropped because nothing in them could be acted on.

Principle: every element on screen is either something to act on or tells you whether to act.

## What the user sees

- **Header pill** (`experimental_threadHeaderAction`), hidden when the thread has no subagents.
  - Any running: spinner, "N running", the newest running agent's context bar and live label
    (`Bash: run tests · 12s`; label hidden on compact viewports). Tooltip: every running agent with
    model and context %.
  - None running: green check, "N done" (amber "N need a look" if any finished failed or without a report).
  - Click opens the panel.
- **Panel** (`threadPanelAction`, layout `flush`):
  - Header: "N running · M finished", then the lead's model and context bar.
  - One row per agent, running first, then finished newest first. Row:
    1. `StatusBadge` · description (click toggles detail) · short model (`haiku 5.5`) · `ContextBar` · elapsed.
    2. Running: spinner + `Tool: summary` + time in that state, or italic "thinking"; amber `quiet 1m 20s`
       after 60s. Finished: `↳` first non-empty report line, or amber "No report handed back".
    3. Only if any: failed-call count (red) and changed files as `experimental_FileLink` with `+a −r`.
    4. `N tools · Nk tokens` and actions. Running: `Stop…`, `Steer…`. Finished: `Follow up…`. Actions insert
       an instruction naming the agent id into the thread composer (`useComposer().insert(text, { at: "end",
       block: true })`); the user sends it. A plugin cannot stop one subagent, only the whole thread.
  - Detail (below the list, one agent at a time): collapsible brief, step list (time, tool, summary,
    duration or spinner; click for input/result; auto-scroll pinned to the bottom while running), report.
- No per-agent colors anywhere. Color carries meaning only:

  | Status | Badge | Means |
  | --- | --- | --- |
  | `running` | spinner, neutral "Running" | working; watch the live line |
  | `done` | green check "Done" | finished and handed back a report: ready to use |
  | `needs-look` | amber triangle "No report" | finished without a report |
  | `failed` | red x "Failed" | task failed or was killed |
  | `unknown` | grey circle "Unknown" | no task event and transcript idle without end_turn |

  Context bar: neutral under 60%, amber 60–85%, red over 85%. Quiet line: amber after 60s.

## Data sources (local, read-only)

1. bb thread events via `bb.sdk.threads.events.list({ threadId, afterSeq, limit: "100", order: "asc", types })`:
   - `thread/identity` → `data.providerThreadId` is the Claude session id.
   - `item/started` / `item/backgroundTask/completed` with `data.item.type === "backgroundTask"` and
     `taskType === "local_agent"`: `familyId` = agent id, `taskStatus`, `usage.totalTokens` on completion.
2. `~/.claude/projects/<encoded cwd>/<sessionId>.jsonl` — the lead transcript (model, latest context).
3. `~/.claude/projects/<encoded cwd>/<sessionId>/subagents/agent-<id>.jsonl` and `agent-<id>.meta.json`
   (`{ agentType, description, toolUseId, requestShape, model }`).

Measured facts the code relies on: subagent transcripts carry no `toolUseResult`, so file changes come from
`Write`/`Edit`/`MultiEdit` inputs there (lead transcripts do carry `structuredPatch`/`bashEditDiff`).
Per-message `usage.output_tokens` is unreliable, so total tokens come only from bb's `usage.totalTokens`.
`message.model` is the real model id (`claude-haiku-5-5`) where meta has the alias (`haiku`). Transcripts do not
record the context window: 1M when the model id contains `[1m]` or usage already exceeded 200k, else 200k.
Edits made through Bash scripts are not detected.

Status precedence: task `completed` or a `SubagentHandback` call → finished (`done` if a report exists, else
`needs-look`); task `failed`/`killed` → `failed`; task `running` or transcript modified within 90s → `running`;
transcript's last assistant message `end_turn` → finished; else `unknown`.

## Files

```
package.json            id/name/description, scripts typecheck + test, same deps as bb-plugin-subagents
app.tsx                 definePluginApp: header action + panel action (both id "claude-subagents")
server.ts               default export plugin(bb): registers rpc threadAgents; wires sources below
src/contract.ts         zod schemas + rpcContract
src/transcript.ts       pure transcript parsing
src/events.ts           pure fold of bb events into session id + task facts
src/assemble.ts         pure join: meta + parsed transcript + task facts → Agent
src/sessions.ts         fs: locate session dir, list agents, cached parse
src/ui/format.ts        pure display helpers
src/ui/live.ts          pure live-state derivation
src/ui/useThreadAgents.ts  polling hook
src/ui/StatusBadge.tsx
src/ui/ContextBar.tsx
src/ui/AgentRow.tsx
src/ui/AgentDetail.tsx
src/ui/SubagentsPanel.tsx
src/ui/HeaderPill.tsx
components/ lib/ hooks/ components.json tsconfig.json vitest.config.ts   copied from bb-plugin-subagents
test/fixtures/          small trimmed real transcripts + meta (lead and subagent), event pages
test/*.test.ts(x)       see Tests
README.md PLUGIN_OVERVIEW.md
```

### src/contract.ts
- `stepSchema = { at: number; endAt: number | null; kind: "tool" | "text"; name; summary; input; result: string | null; isError }`, `type Step`
- `fileChangeSchema = { path; added; removed }`, `type FileChange`
- `agentStatusSchema = enum ["running","done","needs-look","failed","unknown"]`, `type AgentStatus`
- `agentSchema = { agentId; parentAgentId: string | null; description; agentType; model: string | null;
  status: AgentStatus; startedAt: number | null; endedAt: number | null; prompt; report: string | null;
  steps: Step[]; files: FileChange[]; errors: number; totalTokens: number | null; context: number;
  contextWindow: number }`, `type Agent`
- `threadAgentsSchema = { sessionId: string | null; cwd: string | null; environmentId: string | null;
  lead: { model: string | null; context: number; contextWindow: number } | null; agents: Agent[] }`, `type ThreadAgents`
- `rpcContract = defineRpcContract({ threadAgents: { input: { threadId }, output: threadAgentsSchema } })`

### src/transcript.ts
- `type Transcript = { prompt; steps: Step[]; toolUseIds: Set<string>; report: string | null; handedBack: boolean;
  files: FileChange[]; model: string | null; context: number; peakContext: number; firstAt: number | null;
  lastAt: number | null; endedTurn: boolean }`
- `parseTranscript(jsonl: string, opts: { sidechain: boolean }): Transcript` — skips sidechain lines unless
  `sidechain`; report = `SubagentHandback.message`, else last text (sidechain only); `context` = last assistant
  usage (input + cache read + cache creation); `model` = last non-synthetic `message.model`.
- `summarizeTool(name: string, input: Record<string, unknown>): string` — Bash: description, else first command
  line minus a leading `cd …;`/`cd … &&`; Read/Edit/Write/MultiEdit: file_path; Grep/Glob: pattern [in path];
  Agent/Task: description; WebFetch: url; WebSearch: query; else clipped JSON.
- `contextWindow(model: string | null, peak: number): number`
- internal: `changesFromResult(toolUseResult, tool)`, `changesFromInput(tool, input)`, `countHunks`.

### src/events.ts
- `type TaskFacts = { status: string; startedAt: number; endedAt: number | null; totalTokens: number | null }`
- `type EventRow = { seq: number | string; type: string; createdAt: number; data: unknown }`
- `EVENT_TYPES = ["thread/identity", "item/started", "item/backgroundTask/completed"] as const`
- `foldEvents(rows: EventRow[], into?: { sessionId: string | null; tasks: Map<string, TaskFacts> })` → same shape

### src/assemble.ts
- `type AgentSource = { agentId: string; meta: AgentMeta; transcript: Transcript; mtimeMs: number }`
- `type AgentMeta = { agentType?; description?; toolUseId?; model? }`
- `deriveStatus(src: AgentSource, task: TaskFacts | undefined, now: number): AgentStatus`
- `assembleAgents(sources: AgentSource[], tasks: Map<string, TaskFacts>, now: number): Agent[]` — parent = the other
  agent whose `toolUseIds` contains `meta.toolUseId`; sorted by startedAt.

### src/sessions.ts
- `createSessionStore(root = ~/.claude/projects)` → `{ findSessionDir(sessionId): Promise<string | null>;
  readLead(dir, sessionId): Promise<Transcript | null>; readAgents(dir, sessionId): Promise<AgentSource[]> }`
  with a parse cache keyed by path → `size:mtimeMs`.

### server.ts
- `export type { rpcContract }`; `export default async function plugin(bb)`: pages events with `EVENT_TYPES`
  through `foldEvents`, then store reads, `assembleAgents`, `bb.sdk.threads.get({ threadId, include: "environment" })`
  for cwd/environmentId. Unknown session or missing dir → empty result, not an error.

### src/ui/format.ts
- `duration(ms: number | null): string`, `kTokens(n: number | null): string`, `clock(at: number): string`,
  `shortModel(model: string | null): string` (`claude-haiku-5-5` → `haiku 5.5`, null → `inherited`),
  `relPath(path, cwd): string`, `firstLine(text): string`

### src/ui/live.ts
- `QUIET_WARN_MS = 60_000`
- `type LiveState = { label: string; since: number; inFlight: boolean }`
- `liveState(agent: Agent, now: number): LiveState` — last step is an unfinished tool → in flight; else
  "thinking" since the last step's end; no steps → "starting" since startedAt.
- `contextTone(used, window): "ok" | "warn" | "critical"`

### src/ui/useThreadAgents.ts
- `useThreadAgents(threadId): { data: ThreadAgents | null; error: string | null; reload(): void }` — polls every 2s
  while any agent is running, else 15s; drops stale responses.
- `useNow(active: boolean): number` — ticks every 500ms while active.

### Components
- `StatusBadge({ status, compact? })` — icon + word per the table; `compact` = icon only with aria-label.
- `ContextBar({ used, window, className? })`
- `AgentRow({ agent, data, now, isOpen, onToggle })` — uses `useComposer()` for actions.
- `AgentDetail({ agent, now })`
- `SubagentsPanel(props: PluginThreadPanelProps)` — loading / error / "No Claude Code subagents in this thread" / list.
- `HeaderPill(props: PluginThreadHeaderActionProps)` — `useBbNavigate().openThreadPanel({ actionId: "claude-subagents" })`.

## Trace: one agent's context fill

Claude Code appends an assistant line to `agent-<id>.jsonl` with `message.usage` →
`sessions.readAgents` stats the file, misses the cache on new size/mtime, calls `parseTranscript(text,
{ sidechain: true })` → `Transcript.context` = that line's input + cache read + cache creation, `peakContext` =
max over lines, `model` = `message.model` → `assembleAgents` copies `context`, sets `contextWindow =
contextWindow(transcript.model ?? meta.model, peakContext)` → rpc `threadAgents` returns it →
`useThreadAgents` polls it every 2s while running → `AgentRow` renders `<ContextBar used={agent.context}
window={agent.contextWindow} />` → `contextTone` picks neutral/amber/red. The header pill renders the same bar for
the newest running agent.

## Tests (vitest)

- `transcript.test.ts` — fixtures: steps and in-flight tool (result null), report from handback vs last text,
  file changes from inputs (subagent) and from `structuredPatch`/`create` (lead), latest vs peak context, model
  id, `summarizeTool` cases, `contextWindow`.
- `events.test.ts` — session id, task started → completed with totalTokens, failed/killed, non-local_agent ignored.
- `assemble.test.ts` — every `deriveStatus` branch incl. done vs needs-look; parent linking; sort.
- `sessions.test.ts` — temp dir layout: finds session dir, reads agents, cache hit on unchanged file.
- `format.test.ts` — `shortModel`, `duration`, `kTokens`.
- `live.test.ts` — starting / in flight / thinking; `contextTone` thresholds.
- `panel.test.tsx` — renders rows with badge words, running first, `Stop…` inserts text containing the agent id
  into a fake composer, empty state.

## Revised while building

Deviations from the outline above, agreed after the two halves were built:

- `server.ts` also exports `createPlugin(store: SessionStore, now: () => number)` so tests run against a temp dir;
  the default export is `createPlugin(createSessionStore(), Date.now)`. Events are folded incrementally with a
  per-thread cursor (`foldEvents(page, state)`), so each poll reads only new events. Extra type exports:
  `ThreadFacts` (events.ts), `SessionStore` (sessions.ts).
- `endedTurn` is the last assistant line's `stop_reason`; one message spans several jsonl lines sharing `message.id`
  and `usage`. A whitespace-only report counts as no report (`needs-look`). `summarizeTool("SubagentHandback")` is
  "report back". `FileChange` has no `via` (replaced the prototype's `via[]`).
- Amber uses the theme token `text-warning-text` (bar fill stays `bg-amber-500`). The unknown badge uses
  `CircleQuestion`. Header pill when idle: green "N done" counts only `done`; amber "N need a look" counts
  `failed` + `needs-look`; all-unknown shows grey "N unknown". On compact viewports only the live label is hidden.
- `shortModel` strips date suffixes (`claude-sonnet-4-20250514` → `sonnet 4`) and keeps `[1m]`.
- Review pass: `useThreadAgents` returns `{ data, error }` (no `reload`), keeps the newest response even when polls
  overlap and drops data from a previous `threadId`; `StatusBadge` has no `compact` (unused). Server event drains are
  serialized per thread. `firstLine` lives in `src/text.ts` (shared by transcript summaries and the row's report line).
  File `+a −r` use `text-diff-added`/`text-diff-removed` so green stays reserved for "done".
- A handback counts only while it is the agent's last tool call, so an agent resumed with `Follow up…` shows
  running again instead of staying green.
- "Done" and the idle pill use `text-success` (the theme's green); `text-success-foreground` mixes in ink and reads
  olive in the light theme. A finished agent's context bar stays neutral: its fill is no longer actionable.
- Session-dir misses are cached for a minute (`createSessionStore(root, now)`), so threads without a Claude session
  don't rescan `~/.claude/projects` on every poll.
