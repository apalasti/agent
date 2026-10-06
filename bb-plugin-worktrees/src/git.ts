import { spawn } from "node:child_process";
import { realpathSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import type { Worktree, WorktreeStatus } from "./contract";

export interface RunOptions {
  cwd: string;
  env?: Record<string, string>;
  onLine?: (line: string) => void;
  signal?: AbortSignal;
}

export interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

export type Runner = (command: string, args: string[], options: RunOptions) => Promise<CommandResult>;

export class CommandError extends Error {
  constructor(
    readonly command: string,
    readonly result: CommandResult,
  ) {
    const detail = (result.stderr.trim() || result.stdout.trim()).split("\n").slice(-5).join("\n");
    super(`${command} exited with ${result.code}${detail ? `: ${detail}` : ""}`);
  }
}

// GUI-launched servers often lack the Homebrew bin dirs where git-gtr lives.
const EXTRA_PATH = ["/opt/homebrew/bin", "/usr/local/bin"];

function withPath(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const parts = (env.PATH ?? "").split(":").filter(Boolean);
  for (const dir of EXTRA_PATH) if (!parts.includes(dir)) parts.push(dir);
  return { ...env, PATH: parts.join(":") };
}

export const spawnRunner: Runner = (command, args, { cwd, env, onLine, signal }) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: withPath({ ...process.env, GIT_TERMINAL_PROMPT: "0", ...env }),
      stdio: ["ignore", "pipe", "pipe"],
      signal,
    });
    let stdout = "";
    let stderr = "";
    const pending = { stdout: "", stderr: "" };
    const feed = (stream: "stdout" | "stderr", chunk: string) => {
      if (stream === "stdout") stdout += chunk;
      else stderr += chunk;
      if (onLine === undefined) return;
      const lines = (pending[stream] + chunk).split(/\r?\n|\r/);
      pending[stream] = lines.pop() ?? "";
      for (const line of lines) if (line.trim() !== "") onLine(line);
    };
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => feed("stdout", chunk));
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => feed("stderr", chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (onLine !== undefined) {
        for (const rest of [pending.stdout, pending.stderr]) if (rest.trim() !== "") onLine(rest);
      }
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });

export async function run(runner: Runner, command: string, args: string[], options: RunOptions): Promise<string> {
  const result = await runner(command, args, options);
  if (result.code !== 0) throw new CommandError(`${command} ${args.join(" ")}`, result);
  return result.stdout;
}

export function runGit(runner: Runner, cwd: string, args: string[], options: Omit<RunOptions, "cwd"> = {}) {
  return run(runner, "git", args, { ...options, cwd });
}

export async function gitSucceeds(runner: Runner, cwd: string, args: string[]): Promise<boolean> {
  return (await runner("git", args, { cwd })).code === 0;
}

export function runShell(runner: Runner, command: string, options: RunOptions) {
  return run(runner, "/bin/sh", ["-c", command], options);
}

