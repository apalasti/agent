import { spawn } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { delimiter, join } from "node:path";

export interface ModelConfig {
  piPath: string;
  model: string;
  /** Empty loads every installed pi extension; otherwise only these. */
  extensions: string[];
}

/** The bb server is launched by the app without the login shell's PATH, so the usual install dirs are searched too. */
export function resolvePi(configured: string): string {
  if (configured.includes("/")) return configured;
  const dirs = [
    ...(process.env.PATH ?? "").split(delimiter),
    join(homedir(), ".pi/agent/bin"),
    join(homedir(), ".local/bin"),
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

/** One tool-less `pi -p` completion with no session, skills, context files or MCP. */
export function complete(config: ModelConfig, system: string, user: string, signal: AbortSignal): Promise<string> {
  const args = [
    "-p",
    "--no-session",
    "--no-tools",
    "--no-skills",
    "--no-context-files",
    "--no-prompt-templates",
    "--no-themes",
    "--no-mcp",
    "--offline",
    ...(config.extensions.length ? ["--no-extensions", ...config.extensions.flatMap((ext) => ["-e", ext])] : []),
    "--model",
    config.model,
    "--system-prompt",
    system,
  ];
  return new Promise((resolve, reject) => {
    const child = spawn(resolvePi(config.piPath), args, { cwd: tmpdir(), signal, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`pi exited ${code}: ${(stderr || stdout).trim().slice(0, 300)}`));
    });
    child.stdin.end(user);
  });
}
