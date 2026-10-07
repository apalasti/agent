import type { CourseChange } from "./contract";

export const EVENT_TYPES = [
  "client/turn/requested",
  "turn/started",
  "turn/completed",
  "thread/identity",
  "system/operation",
  "thread/compacted",
  "thread/context/cleared",
  "thread/contextWindowUsage/updated",
  "item/started",
  "provider/warning",
] as const;

export interface EventRow {
  seq: number;
  type: string;
  /** ISO string; the SDK returns epoch ms, normalized by the adapter. */
  createdAt: string;
  data: unknown;
}

export interface TurnFact {
  requestSeq: number;
  lastSeq: number;
  at: string;
  text: string;
  providerThreadId: string | null;
  /** bb edits only messages a user typed into this thread, not ones sent by agents or other threads. */
  userSent: boolean;
}

export interface UsagePoint {
  seq: number;
  at: string;
  providerThreadId: string | null;
  usedTokens: number | null;
  window: number | null;
}

export interface Timeline {
  currentProviderThreadId: string | null;
  /** Active user messages, oldest first. */
  turns: TurnFact[];
  usage: UsagePoint[];
  courseChanges: CourseChange[];
  deadRanges: [number, number][];
}

export interface TimelineOptions {
  /** The thread's `sourceThreadId` when it is a fork. */
  sourceThreadId?: string | null;
}

const asRecord = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
const asNumber = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);

type Request = { kind: "message"; text: string; userSent: boolean } | { kind: "command"; name: string } | { kind: "start" } | null;

/** A thread's first message arrives as `thread/start` with input; a fork's own start has none. */
function classifyRequest(data: Record<string, unknown>): Request {
  const method = asRecord(data.request).method;
  if (method !== "turn/start" && method !== "thread/start") return null;
  const input = Array.isArray(data.input) ? data.input : [];
  const texts: string[] = [];
  const commands: string[] = [];
  for (const raw of input) {
    const part = asRecord(raw);
    if (part.type !== "text" || typeof part.text !== "string") continue;
    texts.push(part.text);
    for (const mention of Array.isArray(part.mentions) ? part.mentions : []) {
      const resource = asRecord(asRecord(mention).resource);
      if (resource.kind === "command" && typeof resource.name === "string") commands.push(resource.name);
    }
  }
  const text = texts.join("\n");
  if (text.trim() === "") return method === "thread/start" ? { kind: "start" } : null;
  if (commands.length === 1 && text.trim() === `/${commands[0]}`) return { kind: "command", name: commands[0] as string };
  const target = asRecord(data.target).kind;
  const userSent = data.initiator === "user" && data.senderThreadId == null && (target === "new-turn" || target === "thread-start") && data.inputGroups === undefined;
  return { kind: "message", text, userSent };
}

const providerOf = (data: unknown): string | null => {
  const id = asRecord(data).providerThreadId;
  return typeof id === "string" ? id : null;
};

interface RawTurn extends TurnFact {
  dead: boolean;
}

