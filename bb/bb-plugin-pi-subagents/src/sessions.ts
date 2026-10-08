import { open, readdir, readFile, stat } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { ownsAgent, type ChildSource, type WorkflowSource } from "./assemble";
import { emptyParentFacts, foldParentLine, type ParentFacts } from "./parent";
import { parsePiSession } from "./piSession";
import { parseJournal, parseMeta } from "./workflow";

export type SessionStore = ReturnType<typeof createSessionStore>;
export type SessionRoots = { bridgeDir?: string; piSessions?: string; tmp?: string; uid?: number };
export type ThreadSources = {
  parent: ParentFacts;
  parentPath: string;
  children: ChildSource[];
  outputs: Map<string, ChildSource>;
  workflows: WorkflowSource[];
};

const SAFE_NAME = /^[\w-]+$/;
const SESSION_FILE = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z_.*\.jsonl$/;
const HEADER_PROBE_BYTES = 4_096;
const NEWLINE = 0x0a;

/** pi's SessionManager directory name for a cwd. */
export const sessionDirName = (cwd: string) => `--${cwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;

/** pi-subagents' `encodeCwd` for its task directory. */
export const encodeCwd = (cwd: string) =>
  cwd
    .replace(/[/\\]/g, "-")
    .replace(/^[A-Za-z]:-/, "")
    .replace(/^-+/, "");

function fileStartedAt(name: string): number | null {
  const match = SESSION_FILE.exec(name);
  if (!match) return null;
  const [, day, h, m, s, ms] = match;
  return Date.parse(`${day}T${h}:${m}:${s}.${ms}Z`);
}

async function readRange(path: string, start: number, end: number): Promise<Buffer> {
  const handle = await open(path, "r");
  try {
    const buffer = Buffer.alloc(end - start);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, start);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

export function createSessionStore({
  bridgeDir = join(homedir(), ".bb", "pi-bridge-sessions"),
  piSessions = join(homedir(), ".pi", "agent", "sessions"),
  tmp = tmpdir(),
  uid = process.getuid?.() ?? 0,
}: SessionRoots = {}) {
  const tails = new Map<string, { offset: number; facts: ParentFacts }>();
  const parentOf = new Map<string, string | null>();
  const parsed = new Map<string, { key: string; value: unknown }>();

  async function readParsed<T>(path: string, parse: (text: string) => T): Promise<{ value: T; mtimeMs: number } | null> {
    const info = await stat(path).catch(() => null);
    if (!info?.isFile()) return null;
    const key = `${info.size}:${info.mtimeMs}`;
    const hit = parsed.get(path);
    if (hit?.key === key) return { value: hit.value as T, mtimeMs: info.mtimeMs };
    const text = await readFile(path, "utf8").catch(() => null);
    if (text === null) return null;
    const value = parse(text);
    parsed.set(path, { key, value });
    return { value, mtimeMs: info.mtimeMs };
  }

  async function readChild(path: string): Promise<ChildSource | null> {
    const file = await readParsed(path, parsePiSession);
    return file && { path, transcript: file.value, mtimeMs: file.mtimeMs };
  }

  async function readParent(path: string): Promise<ParentFacts | null> {
    const info = await stat(path).catch(() => null);
    if (!info?.isFile()) return null;
    let tail = tails.get(path);
    if (!tail || info.size < tail.offset) tail = { offset: 0, facts: emptyParentFacts() };
    tails.set(path, tail);
    if (info.size > tail.offset) {
      const chunk = await readRange(path, tail.offset, info.size);
      const complete = chunk.subarray(0, chunk.lastIndexOf(NEWLINE) + 1);
      for (const line of complete.toString("utf8").split("\n")) if (line.trim()) foldParentLine(line, tail.facts);
      tail.offset += complete.length;
    }
    return tail.facts;
  }

  async function parentSessionOf(path: string): Promise<string | null> {
    if (parentOf.has(path)) return parentOf.get(path)!;
    const head = await readRange(path, 0, HEADER_PROBE_BYTES).catch(() => null);
    const end = head?.indexOf(NEWLINE) ?? -1;
    if (!head || end < 0) return null;
    let parentSession: string | null = null;
    try {
      parentSession = (JSON.parse(head.subarray(0, end).toString("utf8")) as { parentSession?: string }).parentSession ?? null;
    } catch {
      parentSession = null;
    }
    parentOf.set(path, parentSession);
    return parentSession;
  }

  async function readChildren(parentPath: string, header: NonNullable<ParentFacts["header"]>): Promise<ChildSource[]> {
    const dir = join(piSessions, sessionDirName(header.cwd));
    const names = (await readdir(dir).catch(() => [] as string[])).filter((name) => {
      const startedAt = fileStartedAt(name);
      return startedAt !== null && startedAt >= header.at;
    });
    const loaded = await Promise.all(
      names.map(async (name) => {
        const path = join(dir, name);
        return (await parentSessionOf(path)) === parentPath ? readChild(path) : null;
      }),
    );
    return loaded.filter((child) => child !== null);
  }

  async function readWorkflow(launch: WorkflowSource["launch"]): Promise<WorkflowSource> {
    const journalPath = launch.scriptPath.replace(/\.js$/, ".jsonl");
    const [meta, journal] = await Promise.all([
      readParsed(launch.scriptPath, parseMeta),
      journalPath === launch.scriptPath ? null : readParsed(journalPath, parseJournal),
    ]);
    return {
      launch,
      meta: meta?.value ?? { name: null, description: null, phases: [] },
      journal: journal?.value ?? { done: 0, failed: 0 },
      journalMtimeMs: journal?.mtimeMs ?? null,
    };
  }

  async function readThread(providerThreadId: string): Promise<ThreadSources | null> {
    if (!SAFE_NAME.test(providerThreadId)) return null;
    const parentPath = join(bridgeDir, `${providerThreadId}.jsonl`);
    const parent = await readParent(parentPath);
    if (!parent?.header) return null;
    const header = parent.header;
    const children = await readChildren(parentPath, header);
    const taskDir = join(tmp, `pi-subagents-${uid}`, encodeCwd(header.cwd), header.id, "tasks");
    const unmatched = [...parent.spawns.keys()].filter(
      (agentId) => SAFE_NAME.test(agentId) && !children.some((child) => ownsAgent(child.transcript.name, agentId)),
    );
    const [outputs, workflows] = await Promise.all([
      Promise.all(unmatched.map(async (agentId) => [agentId, await readChild(join(taskDir, `${agentId}.output`))] as const)),
      Promise.all([...parent.workflows.values()].map(readWorkflow)),
    ]);
    return {
      parent,
      parentPath,
      children,
      outputs: new Map(outputs.filter((entry): entry is [string, ChildSource] => entry[1] !== null)),
      workflows,
    };
  }

  return { readThread };
}
