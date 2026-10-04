import { describe, expect, it } from "vitest";
import {
  discoverGitWorktrees,
  findWorktree,
  mergeWorktrees,
  parseGitdir,
  parseHeadRef,
  type WorktreeIo,
} from "./worktrees.js";

describe("parseGitdir", () => {
  it("strips the trailing /.git", () => {
    expect(parseGitdir("/repo-wt/feat/.git\n")).toBe("/repo-wt/feat");
  });
  it("rejects non-gitdir content", () => {
    expect(parseGitdir("/repo-wt/feat")).toBeNull();
  });
});

describe("parseHeadRef", () => {
  it("reads branch refs", () => {
    expect(parseHeadRef("ref: refs/heads/feature-mel-dashboard\n")).toBe("feature-mel-dashboard");
  });
  it("returns null for detached heads", () => {
    expect(parseHeadRef("e2de223baf766e50eea2a707101e43a785e5b1c8\n")).toBeNull();
  });
});

const fakeIo = (files: Record<string, string>, dirs: Record<string, string[]>): WorktreeIo => ({
  list: async (path) => {
    const entries = dirs[path];
    if (!entries) throw new Error(`missing dir ${path}`);
    return entries;
  },
  read: async (path) => {
    const content = files[path];
    if (content === undefined) throw new Error(`missing file ${path}`);
    return content;
  },
});

describe("discoverGitWorktrees", () => {
  const registry = "/repo/.git/worktrees";
  const io = fakeIo(
    {
      [`${registry}/feat/gitdir`]: "/repo-wt/feat/.git\n",
      [`${registry}/feat/HEAD`]: "ref: refs/heads/feat-x\n",
      [`${registry}/det/gitdir`]: "/repo-wt/det/.git\n",
      [`${registry}/det/HEAD`]: "e2de223baf766e50eea2a707101e43a785e5b1c8\n",
    },
    {
      [registry]: ["feat/gitdir", "feat/HEAD", "det/gitdir", "det/HEAD", "stray.txt"],
    },
  );

  it("returns worktree paths and branches, skipping stray files", async () => {
    expect(await discoverGitWorktrees(io, { path: "/repo", hostId: "host_1" })).toEqual([
      { path: "/repo-wt/feat", hostId: "host_1", branch: "feat-x" },
      { path: "/repo-wt/det", hostId: "host_1", branch: null },
    ]);
  });

  it("returns [] when no worktree registry exists", async () => {
    expect(await discoverGitWorktrees(fakeIo({}, {}), { path: "/repo" })).toEqual([]);
  });
});

describe("mergeWorktrees", () => {
  it("unions sources, environments, and git discovery; environments win", () => {
    const merged = mergeWorktrees(
      [{ path: "/repo", hostId: "host_1" }],
      [
        { environmentId: "env_main", path: "/repo", hostId: "host_1", branchName: "main", isWorktree: false },
        { environmentId: "env_feat", path: "/repo-wt/feat", hostId: "host_1", branchName: "feat-x", isWorktree: true },
      ],
      [
        { path: "/repo-wt/feat", hostId: "host_1", branch: "feat-x" },
        { path: "/repo-wt/other", hostId: "host_1", branch: "other" },
      ],
    );
    expect(merged).toEqual([
      {
        path: "/repo",
        hostId: "host_1",
        branch: "main",
        isPrimary: true,
        isWorktree: false,
        environmentId: "env_main",
      },
      {
        path: "/repo-wt/feat",
        hostId: "host_1",
        branch: "feat-x",
        isPrimary: false,
        isWorktree: true,
        environmentId: "env_feat",
      },
      {
        path: "/repo-wt/other",
        hostId: "host_1",
        branch: "other",
        isPrimary: false,
        isWorktree: true,
        environmentId: null,
      },
    ]);
  });
});

describe("findWorktree", () => {
  const worktrees = mergeWorktrees(
    [{ path: "/repo", hostId: "host_1" }],
    [],
    [{ path: "/repo-wt/feat", hostId: "host_1", branch: "feature-mel-dashboard" }],
  );

  it("matches branch or basename", () => {
    expect(findWorktree(worktrees, "feature-mel-dashboard")?.path).toBe("/repo-wt/feat");
    expect(findWorktree(worktrees, "feat")?.path).toBe("/repo-wt/feat");
    expect(findWorktree(worktrees, "/repo-wt/feat")?.path).toBe("/repo-wt/feat");
  });

  it("returns null for unknown queries", () => {
    expect(findWorktree(worktrees, "nope")).toBeNull();
  });
});