export function realpathOr(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

export interface PorcelainWorktree {
  path: string;
  head: string | null;
  branch: string | null;
  isBare: boolean;
  isDetached: boolean;
  isLocked: boolean;
  isPrunable: boolean;
}

export function parsePorcelain(text: string): PorcelainWorktree[] {
  const worktrees: PorcelainWorktree[] = [];
  for (const block of text.split(/\n\s*\n/)) {
    const lines = block.split("\n").filter((line) => line !== "");
    const first = lines[0];
    if (first === undefined || !first.startsWith("worktree ")) continue;
    const entry: PorcelainWorktree = {
      path: first.slice("worktree ".length),
      head: null,
      branch: null,
      isBare: false,
      isDetached: false,
      isLocked: false,
      isPrunable: false,
    };
    for (const line of lines.slice(1)) {
      const [key = "", ...rest] = line.split(" ");
      const value = rest.join(" ");
      if (key === "HEAD") entry.head = value;
      else if (key === "branch") entry.branch = value.replace(/^refs\/heads\//, "");
      else if (key === "bare") entry.isBare = true;
      else if (key === "detached") entry.isDetached = true;
      else if (key === "locked") entry.isLocked = true;
      else if (key === "prunable") entry.isPrunable = true;
    }
    worktrees.push(entry);
  }
  return worktrees;
}

export type GitWorktree = Omit<Worktree, "environmentIds">;

export async function listWorktrees(runner: Runner, sourcePath: string): Promise<GitWorktree[]> {
  const parsed = parsePorcelain(await runGit(runner, sourcePath, ["worktree", "list", "--porcelain"]));
  return parsed
    .filter((entry) => !entry.isBare)
    .map((entry, index) => ({
      path: realpathOr(entry.path),
      branch: entry.branch,
      head: entry.head,
      isMain: index === 0,
      isDetached: entry.isDetached,
      isLocked: entry.isLocked,
      isPrunable: entry.isPrunable,
    }));
}

export interface EnvironmentRef {
  id: string;
  path: string | null;
}

export function attachEnvironments(worktrees: GitWorktree[], environments: EnvironmentRef[]): Worktree[] {
  const byPath = new Map<string, string[]>();
  for (const environment of environments) {
    if (environment.path === null) continue;
    const key = realpathOr(environment.path);
    byPath.set(key, [...(byPath.get(key) ?? []), environment.id]);
  }
  return worktrees.map((worktree) => ({ ...worktree, environmentIds: byPath.get(worktree.path) ?? [] }));
}

export async function worktreeStatus(runner: Runner, path: string): Promise<WorktreeStatus> {
  const porcelain = await runGit(runner, path, ["status", "--porcelain=v2", "--branch"]);
  let upstream: string | null = null;
  let ahead = 0;
  let behind = 0;
  let dirtyFiles = 0;
  for (const line of porcelain.split("\n")) {
    if (line.startsWith("# branch.upstream ")) upstream = line.slice("# branch.upstream ".length);
    else if (line.startsWith("# branch.ab ")) {
      const match = /\+(\d+) -(\d+)/.exec(line);
      if (match) {
        ahead = Number(match[1]);
        behind = Number(match[2]);
      }
    } else if (line !== "" && !line.startsWith("#")) dirtyFiles += 1;
  }
  return { path, dirtyFiles, upstream, ahead, behind };
}

export async function listBranches(runner: Runner, cwd: string, query: string, limit: number): Promise<string[]> {
  const out = await runGit(runner, cwd, [
    "for-each-ref",
    "--sort=-committerdate",
    "--format=%(refname)",
    "refs/heads",
    "refs/remotes",
  ]);
  const needle = query.trim().toLowerCase();
  const names: string[] = [];
  for (const ref of out.split("\n")) {
    if (ref === "" || ref.endsWith("/HEAD")) continue;
    const name = ref.replace(/^refs\/(heads|remotes)\//, "");
    if (needle !== "" && !name.toLowerCase().includes(needle)) continue;
    names.push(name);
    if (names.length >= limit) break;
  }
  return names;
}

export async function defaultBaseRef(runner: Runner, cwd: string): Promise<string> {
  const originHead = await runner("git", ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"], { cwd });
  if (originHead.code === 0 && originHead.stdout.trim() !== "") return originHead.stdout.trim();
  const current = await runner("git", ["symbolic-ref", "--quiet", "--short", "HEAD"], { cwd });
  if (current.code === 0 && current.stdout.trim() !== "") return current.stdout.trim();
  return "HEAD";
}

export function branchSlug(branch: string): string {
  return branch.replace(/\//g, "-");
}

export function defaultWorktreePath(sourceRoot: string, branch: string): string {
  return join(dirname(sourceRoot), `${basename(sourceRoot)}-worktrees`, branchSlug(branch));
}

export async function hasGtr(runner: Runner, cwd: string): Promise<boolean> {
  try {
    return (await runner("git", ["gtr", "version"], { cwd })).code === 0;
  } catch {
    return false;
  }
}

export async function checkBranchName(runner: Runner, cwd: string, branch: string): Promise<string | null> {
  if (branch.trim() === "") return "Branch name is required";
  const ok = await gitSucceeds(runner, cwd, ["check-ref-format", "--branch", branch]);
  return ok ? null : `"${branch}" is not a valid branch name`;
}

export async function localBranchExists(runner: Runner, cwd: string, branch: string): Promise<boolean> {
  return gitSucceeds(runner, cwd, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`]);
}

export async function findWorktreeForBranch(runner: Runner, sourceRoot: string, branch: string) {
  return (await listWorktrees(runner, sourceRoot)).find((worktree) => worktree.branch === branch) ?? null;
}

export interface CreateWorktreeArgs {
  runner: Runner;
  sourceRoot: string;
  branch: string;
  base: string;
  tool: "gtr" | "git";
  log: (line: string) => void;
  signal?: AbortSignal;
}

export interface CreatedWorktree {
  path: string;
  createdByUs: boolean;
  createdBranch: boolean;
}

export async function createWorktree(args: CreateWorktreeArgs): Promise<CreatedWorktree> {
  const { runner, sourceRoot, branch, base, tool, log, signal } = args;
  const existing = await findWorktreeForBranch(runner, sourceRoot, branch);
  if (existing !== null) {
    log(`Reusing existing worktree ${existing.path}`);
    return { path: existing.path, createdByUs: false, createdBranch: false };
  }
  const branchExisted = await localBranchExists(runner, sourceRoot, branch);
  if (tool === "gtr") {
    await run(runner, "git", ["gtr", "new", branch, "--from", base, "--yes"], { cwd: sourceRoot, onLine: log, signal });
    const path = (await run(runner, "git", ["gtr", "go", branch], { cwd: sourceRoot, signal })).trim();
    return { path: realpathOr(path), createdByUs: true, createdBranch: !branchExisted };
  }
  const path = defaultWorktreePath(sourceRoot, branch);
  const addArgs = branchExisted
    ? ["worktree", "add", path, branch]
    : ["worktree", "add", "--no-track", "-b", branch, path, base];
  await runGit(runner, sourceRoot, addArgs, { onLine: log, signal });
  return { path: realpathOr(path), createdByUs: true, createdBranch: !branchExisted };
}

export interface RemoveWorktreeArgs {
  runner: Runner;
  sourceRoot: string;
  path: string;
  branch: string | null;
  tool: "gtr" | "git";
  force: boolean;
  deleteBranch: boolean;
  log: (line: string) => void;
}

export async function removeWorktree(args: RemoveWorktreeArgs): Promise<{ deletedBranch: string | null }> {
  const { runner, sourceRoot, path, branch, tool, force, deleteBranch, log } = args;
  if (tool === "gtr" && branch !== null) {
    await run(runner, "git", ["gtr", "rm", branch, "--yes", ...(force ? ["--force"] : [])], {
      cwd: sourceRoot,
      onLine: log,
    });
  } else {
    await runGit(runner, sourceRoot, ["worktree", "remove", ...(force ? ["--force"] : []), path], { onLine: log });
  }
  await runGit(runner, sourceRoot, ["worktree", "prune"]);
  if (!deleteBranch || branch === null || !(await localBranchExists(runner, sourceRoot, branch))) {
    return { deletedBranch: null };
  }
  await runGit(runner, sourceRoot, ["branch", "-D", branch], { onLine: log });
  return { deletedBranch: branch };
}
