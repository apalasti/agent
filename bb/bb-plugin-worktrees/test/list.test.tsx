// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { loadPluginApp, renderSlot, type PluginRpcTestHandlers } from "@get-bb/plugin-sdk/testing/app";
import type { PluginSidebarThreadRowStatus, PluginThreadListProps } from "@get-bb/plugin-sdk/app";
import { WORKTREES_CHANGED, type rpcContract } from "../src/contract";
import { makeProject, makeThread, makeWorktree } from "./fixtures";

const MAIN = "/repo";
const FEAT = "/repo-worktrees/feat-a";
const IDLE = "/repo-worktrees/idle";

function rpcHandlers(overrides: Partial<PluginRpcTestHandlers<typeof rpcContract>> = {}) {
  return {
    listWorktrees: ({ projectId }) => ({
      projectId,
      sourcePath: MAIN,
      worktrees: [
        makeWorktree(MAIN, { branch: "main", isMain: true }),
        makeWorktree(FEAT, { branch: "feat/a" }),
        makeWorktree(IDLE, { branch: "idle" }),
      ],
    }),
    worktreeStatus: ({ path }) => ({ path, dirtyFiles: path === FEAT ? 2 : 0, upstream: "origin/feat/a", ahead: 1, behind: 0 }),
    branches: () => ({ branches: [] }),
    validateBranch: () => ({ ok: true, message: null, existingWorktreePath: null }),
    spawnInWorktree: () => ({ threadId: "new" }),
    removeWorktree: () => ({ archivedThreadIds: [], deletedBranch: null, log: "" }),
    getConfig: () => ({
      baseRef: null,
      overlayDir: null,
      setupCommand: null,
      teardownCommand: null,
      tool: "auto",
      effectiveBaseRef: "origin/main",
      effectiveOverlayDir: null,
      effectiveTool: "git",
    }),
    setConfig: () => {
      throw new Error("unused");
    },
    scratch: ({ path }) => ({
      root: path,
      scratchDir: `${path}/.scratch`,
      efforts: [],
      liveThreads: [],
      piSubagents: { orchestrate: true, tickets: [] },
    }),
    scratchSummary: ({ path }) => ({ readyTickets: path === FEAT ? 3 : 0, openIssues: path === FEAT ? 2 : 0, handoffs: 0 }),
    runTicket: () => ({ threadId: "new" }),
    orchestrate: () => ({ threadId: "new" }),
    chart: () => ({ threadId: "new" }),
    handoff: () => ({ threadId: "new" }),
    agentDefaults: () => null,
    threadWorktree: () => null,
    ...overrides,
  } satisfies PluginRpcTestHandlers<typeof rpcContract>;
}

const threads = [
  makeThread("t-main", { title: "Main work", displayTitle: "Main work", environment: { id: "env-main", path: MAIN } }),
  makeThread("t-feat", {
    title: "Feature work",
    displayTitle: "Feature work",
    indicator: "runtime",
    environment: { id: "env-feat", path: `${FEAT}/` },
  }),
  makeThread("t-child", {
    title: "Child",
    displayTitle: "Child",
    parentThreadId: "t-feat",
    environment: { id: "env-feat", path: FEAT },
  }),
];

const projects = [makeProject("p1", { name: "irrops" }), makeProject("me", { name: "Personal", isPersonal: true })];

const SUBAGENTS_RUNNING: PluginSidebarThreadRowStatus = { icon: "Bot", label: "2 subagents running", tone: "running" };

async function renderList(
  options: {
    rpc?: ReturnType<typeof rpcHandlers>;
    onNavigate?: () => void;
    rowStatuses?: Record<string, PluginSidebarThreadRowStatus>;
  } = {},
) {
  const app = await loadPluginApp(() => import("../app"));
  const props: PluginThreadListProps = {
    activeThreadId: "t-main",
    activeProjectId: "p1",
    isCompactViewport: false,
    onNavigate: options.onNavigate ?? (() => {}),
    searchQuery: "",
  };
  return renderSlot<PluginThreadListProps, typeof rpcContract>(app.threadLists[0]!, props, {
    rpc: options.rpc ?? rpcHandlers(),
    sidebarThreads: { status: "ready", threads, projects, sections: [] },
    sidebarRowStatuses: options.rowStatuses,
  });
}

