# bb-plugin-context: design

Shows how full a thread's context window is and what fills it. A slim meter sits above the
prompt, and a "Context" thread panel holds the breakdown, the growth per turn, and the
controls for going back (edit from a message, fork, compact, clear). Plugin id `context`,
display name "Context".

## The gap (measured, bb 0.45)

- bb records usage as `thread/contextWindowUsage/updated` events (one per LLM call) and
  `threads.context({ threadId })`. It shows that as a 16 px ring at the bottom-right of the
  composer. Hovering shows "27k / 200k tokens · 86% left". Nothing is visible at a glance.
- **Claude Code**: "Show details" lists bb's snapshot categories (System prompt, System tools,
  MCP server instructions, Memory files, Skills, Messages, Free space, plus deferred tools).
  "Messages" is one lump: you can't tell which tool results, files or turns fill it. The
  snapshot is optional and goes stale. It is present after a turn completes, but after
  `edit-message` `threads.context` returned only `{ usedTokens: 26140 }`, with no snapshot.
- **pi**: total only (`{ usedTokens, modelContextWindow, estimated }`), and no breakdown at
  all. In a fresh pi thread, tool definitions are about 10.5k of 16.3k tokens. Nobody can see
  that today.
- **No history**: you can't see how the context grew turn by turn, or what rewinding to an
  earlier message would free.