export function parseTimeline(rows: readonly EventRow[], options: TimelineOptions = {}): Timeline {
  const sorted = [...rows].sort((a, b) => a.seq - b.seq);
  const deadRanges: [number, number][] = [];
  const edits: EventRow[] = [];
  for (const row of sorted) {
    if (row.type !== "system/operation") continue;
    const data = asRecord(row.data);
    if (data.operation !== "edit_message" || data.status !== "completed") continue;
    const metadata = asRecord(data.metadata);
    const from = asNumber(metadata.cutoffSequence);
    const to = asNumber(metadata.oldMaxSequence);
    if (from === null || to === null) continue;
    deadRanges.push([from, to]);
    edits.push(row);
  }
  const isDead = (seq: number) => deadRanges.some(([from, to]) => seq >= from && seq <= to);

  const allTurns: RawTurn[] = [];
  const usage: UsagePoint[] = [];
  const deadUsage: UsagePoint[] = [];
  const markers: { row: EventRow; kind: CourseChange["kind"] }[] = [];
  let currentProviderThreadId: string | null = null;
  let forkSeq: number | null = null;
  const seenProviders = new Set<string>();
  let open: RawTurn | null = null;

  for (const row of sorted) {
    const dead = isDead(row.seq);
    const data = asRecord(row.data);
    if (row.type === "client/turn/requested") {
      const request = classifyRequest(data);
      if (request !== null) {
        if (request.kind === "message") {
          open = { requestSeq: row.seq, lastSeq: row.seq, at: row.createdAt, text: request.text, providerThreadId: null, userSent: request.userSent, dead };
          allTurns.push(open);
        } else if (!dead) {
          open = null;
        }
        continue;
      }
    }
    if (row.type === "system/operation" && edits.includes(row)) {
      open = null;
      continue;
    }
    if (open !== null && open.dead === dead) {
      open.lastSeq = row.seq;
      open.providerThreadId ??= providerOf(row.data);
    }
    switch (row.type) {
      case "thread/identity": {
        const id = providerOf(row.data);
        if (dead || id === null) break;
        if (options.sourceThreadId && forkSeq === null && !seenProviders.has(id) && seenProviders.size > 0) forkSeq = row.seq;
        currentProviderThreadId = id;
        break;
      }
      case "thread/contextWindowUsage/updated": {
        const window = asRecord(data.contextWindowUsage);
        const point = {
          seq: row.seq,
          at: row.createdAt,
          providerThreadId: providerOf(row.data),
          usedTokens: asNumber(window.usedTokens),
          window: asNumber(window.modelContextWindow),
        };
        (dead ? deadUsage : usage).push(point);
        break;
      }
      case "thread/compacted":
        if (!dead) markers.push({ row, kind: "compacted" });
        break;
      case "thread/context/cleared":
        if (!dead) markers.push({ row, kind: "cleared" });
        break;
      case "provider/warning":
        if (!dead && data.category === "compaction-skipped") markers.push({ row, kind: "compactionSkipped" });
        break;
    }
    const provider = providerOf(row.data);
    if (provider !== null && !dead) seenProviders.add(provider);
  }
  if (options.sourceThreadId && forkSeq === null) {
    forkSeq = sorted.find((row) => row.type === "thread/identity" && !isDead(row.seq))?.seq ?? null;
  }

  const turns: TurnFact[] = allTurns.filter((turn) => !turn.dead).map(({ dead: _dead, ...turn }) => turn);
  const beforeTurnIndex = (seq: number) => {
    const index = turns.findIndex((turn) => turn.requestSeq > seq);
    return index === -1 ? turns.length + 1 : index + 1;
  };
  const measured = (points: readonly UsagePoint[]) => points.filter((point) => point.usedTokens !== null);
  const lastBefore = (seq: number) => measured(usage).filter((point) => point.seq < seq).at(-1)?.usedTokens ?? null;
  const changeSeqs = [...edits.map((row) => row.seq), ...markers.map(({ row }) => row.seq)].sort((a, b) => a - b);
  const firstAfter = (seq: number) => {
    const until = changeSeqs.find((candidate) => candidate > seq) ?? Number.POSITIVE_INFINITY;
    return measured(usage).find((point) => point.seq > seq && point.seq < until)?.usedTokens ?? null;
  };
  const change = (kind: CourseChange["kind"], row: EventRow, rest: Partial<CourseChange> = {}): CourseChange => ({
    kind,
    seq: row.seq,
    at: row.createdAt,
    beforeTurnIndex: beforeTurnIndex(row.seq),
    tokensBefore: null,
    tokensAfter: null,
    discardedTurns: null,
    sourceThreadId: null,
    ...rest,
  });

  const courseChanges: CourseChange[] = [];
  edits.forEach((row, index) => {
    const [from, to] = deadRanges[index] as [number, number];
    const discarded = allTurns.filter((turn) => turn.dead && turn.requestSeq >= from && turn.requestSeq <= to).length;
    const lastDead = measured(deadUsage).filter((point) => point.seq >= from && point.seq <= to).at(-1);
    courseChanges.push(
      change("edited", row, {
        discardedTurns: discarded > 0 ? discarded : null,
        tokensBefore: lastDead?.usedTokens ?? null,
        tokensAfter: firstAfter(row.seq),
      }),
    );
  });
  for (const { row, kind } of markers) {
    if (kind === "compacted") courseChanges.push(change(kind, row, { tokensBefore: lastBefore(row.seq), tokensAfter: firstAfter(row.seq) }));
    else if (kind === "compactionSkipped") courseChanges.push(change(kind, row, { tokensBefore: lastBefore(row.seq), tokensAfter: lastBefore(row.seq) }));
    else courseChanges.push(change(kind, row, { tokensBefore: lastBefore(row.seq), tokensAfter: firstAfter(row.seq) }));
  }
  if (options.sourceThreadId && forkSeq !== null) {
    const row = sorted.find((candidate) => candidate.seq === forkSeq) as EventRow;
    courseChanges.push(change("forked", row, { sourceThreadId: options.sourceThreadId }));
  }
  courseChanges.sort((a, b) => a.seq - b.seq);

  return { currentProviderThreadId, turns, usage, courseChanges, deadRanges };
}

/** Last seq of a course change of `kind`, or null. */
export function lastChangeSeq(timeline: Timeline, kinds: readonly CourseChange["kind"][]): number | null {
  const found = timeline.courseChanges.filter((change) => kinds.includes(change.kind)).at(-1);
  return found?.seq ?? null;
}
