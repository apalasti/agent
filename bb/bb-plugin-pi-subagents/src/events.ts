export type TaskFacts = { status: string; startedAt: number; endedAt: number | null; totalTokens: number | null };
export type EventRow = { seq: number | string; type: string; createdAt: number; data: unknown };
export type ThreadFacts = { sessionId: string | null; tasks: Map<string, TaskFacts> };

export const EVENT_TYPES = ["thread/identity", "item/started", "item/backgroundTask/completed"] as const;

type EventData = {
  providerThreadId?: string;
  item?: {
    type?: string;
    taskType?: string;
    familyId?: string;
    taskStatus?: string;
    status?: string;
    usage?: { totalTokens?: number };
  };
};

export function foldEvents(rows: EventRow[], into: ThreadFacts = { sessionId: null, tasks: new Map() }): ThreadFacts {
  for (const row of rows) {
    const data = (row.data ?? {}) as EventData;
    if (row.type === "thread/identity" && data.providerThreadId) into.sessionId = data.providerThreadId;
    const item = data.item;
    if (item?.type !== "backgroundTask" || item.taskType !== "local_agent" || !item.familyId) continue;
    const previous = into.tasks.get(item.familyId);
    into.tasks.set(item.familyId, {
      status: item.taskStatus ?? item.status ?? "unknown",
      startedAt: previous?.startedAt ?? row.createdAt,
      endedAt: row.type === "item/backgroundTask/completed" ? row.createdAt : null,
      totalTokens: item.usage?.totalTokens ?? previous?.totalTokens ?? null,
    });
  }
  return into;
}
