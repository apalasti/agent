import { join } from "node:path";
import { createClaudeTranscriptParser } from "./claudeTranscript";
import { composeReport, toMeter, type ContextUsage, type SessionSourceKind } from "./compose";
import type { CategoryId, ContextReport, CourseChange, Meter } from "./contract";
import { parseTimeline, type EventRow, type Timeline } from "./events";
import { createPiSessionParser, type SessionContext, type SessionParser } from "./piSession";

export interface FileStat {
  size: number;
  mtimeMs: number;
}

export interface CollectFs {
  stat(path: string): Promise<FileStat | null>;
  read(path: string, start: number, end: number): Promise<Buffer>;
  readdir(dir: string): Promise<string[]>;
}

export interface ThreadInfo {
  id: string;
  providerId: string | null;
  status: string;
  sourceThreadId: string | null;
  hostId: string | null;
}

export interface CollectSdk {
  /** Every event after `afterSeq` (exclusive) of the types in `EVENT_TYPES`, ascending. */
  listEvents(threadId: string, afterSeq: number): Promise<EventRow[]>;
  thread(threadId: string): Promise<ThreadInfo>;
  context(threadId: string): Promise<ContextUsage | null>;
  primaryHostId(): Promise<string | null>;
}

/** Small persistent store for facts bb deletes, such as the turns an edit discarded. */
export interface CollectMemo {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
}

export interface CollectRoots {
  /** `~/.bb/pi-bridge-sessions` */
  piSessions: string;
  /** `~/.claude/projects` */
  claudeProjects: string;
}

export interface CollectorDeps {
  sdk: CollectSdk;
  fs: CollectFs;
  roots: CollectRoots;
  memo?: CollectMemo;
  now?: () => number;
}

export interface Collector {
  meter(threadId: string): Promise<Meter>;
  report(threadId: string): Promise<ContextReport>;
  invalidate(threadId: string): void;
  dispose(): void;
}

export const FRESH_MS = 2_000;
const CHECK_BYTES = 4_096;
const MISSING_RETRY_MS = 5_000;
const BASE_CATEGORIES = new Set<CategoryId>(["system", "tools", "memory", "skills"]);
const SAFE_ID = /^[A-Za-z0-9_.:-]+$/;

interface TrackedFile {
  kind: "pi" | "claude";
  parser: SessionParser;
  /** Bytes consumed, always just past a newline. */
  offset: number;
  size: number;
  mtimeMs: number;
  head: Buffer;
  tail: Buffer;
  context: SessionContext | null;
}

interface ThreadCache {
  rows: EventRow[];
  lastSeq: number;
  timeline: Timeline | null;
  report: ContextReport | null;
  fetchedAt: number;
  dirty: boolean;
  /** System, tools, memory and skills of the last session read; they carry over to a new session. */
  base: { kind: SessionSourceKind; session: SessionContext } | null;
  calibration: number | null;
  window: number | null;
}

interface EditMemo {
  discardedTurns: number | null;
  tokensBefore: number | null;
}