function memoryStorage(): Storage {
  const items = new Map<string, string>();
  return {
    get length() {
      return items.size;
    },
    clear: () => items.clear(),
    getItem: (key) => items.get(key) ?? null,
    key: (index) => [...items.keys()][index] ?? null,
    removeItem: (key) => void items.delete(key),
    setItem: (key, value) => void items.set(key, String(value)),
  };
}

// Node's own experimental localStorage global shadows jsdom's and throws without a backing file.
beforeEach(() => vi.stubGlobal("localStorage", memoryStorage()));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Worktrees thread list", () => {
  it("renders project → worktrees → threads, folds idle worktrees, and skips an empty personal project", async () => {
    const slot = await renderList();
    await slot.findByText("feat/a");
    expect(slot.getByText("irrops")).toBeTruthy();
    expect(slot.getByText("main")).toBeTruthy();
    expect(slot.getByText("1 idle worktree")).toBeTruthy();
    expect(slot.queryByText("idle")).toBeNull();
    expect(slot.queryByText("Personal")).toBeNull();

    const anchors = Array.from(slot.container.querySelectorAll("a[data-sidebar-thread-shortcut-target]"));
    expect(anchors.map((a) => a.getAttribute("data-sidebar-thread-id"))).toEqual(["t-main", "t-feat", "t-child"]);
    expect(anchors[0]!.getAttribute("href")).toBe("/projects/p1/threads/t-main");
    expect(anchors[0]!.getAttribute("aria-current")).toBe("page");
  });

  it("expands the idle fold in place and remembers it", async () => {
    const slot = await renderList();
    fireEvent.click(await slot.findByRole("button", { name: "Expand 1 idle worktree" }));
    const rows = Array.from(slot.container.querySelectorAll("[data-worktree-path]")).map((row) =>
      row.getAttribute("data-worktree-path"),
    );
    expect(rows).toEqual([MAIN, FEAT, IDLE]);
    expect(JSON.parse(localStorage.getItem("bb-plugin-worktrees:collapsed") ?? "[]")).toContain("idle-expanded:p1");

    cleanup();
    const again = await renderList();
    await again.findByText("idle");
  });

  it("badges a worktree with runnable .scratch work", async () => {
    const slot = await renderList();
    await slot.findByRole("img", { name: "3 ready tickets · 2 open issues" });
  });

  it("orders worktrees: main first, then by activity, then by name", async () => {
    const slot = await renderList();
    await slot.findByText("feat/a");
    const rows = Array.from(slot.container.querySelectorAll("[data-worktree-path]")).map((row) =>
      row.getAttribute("data-worktree-path"),
    );
    expect(rows).toEqual([MAIN, FEAT]);
  });

  it("opens a thread through the host and closes the drawer", async () => {
    const onNavigate = vi.fn();
    const slot = await renderList({ onNavigate });
    const anchor = await slot.findByRole("link", { name: "Open Feature work" });
    fireEvent.click(anchor);
    expect(slot.inspection.sidebarActionCalls).toContainEqual(expect.objectContaining({ method: "open", threadId: "t-feat" }));
    expect(onNavigate).toHaveBeenCalled();
  });

  it("starts a new thread in a worktree by reusing a live thread's environment", async () => {
    const slot = await renderList();
    fireEvent.click(await slot.findByRole("button", { name: "New thread in feat/a" }));
    expect(slot.inspection.sidebarActionCalls).toContainEqual(
      expect.objectContaining({
        method: "openNewThread",
        options: expect.objectContaining({ projectId: "p1", environmentId: "env-feat" }),
      }),
    );
  });

  it("asks the backend for the status of on-screen worktrees and shows dirty/ahead", async () => {
    const slot = await renderList();
    await slot.findByLabelText("2 uncommitted files · 1 ahead of origin/feat/a");
    expect(slot.inspection.rpcCalls.some((call) => call.method === "worktreeStatus")).toBe(true);
    expect(slot.getAllByText("↑1").length).toBeGreaterThan(0);
  });

  it("refetches worktrees when the backend signals a change", async () => {
    const slot = await renderList();
    await slot.findByText("feat/a");
    const before = slot.inspection.rpcCalls.filter((call) => call.method === "listWorktrees").length;
    await slot.behavior.emitRealtime(WORKTREES_CHANGED, null);
    await waitFor(() =>
      expect(slot.inspection.rpcCalls.filter((call) => call.method === "listWorktrees").length).toBeGreaterThan(before),
    );
  });

  it("collapses a worktree and remembers it", async () => {
    const slot = await renderList();
    fireEvent.click(await slot.findByRole("button", { name: "Collapse feat/a threads" }));
    expect(slot.queryByRole("link", { name: "Open Feature work" })).toBeNull();
    expect(JSON.parse(localStorage.getItem("bb-plugin-worktrees:collapsed") ?? "[]")).toContain(`worktree:p1:${FEAT}`);

    cleanup();
    const again = await renderList();
    await again.findByText("feat/a");
    expect(again.queryByRole("link", { name: "Open Feature work" })).toBeNull();
  });

  it("nests child threads and lets the parent collapse them", async () => {
    const slot = await renderList();
    await slot.findByRole("link", { name: "Open Child" });
    fireEvent.click(slot.getByRole("button", { name: "Collapse Feature work threads" }));
    expect(slot.queryByRole("link", { name: "Open Child" })).toBeNull();
  });

  it("shows a running row status as a second line under a busy thread's title, keeping the spinner", async () => {
    const slot = await renderList({ rowStatuses: { "t-feat": SUBAGENTS_RUNNING } });
    const anchor = await slot.findByRole("link", { name: "Open Feature work" });
    const row = anchor.parentElement!;
    const line = row.querySelector("[data-row-status-line]");
    expect(line?.textContent).toBe("2 subagents running");
    expect(row.querySelector(".animate-spin")).toBeTruthy();
    expect(row.querySelectorAll("a[data-sidebar-thread-shortcut-target]")).toHaveLength(1);

    fireEvent.click(anchor);
    expect(slot.inspection.sidebarActionCalls).toContainEqual(expect.objectContaining({ method: "open", threadId: "t-feat" }));
  });

  it("leaves rows without a running status single-line", async () => {
    const slot = await renderList({ rowStatuses: { "t-main": { icon: "Check", label: "Done", tone: "success" } } });
    await slot.findByText("feat/a");
    expect(slot.container.querySelector("[data-row-status-line]")).toBeNull();
    expect(slot.getByLabelText("Done")).toBeTruthy();
  });

  it("rolls a nested thread's running status into its collapsed worktree", async () => {
    const slot = await renderList({ rowStatuses: { "t-child": SUBAGENTS_RUNNING } });
    fireEvent.click(await slot.findByRole("button", { name: "Collapse feat/a threads" }));
    const worktree = slot.container.querySelector(`[data-worktree-path="${FEAT}"]`)!;
    expect(worktree.getAttribute("title")).toBe(`${FEAT}\n2 subagents running`);
    expect(worktree.querySelector('[aria-label="2 subagents running"]')).toBeTruthy();
  });

  it("shows why a project's worktrees could not be listed", async () => {
    const slot = await renderList({
      rpc: rpcHandlers({
        listWorktrees: () => {
          throw new Error("not a git repository");
        },
      }),
    });
    await slot.findByText(/not a git repository/);
    expect(slot.getByRole("link", { name: "Open Feature work" })).toBeTruthy();
  });
});
