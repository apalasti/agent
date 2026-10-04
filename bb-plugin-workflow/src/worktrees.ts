export interface WorktreeInfo {
  /** Absolute path of the checkout. */
  path: string;
  hostId?: string;
  branch: string | null;
  isPrimary: boolean;
  isWorktree: boolean;
  /** BB environment id attached to this checkout, when one exists. */
  environmentId: string | null;
}

export interface SourceRoot {
  path: string;
  hostId?: string;
}

export interface EnvironmentRef {
  environmentId: string;
  path: string;
  hostId?: string;
  branchName?: string | null;
  isWorktree?: boolean | null;
}

/** `a/b/.git` → `a/b`; anything else → null. */
export function parseGitdir(content: string): string | null {
  const trimmed = content.trim();
  return trimmed.endsWith("/.git") ? trimmed.slice(0, -"/.git".length) : null;
}

/** `ref: refs/heads/x` → `x`; a detached sha → null. */
export function parseHeadRef(content: string): string | null {
  const match = /^ref: refs\/heads\/(.+)$/m.exec(content.trim());
  return match?.[1] ?? null;
}

export interface WorktreeIo {
  /** Recursive relative file paths under the directory (host `listPaths` semantics). */
  list(path: string, hostId?: string): Promise<string[]>;
  read(path: string, hostId?: string): Promise<string>;
}

/**
 * Reads git's worktree registry (`<root>/.git/worktrees/<name>/gitdir` and
 * `HEAD`) instead of shelling out, so it works through the host files API on
 * any machine. Throws on unreadable roots.
 */
export async function discoverGitWorktrees(
  io: WorktreeIo,
  root: SourceRoot,
): Promise<{ path: string; hostId?: string; branch: string | null }[]> {
  const registry = `${root.path}/.git/worktrees`;
  let files: string[];
  try {
    files = await io.list(registry, root.hostId);
  } catch {
    return [];
  }
  const names = [
    ...new Set(
      files.filter((f) => f.includes("/")).map((f) => f.slice(0, f.indexOf("/"))),
    ),
  ];
  const found: { path: string; hostId?: string; branch: string | null }[] = [];
  for (const name of names) {
    const gitdir = await io.read(`${registry}/${name}/gitdir`, root.hostId).catch(() => null);
    const path = gitdir === null ? null : parseGitdir(gitdir);
    if (!path) continue;
    const head = await io.read(`${registry}/${name}/HEAD`, root.hostId).catch(() => null);
    found.push({ path, hostId: root.hostId, branch: head === null ? null : parseHeadRef(head) });
  }
  return found;
}

/**
 * Union of project source roots, BB environments, and git-discovered
 * worktrees, deduped by path. Environments win shared attributes: they carry
 * the id spawns reuse. Order is primary roots first, then the rest by path.
 */
export function mergeWorktrees(
  sources: SourceRoot[],
  environments: EnvironmentRef[],
  gitWorktrees: { path: string; hostId?: string; branch: string | null }[],
): WorktreeInfo[] {
  const byPath = new Map<string, WorktreeInfo>();
  const primaryPaths = new Set(sources.map((s) => s.path));
  for (const source of sources) {
    byPath.set(source.path, {
      path: source.path,
      hostId: source.hostId,
      branch: null,
      isPrimary: true,
      isWorktree: false,
      environmentId: null,
    });
  }
  for (const env of environments) {
    const existing = byPath.get(env.path);
    byPath.set(env.path, {
      path: env.path,
      hostId: env.hostId ?? existing?.hostId,
      branch: env.branchName ?? existing?.branch ?? null,
      isPrimary: existing?.isPrimary ?? primaryPaths.has(env.path),
      isWorktree: env.isWorktree ?? existing?.isWorktree ?? false,
      environmentId: env.environmentId,
    });
  }
  for (const wt of gitWorktrees) {
    const existing = byPath.get(wt.path);
    if (existing) {
      byPath.set(wt.path, {
        ...existing,
        branch: existing.branch ?? wt.branch,
        isWorktree: true,
      });
      continue;
    }
    byPath.set(wt.path, {
      path: wt.path,
      hostId: wt.hostId,
      branch: wt.branch,
      isPrimary: false,
      isWorktree: true,
      environmentId: null,
    });
  }
  return [...byPath.values()].sort(
    (a, b) => Number(b.isPrimary) - Number(a.isPrimary) || a.path.localeCompare(b.path),
  );
}

/** Matches against a worktree's branch, directory basename, or full path. */
export function findWorktree(
  worktrees: WorktreeInfo[],
  query: string,
): WorktreeInfo | null {
  const matches = worktrees.filter(
    (w) => w.path === query || w.branch === query || basename(w.path) === query,
  );
  return matches.length === 1 ? matches[0] : null;
}

function basename(path: string): string {
  return path.replace(/\/+$/, "").split("/").pop() ?? path;
}
