import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { EventRow } from "../src/events";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

export const SESSION_ID = "e4e2cad1-7748-4c89-addd-0cde1c13dd84";
export const PROJECT = "-Users-me-agent";
export const WRITES_AGENT = "a2baef7967d8bccd4";
export const ERRORS_AGENT = "a242f96a1fed29aac";

export const fixture = (name: string) => readFileSync(join(FIXTURES, name), "utf8");
export const fixtureEvents = (): EventRow[] => JSON.parse(fixture("events.json")) as EventRow[];
export const lines = (text: string) => text.split("\n").filter((line) => line.trim() !== "");

export async function seedProjects(): Promise<{ root: string; sessionDir: string; subagents: string }> {
  const root = await mkdtemp(join(tmpdir(), "claude-subagents-"));
  const sessionDir = join(root, PROJECT);
  const subagents = join(sessionDir, SESSION_ID, "subagents");
  await mkdir(join(root, "-Users-me-other"), { recursive: true });
  await mkdir(subagents, { recursive: true });
  await writeFile(join(sessionDir, `${SESSION_ID}.jsonl`), fixture("lead.jsonl"));
  for (const [agentId, name] of [
    [WRITES_AGENT, "subagent-writes"],
    [ERRORS_AGENT, "subagent-errors"],
  ]) {
    await writeFile(join(subagents, `agent-${agentId}.jsonl`), fixture(`${name}.jsonl`));
    await writeFile(join(subagents, `agent-${agentId}.meta.json`), fixture(`${name}.meta.json`));
  }
  return { root, sessionDir, subagents };
}