- **Changing course leaves traps**:
  - `edit-message` deletes the abandoned events (`cutoffSequence <= seq <= oldMaxSequence`)
    from the log and appends `system/operation { operation: "edit_message", status:
    "completed", metadata: { cutoffSequence, oldMaxSequence, replacementProviderThreadId } }`.
    The discarded turns can be counted only from events fetched before the edit; the
    collector keeps those rows and stores the count in `bb.storage.kv`. (Revised: this said
    the dead events stay in the log; bb's `deleteThreadEventSuffixInTransaction` removes them.)
  - The edit then starts a new provider session, signalled by `thread/identity` with a new id
    (pi `pi_<uuid>`, Claude Code `<uuid>`). Sometimes the same id is rewritten in place
    (`replacementProviderThreadId: "thr_x:rewind:<uuid>"`).
  - Its first usage event is `usedTokens: null`.
  - `fork` copies the source's visible events into the new thread, followed by a new
    `thread/identity` (`thr_<newid>` for pi). `threads.context` returns `usage: null` until
    the fork's first turn. Its session file, however, already holds the copied history.
  - `compact` sends a `/compact` turn. That gives an `item/started { item.type:
    "contextCompaction" }` and then `thread/compacted`, or `provider/warning { category:
    "compaction-skipped" }` when the session is too small.
  - `clear` gives `thread/context/cleared`.
  - Summing all events, or reading an old session file, shows the abandoned branch.

## Data sources (all on the server's machine)

1. **bb usage**: `bb.sdk.threads.context({ threadId })`. This is the authoritative total
   (`usedTokens`, `modelContextWindow`), plus the optional Claude Code `snapshot`
   (`categories[] { id, label, kind: used|reserved|free|deferred, tokens, entries[] }`,
   `autoCompactAtTokens`, `providerSessionId`, `model`, `capturedAt`). A snapshot is used only
   when `snapshot.providerSessionId` equals the current provider session.
2. **bb events**: `bb.sdk.threads.events.list({ threadId, afterSeq, limit<=100, order: "asc",
   types })` with the types `client/turn/requested`, `turn/started`, `turn/completed`,
   `thread/identity`, `system/operation`, `thread/compacted`, `thread/context/cleared`,
   `thread/contextWindowUsage/updated`, `item/started`, `provider/warning`. Deltas and
   `provider/unhandled` are never fetched (the latter carries the 64 KB system prompt).
   - A user message is a `client/turn/requested` whose `data.request.method` is `"turn/start"`,
     or `"thread/start"` for a thread's first message, and whose `data.input` has text. A
     `thread/start` without input (a fork's own start) ends the copied turns. (Revised: this
     named `turn/start` only.) Its `seq` is what `threads.editMessage` takes as
     `expectedRequestSequence`, but bb edits only requests with `initiator: "user"`, no
     `senderThreadId`, and a `new-turn`/`thread-start` target; messages sent by agents or
     other threads are not editable (`Turn.notEditableReason`). A `/compact` turn (an input with a single `command` mention)
     is a course change, not a message.
   - The current provider session is the `providerThreadId` of the last `thread/identity`.
3. **pi session**: `~/.bb/pi-bridge-sessions/<providerThreadId>.jsonl`, which holds the
   active branch only (no session here has ever branched: bb rewrites or replaces the file).
   - Entries: `session`, `model_change`, `thinking_level_change`, `session_info` (not in
     context), and `message` with `role` system | user | assistant | toolResult.
   - The system message has `sections { preamble, tools, rules, docs, addendum,
     project_context, skills, cwd }` and `toolsAdded[] { name, description, parameters }`.
   - assistant `content[]`: `thinking | text | toolCall { name, arguments }`, plus `usage
     { input, output, cacheRead, cacheWrite, totalTokens }`.
   - toolResult: `{ toolCallId, toolName, content[], isError }`.
   - `compaction { summary, firstKeptEntryId, tokensBefore }`: in context are the summary
     plus entries from `firstKeptEntryId` on, minus later replaced ones.
   - `context_edit { targetId, replacement: null }` removes `targetId` from context.
   - `custom_message` (for example subagent notifications) is in context.
4. **Claude Code transcript**: `~/.claude/projects/<encoded cwd>/<providerThreadId>.jsonl`.
   Find it by file name across the project dirs, not by encoding the cwd.
   - Entries: `user` (string, or blocks including `tool_result { tool_use_id, content }`),
     `assistant` (one content block per line: `text | thinking | tool_use { id, name, input }`,
     plus `message.usage`), `attachment` (`rendered`, which is in context: `instructions` count
     as memory, `skill_listing` as skills, others as other; `prompt_snapshot` carries the
     system prompt and tool schemas, used for `system`/`tools` when bb has no snapshot), and
     `system` with
     `subtype: "compact_boundary"`. Only entries after the last boundary are in context; the
     next `user` with `isCompactSummary: true` is the summary.
   - Skip `isSidechain: true`, `queue-operation`, `last-prompt`, `ai-title` and `atis-latch`.

## Estimation and calibration

- `estimateTokens(text) = ceil(chars / 4)`; an image block counts 1,600. Measured on a fresh
  pi session: system sections plus tool definitions plus the user message estimated 16,141,
  and the real first-call input was 16,300 (1% off).
- Every in-context item gets an estimate. Then it is calibrated against the authoritative
  total `T` (bb `usedTokens`):
  - **pi**: scale every item by `T / sum(estimates)`. If that factor is outside 0.5–2, don't
    scale; show the residual as the `unattributed` category instead.
  - **Claude Code with a current snapshot**: keep the snapshot's non-Messages categories
    (they come from Claude's own `/context`). Split the remaining
    `T - sum(non-Messages used categories)` across the transcript items by their estimates.
  - **Claude Code without a snapshot**: transcript items at their estimates. Then
    `unattributed = max(0, T - sum)`, labelled "System prompt, tools & skills (not in
    transcript)". When the transcript's `prompt_snapshot` makes the sum exceed `T` (factor
    0.5–1), scale down to `T` instead. (Revised: added the scale-down case; the prompt
    snapshot overestimates by about 30%.)
  - **No bb total** (a fresh fork, or a new session before its first call): the sum of the
    estimates, with `window.basis = "estimated"`.
- `window.basis` is `measured` when `T` came from bb for the current session, `estimated`
  when the total is the plugin's own, and `none` when there is nothing to show.

## Categories (stable ids, fixed order)

| id | label | pi source | Claude Code source |
|---|---|---|---|
| `system` | System prompt | sections preamble, tools, rules, docs, addendum, cwd | snapshot "System prompt" + "MCP server instructions" |
| `tools` | Tool definitions | `toolsAdded` (one entry per tool) | snapshot "System tools" (+ non-deferred MCP tools) |
| `memory` | Memory files | section `project_context` | snapshot "Memory files" |
| `skills` | Skills | section `skills` | snapshot "Skills" |
| `user` | Your messages | user messages | user string/text blocks, attachments |
| `assistant` | Assistant text | text blocks | text blocks |
| `thinking` | Thinking | thinking blocks | thinking blocks |
| `toolCalls` | Tool calls | toolCall arguments | tool_use input |
| `toolResults` | Tool results | toolResult content, one entry per tool name | tool_result content, by tool name |
| `summary` | Compaction summary | compaction summary | the isCompactSummary user message |
| `other` | Other | custom_message | other in-context entries |
| `unattributed` | Unattributed | residual | residual (see above) |
| `reserved` | Autocompact buffer | (none) | snapshot reserved |
| `free` | Free space | window minus used | window minus used minus reserved |
| `deferred` | Available on demand | (none) | snapshot deferred (not counted) |

