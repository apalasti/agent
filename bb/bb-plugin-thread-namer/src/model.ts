import { spawn } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { delimiter, join } from "node:path";

export interface ModelConfig {
  claudePath: string;
  model: string;
}

/** The bb server is launched by the app without the login shell's PATH, so the usual install dirs are searched too. */
export function resolveClaude(configured: string): string {
  if (configured.includes("/")) return configured;
  const dirs = [
    ...(process.env.PATH ?? "").split(delimiter),
    join(homedir(), ".local/bin"),
    join(homedir(), ".claude/local"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
  ];
  for (const dir of dirs.filter(Boolean)) {
    const candidate = join(dir, configured);
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {}
  }
  return configured;
}

/** One tool-less `claude -p` completion, billed to the user's Claude Code login. */
export function complete(config: ModelConfig, system: string, user: string, signal: AbortSignal): Promise<string> {
  const args = [
    "-p",
    "--model",
    config.model,
    "--system-prompt",
    system,
    "--tools",
    "",
    "--setting-sources",
    "",
    "--strict-mcp-config",
    "--disable-slash-commands",
    "--no-session-persistence",
    "--output-format",
    "text",
  ];
  return new Promise((resolve, reject) => {
    // A neutral cwd keeps the thread's project CLAUDE.md out of the naming prompt.
    const child = spawn(resolveClaude(config.claudePath), args, {
      cwd: tmpdir(),
      signal,
      stdio: ["pipe", "pipe", "pipe"],
      // bb aborts AI-service calls after 5s; skipping telemetry and update checks halves startup to about 1s.
      env: { ...process.env, CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1", DISABLE_AUTOUPDATER: "1" },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`claude exited ${code}: ${(stderr || stdout).trim().slice(0, 300)}`));
    });
    child.stdin.end(user);
  });
}
