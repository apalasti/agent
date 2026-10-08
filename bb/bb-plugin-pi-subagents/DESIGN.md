# bb-plugin-pi-subagents — design

Makes pi subagents (`@tintinweb/pi-subagents` 0.19: the `Agent` tool and `SubagentWorkflow` runs) in a bb thread on
the pi provider observable and actionable. Plugin id `pi-subagents`, display name "Subagents".
This replaced the Claude Code design (`bb-plugin-claude-subagents`, which read `~/.claude/projects/`); Claude Code
support is dropped.

Principle: every element on screen is either something to act on or tells you whether to act.

## What the user sees

- **Header pill** (`experimental_threadHeaderAction`), hidden when the thread has no top-level agents or workflows.
  Workflow children are never counted as agents.
  - Anything running: spinner and a label — "N running" for top-level agents, "N running · M workflow(s)" when
    workflows run too, "Workflow: <name>" when one workflow runs alone, "M workflows running" for several — then
    the newest running agent's live label (`bash: npm test · 12s`; hidden on compact viewports). Tooltip: each
    running workflow with its finished-agent count, each running agent with model, context % and live label.
  - Nothing running: green "N done", amber "N need a look" (failed or no report), else grey "N unknown", over
    top-level agents and workflows together.
  - Click opens the panel.
- **Panel** (`threadPanelAction`, layout `flush`) with in-panel navigation between three views:
  - **Card list**: workflow cards (running first, then newest), then top-level agent cards (same order).
    Empty: "No pi subagents or workflows in this thread."
  - **Agent card** (rounded `bg-muted/40`, muted text):
    1. description
    2. agent type · status word · duration (live while running)
    3. model (`Sonnet 5.5`) · `162.3k tokens` · `44 tool uses` · link-colored **View transcript**
    4. running only: live label (`bash: npm test · 12s`, or "thinking")
  - **Workflow card**, same shape: name; `Workflow` · status · duration; `N phases` · `k/n agents` (k = finished
    journal entries, n = children seen) · tokens once finished · **View agents**; the run's error in red, if any.
  - **Workflow view**: `<` back to the list, name, description, phases joined by `·`, then its children as agent
    cards in start order.
  - **Transcript view**: `<` back (to wherever it was opened from), description as title, `Model Sonnet 5.5`, the
    prompt in a card (host `Markdown`, clamped to 15rem with a bottom fade and "Show more"/"Show less" when it
    overflows; a copy button under it copies the raw prompt), a muted activity summary with a chevron that expands
    into the step list (time, tool, summary, duration or spinner; click for input/result), then the report
    (`Markdown`), the live label with a spinner while running, or amber "No report handed back".
    Actions, top-level agents only: `Steer…` while running drafts "Use steer_subagent on agent `<id>`: ";
    `Follow up…` otherwise drafts "Resume agent `<id>` (Agent tool, resume) and ". Both insert into the thread
    composer (`useComposer().insert(text, { at: "end", block: true })`); the user sends. Workflow children get no
    actions: those tools cannot address them. pi-subagents has no stop tool, so there is no `Stop…`.
  - A view whose agent or workflow vanished from the data falls back to the card list.
- Status words and colors:

  | Status | Word | Means |
  | --- | --- | --- |
  | `running` | spinner "Running" | working; watch the live line |
  | `done` | "Completed" | finished and handed back a report |
  | `needs-look` | amber "No report" | finished without a report |
  | `failed` | red "Failed" | errored, stopped or aborted |
  | `unknown` | "Unknown" | no completion record and transcript idle without ending its turn |

- Activity summary grouping (`activitySummary`): bash → "ran N command(s)"; read → "read <basename>" for one
  distinct file else "read N files"; edit/write → "edited <basename>" / "edited N files"; grep/find/ls →
  "searched once" / "searched N times"; anything else → "used a tool" / "used N tools"; failures as "(N failed)";
  groups in that order, comma-joined, first letter capitalised. Text steps are not counted.

## Data sources (local, read-only)

| Fact | Source |
| --- | --- |
| thread → pi session file | bb event `thread/identity` `providerThreadId` → `~/.bb/pi-bridge-sessions/<providerThreadId>.jsonl` |
| session id, cwd | that file's first line `{type:"session", id, cwd}` |
| lead model + context | parent file: last `model_change`, last assistant `message.usage` |
| agent spawned | parent file: `toolResult` `toolName:"Agent"`, `details.{agentId, subagentType, modelName, description}` |
| agent finished | parent file: `custom` `customType:"subagents:record"` `data.{id,status,result,error,startedAt,completedAt}` |
| agent tokens/duration | parent file: `custom_message` `customType:"subagent-notification"` `details.{totalTokens,durationMs,status}` and each of `details.others` |
| agent transcript | child session in `~/.pi/agent/sessions/--<cwd>--/` whose header `parentSession` is the parent file and whose `session_info.name` ends `#<agentId[0..8]>`; else `$TMPDIR/pi-subagents-<uid>/<encodeCwd>/<sessionId>/tasks/<agentId>.output` |
| workflow run | parent file: `toolResult` `toolName:"SubagentWorkflow"`, `details.taskId`, `Script:` line → task dir |
| workflow meta | `<runId>.workflow.js` `export const meta = {…}` (`name`, `description`, `phases[].title`) |
| workflow progress | `<runId>.workflow.jsonl` lines `{index, ok}`, deduped by index; a partial last line is skipped |
| workflow finished | `subagent-notification` whose task id is the run id |
| workflow children | child sessions of this parent not owned by an `Agent` spawn, attributed to the latest run whose window (start → end, or now) contains their first line |

