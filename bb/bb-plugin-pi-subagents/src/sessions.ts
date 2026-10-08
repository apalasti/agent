import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AgentMeta, AgentSource } from "./assemble";
import { parseTranscript, type Transcript } from "./transcript";

export type SessionStore = ReturnType<typeof createSessionStore>;

const AGENT_FILE = /^agent-(.+)\.jsonl$/;
const MISS_RETRY_MS = 60_000;

async function readMeta(path: string): Promise<AgentMeta> {
  try {
    return (JSON.parse(await readFile(path, "utf8")) ?? {}) as AgentMeta;
  } catch {
    return {};
  }
}

export function createSessionStore(root = join(homedir(), ".claude", "projects"), now: () => number = Date.now) {
  const sessionDirs = new Map<string, string>();
  const missedAt = new Map<string, number>();
  const parsed = new Map<string, { key: string; transcript: Transcript }>();

  async function readTranscript(path: string, sidechain: boolean) {
    const info = await stat(path).catch(() => null);
    if (!info) return null;
    const key = `${info.size}:${info.mtimeMs}`;
    const hit = parsed.get(path);
    if (hit?.key === key) return { transcript: hit.transcript, mtimeMs: info.mtimeMs };
    const transcript = parseTranscript(await readFile(path, "utf8"), { sidechain });
    parsed.set(path, { key, transcript });
    return { transcript, mtimeMs: info.mtimeMs };
  }

  async function findSessionDir(sessionId: string): Promise<string | null> {
    const cached = sessionDirs.get(sessionId);
    if (cached) return cached;
    const missed = missedAt.get(sessionId);
    if (missed !== undefined && now() - missed < MISS_RETRY_MS) return null;
    for (const project of await readdir(root).catch(() => [])) {
      const dir = join(root, project);
      if (await stat(join(dir, `${sessionId}.jsonl`)).catch(() => null)) {
        sessionDirs.set(sessionId, dir);
        missedAt.delete(sessionId);
        return dir;
      }
    }
    missedAt.set(sessionId, now());
    return null;
  }

  async function readLead(dir: string, sessionId: string): Promise<Transcript | null> {
    return (await readTranscript(join(dir, `${sessionId}.jsonl`), false))?.transcript ?? null;
  }

  async function readAgents(dir: string, sessionId: string): Promise<AgentSource[]> {
    const subagents = join(dir, sessionId, "subagents");
    const agentIds = (await readdir(subagents).catch(() => [] as string[]))
      .map((name) => AGENT_FILE.exec(name)?.[1])
      .filter((agentId) => agentId !== undefined);
    const loaded = await Promise.all(
      agentIds.map(async (agentId) => {
        const file = await readTranscript(join(subagents, `agent-${agentId}.jsonl`), true);
        if (!file) return null;
        return { agentId, meta: await readMeta(join(subagents, `agent-${agentId}.meta.json`)), ...file };
      }),
    );
    return loaded.filter((source) => source !== null);
  }

  return { findSessionDir, readLead, readAgents };
}
