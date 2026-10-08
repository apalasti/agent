import { mkdir, mkdtemp, readdir, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

export const PROVIDER_THREAD_ID = "pi_e6c62b6b-9ba7-4f95-85af-6183a2877e86";
export const SESSION_ID = "01a11d12-e481-771f-b48d-2541fad34b6a";
export const CWD = "/Users/andraspalasti/fun/agent";
export const UID = 501;
export const DEMO_RUN = "wf_98928077532b";
export const LIVE_RUN = "wf_95958c48bb8e";
export const SUBAGENTS_AGENT = "ff796ad3-63be-402";
export const WORKFLOWS_AGENT = "6c45e43b-6dc0-4e6";
export const SUBAGENTS_SESSION = "2026-10-08T19-58-56-890Z_01a11d18-f37a-771f-b48d-2551df696380.jsonl";
export const DEMO_CHILD_SESSION = "2026-10-08T19-52-56-416Z_01a11d13-7360-771f-b48d-25439b8dfd46.jsonl";

const REAL_BRIDGE = "/Users/andraspalasti/.bb/pi-bridge-sessions";
const REAL_TMP = "/var/folders/hb/z0645d0501q_35ylknn4gl3c0000gn/T";

export const fixture = (name: string) => readFileSync(join(FIXTURES, name), "utf8");
export const lines = (text: string) => text.split("\n").filter((line) => line.trim() !== "");

export type Layout = { root: string; bridgeDir: string; piSessions: string; tmp: string; childDir: string; taskDir: string; parentPath: string };

/** Lays the real fixtures out like this machine's disk, with the recorded absolute paths moved under a temp root. */
export async function seedDisk(): Promise<Layout> {
  const root = await mkdtemp(join(tmpdir(), "pi-subagents-test-"));
  const bridgeDir = join(root, "bridge");
  const piSessions = join(root, "sessions");
  const tmp = join(root, "tmp");
  const childDir = join(piSessions, "--Users-andraspalasti-fun-agent--");
  const taskDir = join(tmp, `pi-subagents-${UID}`, "Users-andraspalasti-fun-agent", SESSION_ID, "tasks");
  const parentPath = join(bridgeDir, `${PROVIDER_THREAD_ID}.jsonl`);
  const moved: Record<string, string> = { [REAL_BRIDGE]: bridgeDir, [REAL_TMP]: tmp };
  const pattern = new RegExp(Object.keys(moved).map((path) => path.replace(/[.]/g, "\\.")).join("|"), "g");
  const relocate = (text: string) => text.replace(pattern, (path) => moved[path]!);

  await Promise.all([bridgeDir, childDir, taskDir, join(piSessions, "--Users-me-other--")].map((dir) => mkdir(dir, { recursive: true })));
  await writeFile(parentPath, relocate(fixture("parent.jsonl")));
  for (const name of await readdir(join(FIXTURES, "sessions")))
    await writeFile(join(childDir, name), relocate(fixture(`sessions/${name}`)));
  for (const name of await readdir(join(FIXTURES, "tasks")))
    await writeFile(join(taskDir, name), relocate(fixture(`tasks/${name}`)));
  return { root, bridgeDir, piSessions, tmp, childDir, taskDir, parentPath };
}