## Surfaces

- **Composer meter** (`app.composer.customize({ scopes: ["thread"], banners: [{ chrome:
  "bare" }] })`). One line, at most 28 px tall, above the prompt:
  - a segmented bar (one segment per used category, in the order above), with a tick at
    `autoCompactAt` when known;
  - `27k / 200k · 14%`, with a leading `≈` when the basis is estimated;
  - the top three categories (`Tools 11k · System 7k · Messages 6k`).
  - Tone: muted below 60% of the usable limit (`autoCompactAt ?? window`), amber from 60%,
    red from 85%.
  - A click opens the Context panel (`useBbNavigate().openThreadPanel({ actionId:
    "context" })`), and the hover title lists every category.
  - Renders nothing while `window.basis === "none"`. After a course change with no new
    measurement yet, it shows the estimate with `≈` and the label "recomputing".
- **Thread panel "Context"** (`threadPanelAction`, id `context`, layout flush):
  1. Header: used / window, a large segmented bar, the autoCompact tick, and a note on the
     basis ("measured by bb · breakdown estimated from the pi session").
  2. **What's in it**: the categories as rows (dot, label, tokens, %). They expand to entries
     (per tool, per section, per file, per tool name), and toolResults entries expand to the
     largest single results (`read …/SKILL.md · 4.1k`).
  3. **Largest items**: the top 10 individual items with their turn number. A click scrolls
     to that turn.
  4. **Turns**: one row per user message in the active timeline, oldest first:
     - `#n`, a one-line preview, `+12.3k` added, the context after, and a small bar;
     - state: `inContext`, or `summarized` / `cleared` (greyed) for turns before the last
       compaction or clear.
     - Course changes show as divider rows where they happened:
       - "Edited here: 2 turns (31k) discarded";
       - "Compacted 161k → 24k" (or "Compaction skipped: session too small");
       - "Context cleared";
       - "Forked from @thread at turn 3".
     - Row actions (disabled while the thread runs; the reason goes in the tooltip):
       - **Edit from here…**: an inline editor prefilled with the message text. It shows
         "Rewinds to ≈18k (frees 40k), discards turns n…m". Confirm calls
         `sdk.threads.editMessage({ threadId, expectedRequestSequence: requestSeq, message
         })`.
       - **Fork from here**: `sdk.threads.fork({ sourceThreadId, sourceSeqEnd: lastSeq })`,
         then navigate to the new thread.
  5. Footer: **Compact** (`sdk.threads.compact`) and **Clear context**
     (`sdk.threads.clearContext`), each behind a confirm that states the current size.
- **CLI** `bb context show [--thread <id> | --self] [--turns N] [--json]`. A bounded text
  summary (categories, top items, the last N turns) for agents checking their own context.
  The skill is in `skills/context/SKILL.md`.
