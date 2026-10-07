# bb-plugin-context: design

Shows how full a thread's context window is and what fills it. The plugin's ring takes the
place of bb's context ring under the prompt, with a detailed hover card, and a "Context" thread panel holds the breakdown, the growth per turn, and the
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
- **Measured attribution comes first.** pi assistant messages and Claude Code assistant
  lines (deduplicated by `message.id`) carry the provider's per-call `usage`. Every LLM call
  `k` has `input_k = input + cacheRead + cacheWrite` (Claude Code: `input_tokens +
  cache_creation_input_tokens + cache_read_input_tokens`) and `output_k`.
  - **Baseline**: everything before the first call. That is the system, tools, memory and
    skills items plus the first user message, and together they take `input_1`. The split
    within them is by estimate.
  - **Assistant messages**: an assistant message takes `output_k`. pi `usage.reasoning`,
    when present, goes to its thinking blocks; the rest is split by estimate.
  - **Items appended between calls** (tool results, user messages, custom messages,
    attachments): those between call `k-1` and call `k` take `delta_k = input_k -
    input_{k-1} - output_{k-1}`, split by estimate.
  - **Fallbacks**: a step whose delta is negative, or more than 3× (plus 40 tokens of
    framing per item) or less than ⅓ of its estimate (cache resets, `context_edit`
    removals), falls back to estimates. Items after the last call use estimates. A
    baseline that falls back (a Claude Code transcript without `prompt_snapshot`) is not
    counted in the "N steps fell back" note. (Revised: the framing allowance was added
    because results of a few characters measure about 32 tokens, over 3× their estimate.)
  - pi assistant messages with `stopReason` `error` or `aborted` carry zero usage and are
    never replayed (pi-ai `transformMessages` skips them), so they are not in context.
  - The first call after a compaction starts a new baseline: the summary plus the kept
    items.
  - Measured on the lead's 1.6 MB session, chars/4 undercounted assistant messages by half
    (30k estimated vs 60k `usage.output`, mostly hidden reasoning). Tool results were
    undercounted by 1.69× (78k vs 131k of exact deltas; each result also carries about 35
    tokens of framing).
    (Revised: this replaced uniform scaling by `T / sum(estimates)`. That scaling inflated
    the system prompt and tool definitions by the same 1.67× even though their first-call
    size is exact.)
- bb's `usedTokens` is the last call's `totalTokens` for pi (input + output), but only the
  last call's input for Claude Code. A fully measured Claude Code breakdown therefore sums
  to `T` plus the last reply's output, which is in context for the next call.
- Whatever is not measured is then calibrated against the authoritative total `T` (bb
  `usedTokens`):
  - **pi**: measured items stay as they are. Scale only the estimated remainder so that
    the sum matches `T`. If that factor is outside 0.5–2, don't scale; show the residual
    as the `unattributed` category instead.
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
- `window.contextWindow` comes from bb, else the latest usage event, else the snapshot, else
  the window last seen for the thread (kept in `bb.storage.kv` as `window:<threadId>`), else
  for a fork its source thread's. It is null only when none of these is known.
- `notes` hold caveats only, at most 2: no `/context` snapshot, edit counts unknown from
  before the plugin was installed, remote host, steps that fell back to estimates. The basis
  line already says where the breakdown comes from.

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