Status, agent: record/notification `completed` or `steered` → done/needs-look by report; `error|stopped|aborted` →
failed; transcript written <90s ago → running; last assistant turn ended → done/needs-look; else unknown.
Workflow child: turn ended → done/needs-look; written <90s ago while the run is unfinished → running; else unknown.
Workflow: notification `completed` → done; failed statuses → failed; journal or a child written <90s ago → running;
else unknown.

Known limits: workflow children carry no label or phase on disk, so they are titled by their prompt's first line;
two concurrent workflows in one thread can mix children; a run killed with pi shows `unknown` once idle >90s; a
foreground `Agent` call (`run_in_background: false`) has no `toolResult` until it finishes, so while it runs it is
not shown, or is listed under a workflow that runs at the same time.

## Files

```
package.json            id/name/description, scripts typecheck + test
app.tsx                 definePluginApp: header action + panel action (both id "pi-subagents")
server.ts               createPlugin(store, now): rpc threadAgents; per-thread incremental event fold
src/contract.ts         zod schemas (Step, FileChange, AgentStatus, Agent, Workflow, ThreadAgents) + rpcContract
src/events.ts           fold thread/identity → providerThreadId
src/piSession.ts        pure parser of pi session / .output jsonl; summarizeTool, changesFromArgs, contextWindow
src/parent.ts           pure line-at-a-time fold of the parent session (spawns, records, notifications, workflow launches)
src/workflow.ts         pure parseMeta(js), parseJournal(jsonl)
src/assemble.ts         pure join → { agents, workflows }; deriveAgentStatus, ownsAgent
src/sessions.ts         fs store: tails the parent file, indexes child sessions, reads task dirs, caches by size:mtime
src/text.ts             firstLine
src/ui/format.ts        duration, elapsed, kTokens, clock, shortModel
src/ui/live.ts          liveState, liveLabel
src/ui/activity.ts      activitySummary
src/ui/useThreadAgents.ts  polling hook (2s while anything runs, else 15s; drops stale responses), useNow
src/ui/Card.tsx         Card, CardTitle, CardLine, LinkButton, StatusWord, Spinner
src/ui/ViewHeader.tsx   `<` back + title
src/ui/AgentCard.tsx    AgentCard({ agent, now, onViewTranscript })
src/ui/WorkflowCard.tsx WorkflowCard({ workflow, children, now, onViewAgents })
src/ui/CardList.tsx     CardList({ data, now, onOpen(view) })
src/ui/WorkflowView.tsx WorkflowView({ workflow, children, now, onBack, onOpenAgent })
src/ui/TranscriptView.tsx  TranscriptView({ agent, now, onBack }): PromptCard, ActivitySummary, steps, report, actions
src/ui/SubagentsPanel.tsx  View = list | workflow(runId) | agent(agentId, from: View); renders the views above
src/ui/HeaderPill.tsx   PANEL_ACTION_ID, pill
test/fixtures/          trimmed real pi files: parent session, child sessions, an .output file, a workflow run
```

## Trace: one workflow child's tokens on its card

pi-subagents' workflow runtime spawns a child; pi writes `~/.pi/agent/sessions/--<cwd>--/<ts>_<uuid>.jsonl` with
header `parentSession` = `~/.bb/pi-bridge-sessions/pi_X.jsonl`, then assistant lines with `message.usage` → the
panel polls rpc `threadAgents({ threadId })` → the server folds bb events → `providerThreadId = pi_X` →
`store.readThread("pi_X")` tails the parent file (a new `SubagentWorkflow` toolResult → `WorkflowLaunch{ runId,
scriptPath, at }`), lists the child dir, reads the new file's header (parentSession matches) and parses it
(`PiTranscript.totalTokens` sums input + output + cacheWrite per call) → `assemble` finds no spawn owning it, sees
`firstAt` inside the run's window → `Agent{ workflowId: runId, totalTokens, steps }` → `CardList` counts it in the
`WorkflowCard`'s `k/n agents`; "View agents" → `WorkflowView` renders its `AgentCard`: `162.3k tokens · 44 tool uses`.

## Tests (vitest)

- `piSession`, `parent`, `workflow`, `assemble`, `sessions`, `server`, `events` — against the real pi fixtures and
  synthetic lines.
- `format.test.ts` — `shortModel`, `duration`, `elapsed`, `kTokens`.
- `live.test.ts` — starting / in flight / thinking; `liveLabel`.
- `activity.test.ts` — grouping, distinct files, singulars, failures.
- `panel.test.tsx` — card text, ordering and status words, list → transcript → back, list → workflow → child
  transcript → workflow → list, prompt clamp and copy, activity expansion, `Steer…`/`Follow up…` drafts with the
  agent id, no actions on workflow children, empty state, header pill labels, polling races.
