import { dirname, isAbsolute, join, normalize, sep } from "node:path";
import type { Subagent, SubagentStatus, ThreadSummary, TranscriptEntry } from "./contract";
import { applyEvents, emptyLaunchState, turnActive, type EventRow, type LaunchState, type SubagentLaunch } from "./events";
import { appendSession, emptySession, encodeCwd, type SessionAgentResult, type SessionRecord, type SessionState } from "./session";
import {
  appendTranscript,
  emptyTranscript,
  tailEntries,
  transcriptPrompt,
  type NestedLaunch,
  type TranscriptState,
} from "./transcript";

export interface FileStat {
  size: number;
  mtimeMs: number;
}

export interface CollectFs {
  stat(path: string): Promise<FileStat | null>;
  read(path: string, start: number, end: number): Promise<Buffer>;
  readdir(dir: string): Promise<string[]>;
  realpath(path: string): Promise<string | null>;
}

export interface ThreadInfo {
  id: string;
  providerId: string;
  status: string;
  updatedAt: number;
}

export interface CollectSdk {
  /** Every event after `afterSeq` (exclusive) of the types in `EVENT_TYPES`, ascending. */
  listEvents(threadId: string, afterSeq: number): Promise<EventRow[]>;
  listThreads(): Promise<ThreadInfo[]>;
}

export interface CollectorOptions {
  sdk: CollectSdk;
  fs: CollectFs;
  /** `os.tmpdir()/pi-subagents-<uid>`: where pi-subagents writes `.output` transcripts. */
  tasksRoot: string;
  /** `~/.bb/pi-bridge-sessions`: the bb pi bridge's session files. */
  sessionsRoot: string;
  now?: () => number;
  onChange?: (threadId: string) => void;
}

export const RECENT_WINDOW_MS = 24 * 60 * 60 * 1000;
export const RECENT_THREAD_LIMIT = 50;
export const STALE_TRANSCRIPT_MS = 10 * 60 * 1000;
const THREAD_LIST_TTL_MS = 2_000;
const PROMPT_PEEK_BYTES = 64 * 1024;
const CONCURRENCY = 8;

interface TrackedFile<T> {
  state: T;
  size: number;
  mtimeMs: number;
}

interface ThreadCache {
  launches: LaunchState;
  fetched: boolean;
  listedUpdatedAt: number | null;
  listedStatus: string | null;
  fingerprint: string | null;
}

interface Resolved {
  launch: SubagentLaunch;
  subagent: Subagent;
  transcript: TranscriptState | null;
}

const iso = (ms: number | null | undefined) => (ms == null ? null : new Date(ms).toISOString());
const SAFE_ID = /^[A-Za-z0-9_.-]+$/;

export function mapPiStatus(status: string): SubagentStatus {
  switch (status) {
    case "queued":
    case "running":
      return "running";
    case "completed":
    case "steered":
      return "completed";
    case "error":
    case "aborted":
      return "failed";
    case "stopped":
      return "stopped";
    default:
      return "unknown";
  }
}

/** Outcome of a foreground `Agent` result: `Agent completed in …(note).\n\n<report>` or `Agent failed: …`. */
export function foregroundOutcome(text: string): { status: SubagentStatus; result: string } {
  if (text.startsWith("Agent failed:")) return { status: "failed", result: text };
  const split = text.indexOf("\n\n");
  const headline = split === -1 ? text : text.slice(0, split);
  const result = split === -1 ? text : text.slice(split + 2);
  if (headline.includes("(STOPPED BY THE USER")) return { status: "stopped", result };
  if (headline.includes("(aborted")) return { status: "failed", result };
  return { status: "completed", result };
}

function transcriptOutcome(transcript: TranscriptState | null): SubagentStatus | null {
  switch (transcript?.lastStopReason) {
    case "stop":
      return "completed";
    case "error":
      return "failed";
    case "aborted":
      return "stopped";
    default:
      return null;
  }
}

/** Text of a fetched `get_subagent_result` after its `Agent:`/`Type:`/`Description:` header. */
function fetchedResult(text: string): string {
  const split = text.indexOf("\n\n");
  return split === -1 ? text : text.slice(split + 2);
}

async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index] as T);
    }
  });
  await Promise.all(workers);
  return results;
}

