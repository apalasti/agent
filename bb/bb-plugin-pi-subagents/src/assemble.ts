import type { Agent, AgentStatus, Workflow } from "./contract";
import type { NotificationFact, ParentFacts, PendingCall, RecordFact, SpawnFact, WorkflowLaunch } from "./parent";
import { contextWindow, type PiTranscript } from "./piSession";
import { firstLine } from "./text";
import type { Journal, WorkflowMeta } from "./workflow";

export type ChildSource = { path: string; transcript: PiTranscript; mtimeMs: number };
export type WorkflowSource = { launch: WorkflowLaunch; meta: WorkflowMeta; journal: Journal; journalMtimeMs: number | null };

const RECENTLY_WRITTEN_MS = 90_000;
const COMPLETED = new Set(["completed", "steered"]);
const FAILED = new Set(["error", "stopped", "aborted"]);

/** pi-subagents names an agent's session `<Type>#<first 8 chars of its id>`. */
export const ownsAgent = (name: string | null, agentId: string) => name?.endsWith(`#${agentId.slice(0, 8)}`) ?? false;

const finished = (report: string | null): AgentStatus => (report ? "done" : "needs-look");

const reportOf = (record: RecordFact | undefined, transcript: PiTranscript | null) =>
  (record?.result?.trim() ? record.result : null) ?? transcript?.report ?? null;

export function deriveAgentStatus(
  record: RecordFact | undefined,
  notification: NotificationFact | undefined,
  transcript: PiTranscript | null,
  mtimeMs: number,
  now: number,
): AgentStatus {
  const status = record?.status ?? notification?.status;
  if (status && COMPLETED.has(status)) return finished(reportOf(record, transcript));
  if (status && FAILED.has(status)) return "failed";
  if (now - mtimeMs < RECENTLY_WRITTEN_MS) return "running";
  if (transcript?.endedTurn) return finished(transcript.report);
  return "unknown";
}

function deriveChildStatus(child: ChildSource, runFinished: boolean, now: number): AgentStatus {
  if (child.transcript.endedTurn) return finished(child.transcript.report);
  if (!runFinished && now - child.mtimeMs < RECENTLY_WRITTEN_MS) return "running";
  return "unknown";
}

const emptyActivity = { prompt: "", steps: [], files: [], context: 0, peakContext: 0 };

function spawnedAgent(parent: ParentFacts, spawn: SpawnFact, source: ChildSource | undefined, now: number): Agent {
  const transcript = source?.transcript ?? null;
  const record = parent.records.get(spawn.agentId);
  const notification = parent.notifications.get(spawn.agentId);
  const status = deriveAgentStatus(record, notification, transcript, source?.mtimeMs ?? spawn.at, now);
  const model = transcript?.model ?? spawn.modelHint;
  const startedAt = record?.startedAt ?? transcript?.firstAt ?? spawn.at;
  const durationMs = notification?.durationMs;
  const endedAt = record?.completedAt ?? (durationMs ? startedAt + durationMs : (transcript?.lastAt ?? null));
  const { prompt, steps, files, context, peakContext } = transcript ?? emptyActivity;
  return {
    agentId: spawn.agentId,
    parentAgentId: null,
    description: spawn.description,
    agentType: spawn.agentType,
    model,
    status,
    startedAt,
    endedAt: status === "running" ? null : endedAt,
    prompt,
    report: reportOf(record, transcript),
    steps,
    files,
    errors: steps.filter((step) => step.isError).length,
    totalTokens: notification?.totalTokens ?? transcript?.totalTokens ?? null,
    context,
    contextWindow: contextWindow(model, peakContext, spawn.modelHint),
    workflowId: null,
    callId: spawn.toolCallId || null,
    pending: false,
  };
}

function pendingAgent(parent: ParentFacts, call: PendingCall, source: ChildSource | undefined, now: number): Agent {
  const spawn = { ...call, agentId: call.toolCallId };
  return { ...spawnedAgent(parent, spawn, source, now), pending: true };
}