- **Context ring** (replaces bb's ring at the bottom-right of the composer footer).
  (Revised: this was a one-line meter banner above the prompt; the user preferred one richer
  ring where bb's sits, with the panel unchanged.)
  - bb has no API for its ring and composer `actions` render inside the prompt box, so the
    ring is registered as a composer action (`app.composer.customize({ scopes: ["thread"],
    actions: [{ id: "ring" }] })`) that renders an invisible anchor and `createPortal`s the
    ring into a `<span data-context-plugin-ring>` it inserts in the composer's own
    `[data-follow-up-composer-footer]`, just before bb's `button[aria-label^="Context window"]`
    (or at the end of the footer's right-hand group when bb's ring is absent). A
    `MutationObserver` on the composer re-inserts the span when bb re-renders the footer.
  - A content script (`app.contentScripts.register({ id: "hide-native-ring" })`) adds one CSS
    rule hiding bb's ring only inside a footer that `:has([data-context-plugin-ring]:not(:empty))`.
    If bb changes its markup, the ring falls back to rendering inline in the action slot (next
    to the mic) and bb's ring stays visible; nothing breaks.
    (Revised: the rule matched any slot, so bb's ring vanished while ours rendered nothing,
    e.g. while loading or with basis `none`; now bb's ring shows until ours has content.)
  - The ring itself copies bb's: a 32 px round button with a 16 px progress ring of used /
    window, with the % as text to its left at every width (`11%`, `≈11%` when estimated,
    tone-coloured, inside the button). (Revised: bb shows the % only on narrow screens; the
    user asked for it always.) Ring colour follows the tone: muted below 60%
    of the usable limit (`autoCompactAt ?? window`), amber from 60%, red from 85%. `≈` and a
    dashed ring while the basis is estimated or recomputing. Renders nothing while
    `window.basis === "none"`.
  - **Hover card** (opens on hover and on keyboard focus; Radix hover card, about 320 px):
    1. `22k / 200k tokens · 11%`, with `≈` when estimated, "recomputing" when recomputing,
       and "autocompact at 167k" when known.
    2. The segmented `MeterBar` with the autocompact tick.
    3. Every used category from `meter.segments` (dot, label, tokens, % of used), largest
       first.
    4. From `useReport`, mounted only while the card is open: the 3 largest items (label,
       detail, `#turn`) and the most recent course change as one line (same wording as the
       panel's divider).
    5. "Show details" opens the Context panel. Clicking the ring opens it too
       (`useBbNavigate().openThreadPanel({ actionId: "context" })`).
- **Thread panel "Context"** (`threadPanelAction`, id `context`, layout flush):
  1. Header: used / window, a large segmented bar, the autoCompact tick, and a note on the
     basis ("measured by bb · breakdown estimated from the pi session").
  2. **What's in it**: the categories as rows (dot, label, tokens, and % of the *used*
     context; Free space shows % of the window). They expand to entries (per tool, per
     section, per file, per tool name), and toolResults entries expand to the largest single
     results, showing only the detail (`…/SKILL.md · 4.1k`). (Revised: % was of the window,
     which read "<1%" for nearly every row.)
  3. **Largest items**: the top 10 *conversation* items (messages, thinking, tool calls and
     results, summaries; never system, tools, memory, skills, or `other` harness context such
     as Claude Code's injected reminders), each with its turn number.
     A click scrolls to that turn. (Revised: tool definitions crowded the list. They are
     fixed cost and already listed in the breakdown. Claude Code's per-turn attachments
     (`sandbox_instructions`, `*_delta`) crowded it the same way, so `other` is left out too.
     They show in the breakdown under readable labels such as "MCP instructions (update)".)
  4. **Turns**: one row per user message in the active timeline, oldest first:
     - `#n`, a one-line preview, `+12.3k` added, the context after, and a small bar;
     - state: `inContext`, or `summarized` / `cleared` (greyed) for turns before the last
       compaction or clear.
     - Course changes show as divider rows where they happened:
       - "Edited here: 2 turns discarded (31k tokens)";
       - "Compacted 161k → 24k" (or "Compaction skipped: session too small");
       - "Context cleared";
       - "Forked from @thread at turn 3".
     - Row actions live in one always-visible `…` menu per row, and are disabled while the
       thread runs, with the reason as the item's description. Edit needs `editable`, which
       bb grants only to messages a user typed into this thread. Fork works from any
       completed turn. (Revised: hover actions overlaid the preview and duplicated the menu.
       Fork was tied to `editable`.)
       - **Edit from here…**: an inline editor prefilled with the message text. It shows
         "Rewinds to ≈18k (frees 40k), discards turns n…m". Confirm calls
         `sdk.threads.editMessage({ threadId, expectedRequestSequence: requestSeq,
         operationId: crypto.randomUUID(), input: [{ type: "text", text, mentions: [] }] })`.
         (Revised: this said `message`. The real args need `operationId` and an `input` array.)
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
  src/measure.ts       apportion(weights, target); attributeMeasured(base, entries): { items, fallbackSteps }
  src/events.ts        EVENT_TYPES; parseTimeline(rows: EventRow[], options?: { sourceThreadId }): Timeline
  src/piSession.ts     parsePiSession(text: string): SessionContext
  src/claudeTranscript.ts  parseClaudeTranscript(text: string): SessionContext
  src/compose.ts       composeReport(input: ComposeInput): ContextReport; toMeter(report): Meter
  src/collect.ts       createCollector(deps: { sdk: CollectSdk; fs: CollectFs; roots }): Collector
  src/ui/format.ts     formatTokens(n): string; percent(n, d); toneFor(used, limit); CATEGORY_STYLE
  src/ui/data.ts       useMeter(threadId); useReport(threadId)
  src/ui/MeterBar.tsx  <MeterBar segments total autoCompactAt size />
  src/ui/ContextRing.tsx     composer action: anchor + portal into bb's footer, ring button, hover card
  src/ui/footerSlot.ts       useFooterSlot(anchor): HTMLElement | null (insert span, observe, re-insert)
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
  measuredTokens?: number;                        // from per-call usage; absent when only estimated
}
interface SessionContext {
  items: SessionItem[]; model: string | null; compactedBeforeOrdinal: number | null;
  compactions: { tokensBefore: number | null; tokensAfter: number | null }[]; // "Compacted 161k → 24k": after = pi's first call input after the compaction, or Claude's postTokens; preferred over bb's next usage event, which can arrive turns later (Revised: was only a fallback when bb had no usage around it)
  fallbackSteps: number;
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
3. `ContextRing` gets `threadId` from `useComposer().scope`. `useMeter` sees the realtime
   signal for its thread and calls `rpc.call("meter", { threadId })`.
4. `collector.meter(threadId)` runs four steps:
   - `events.list` after the cached seq gives `parseTimeline` the current session `pi_<uuid>`
     and the dead ranges;
   - `threads.context` gives `T = 23k` (measured);
   - re-reading the session file (it grew, so only the new bytes when appended) gives a
     `toolResult` `SessionItem { category: "toolResults", label: "read", detail:
     "…/SKILL.md", estTokens: 4100 }`. Once the next assistant message lands, its usage
     sets `measuredTokens` to that call's input growth (about 4.1k plus framing);
   - `composeReport` keeps measured items and scales the rest to `T`, then returns the
     report. (Revised: this said it scaled all items by `T / sum`.)
5. The meter returns `{ window: { usedTokens: 23k, contextWindow: 1M, basis: "measured" },
   segments: [...toolResults 4.1k...], top: [...] }`.
6. The ring fills to 2%; hovering it shows the card, whose `MeterBar` draws the toolResults
   segment and whose category list includes `Tool results 4.1k`.

## Trace: "Edit from here" on turn 2

1. In the Turns list, turn 2 shows `requestSeq 19, tokensBefore 16.4k`. The user edits the
   message and confirms.
2. `sdk.threads.editMessage({ threadId, expectedRequestSequence: 19, operationId, input })` makes bb
   append `system/operation edit_message { cutoffSequence: 19, oldMaxSequence: 40 }`, a new
   `client/turn/requested`, and a `thread/identity` with the new session.
3. `experimental_thread.events` → `context-changed` → refetch → `parseTimeline` marks 19..40
   dead and switches to the new session, and the CourseChange
   `{ kind: "edited", discardedTurns: 2 }` sits before the new turn 2.
4. Until the new session's first usage arrives, `T` is null, so the meter shows `≈16.4k`
   (`tokensBefore` of the edited turn plus the estimate of the new message) and "recomputing".

## Limits

- Per-item numbers come from per-call usage where a step fits; within a step, and for
  steps that fall back, they are estimates (chars/4) calibrated to bb's measured total.
  (Revised: this said all per-item numbers were calibrated estimates.) Thinking may
  be over-attributed if the provider strips earlier thinking blocks, which is why it is its
  own category.
- Only pi and Claude Code have breakdowns. Other providers get the bb total and a single
  `unattributed` segment.
- A thread on a remote host: session files are read on the plugin server's machine.
  Breakdown is unavailable for remote threads (basis from bb only).