export function createCollector(options: CollectorOptions) {
  const { sdk, fs } = options;
  const now = options.now ?? Date.now;
  const threads = new Map<string, ThreadCache>();
  const sessions = new Map<string, TrackedFile<SessionState>>();
  const transcripts = new Map<string, TrackedFile<TranscriptState>>();
  const prompts = new Map<string, { mtimeMs: number; prompt: string | null }>();
  const locks = new Map<string, Promise<unknown>>();
  let realRoots: Promise<string[]> | null = null;
  let threadList: { at: number; threads: Promise<ThreadInfo[]> } | null = null;

  function serialized<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const run = (locks.get(key) ?? Promise.resolve()).then(fn, fn);
    const settled = run.catch(() => undefined);
    locks.set(key, settled);
    void settled.then(() => {
      if (locks.get(key) === settled) locks.delete(key);
    });
    return run;
  }

  const roots = () =>
    (realRoots ??= Promise.all(
      [options.tasksRoot, options.sessionsRoot].map(async (root) => (await fs.realpath(root)) ?? normalize(root)),
    ));

  async function allowed(path: string): Promise<boolean> {
    if (!isAbsolute(path) || normalize(path) !== path) return false;
    const real = await fs.realpath(path);
    if (real === null) return false;
    return (await roots()).some((root) => real.startsWith(root + sep));
  }

  async function refreshFile<T extends { offset: number }>(
    cache: Map<string, TrackedFile<T>>,
    path: string,
    empty: () => T,
    append: (state: T, chunk: Buffer) => number,
  ): Promise<T | null> {
    const stat = await fs.stat(path);
    if (stat === null) return null;
    let tracked = cache.get(path);
    if (tracked !== undefined && tracked.size === stat.size && tracked.mtimeMs === stat.mtimeMs) return tracked.state;
    if (tracked === undefined || stat.size < tracked.state.offset) {
      if (!(await allowed(path))) return null;
      tracked = { state: empty(), size: 0, mtimeMs: 0 };
      cache.set(path, tracked);
    }
    if (stat.size > tracked.state.offset) append(tracked.state, await fs.read(path, tracked.state.offset, stat.size));
    tracked.size = stat.size;
    tracked.mtimeMs = stat.mtimeMs;
    return tracked.state;
  }

  const readTranscript = (path: string) => refreshFile(transcripts, path, emptyTranscript, appendTranscript);

  const readSession = (providerThreadId: string) =>
    SAFE_ID.test(providerThreadId)
      ? refreshFile(sessions, join(options.sessionsRoot, `${providerThreadId}.jsonl`), emptySession, appendSession)
      : Promise.resolve(null);

  async function filePrompt(path: string): Promise<string | null> {
    const stat = await fs.stat(path);
    if (stat === null) return null;
    const cached = prompts.get(path);
    if (cached !== undefined && (cached.prompt !== null || cached.mtimeMs === stat.mtimeMs)) return cached.prompt;
    if (!(await allowed(path))) return null;
    const head = (await fs.read(path, 0, Math.min(stat.size, PROMPT_PEEK_BYTES))).toString("utf8");
    const newline = head.indexOf("\n");
    const prompt = newline === -1 ? null : transcriptPrompt(head.slice(0, newline));
    prompts.set(path, { mtimeMs: stat.mtimeMs, prompt });
    return prompt;
  }

  /** An `.output` in `dirs` started with `prompt` whose agent id nobody has claimed yet. */
  async function findByPrompt(dirs: readonly string[], prompt: string, claimed: Set<string>) {
    for (const dir of dirs) {
      const files = await fs.readdir(dir).catch(() => [] as string[]);
      for (const file of files) {
        if (!file.endsWith(".output")) continue;
        const agentId = file.slice(0, -".output".length);
        if (claimed.has(agentId)) continue;
        const path = join(dir, file);
        if ((await filePrompt(path)) === prompt) return { agentId, outputFile: path };
      }
    }
    return null;
  }

  async function existingFile(dirs: readonly string[], name: string): Promise<string | null> {
    for (const dir of dirs) {
      const path = join(dir, name);
      if ((await fs.stat(path)) !== null) return path;
    }
    return null;
  }

  async function refreshEvents(threadId: string, cache: ThreadCache) {
    applyEvents(cache.launches, await sdk.listEvents(threadId, cache.launches.lastSeq));
    cache.fetched = true;
  }

  function threadCache(threadId: string): ThreadCache {
    let cache = threads.get(threadId);
    if (cache === undefined) {
      cache = { launches: emptyLaunchState(), fetched: false, listedUpdatedAt: null, listedStatus: null, fingerprint: null };
      threads.set(threadId, cache);
    }
    return cache;
  }

  async function resolveThread(threadId: string, cache: ThreadCache): Promise<Resolved[]> {
    const launches = [...cache.launches.launches.values()];
    if (launches.length === 0) return [];
    const sessionStates = (await Promise.all(cache.launches.providerThreadIds.map(readSession))).filter(
      (state): state is SessionState => state !== null,
    );
    const records = new Map<string, SessionRecord>();
    const agentResults: SessionAgentResult[] = [];
    const taskDirs = new Set<string>();
    for (const session of sessionStates) {
      for (const [id, record] of session.records) records.set(id, record);
      agentResults.push(...session.agentResults);
      if (session.sessionId !== null && session.cwd !== null) {
        taskDirs.add(join(options.tasksRoot, encodeCwd(session.cwd), session.sessionId, "tasks"));
      }
    }
    for (const launch of launches) if (launch.outputFile !== null) taskDirs.add(dirname(launch.outputFile));
    const dirs = [...taskDirs];
    const active = turnActive(cache.launches);
    const claimed = new Set(launches.flatMap((launch) => (launch.agentId === null ? [] : [launch.agentId])));
    const consumedResults = new Set<SessionAgentResult>();
    for (const result of agentResults) if (result.agentId !== null && claimed.has(result.agentId)) consumedResults.add(result);

    const resolved: Resolved[] = [];
    for (const launch of launches) {
      let agentId = launch.agentId;
      let outputFile = launch.outputFile;
      let sessionResult: SessionAgentResult | undefined;
      if (agentId === null && launch.completedAt !== null) {
        sessionResult = agentResults.find(
          (candidate) =>
            !consumedResults.has(candidate) &&
            candidate.agentId !== null &&
            candidate.description === launch.description &&
            (candidate.subagentType === null || candidate.subagentType === launch.type),
        );
        if (sessionResult !== undefined) {
          consumedResults.add(sessionResult);
          agentId = sessionResult.agentId;
        }
      } else if (agentId !== null) {
        sessionResult = agentResults.find((candidate) => candidate.agentId === agentId);
      }
      if (agentId === null && launch.completedAt === null && launch.prompt !== "") {
        const found = await findByPrompt(dirs, launch.prompt, claimed);
        if (found !== null) ({ agentId, outputFile } = found);
      }
      if (agentId !== null) claimed.add(agentId);
      if (outputFile === null && agentId !== null && SAFE_ID.test(agentId)) outputFile = await existingFile(dirs, `${agentId}.output`);
      const transcript = outputFile === null ? null : await readTranscript(outputFile);
      const mtimeMs = outputFile === null ? null : (transcripts.get(outputFile)?.mtimeMs ?? null);

      const record = agentId === null ? undefined : records.get(agentId);
      const ref = agentId === null ? undefined : cache.launches.statusRefs.get(agentId);
      const foreground = launch.resultText !== null && launch.background === false ? foregroundOutcome(launch.resultText) : null;
      const refStatus = ref === undefined ? "unknown" : mapPiStatus(ref.status);

      let status: SubagentStatus = "unknown";
      let result: string | null = null;
      let finishedAt: number | null = null;
      if (record !== undefined) {
        status = mapPiStatus(record.status);
        result = record.result ?? record.error;
        finishedAt = record.completedAt;
      } else if (ref !== undefined && refStatus !== "running" && refStatus !== "unknown") {
        status = refStatus;
        result = fetchedResult(ref.text);
        finishedAt = ref.at;
      } else if (foreground !== null) {
        status = sessionResult?.status != null && sessionResult.status !== "completed" ? mapPiStatus(sessionResult.status) : foreground.status;
        result = foreground.result;
        finishedAt = launch.completedAt;
      } else if (launch.failed) {
        status = "failed";
        result = launch.resultText;
        finishedAt = launch.completedAt;
      } else if (transcriptOutcome(transcript) !== null) {
        status = transcriptOutcome(transcript) ?? "unknown";
        result = transcript?.lastText ?? null;
      } else if (active || (mtimeMs !== null && now() - mtimeMs < STALE_TRANSCRIPT_MS)) {
        status = "running";
      }
      if (finishedAt === null && status !== "running" && status !== "unknown" && transcript?.updatedAt != null) {
        finishedAt = Date.parse(transcript.updatedAt);
      }

      resolved.push({
        launch,
        transcript,
        subagent: {
          agentId,
          callId: launch.callId,
          description: launch.description || record?.description || "",
          type: launch.type,
          model: transcript?.model ?? launch.model ?? sessionResult?.modelName ?? null,
          background: launch.background ?? launch.requestedBackground ?? false,
          status,
          startedAt: iso(launch.startedAt),
          updatedAt: transcript?.updatedAt ?? iso(mtimeMs) ?? iso(finishedAt) ?? iso(launch.startedAt),
          finishedAt: iso(finishedAt),
          turns: transcript?.turns ?? 0,
          toolCalls: transcript?.toolCalls ?? 0,
          lastActivity: transcript?.lastActivity ?? null,
          result,
          outputFile,
          parentAgentId: null,
        },
      });
    }

    const fingerprint = JSON.stringify(
      resolved.map(({ subagent: s }) => [s.callId, s.agentId, s.status, s.turns, s.toolCalls, s.lastActivity]),
    );
    if (cache.fingerprint !== null && cache.fingerprint !== fingerprint) options.onChange?.(threadId);
    cache.fingerprint = fingerprint;
    return resolved;
  }

  function loadThread(threadId: string, fetchEvents = true): Promise<Resolved[]> {
    return serialized(threadId, async () => {
      const cache = threadCache(threadId);
      if (fetchEvents || !cache.fetched) await refreshEvents(threadId, cache);
      return resolveThread(threadId, cache);
    });
  }

  async function nestedChildren(parent: Subagent, transcript: TranscriptState | null, parentRunning: boolean): Promise<Subagent[]> {
    if (transcript === null || transcript.nested.length === 0 || parent.outputFile === null) return [];
    const dirs = [dirname(parent.outputFile)];
    const claimed = new Set(transcript.nested.flatMap((child) => (child.agentId === null ? [] : [child.agentId])));
    if (parent.agentId !== null) claimed.add(parent.agentId);
    const children: Subagent[] = [];
    for (const child of transcript.nested) children.push(await resolveNested(child, transcript, parent, dirs, claimed, parentRunning));
    return children;
  }

  async function resolveNested(
    child: NestedLaunch,
    parentTranscript: TranscriptState,
    parent: Subagent,
    dirs: string[],
    claimed: Set<string>,
    parentRunning: boolean,
  ): Promise<Subagent> {
    let agentId = child.agentId;
    let outputFile: string | null = null;
    if (agentId === null && child.prompt !== "") {
      const found = await findByPrompt(dirs, child.prompt, claimed);
      if (found !== null) ({ agentId, outputFile } = found);
    }
    if (agentId !== null) claimed.add(agentId);
    if (outputFile === null && agentId !== null && SAFE_ID.test(agentId)) outputFile = await existingFile(dirs, `${agentId}.output`);
    const transcript = outputFile === null ? null : await readTranscript(outputFile);
    const mtimeMs = outputFile === null ? null : (transcripts.get(outputFile)?.mtimeMs ?? null);
    const ref = agentId === null ? undefined : parentTranscript.nestedRefs.get(agentId);

    let status: SubagentStatus = "unknown";
    let result: string | null = null;
    const settled = child.resultText ?? (ref !== undefined && !/^Agent \S+ is (?:running|queued)\.$/.test(ref.text) ? ref.text : null);
    if (settled !== null) {
      const isError = child.resultText !== null ? child.resultIsError : (ref?.isError ?? false);
      if (isError || settled.startsWith("Agent failed:")) status = "failed";
      else if (settled.startsWith("Nested agent (STOPPED")) status = "stopped";
      else if (settled.startsWith("Nested agent (aborted")) status = "failed";
      else status = "completed";
      result = settled;
    } else if (transcriptOutcome(transcript) !== null) {
      status = transcriptOutcome(transcript) ?? "unknown";
      result = transcript?.lastText ?? null;
    } else if (parentRunning || (mtimeMs !== null && now() - mtimeMs < STALE_TRANSCRIPT_MS)) {
      status = "running";
    }
    return {
      agentId,
      callId: child.callId,
      description: child.description,
      type: child.type,
      model: transcript?.model ?? null,
      background: child.background ?? false,
      status,
      startedAt: child.at,
      updatedAt: transcript?.updatedAt ?? iso(mtimeMs) ?? child.at,
      finishedAt: status === "running" || status === "unknown" ? null : (transcript?.updatedAt ?? null),
      turns: transcript?.turns ?? 0,
      toolCalls: transcript?.toolCalls ?? 0,
      lastActivity: transcript?.lastActivity ?? null,
      result,
      outputFile,
      parentAgentId: parent.agentId,
    };
  }

  const matches = (subagent: Subagent, ref: string) =>
    subagent.callId === ref || (subagent.agentId !== null && (subagent.agentId === ref || subagent.agentId.startsWith(ref)));

  /** Finds a subagent by call id, agent id or agent-id prefix, searching nested children two levels deep. */
  async function findSubagent(threadId: string, ref: string) {
    const resolved = await loadThread(threadId);
    const top = resolved.find((entry) => matches(entry.subagent, ref));
    if (top !== undefined) return { subagent: top.subagent, transcript: top.transcript };
    let level = resolved.map((entry) => ({ subagent: entry.subagent, transcript: entry.transcript }));
    for (let depth = 0; depth < 2; depth++) {
      const next: typeof level = [];
      for (const parent of level) {
        for (const child of await nestedChildren(parent.subagent, parent.transcript, parent.subagent.status === "running")) {
          const transcript = child.outputFile === null ? null : await readTranscript(child.outputFile);
          if (matches(child, ref)) return { subagent: child, transcript };
          next.push({ subagent: child, transcript });
        }
      }
      level = next;
    }
    return null;
  }

  async function recentThreads(): Promise<ThreadInfo[]> {
    if (threadList === null || now() - threadList.at > THREAD_LIST_TTL_MS) {
      const listed = sdk.listThreads();
      threadList = { at: now(), threads: listed };
      listed.catch(() => {
        if (threadList?.threads === listed) threadList = null;
      });
    }
    const cutoff = now() - RECENT_WINDOW_MS;
    return (await threadList.threads)
      .filter((thread) => thread.providerId === "pi" && (thread.status !== "idle" || thread.updatedAt >= cutoff))
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, RECENT_THREAD_LIMIT);
  }

  function summarize(threadId: string, resolved: Resolved[]): ThreadSummary {
    return {
      threadId,
      running: resolved.filter((entry) => entry.subagent.status === "running").length,
      total: resolved.length,
    };
  }

  return {
    async threadSubagents(threadId: string): Promise<Subagent[]> {
      return (await loadThread(threadId)).map((entry) => entry.subagent);
    },

    async transcript(
      threadId: string,
      ref: string,
      limit: number,
    ): Promise<{ subagent: Subagent; entries: TranscriptEntry[]; truncated: boolean; children: Subagent[] } | null> {
      const found = await findSubagent(threadId, ref);
      if (found === null) return null;
      const { entries, truncated } = tailEntries(found.transcript?.entries ?? [], limit);
      const children = await nestedChildren(found.subagent, found.transcript, found.subagent.status === "running");
      return { subagent: found.subagent, entries, truncated, children };
    },

    async summaries(threadIds?: readonly string[]): Promise<ThreadSummary[]> {
      const targets: { id: string; fetch: boolean }[] =
        threadIds !== undefined
          ? threadIds.map((id) => ({ id, fetch: true }))
          : (await recentThreads()).map((thread) => {
              const cache = threadCache(thread.id);
              const fetch =
                cache.listedUpdatedAt !== thread.updatedAt || thread.status !== "idle" || cache.listedStatus !== thread.status;
              cache.listedUpdatedAt = thread.updatedAt;
              cache.listedStatus = thread.status;
              return { id: thread.id, fetch };
            });
      const summaries = await mapLimit(targets, CONCURRENCY, async ({ id, fetch }) => {
        try {
          return summarize(id, await loadThread(id, fetch));
        } catch {
          return null;
        }
      });
      return summaries.filter((summary): summary is ThreadSummary => summary !== null && summary.total > 0);
    },

    recentThreads,
  };
}

export type Collector = ReturnType<typeof createCollector>;
