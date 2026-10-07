import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { CollectFs, CollectSdk, ThreadInfo } from "../src/collect";
import type { ContextUsage } from "../src/compose";
import type { EventRow } from "../src/events";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

export const fixture = (name: string) => readFileSync(join(FIXTURES, name), "utf8");

/** `bb thread log --json` rows, with `createdAt` normalized to ISO like the server adapter does. */
export function fixtureEvents(name: string): EventRow[] {
  const rows = JSON.parse(fixture(name)) as { seq: number; type: string; createdAt: number; data: unknown }[];
  return rows.map((row) => ({ seq: row.seq, type: row.type, createdAt: new Date(row.createdAt).toISOString(), data: row.data }));
}

export const fixtureUsage = (name: string) => (JSON.parse(fixture(name)) as { usage: ContextUsage | null }).usage;

export const PI_ROOT = "/home/me/.bb/pi-bridge-sessions";
export const CLAUDE_ROOT = "/home/me/.claude/projects";
export const ROOTS = { piSessions: PI_ROOT, claudeProjects: CLAUDE_ROOT };

export class FakeFs implements CollectFs {
  files = new Map<string, { content: Buffer; mtimeMs: number }>();
  reads: { path: string; start: number; end: number }[] = [];
  clock = 1_000;

  write(path: string, content: string | Buffer) {
    this.files.set(path, { content: Buffer.isBuffer(content) ? content : Buffer.from(content, "utf8"), mtimeMs: ++this.clock });
  }
  append(path: string, content: string) {
    const existing = this.files.get(path)?.content ?? Buffer.alloc(0);
    this.write(path, Buffer.concat([existing, Buffer.from(content, "utf8")]));
  }
  async stat(path: string) {
    const file = this.files.get(path);
    return file === undefined ? null : { size: file.content.length, mtimeMs: file.mtimeMs };
  }
  async read(path: string, start: number, end: number) {
    this.reads.push({ path, start, end });
    return this.files.get(path)?.content.subarray(start, end) ?? Buffer.alloc(0);
  }
  async readdir(dir: string) {
    const names = new Set<string>();
    for (const path of this.files.keys()) {
      if (path.startsWith(`${dir}/`)) names.add(path.slice(dir.length + 1).split("/")[0] as string);
    }
    return [...names];
  }
}

export class FakeSdk implements CollectSdk {
  events = new Map<string, EventRow[]>();
  threads = new Map<string, ThreadInfo>();
  usage = new Map<string, ContextUsage | null>();
  primary: string | null = "host_local";
  calls = { events: 0, context: 0 };

  async listEvents(threadId: string, afterSeq: number) {
    this.calls.events += 1;
    return (this.events.get(threadId) ?? []).filter((row) => row.seq > afterSeq);
  }
  async thread(threadId: string) {
    const thread = this.threads.get(threadId);
    if (thread === undefined) throw new Error(`no thread ${threadId}`);
    return thread;
  }
  async context(threadId: string) {
    this.calls.context += 1;
    return this.usage.get(threadId) ?? null;
  }
  async primaryHostId() {
    return this.primary;
  }
}

export const thread = (id: string, providerId: string, rest: Partial<ThreadInfo> = {}): ThreadInfo => ({
  id,
  providerId,
  status: "idle",
  sourceThreadId: null,
  hostId: "host_local",
  ...rest,
});
