export interface SessionRecord {
  id: string;
  type: string | null;
  description: string | null;
  status: string;
  result: string | null;
  error: string | null;
  startedAt: number | null;
  completedAt: number | null;
}

/** An `Agent` tool result as pi persisted it; foreground results carry the agent id only here. */
export interface SessionAgentResult {
  toolCallId: string;
  agentId: string | null;
  description: string | null;
  subagentType: string | null;
  modelName: string | null;
  status: string | null;
  isError: boolean;
}

export interface SessionState {
  offset: number;
  sessionId: string | null;
  cwd: string | null;
  records: Map<string, SessionRecord>;
  agentResults: SessionAgentResult[];
}

export function emptySession(): SessionState {
  return { offset: 0, sessionId: null, cwd: null, records: new Map(), agentResults: [] };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const str = (value: unknown): string | null => (typeof value === "string" ? value : null);
const num = (value: unknown): number | null => (typeof value === "number" ? value : null);

// Session files reach megabytes; only these lines are worth a JSON.parse.
const INTERESTING = ['"type":"session"', '"subagents:record"', '"toolName":"Agent"'];

function applyLine(state: SessionState, line: string) {
  if (!INTERESTING.some((marker) => line.includes(marker))) return;
  let entry: unknown;
  try {
    entry = JSON.parse(line);
  } catch {
    return;
  }
  if (!isRecord(entry)) return;
  if (entry.type === "session") {
    state.sessionId = str(entry.id);
    state.cwd = str(entry.cwd);
    return;
  }
  if (entry.type === "custom" && entry.customType === "subagents:record" && isRecord(entry.data)) {
    const data = entry.data;
    const id = str(data.id);
    if (id === null) return;
    state.records.set(id, {
      id,
      type: str(data.type),
      description: str(data.description),
      status: str(data.status) ?? "completed",
      result: str(data.result),
      error: str(data.error),
      startedAt: num(data.startedAt),
      completedAt: num(data.completedAt),
    });
    return;
  }
  if (entry.type === "message" && isRecord(entry.message)) {
    const message = entry.message;
    if (message.role !== "toolResult" || message.toolName !== "Agent") return;
    const details = isRecord(message.details) ? message.details : {};
    state.agentResults.push({
      toolCallId: str(message.toolCallId) ?? "",
      agentId: str(details.agentId),
      description: str(details.description),
      subagentType: str(details.subagentType),
      modelName: str(details.modelName),
      status: str(details.status),
      isError: message.isError === true,
    });
  }
}

/** Consumes complete lines of `chunk`, which starts at `state.offset`; returns the bytes consumed. */
export function appendSession(state: SessionState, chunk: Buffer): number {
  const end = chunk.lastIndexOf(0x0a);
  if (end === -1) return 0;
  for (const line of chunk.subarray(0, end).toString("utf8").split("\n")) applyLine(state, line);
  state.offset += end + 1;
  return end + 1;
}

export function parseSession(text: string): SessionState {
  const state = emptySession();
  appendSession(state, Buffer.from(text.endsWith("\n") ? text : `${text}\n`, "utf8"));
  return state;
}

/** pi-subagents' task directory name for a cwd (its `encodeCwd`). */
export function encodeCwd(cwd: string): string {
  return cwd
    .replace(/[/\\]/g, "-")
    .replace(/^[A-Za-z]:-/, "")
    .replace(/^-+/, "");
}
