import type { Agent, AgentStatus } from "./contract";
import type { TaskFacts } from "./events";
import { contextWindow, type Transcript } from "./transcript";

export type AgentMeta = { agentType?: string; description?: string; toolUseId?: string; model?: string };
export type AgentSource = { agentId: string; meta: AgentMeta; transcript: Transcript; mtimeMs: number };

const RECENTLY_WRITTEN_MS = 90_000;

const finished = (transcript: Transcript): AgentStatus => (transcript.report?.trim() ? "done" : "needs-look");

export function deriveStatus(src: AgentSource, task: TaskFacts | undefined, now: number): AgentStatus {
  if (task?.status === "completed" || src.transcript.handedBack) return finished(src.transcript);
  if (task?.status === "failed" || task?.status === "killed") return "failed";
  if (task?.status === "running" || now - src.mtimeMs < RECENTLY_WRITTEN_MS) return "running";
  if (src.transcript.endedTurn) return finished(src.transcript);
  return "unknown";
}

function parentOf(src: AgentSource, sources: AgentSource[]): string | null {
  const toolUseId = src.meta.toolUseId;
  if (!toolUseId) return null;
  return sources.find((other) => other !== src && other.transcript.toolUseIds.has(toolUseId))?.agentId ?? null;
}

function toAgent(src: AgentSource, sources: AgentSource[], task: TaskFacts | undefined, now: number): Agent {
  const { transcript, meta } = src;
  const status = deriveStatus(src, task, now);
  const model = transcript.model ?? meta.model ?? null;
  return {
    agentId: src.agentId,
    parentAgentId: parentOf(src, sources),
    description: meta.description ?? src.agentId,
    agentType: meta.agentType ?? "agent",
    model,
    status,
    startedAt: transcript.firstAt ?? task?.startedAt ?? null,
    endedAt: status === "running" ? null : (task?.endedAt ?? transcript.lastAt),
    prompt: transcript.prompt,
    report: transcript.report,
    steps: transcript.steps,
    files: transcript.files,
    errors: transcript.steps.filter((step) => step.isError).length,
    totalTokens: task?.totalTokens ?? null,
    context: transcript.context,
    contextWindow: contextWindow(model, transcript.peakContext),
  };
}

export function assembleAgents(sources: AgentSource[], tasks: Map<string, TaskFacts>, now: number): Agent[] {
  return sources
    .map((src) => toAgent(src, sources, tasks.get(src.agentId), now))
    .sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0));
}