export function createCollector(deps: CollectorDeps): Collector {
  const { sdk, fs, roots } = deps;
  const now = deps.now ?? Date.now;
  const threads = new Map<string, ThreadCache>();
  const files = new Map<string, TrackedFile>();
  const claudePaths = new Map<string, { path: string | null; at: number }>();
  const locks = new Map<string, Promise<unknown>>();
  let primaryHost: Promise<string | null> | null = null;

  function serialized<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const run = (locks.get(key) ?? Promise.resolve()).then(fn, fn);
    const settled = run.catch(() => undefined);
    locks.set(key, settled);
    void settled.then(() => {
      if (locks.get(key) === settled) locks.delete(key);
    });
    return run;
  }

  function newParser(kind: TrackedFile["kind"]): SessionParser {
    return kind === "pi" ? createPiSessionParser() : createClaudeTranscriptParser();
  }

  /** Spot-checks the first and last consumed bytes; a rewrite that keeps both intact goes unnoticed. */
  async function unchanged(path: string, tracked: TrackedFile): Promise<boolean> {
    if (tracked.offset === 0) return true;
    const [head, tail] = await Promise.all([
      fs.read(path, 0, tracked.head.length),
      fs.read(path, tracked.offset - tracked.tail.length, tracked.offset),
    ]);
    return head.equals(tracked.head) && tail.equals(tracked.tail);
  }

  async function readSession(path: string, kind: TrackedFile["kind"]): Promise<SessionContext | null> {
    const stat = await fs.stat(path);
    if (stat === null) {
      files.delete(path);
      return null;
    }
    let tracked = files.get(path);
    if (tracked !== undefined && tracked.size === stat.size && tracked.mtimeMs === stat.mtimeMs && tracked.context !== null) return tracked.context;
    if (tracked === undefined || tracked.kind !== kind || stat.size < tracked.offset || !(await unchanged(path, tracked))) {
      tracked = { kind, parser: newParser(kind), offset: 0, size: 0, mtimeMs: 0, head: Buffer.alloc(0), tail: Buffer.alloc(0), context: null };
      files.set(path, tracked);
    }
    if (stat.size > tracked.offset) {
      const chunk = await fs.read(path, tracked.offset, stat.size);
      const end = chunk.lastIndexOf(0x0a);
      if (end !== -1) {
        const complete = chunk.subarray(0, end + 1);
        for (const line of complete.toString("utf8").split("\n")) tracked.parser.push(line);
        if (tracked.offset === 0) tracked.head = Buffer.from(complete.subarray(0, CHECK_BYTES));
        tracked.offset += complete.length;
        const tailStart = Math.max(0, complete.length - CHECK_BYTES);
        tracked.tail = Buffer.from(complete.subarray(tailStart));
      }
    }
    tracked.size = stat.size;
    tracked.mtimeMs = stat.mtimeMs;
    tracked.context = tracked.parser.context();
    return tracked.context;
  }

  async function claudePath(providerThreadId: string): Promise<string | null> {
    const cached = claudePaths.get(providerThreadId);
    if (cached !== undefined && (cached.path !== null || now() - cached.at < MISSING_RETRY_MS)) {
      if (cached.path === null || (await fs.stat(cached.path)) !== null) return cached.path;
    }
    const name = `${providerThreadId}.jsonl`;
    let found: string | null = null;
    for (const dir of await fs.readdir(roots.claudeProjects).catch(() => [] as string[])) {
      const candidate = join(roots.claudeProjects, dir, name);
      if ((await fs.stat(candidate)) !== null) {
        found = candidate;
        break;
      }
    }
    claudePaths.set(providerThreadId, { path: found, at: now() });
    return found;
  }

  async function sessionSource(providerId: string | null, providerThreadId: string | null): Promise<{ kind: SessionSourceKind; path: string | null; session: SessionContext | null }> {
    if (providerThreadId === null || !SAFE_ID.test(providerThreadId)) return { kind: "bb-only", path: null, session: null };
    if (providerId === "pi") {
      const path = join(roots.piSessions, `${providerThreadId}.jsonl`);
      const session = await readSession(path, "pi");
      return session === null ? { kind: "bb-only", path: null, session: null } : { kind: "pi-session", path, session };
    }
    if (providerId === "claude-code") {
      const path = await claudePath(providerThreadId);
      const session = path === null ? null : await readSession(path, "claude");
      return session === null ? { kind: "bb-only", path: null, session: null } : { kind: "claude-transcript", path, session };
    }
    return { kind: "bb-only", path: null, session: null };
  }

  async function rememberEdits(threadId: string, changes: CourseChange[]) {
    const memo = deps.memo;
    if (memo === undefined) return changes;
    return Promise.all(
      changes.map(async (change) => {
        if (change.kind !== "edited") return change;
        const key = `edit:${threadId}:${change.seq}`;
        if (change.discardedTurns !== null) {
          await memo.set(key, { discardedTurns: change.discardedTurns, tokensBefore: change.tokensBefore } satisfies EditMemo);
          return change;
        }
        const stored = (await memo.get(key)) as EditMemo | undefined | null;
        return stored == null ? change : { ...change, discardedTurns: stored.discardedTurns, tokensBefore: change.tokensBefore ?? stored.tokensBefore };
      }),
    );
  }

  async function storedWindow(threadId: string): Promise<number | null> {
    const stored = await deps.memo?.get(`window:${threadId}`);
    return typeof stored === "number" && stored > 0 ? stored : null;
  }

  /** The window bb or the events report now, else the last one seen for this thread, else its fork source's. */
  async function knownWindow(threadId: string, cache: ThreadCache, info: ThreadInfo, usage: ContextUsage | null, timeline: Timeline): Promise<number | null> {
    const seen = usage?.modelContextWindow ?? [...timeline.usage].reverse().find((point) => point.window !== null)?.window ?? usage?.snapshot?.contextWindowTokens ?? null;
    if (seen === null) {
      cache.window ??= await storedWindow(threadId);
      if (cache.window !== null || info.sourceThreadId === null) return cache.window;
      const source = info.sourceThreadId;
      cache.window = (await storedWindow(source)) ?? (await sdk.context(source).catch(() => null))?.modelContextWindow ?? null;
      if (cache.window === null) return null;
    } else if (seen === cache.window) {
      return seen;
    } else {
      cache.window = seen;
    }
    await deps.memo?.set(`window:${threadId}`, cache.window);
    return cache.window;
  }

  async function build(threadId: string): Promise<ContextReport> {
    const cache = threads.get(threadId) ?? { rows: [], lastSeq: 0, timeline: null, report: null, fetchedAt: 0, dirty: true, base: null, calibration: null, window: null };
    threads.set(threadId, cache);
    if (cache.report !== null && !cache.dirty && now() - cache.fetchedAt < FRESH_MS) return cache.report;
    cache.dirty = false;
    cache.fetchedAt = now();

    const [fresh, info, usage, primary] = await Promise.all([
      sdk.listEvents(threadId, cache.lastSeq),
      sdk.thread(threadId),
      sdk.context(threadId),
      (primaryHost ??= sdk.primaryHostId().catch(() => null)),
    ]);
    if (fresh.length > 0 || cache.timeline === null) {
      for (const row of fresh) if (row.seq > cache.lastSeq) cache.rows.push(row);
      cache.lastSeq = cache.rows.at(-1)?.seq ?? cache.lastSeq;
      const timeline = parseTimeline(cache.rows, { sourceThreadId: info.sourceThreadId });
      timeline.courseChanges = await rememberEdits(threadId, timeline.courseChanges);
      cache.timeline = timeline;
    }
    const timeline = cache.timeline as Timeline;
    const remote = info.hostId !== null && primary !== null && info.hostId !== primary;
    let source = remote ? { kind: "bb-only" as const, path: null, session: null } : await sessionSource(info.providerId, timeline.currentProviderThreadId);
    if (source.session !== null) {
      const items = source.session.items.filter((item) => item.userOrdinal === null && BASE_CATEGORIES.has(item.category));
      cache.base = { kind: source.kind, session: { items, model: source.session.model, compactedBeforeOrdinal: null, compactions: [], fallbackSteps: 0 } };
    } else if (!remote && cache.base !== null) {
      source = { kind: cache.base.kind, path: null, session: cache.base.session };
    }
    cache.report = composeReport({
      threadId,
      providerId: info.providerId,
      threadStatus: info.status,
      timeline,
      session: source.session,
      source: { kind: source.kind, path: source.path },
      usage,
      remote,
      priorCalibration: cache.calibration,
      knownWindow: await knownWindow(threadId, cache, info, usage, timeline),
    });
    const { source: reported, window } = cache.report;
    if (window.basis === "measured" && reported.kind !== "claude-snapshot" && reported.calibration !== null) cache.calibration = reported.calibration;
    return cache.report;
  }

  return {
    report: (threadId) => serialized(threadId, () => build(threadId)),
    meter: async (threadId) => toMeter(await serialized(threadId, () => build(threadId))),
    invalidate(threadId) {
      const cache = threads.get(threadId);
      if (cache !== undefined) cache.dirty = true;
    },
    dispose() {
      threads.clear();
      files.clear();
      claudePaths.clear();
    },
  };
}
