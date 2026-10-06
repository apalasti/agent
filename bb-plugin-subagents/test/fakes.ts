import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { CollectFs, CollectSdk, ThreadInfo } from "../src/collect";
import type { EventRow } from "../src/events";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

export const fixture = (name: string) => readFileSync(join(FIXTURES, name), "utf8");
export const fixtureEvents = (name: string): EventRow[] => JSON.parse(fixture(name)) as EventRow[];

export const TASKS_ROOT = "/var/folders/hb/z0645d0501q_35ylknn4gl3c0000gn/T/pi-subagents-501";
export const SESSIONS_ROOT = "/home/me/.bb/pi-bridge-sessions";
export const PROBE_TASKS = `${TASKS_ROOT}/private-tmp-wt-demo/01a112d8-24e3-74f4-8ac4-0f1c30093e1e/tasks`;
export const PROBE_SESSION = `${SESSIONS_ROOT}/pi_f7522fe0-34e0-44a8-9ce8-aad83df06b33.jsonl`;
export const FOREGROUND_TASKS = `${TASKS_ROOT}/Users-andraspalasti-fun-agent/01a10670-a973-742b-a6a1-1e6c89e62a67/tasks`;
export const FOREGROUND_SESSION = `${SESSIONS_ROOT}/pi_b8f629db-1e91-404b-a066-47c0c8740a13.jsonl`;

export class FakeFs implements CollectFs {
  files = new Map<string, { content: Buffer; mtimeMs: number }>();
  reads: { path: string; start: number; end: number }[] = [];
  clock = 1_000;

  write(path: string, content: string, mtimeMs = this.clock) {
    this.files.set(path, { content: Buffer.from(content, "utf8"), mtimeMs });
  }
  append(path: string, content: string, mtimeMs = this.clock) {
    const existing = this.files.get(path)?.content ?? Buffer.alloc(0);
    this.files.set(path, { content: Buffer.concat([existing, Buffer.from(content, "utf8")]), mtimeMs });
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
    return [...this.files.keys()].filter((path) => dirname(path) === dir).map((path) => path.slice(dir.length + 1));
  }
  async realpath(path: string) {
    if (this.files.has(path)) return path;
    return [...this.files.keys()].some((file) => file.startsWith(`${path}/`)) ? path : null;
  }
}

export class FakeSdk implements CollectSdk {
  events = new Map<string, EventRow[]>();
  threads: ThreadInfo[] = [];
  eventCalls: { threadId: string; afterSeq: number }[] = [];

  async listEvents(threadId: string, afterSeq: number) {
    this.eventCalls.push({ threadId, afterSeq });
    return (this.events.get(threadId) ?? []).filter((row) => row.seq > afterSeq);
  }
  async listThreads() {
    return this.threads;
  }
}

export function seedProbe(fs: FakeFs) {
  fs.write(PROBE_SESSION, fixture("probe-session.jsonl"));
  fs.write(`${PROBE_TASKS}/3a2ff4b2-3d37-45c.output`, fixture("probe-3a2ff4b2.output"));
  fs.write(`${PROBE_TASKS}/27e7abbc-45cf-47d.output`, fixture("probe-27e7abbc.output"));
}

export function seedForeground(fs: FakeFs) {
  fs.write(FOREGROUND_SESSION, fixture("foreground-session.jsonl"));
  fs.write(`${FOREGROUND_TASKS}/b0a2601e-c4a4-483.output`, fixture("foreground-b0a2601e.output"));
}

export const lines = (text: string) => text.split("\n").filter((line) => line.trim() !== "");
