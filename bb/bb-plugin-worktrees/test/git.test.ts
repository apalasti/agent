import { existsSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  attachEnvironments,
  checkBranchName,
  createWorktree,
  defaultBaseRef,
  listBranches,
  listWorktrees,
  parsePorcelain,
  removeWorktree,
  spawnRunner,
  worktreeStatus,
} from "../src/git";
import { addOrigin, git, makeRepo, write, type TempRepo } from "./repo";

let repo: TempRepo;
afterEach(() => repo?.cleanup());
const noLog = () => {};

describe("parsePorcelain", () => {
  it("reads branch, detached, locked, prunable and bare entries", () => {
    const text = [
      "worktree /repo",
      "HEAD aaa",
      "detached",
      "",
      "worktree /repo-worktrees/feature-x",
      "HEAD bbb",
      "branch refs/heads/feature/x",
      "locked reason here",
      "",
      "worktree /gone",
      "HEAD ccc",
      "branch refs/heads/gone",
      "prunable gitdir file points to non-existent location",
      "",
      "worktree /bare",
      "bare",
      "",
    ].join("\n");
    expect(parsePorcelain(text)).toEqual([
      { path: "/repo", head: "aaa", branch: null, isBare: false, isDetached: true, isLocked: false, isPrunable: false },
      { path: "/repo-worktrees/feature-x", head: "bbb", branch: "feature/x", isBare: false, isDetached: false, isLocked: true, isPrunable: false },
      { path: "/gone", head: "ccc", branch: "gone", isBare: false, isDetached: false, isLocked: false, isPrunable: true },
      { path: "/bare", head: null, branch: null, isBare: true, isDetached: false, isLocked: false, isPrunable: false },
    ]);
  });
});

describe("worktrees in a real repo", () => {
  it("creates a worktree beside the repo, lists it, and reuses it for the same branch", async () => {
    repo = makeRepo();
    const created = await createWorktree({ runner: spawnRunner, sourceRoot: repo.repo, branch: "feat/x", base: "main", tool: "git", log: noLog });
    expect(created).toEqual({ path: join(repo.root, "demo-worktrees", "feat-x"), createdByUs: true, createdBranch: true });

    const worktrees = await listWorktrees(spawnRunner, repo.repo);
    expect(worktrees.map((w) => [w.path, w.branch, w.isMain])).toEqual([
      [repo.repo, "main", true],
      [created.path, "feat/x", false],
    ]);

    const again = await createWorktree({ runner: spawnRunner, sourceRoot: repo.repo, branch: "feat/x", base: "main", tool: "git", log: noLog });
    expect(again).toEqual({ path: created.path, createdByUs: false, createdBranch: false });
  });

  it("checks out an existing branch without creating it", async () => {
    repo = makeRepo();
    git(repo.repo, "branch", "existing");
    const created = await createWorktree({ runner: spawnRunner, sourceRoot: repo.repo, branch: "existing", base: "main", tool: "git", log: noLog });
    expect(created.createdBranch).toBe(false);
    expect(git(created.path, "branch", "--show-current").trim()).toBe("existing");
  });

  it("reports dirty files and ahead/behind against the upstream", async () => {
    repo = makeRepo();
    addOrigin(repo);
    write(join(repo.repo, "a.txt"), "a");
    git(repo.repo, "add", "a.txt");
    git(repo.repo, "commit", "-q", "-m", "a");
    write(join(repo.repo, "dirty.txt"), "x");
    expect(await worktreeStatus(spawnRunner, repo.repo)).toEqual({
      path: repo.repo,
      dirtyFiles: 1,
      upstream: "origin/main",
      ahead: 1,
      behind: 0,
    });
  });

  it("defaults the base ref to origin/HEAD, else the current branch", async () => {
    repo = makeRepo();
    expect(await defaultBaseRef(spawnRunner, repo.repo)).toBe("main");
    addOrigin(repo);
    expect(await defaultBaseRef(spawnRunner, repo.repo)).toBe("origin/main");
  });

  it("lists local and remote branches filtered by query, without origin/HEAD", async () => {
    repo = makeRepo();
    addOrigin(repo);
    git(repo.repo, "branch", "feature/one");
    git(repo.repo, "branch", "other");
    const all = await listBranches(spawnRunner, repo.repo, "", 50);
    expect(all.sort()).toEqual(["feature/one", "main", "origin/main", "other"]);
    expect(await listBranches(spawnRunner, repo.repo, "FEAT", 50)).toEqual(["feature/one"]);
  });

  it("removes a worktree and optionally its branch", async () => {
    repo = makeRepo();
    const { path } = await createWorktree({ runner: spawnRunner, sourceRoot: repo.repo, branch: "gone", base: "main", tool: "git", log: noLog });
    const result = await removeWorktree({
      runner: spawnRunner,
      sourceRoot: repo.repo,
      path,
      branch: "gone",
      tool: "git",
      force: false,
      deleteBranch: true,
      log: noLog,
    });
    expect(result).toEqual({ deletedBranch: "gone" });
    expect(existsSync(path)).toBe(false);
    expect(git(repo.repo, "branch", "--list", "gone").trim()).toBe("");
  });

  it("validates branch names", async () => {
    repo = makeRepo();
    expect(await checkBranchName(spawnRunner, repo.repo, "ok/name")).toBeNull();
    expect(await checkBranchName(spawnRunner, repo.repo, "bad..name")).toMatch(/not a valid branch name/);
  });
});

describe("attachEnvironments", () => {
  it("matches environments to worktrees by path", () => {
    const worktrees = [
      { path: "/a", branch: "main", head: null, isMain: true, isDetached: false, isLocked: false, isPrunable: false },
      { path: "/b", branch: "x", head: null, isMain: false, isDetached: false, isLocked: false, isPrunable: false },
    ];
    const attached = attachEnvironments(worktrees, [
      { id: "env_1", path: "/b" },
      { id: "env_2", path: "/b" },
      { id: "env_3", path: null },
    ]);
    expect(attached.map((w) => w.environmentIds)).toEqual([[], ["env_1", "env_2"]]);
  });
});