- **Live updates**: the server listens to `experimental_thread.events` (coalesced to 1/s per
  thread), drops that thread's cached report, and publishes realtime `context-changed
  { threadId }`. The frontend refetches only for its own thread, and once more on realtime
  reconnect.

## Files

```
bb-plugin-context/
  package.json, server.ts, app.tsx, DESIGN.md, CONTRACT-CHANGES.md
  src/contract.ts      lead-owned: zod RPC contract + shared types (append-only for others)
  src/estimate.ts      estimateTokens(text): number; IMAGE_TOKENS = 1600
  src/events.ts        EVENT_TYPES; parseTimeline(rows: EventRow[], options?: { sourceThreadId }): Timeline
  src/piSession.ts     parsePiSession(text: string): SessionContext
  src/claudeTranscript.ts  parseClaudeTranscript(text: string): SessionContext
  src/compose.ts       composeReport(input: ComposeInput): ContextReport; toMeter(report): Meter
  src/collect.ts       createCollector(deps: { sdk: CollectSdk; fs: CollectFs; roots }): Collector
  src/ui/format.ts     formatTokens(n): string; percent(n, d); toneFor(used, limit); CATEGORY_STYLE
  src/ui/data.ts       useMeter(threadId); useReport(threadId)
  src/ui/MeterBar.tsx  <MeterBar segments total autoCompactAt size />
  src/ui/ComposerMeter.tsx   banner component
  src/ui/ContextPanel.tsx    panel shell: header, Breakdown, LargestItems, Turns, footer
  src/ui/Breakdown.tsx, src/ui/Turns.tsx (+ RewindEditor), src/ui/CourseChangeRow.tsx
  skills/context/SKILL.md
  test/*.test.ts       fixtures trimmed from real files (test/fixtures/)
```

Internal (backend-only) types, which are not in the contract:

```ts
interface EventRow { seq: number; type: string; createdAt: string; data: unknown }
interface Timeline {
  currentProviderThreadId: string | null;
  turns: TurnFact[];                 // active user messages, oldest first
  usage: { seq: number; providerThreadId: string; usedTokens: number | null; window: number | null }[];
  courseChanges: CourseChange[];     // contract type
  deadRanges: [number, number][];
}
interface TurnFact { requestSeq: number; lastSeq: number; at: string; text: string; providerThreadId: string | null; userSent: boolean }
interface SessionItem {
  key: string; category: CategoryId; label: string; detail: string | null;
  estTokens: number; userOrdinal: number | null; // index of the user message this item follows (0-based), null for system/tools
  userText?: string;                              // set on user-message items, for matching to bb turns
}
interface SessionContext {
  items: SessionItem[]; model: string | null; compactedBeforeOrdinal: number | null;
  compactions: { tokensBefore: number | null; tokensAfter: number | null }[]; // fills "Compacted 161k → …" when bb has no usage around it
}
```

Turns are matched to session user messages from the end, by order, and checked by a
normalized text prefix (both sides carry bb's `[bb message from …]` header). An unmatched
turn has `tokensAfter` from usage events only, and `largest: []`.

## Trace: one tool result reaches the meter

1. pi runs `read SKILL.md`. That appends a `toolResult` line to
   `~/.bb/pi-bridge-sessions/pi_<uuid>.jsonl`. The next LLM call makes bb append
   `thread/contextWindowUsage/updated { usedTokens: 23k }` (seq 61).
2. Core fires `experimental_thread.events { thread, sequence: 61 }`. `server.ts` calls
   `collector.invalidate(threadId)` and `bb.realtime.publish("context-changed",
   { threadId })`.
3. `ComposerMeter` gets `threadId` from `useComposer().scope`. `useMeter` sees the realtime
   signal for its thread and calls `rpc.call("meter", { threadId })`.
4. `collector.meter(threadId)` runs four steps:
   - `events.list` after the cached seq gives `parseTimeline` the current session `pi_<uuid>`
     and the dead ranges;
   - `threads.context` gives `T = 23k` (measured);
   - re-reading the session file (it grew, so only the new bytes when appended) gives a
     `toolResult` `SessionItem { category: "toolResults", label: "read", detail:
     "…/SKILL.md", estTokens: 4100 }`;
   - `composeReport` scales the items by `T / sum` and returns the report.
5. The meter returns `{ window: { usedTokens: 23k, contextWindow: 1M, basis: "measured" },
   segments: [...toolResults 4.1k...], top: [...] }`.
6. `MeterBar` draws the toolResults segment, and the label reads `23k / 1m · 2% · Tools 10k ·
   System 6k · Tool results 4k`.

## Trace: "Edit from here" on turn 2

1. In the Turns list, turn 2 shows `requestSeq 19, tokensBefore 16.4k`. The user edits the
   message and confirms.
2. `sdk.threads.editMessage({ threadId, expectedRequestSequence: 19, message })` makes bb
   append `system/operation edit_message { cutoffSequence: 19, oldMaxSequence: 40 }`, a new
   `client/turn/requested`, and a `thread/identity` with the new session.
3. `experimental_thread.events` → `context-changed` → refetch → `parseTimeline` marks 19..40
   dead and switches to the new session, and the CourseChange
   `{ kind: "edited", discardedTurns: 2 }` sits before the new turn 2.
4. Until the new session's first usage arrives, `T` is null, so the meter shows `≈16.4k`
   (`tokensBefore` of the edited turn plus the estimate of the new message) and "recomputing".

## Limits

- Per-item numbers are estimates (chars/4) calibrated to bb's measured total. Thinking may
  be over-attributed if the provider strips earlier thinking blocks, which is why it is its
  own category.
- Only pi and Claude Code have breakdowns. Other providers get the bb total and a single
  `unattributed` segment.
- A thread on a remote host: session files are read on the plugin server's machine.
  Breakdown is unavailable for remote threads (basis from bb only).
