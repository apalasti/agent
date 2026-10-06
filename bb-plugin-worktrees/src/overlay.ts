import { appendFile, copyFile, lstat, mkdir, readdir, readFile, symlink, unlink } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { gitSucceeds, runGit, type Runner } from "./git";

export interface OverlayArgs {
  runner: Runner;
  sourceRoot: string;
  worktreePath: string;
  overlayDir: string;
  log: (line: string) => void;
}

export interface OverlayResult {
  copied: string[];
  skipWorktree: string[];
  symlinked: string[];
}

async function findAgentsFiles(root: string, dir = root): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await findAgentsFiles(root, full)));
    else if (entry.isFile() && entry.name === "AGENTS.md") found.push(relative(root, full));
  }
  return found.sort();
}

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
}

async function addExclude(excludePath: string, pattern: string): Promise<void> {
  const current = (await exists(excludePath)) ? await readFile(excludePath, "utf8") : "";
  if (current.split("\n").includes(pattern)) return;
  await mkdir(dirname(excludePath), { recursive: true });
  const separator = current === "" || current.endsWith("\n") ? "" : "\n";
  await appendFile(excludePath, `${separator}${pattern}\n`);
}

export async function applyOverlay(args: OverlayArgs): Promise<OverlayResult> {
  const { runner, sourceRoot, worktreePath, overlayDir, log } = args;
  const result: OverlayResult = { copied: [], skipWorktree: [], symlinked: [] };

  for (const file of await findAgentsFiles(overlayDir)) {
    const dest = join(worktreePath, file);
    await mkdir(dirname(dest), { recursive: true });
    await copyFile(join(overlayDir, file), dest);
    result.copied.push(file);
    if (await gitSucceeds(runner, worktreePath, ["ls-files", "--error-unmatch", "--", file])) {
      await runGit(runner, worktreePath, ["update-index", "--skip-worktree", "--", file]);
      result.skipWorktree.push(file);
    }
  }

  const commonDir = (
    await runGit(runner, sourceRoot, ["rev-parse", "--path-format=absolute", "--git-common-dir"])
  ).trim();
  for (const entry of await readdir(overlayDir, { withFileTypes: true })) {
    if (!entry.isFile() || entry.name === "AGENTS.md" || entry.name.startsWith(".")) continue;
    const dest = join(worktreePath, entry.name);
    if (await exists(dest)) {
      if (!(await lstat(dest)).isSymbolicLink()) {
        log(`Overlay: ${entry.name} already exists in the worktree, not linking`);
        continue;
      }
      await unlink(dest);
    }
    await symlink(join(overlayDir, entry.name), dest);
    await addExclude(join(commonDir, "info", "exclude"), `/${entry.name}`);
    result.symlinked.push(entry.name);
  }

  log(
    `Overlay: copied ${result.copied.length} AGENTS.md (${result.skipWorktree.length} skip-worktree), linked ${result.symlinked.join(", ") || "nothing"}`,
  );
  return result;
}
