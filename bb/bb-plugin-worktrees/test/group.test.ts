import { describe, expect, it } from "vitest";
import {
  buildThreadForest,
  groupSidebar,
  normalizePath,
  OTHER_GROUP_KEY,
  rollupIndicator,
  type ThreadNode,
} from "../src/group";
import { makeProject, makeThread, makeWorktree } from "./fixtures";

const ids = (nodes: readonly ThreadNode[]) => nodes.map((node) => node.thread.id);

const MAIN = "/repo";
const FEAT = "/repo-worktrees/feat-a";
const FIX = "/repo-worktrees/fix-b";

describe("normalizePath", () => {
  it("strips trailing slashes but keeps root", () => {
    expect(normalizePath("/a/b///")).toBe("/a/b");
    expect(normalizePath("/")).toBe("/");
  });
});

describe("rollupIndicator", () => {
  it("picks the most urgent indicator, including nested children", () => {
    const forest = buildThreadForest([
      makeThread("a", { indicator: "unread-success" }),
      makeThread("b", { indicator: "workflow" }),
      makeThread("c", { parentThreadId: "a", indicator: "waiting-for-input" }),
    ]);
    expect(rollupIndicator(forest)).toBe("waiting-for-input");
    expect(rollupIndicator(buildThreadForest([makeThread("d", { indicator: "draft" })]))).toBe("none");
  });
});

