export interface EventRow {
  seq: number;
  type: string;
  createdAt: number;
  data: unknown;
}

export const EVENT_TYPES = ["thread/identity", "turn/started", "turn/completed", "item/started", "item/completed"] as const;

export interface SubagentLaunch {
  callId: string;
  description: string;
  type: string;
  prompt: string;
  model: string | null;
  requestedBackground: boolean | null;
  startedAt: number;
  completedAt: number | null;
  /** Raw text of the `Agent` tool result, absent until the call returns. */
  resultText: string | null;
  failed: boolean;
  agentId: string | null;
  outputFile: string | null;
  background: boolean | null;
}

export interface AgentStatusRef {
  status: string;
  text: string;
  at: number;
}

export interface LaunchState {
  lastSeq: number;
  launches: Map<string, SubagentLaunch>;
  providerThreadIds: string[];
  lastTurnStartedSeq: number;
  lastTurnCompletedSeq: number;
  /** Latest `get_subagent_result` reading per agent id. */
  statusRefs: Map<string, AgentStatusRef>;
}

export function emptyLaunchState(): LaunchState {
  return {
    lastSeq: 0,
    launches: new Map(),
    providerThreadIds: [],
    lastTurnStartedSeq: 0,
    lastTurnCompletedSeq: 0,
    statusRefs: new Map(),
  };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const str = (value: unknown): string | null => (typeof value === "string" ? value : null);

const BACKGROUND_RESULT = /^(?:.*\n)?Agent (?:started|queued|resumed) in background\./;

export function parseLaunchResult(text: string): { agentId: string | null; outputFile: string | null; background: boolean } {
  return {
    agentId: /^Agent ID: (\S+)$/m.exec(text)?.[1] ?? null,
    outputFile: /^Output file: (.+\.output)$/m.exec(text)?.[1] ?? null,
    background: BACKGROUND_RESULT.test(text),
  };
}

export function parseStatusRef(text: string): { agentId: string; status: string } | null {
  const match = /^Agent: (\S+)\n.*\| Status: ([a-z]+)/.exec(text);
  return match?.[1] && match[2] ? { agentId: match[1], status: match[2] } : null;
}

function resultText(result: unknown): string | null {
  if (typeof result === "string") return result;
  if (Array.isArray(result)) {
    const texts = result.flatMap((block) => (isRecord(block) && typeof block.text === "string" ? [block.text] : []));
    return texts.length > 0 ? texts.join("\n") : null;
  }
  return null;
}

function applyToolCall(state: LaunchState, row: EventRow, item: Record<string, unknown>) {
  const callId = str(item.id);
  if (callId === null) return;
  const args = isRecord(item.arguments) ? item.arguments : {};
  const completed = row.type === "item/completed";

  if (item.tool === "Agent") {
    const launch = state.launches.get(callId) ?? {
      callId,
      description: str(args.description) ?? "",
      type: str(args.subagent_type) ?? "general-purpose",
      prompt: str(args.prompt) ?? "",
      model: str(args.model),
      requestedBackground: typeof args.run_in_background === "boolean" ? args.run_in_background : null,
      startedAt: row.createdAt,
      completedAt: null,
      resultText: null,
      failed: false,
      agentId: null,
      outputFile: null,
      background: null,
    };
    if (completed) {
      const text = resultText(item.result) ?? "";
      const parsed = parseLaunchResult(text);
      launch.completedAt = row.createdAt;
      launch.resultText = text;
      launch.failed = item.status === "failed" || text.startsWith("Agent failed:");
      launch.agentId = parsed.agentId;
      launch.outputFile = parsed.outputFile;
      launch.background = parsed.background;
    }
    state.launches.set(callId, launch);
    return;
  }

  if (item.tool === "get_subagent_result" && completed) {
    const text = resultText(item.result);
    const ref = text === null ? null : parseStatusRef(text);
    if (ref !== null && text !== null) state.statusRefs.set(ref.agentId, { status: ref.status, text, at: row.createdAt });
  }
}

/** Folds new event rows (ascending seq) into the state; rows at or below `lastSeq` are ignored. */
export function applyEvents(state: LaunchState, rows: readonly EventRow[]): LaunchState {
  for (const row of rows) {
    if (row.seq <= state.lastSeq) continue;
    state.lastSeq = row.seq;
    const data = isRecord(row.data) ? row.data : {};
    const providerThreadId = str(data.providerThreadId);
    if (providerThreadId !== null && !state.providerThreadIds.includes(providerThreadId)) {
      state.providerThreadIds.push(providerThreadId);
    }
    if (row.type === "turn/started") state.lastTurnStartedSeq = row.seq;
    else if (row.type === "turn/completed") state.lastTurnCompletedSeq = row.seq;
    else if ((row.type === "item/started" || row.type === "item/completed") && isRecord(data.item)) {
      if (data.item.type === "toolCall") applyToolCall(state, row, data.item);
    }
  }
  return state;
}

export const parseLaunches = (rows: readonly EventRow[]): LaunchState => applyEvents(emptyLaunchState(), rows);

export const turnActive = (state: LaunchState): boolean => state.lastTurnStartedSeq > state.lastTurnCompletedSeq;
