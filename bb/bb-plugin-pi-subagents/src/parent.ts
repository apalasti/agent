export type SpawnFact = {
  agentId: string;
  agentType: string;
  description: string;
  modelHint: string | null;
  at: number;
  toolCallId: string;
};
export type RecordFact = {
  status: string;
  result: string | null;
  error: string | null;
  startedAt: number | null;
  completedAt: number | null;
};
export type NotificationFact = { status: string; totalTokens: number | null; durationMs: number | null; error: string | null };
export type WorkflowLaunch = { runId: string; scriptPath: string; at: number };
export type ParentFacts = {
  header: { id: string; cwd: string; at: number } | null;
  model: string | null;
  context: number;
  peakContext: number;
  spawns: Map<string, SpawnFact>;
  records: Map<string, RecordFact>;
  notifications: Map<string, NotificationFact>;
  workflows: Map<string, WorkflowLaunch>;
};

type Details = Record<string, unknown>;
type Line = {
  type?: string;
  customType?: string;
  timestamp?: string;
  id?: string;
  cwd?: string;
  provider?: string;
  modelId?: string;
  data?: Details;
  details?: Details;
  message?: {
    role?: string;
    toolName?: string;
    toolCallId?: string;
    content?: { type?: string; text?: string }[] | string;
    details?: Details;
    provider?: string;
    model?: string;
    usage?: { input?: number; cacheRead?: number; cacheWrite?: number };
  };
};

export function emptyParentFacts(): ParentFacts {
  return {
    header: null,
    model: null,
    context: 0,
    peakContext: 0,
    spawns: new Map(),
    records: new Map(),
    notifications: new Map(),
    workflows: new Map(),
  };
}

const str = (value: unknown) => (typeof value === "string" ? value : null);
const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : null);

function text(content: NonNullable<Line["message"]>["content"]): string {
  if (typeof content === "string") return content;
  return (content ?? []).map((part) => part.text ?? "").join("\n");
}

const field = (body: string, label: string) => new RegExp(`^${label}: (.+)$`, "m").exec(body)?.[1]?.trim() ?? null;

function notification(details: Details): NotificationFact {
  return {
    status: str(details.status) ?? "unknown",
    totalTokens: num(details.totalTokens),
    durationMs: num(details.durationMs),
    error: str(details.error),
  };
}

/** Folds one line of the parent session into `into`; unparsable lines (a partial tail) are ignored. */
export function foldParentLine(raw: string, into: ParentFacts): ParentFacts {
  let line: Line;
  try {
    line = JSON.parse(raw) as Line;
  } catch {
    return into;
  }
  const at = line.timestamp ? Date.parse(line.timestamp) : NaN;

  if (line.type === "session" && line.id) {
    into.header = { id: line.id, cwd: line.cwd ?? "", at: Number.isNaN(at) ? 0 : at };
    return into;
  }
  if (line.type === "model_change" && line.modelId) {
    into.model = line.provider ? `${line.provider}/${line.modelId}` : line.modelId;
    return into;
  }
  if (line.type === "custom" && line.customType === "subagents:record" && line.data) {
    const data = line.data;
    const id = str(data.id);
    if (id)
      into.records.set(id, {
        status: str(data.status) ?? "unknown",
        result: str(data.result),
        error: str(data.error),
        startedAt: num(data.startedAt),
        completedAt: num(data.completedAt),
      });
    return into;
  }
  if (line.type === "custom_message" && line.customType === "subagent-notification" && line.details) {
    const all = [line.details, ...(Array.isArray(line.details.others) ? (line.details.others as Details[]) : [])];
    for (const details of all) {
      const id = str(details.id);
      if (id) into.notifications.set(id, notification(details));
    }
    return into;
  }

  const message = line.message;
  if (line.type !== "message" || !message) return into;
  if (message.role === "assistant") {
    if (message.model) into.model = message.provider ? `${message.provider}/${message.model}` : message.model;
    if (message.usage) {
      into.context = (message.usage.input ?? 0) + (message.usage.cacheRead ?? 0) + (message.usage.cacheWrite ?? 0);
      into.peakContext = Math.max(into.peakContext, into.context);
    }
    return into;
  }
  if (message.role !== "toolResult" || Number.isNaN(at)) return into;
  const details = message.details ?? {};
  const body = text(message.content);

  if (message.toolName === "Agent") {
    const agentId = str(details.agentId);
    if (!agentId || into.spawns.has(agentId)) return into;
    into.spawns.set(agentId, {
      agentId,
      agentType: str(details.subagentType) ?? field(body, "Type") ?? "agent",
      description: str(details.description) ?? field(body, "Description") ?? agentId,
      modelHint: str(details.modelName),
      at,
      toolCallId: message.toolCallId ?? "",
    });
    return into;
  }
  if (message.toolName === "SubagentWorkflow") {
    const runId = str(details.taskId) ?? field(body, "Task ID");
    const scriptPath = field(body, "Script");
    if (runId && scriptPath && !into.workflows.has(runId)) into.workflows.set(runId, { runId, scriptPath, at });
  }
  return into;
}