describe("groupSidebar", () => {
  const project = makeProject("p1");
  const worktrees = [
    makeWorktree(FIX, { branch: "fix-b" }),
    makeWorktree(MAIN, { branch: "main", isMain: true }),
    makeWorktree(FEAT, { branch: "feat/a" }),
  ];

  it("matches threads to worktrees by normalized environment path", () => {
    const tree = groupSidebar(
      [
        makeThread("t1", { environment: { path: `${FEAT}/` } }),
        makeThread("t2", { environment: { path: MAIN } }),
      ],
      [project],
      { p1: worktrees },
    );
    const groups = tree.projects[0]!.worktrees;
    expect(groups.find((g) => g.key === FEAT)?.threads.map((n) => n.thread.id)).toEqual(["t1"]);
    expect(groups.find((g) => g.key === MAIN)?.threads.map((n) => n.thread.id)).toEqual(["t2"]);
  });

  it("falls back to the backend's environment ids when paths differ", () => {
    const tree = groupSidebar(
      [makeThread("t1", { environment: { id: "env-x", path: "/symlinked/feat-a" } })],
      [project],
      { p1: [makeWorktree(FEAT, { environmentIds: ["env-x"] })] },
    );
    expect(tree.projects[0]!.worktrees.map((g) => [g.key, g.threadCount])).toEqual([[FEAT, 1]]);
  });

  it("orders main first, then by latest thread activity, then by name", () => {
    const tree = groupSidebar(
      [
        makeThread("t1", { latestAttentionAt: 50, environment: { path: FIX } }),
        makeThread("t2", { latestAttentionAt: 90, environment: { path: FEAT } }),
      ],
      [project],
      { p1: worktrees },
    );
    expect(tree.projects[0]!.worktrees.map((g) => [g.label, g.threadCount])).toEqual([
      ["main", 0],
      ["feat/a", 1],
      ["fix-b", 1],
    ]);
  });

  it("keeps the main checkout but folds other thread-less worktrees into idle, sorted by name", () => {
    const tree = groupSidebar(
      [makeThread("t1", { environment: { path: FIX } })],
      [project],
      { p1: [...worktrees, makeWorktree("/repo-worktrees/a-idle", { branch: "a-idle" })] },
    );
    const node = tree.projects[0]!;
    expect(node.worktrees.map((g) => g.label)).toEqual(["main", "fix-b"]);
    expect(node.idleWorktrees.map((g) => g.label)).toEqual(["a-idle", "feat/a"]);
  });

  it("treats a worktree whose only threads are archived, hidden or pinned as idle", () => {
    const tree = groupSidebar(
      [
        makeThread("archived", { isArchived: true, archivedAt: 1, environment: { path: FEAT } }),
        makeThread("hidden", { isHidden: true, environment: { path: FEAT } }),
        makeThread("pinned", { isPinned: true, pinnedAt: 1, environment: { path: FEAT } }),
      ],
      [project],
      { p1: worktrees },
    );
    expect(tree.projects[0]!.idleWorktrees.map((g) => g.key)).toEqual([FEAT, FIX]);
  });

  it("labels a detached worktree by its directory name", () => {
    const tree = groupSidebar([], [project], {
      p1: [makeWorktree("/repo-worktrees/hotfix", { branch: null, isDetached: true, isMain: true })],
    });
    expect(tree.projects[0]!.worktrees[0]!.label).toBe("hotfix");
  });

  it("keeps threads in unknown checkouts in their own path group and environment-less ones in Other", () => {
    const tree = groupSidebar(
      [
        makeThread("t1", { environment: { path: "/elsewhere/x", branchName: "x-branch" } }),
        makeThread("t2", { environment: null }),
      ],
      [project],
      { p1: [makeWorktree(MAIN, { isMain: true })] },
    );
    const groups = tree.projects[0]!.worktrees;
    expect(groups.map((g) => [g.kind, g.label])).toEqual([
      ["worktree", "repo"],
      ["unmatched", "x-branch"],
      ["other", "Other"],
    ]);
    expect(groups[2]!.key).toBe(OTHER_GROUP_KEY);
  });

  it("still groups by path before worktrees are loaded", () => {
    const tree = groupSidebar([makeThread("t1", { environment: { path: FEAT } })], [project], {});
    expect(tree.projects[0]!.worktreesLoaded).toBe(false);
    expect(tree.projects[0]!.worktrees.map((g) => g.key)).toEqual([FEAT]);
  });

  it("hides archived and hidden threads", () => {
    const tree = groupSidebar(
      [
        makeThread("live", { environment: { path: MAIN } }),
        makeThread("archived", { isArchived: true, archivedAt: 5, environment: { path: MAIN } }),
        makeThread("hidden", { isHidden: true, environment: { path: MAIN } }),
      ],
      [project],
      { p1: [makeWorktree(MAIN, { isMain: true })] },
    );
    expect(ids(tree.projects[0]!.worktrees[0]!.threads)).toEqual(["live"]);
  });

  it("nests child threads under their parent and counts them", () => {
    const tree = groupSidebar(
      [
        makeThread("parent", { environment: { path: FEAT } }),
        makeThread("child", { parentThreadId: "parent", environment: { path: MAIN } }),
        makeThread("orphan", { parentThreadId: "gone", environment: { path: FEAT } }),
      ],
      [project],
      { p1: worktrees },
    );
    const feat = tree.projects[0]!.worktrees.find((g) => g.key === FEAT)!;
    expect(feat.threadCount).toBe(3);
    const parent = feat.threads.find((n) => n.thread.id === "parent")!;
    expect(ids(parent.children)).toEqual(["child"]);
    expect(ids(feat.threads).sort()).toEqual(["orphan", "parent"]);
  });

  it("does not loop on a parent cycle", () => {
    const tree = groupSidebar(
      [
        makeThread("a", { parentThreadId: "b", environment: { path: MAIN } }),
        makeThread("b", { parentThreadId: "a", environment: { path: MAIN } }),
      ],
      [project],
      { p1: [makeWorktree(MAIN, { isMain: true })] },
    );
    expect(tree.projects[0]!.worktrees[0]!.threadCount).toBe(2);
  });

  it("sorts active threads first, then by latest attention", () => {
    const tree = groupSidebar(
      [
        makeThread("old", { latestAttentionAt: 10, environment: { path: MAIN } }),
        makeThread("recent", { latestAttentionAt: 30, environment: { path: MAIN } }),
        makeThread("running", { status: "active", latestAttentionAt: 1, environment: { path: MAIN } }),
      ],
      [project],
      { p1: [makeWorktree(MAIN, { isMain: true })] },
    );
    expect(ids(tree.projects[0]!.worktrees[0]!.threads)).toEqual(["running", "recent", "old"]);
  });

  it("lifts pinned threads (with their children) into the pinned group in pin order", () => {
    const tree = groupSidebar(
      [
        makeThread("p-late", { isPinned: true, pinnedAt: 20, environment: { path: MAIN } }),
        makeThread("p-keyed", { isPinned: true, pinnedAt: 1, pinSortKey: "a", environment: { path: MAIN } }),
        makeThread("p-early", { isPinned: true, pinnedAt: 10, environment: { path: MAIN } }),
        makeThread("kid", { parentThreadId: "p-late", environment: { path: MAIN } }),
      ],
      [project],
      { p1: [makeWorktree(MAIN, { isMain: true })] },
    );
    expect(ids(tree.pinned)).toEqual(["p-keyed", "p-late", "p-early"]);
    expect(ids(tree.pinned[1]!.children)).toEqual(["kid"]);
    expect(tree.projects[0]!.worktrees[0]!.threadCount).toBe(0);
  });

  it("skips the personal project but collects its threads into a trailing group", () => {
    const personal = makeProject("me", { isPersonal: true });
    const tree = groupSidebar([makeThread("solo", { projectId: "me" })], [personal, project], {});
    expect(tree.projects.map((p) => p.project.id)).toEqual(["p1"]);
    expect(ids(tree.personal)).toEqual(["solo"]);
  });

  it("exposes an environment a live thread runs in for reuse", () => {
    const tree = groupSidebar(
      [makeThread("t1", { environment: { id: "env-live", path: FEAT } })],
      [project],
      { p1: worktrees },
    );
    const groups = tree.projects[0]!.worktrees;
    expect(groups.find((g) => g.key === FEAT)!.liveEnvironmentId).toBe("env-live");
    expect(groups.find((g) => g.key === MAIN)!.liveEnvironmentId).toBeNull();
  });
});