/** pi writes no agent id until a foreground call returns, but the child session starts with the call's prompt. */
const runsCall = (child: ChildSource, call: PendingCall) =>
  child.transcript.prompt === call.prompt && child.transcript.firstAt !== null && child.transcript.firstAt >= call.at;

function childAgent(child: ChildSource, runId: string, runFinished: boolean, now: number): Agent {
  const { transcript } = child;
  const status = deriveChildStatus(child, runFinished, now);
  return {
    agentId: transcript.sessionId ?? child.path,
    parentAgentId: null,
    description: firstLine(transcript.prompt) || (transcript.name ?? runId),
    agentType: transcript.name?.split("#")[0] || "agent",
    model: transcript.model,
    status,
    startedAt: transcript.firstAt,
    endedAt: status === "running" ? null : transcript.lastAt,
    prompt: transcript.prompt,
    report: transcript.report,
    steps: transcript.steps,
    files: transcript.files,
    errors: transcript.steps.filter((step) => step.isError).length,
    totalTokens: transcript.totalTokens,
    context: transcript.context,
    contextWindow: contextWindow(transcript.model, transcript.peakContext),
    workflowId: runId,
    callId: null,
    pending: false,
  };
}

type Run = { source: WorkflowSource; notification: NotificationFact | undefined; end: number; children: ChildSource[] };

function toWorkflow(run: Run, now: number): Workflow {
  const { source, notification, children } = run;
  const { launch, meta, journal } = source;
  const lastActivity = Math.max(launch.at, source.journalMtimeMs ?? 0, ...children.map((child) => child.mtimeMs));
  let status: AgentStatus;
  if (notification?.status === "completed") status = "done";
  else if (notification && FAILED.has(notification.status)) status = "failed";
  else if (now - lastActivity < RECENTLY_WRITTEN_MS) status = "running";
  else status = "unknown";
  return {
    runId: launch.runId,
    name: meta.name ?? launch.runId,
    description: meta.description,
    status,
    phases: meta.phases,
    startedAt: launch.at,
    endedAt: notification ? run.end : status === "running" ? null : lastActivity,
    done: journal.done,
    failed: journal.failed,
    totalTokens: notification?.totalTokens ?? null,
    error: notification?.error ?? null,
  };
}

export function assemble(
  parent: ParentFacts,
  children: ChildSource[],
  outputs: Map<string, ChildSource>,
  workflows: WorkflowSource[],
  now: number,
): { agents: Agent[]; workflows: Workflow[] } {
  const spawns = [...parent.spawns.values()];
  const owned = new Set<ChildSource>();
  const agents = spawns.map((spawn) => {
    const child = children.find((candidate) => ownsAgent(candidate.transcript.name, spawn.agentId));
    if (child) owned.add(child);
    return spawnedAgent(parent, spawn, child ?? outputs.get(spawn.agentId), now);
  });
  for (const call of [...parent.pending.values()].sort((a, b) => a.at - b.at)) {
    const child = children
      .filter((candidate) => !owned.has(candidate) && runsCall(candidate, call))
      .sort((a, b) => a.transcript.firstAt! - b.transcript.firstAt!)[0];
    if (child) owned.add(child);
    agents.push(pendingAgent(parent, call, child, now));
  }

  const runs: Run[] = workflows
    .map((source) => {
      const notification = parent.notifications.get(source.launch.runId);
      const end = notification ? source.launch.at + (notification.durationMs ?? 0) : now;
      return { source, notification, end, children: [] as ChildSource[] };
    })
    .sort((a, b) => b.source.launch.at - a.source.launch.at);
  for (const child of children) {
    const startedAt = child.transcript.firstAt;
    if (owned.has(child) || startedAt === null) continue;
    runs.find((run) => run.source.launch.at <= startedAt && startedAt <= run.end)?.children.push(child);
  }
  for (const run of runs)
    for (const child of run.children) agents.push(childAgent(child, run.source.launch.runId, run.notification !== undefined, now));

  return {
    agents: agents.sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0)),
    workflows: runs.map((run) => toWorkflow(run, now)).sort((a, b) => a.startedAt - b.startedAt),
  };
}
