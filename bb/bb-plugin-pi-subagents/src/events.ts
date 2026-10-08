export type EventRow = { seq: number | string; type: string; createdAt: number; data: unknown };
export type ThreadFacts = { providerThreadId: string | null };

export const EVENT_TYPES = ["thread/identity"] as const;

export function foldEvents(rows: EventRow[], into: ThreadFacts = { providerThreadId: null }): ThreadFacts {
  for (const row of rows) {
    const data = (row.data ?? {}) as { providerThreadId?: string };
    if (row.type === "thread/identity" && data.providerThreadId) into.providerThreadId = data.providerThreadId;
  }
  return into;
}
