// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { loadPluginApp, renderSlot, type PluginRpcTestHandlers } from "@get-bb/plugin-sdk/testing/app";
import type { AgentDefaults, rpcContract, ScratchTicket, ScratchView } from "../src/contract";
import { needsPiWarning } from "../src/ui/tasks/useLaunch";

const PATH = "/repo-worktrees/feat";

const ticket = (number: string, title: string, state: ScratchTicket["state"], blockers: string[] = []): ScratchTicket => ({
  ref: `demo/${number}`,
  number,
  slug: `${number}-x`,
  title,
  type: "task",
  status: state === "done" ? "closed" : "open",
  claimed: null,
  blockedBy: blockers,
  blockers,
  state,
  path: `${PATH}/.scratch/demo/tickets/${number}-x.md`,
});

const INDEX: ScratchView = {
  root: PATH,
  scratchDir: `${PATH}/.scratch`,
  efforts: [
    {
      slug: "demo",
      dir: `${PATH}/.scratch/demo`,
      mapPath: `${PATH}/.scratch/demo/MAP.md`,
      tickets: [ticket("01", "Name it", "done"), ticket("02", "Wire it", "frontier"), ticket("03", "Ship it", "blocked", ["02"])],
      issues: [
        { ref: "demo/01", number: "01", slug: "01-a", title: "Build A", status: "needs-plan", path: "a" },
        { ref: "demo/02", number: "02", slug: "02-b", title: "Build B", status: "ready-to-implement", path: "b" },
        { ref: "demo/03", number: "03", slug: "03-c", title: "Build C", status: "done", path: "c" },
      ],
      handoffReady: false,
    },
  ],
  liveThreads: [],
  piSubagents: { orchestrate: true, tickets: [] },
};

const PI_WARNING = "Orchestration uses pi subagents; other providers can't run them.";

function handlers(view: ScratchView = INDEX, defaults: AgentDefaults | null = null) {
  const unused = () => {
    throw new Error("unused");
  };
  return {
    listWorktrees: unused,
    worktreeStatus: unused,
    branches: unused,
    validateBranch: unused,
    spawnInWorktree: unused,
    removeWorktree: unused,
    getConfig: unused,
    setConfig: unused,
    scratch: () => view,
    scratchSummary: unused,
    runTicket: () => ({ threadId: "thr_ticket" }),
    orchestrate: () => ({ threadId: "thr_batch" }),
    chart: () => ({ threadId: "thr_chart" }),
    handoff: unused,
    agentDefaults: () => defaults,
    threadWorktree: () => ({ projectId: "p1", path: PATH, label: "feat" }),
  } satisfies PluginRpcTestHandlers<typeof rpcContract>;
}

async function renderPanel(rpc = handlers()) {
  await loadPluginApp(() => import("../app"));
  const { TasksPanel } = await import("../src/ui/tasks/TasksPanel");
  const view = renderSlot({ component: TasksPanel }, { threadId: "thr_here", params: null }, { rpc });
  await view.findByText("Wire it");
  return view;
}

afterEach(cleanup);

describe("TasksPanel", () => {
  it("shows ready and blocked tickets, the open-issue batch, and progress; done is collapsed", async () => {
    const view = await renderPanel();
    expect(view.getByText("Ship it")).toBeTruthy();
    expect(view.queryByText("Name it")).toBeNull();
    expect(view.getByText("1/3")).toBeTruthy();
    expect(view.getByText("2 open · run as one batch")).toBeTruthy();
    expect(view.getByText("Build A")).toBeTruthy();
    expect(view.queryByText("Build C")).toBeNull();
    expect(view.getAllByRole("button", { name: "Run" })).toHaveLength(1);
    fireEvent.click(view.getByRole("button", { name: /Done · 1/ }));
    expect(view.getByText("Name it")).toBeTruthy();
  });

  it("runs a ticket, then navigates to the thread", async () => {
    const view = await renderPanel();
    fireEvent.click(view.getByRole("button", { name: "Run" }));
    await waitFor(() => expect(view.inspection.navigateCalls).toEqual([{ method: "toThread", threadId: "thr_ticket" }]));
    expect(view.inspection.rpcCalls.find((call) => call.method === "runTicket")?.input).toEqual({
      projectId: "p1",
      path: PATH,
      ref: "demo/02",
    });
  });

  it("orchestrates all open issues once and stays put on cmd-click", async () => {
    const view = await renderPanel();
    fireEvent.click(view.getByRole("button", { name: "Orchestrate" }), { metaKey: true });
    await waitFor(() =>
      expect(view.inspection.rpcCalls.filter((call) => call.method === "orchestrate")).toEqual([
        expect.objectContaining({ input: expect.objectContaining({ effort: "demo", issues: ["01", "02"] }) }),
      ]),
    );
    await waitFor(() => expect(view.inspection.rpcCalls.filter((call) => call.method === "scratch")).toHaveLength(2));
    expect(view.inspection.navigateCalls).toEqual([]);
  });

  it("charts a new map from the idea", async () => {
    const view = await renderPanel();
    fireEvent.change(view.getByLabelText("Idea for a new map"), { target: { value: "  cost tracking " } });
    fireEvent.click(view.getByRole("button", { name: "Chart" }));
    await waitFor(() =>
      expect(view.inspection.rpcCalls.find((call) => call.method === "chart")?.input).toMatchObject({ idea: "cost tracking" }),
    );
  });

  it("opens a ticket's live thread instead of running it, and offers Run again", async () => {
    const live = { ...INDEX, liveThreads: [{ kind: "ticket" as const, ref: "demo/02", threadId: "thr_live" }] };
    const view = await renderPanel(handlers(live));
    expect(view.queryByRole("button", { name: "Run" })).toBeNull();
    fireEvent.click(view.getByRole("button", { name: "Open" }));
    expect(view.inspection.navigateCalls).toEqual([{ method: "toThread", threadId: "thr_live" }]);
    expect(view.getByRole("button", { name: "More for demo/02" })).toBeTruthy();
  });

  it("opens the batch thread instead of orchestrating while one is live", async () => {
    const live = { ...INDEX, liveThreads: [{ kind: "issue" as const, ref: "demo/01", threadId: "thr_orch" }] };
    const view = await renderPanel(handlers(live));
    expect(view.queryByRole("button", { name: "Orchestrate" })).toBeNull();
    fireEvent.click(view.getByRole("button", { name: "Open demo batch thread" }));
    expect(view.inspection.navigateCalls).toEqual([{ method: "toThread", threadId: "thr_orch" }]);
  });

  it("explains a thread outside any worktree", async () => {
    await loadPluginApp(() => import("../app"));
    const { TasksPanel } = await import("../src/ui/tasks/TasksPanel");
    const view = renderSlot(
      { component: TasksPanel },
      { threadId: "thr_here", params: null },
      { rpc: { ...handlers(), threadWorktree: () => null } },
    );
    await view.findByText(/isn't in a git worktree/);
  });

  it("seeds the picker from agentDefaults and warns when orchestrating off pi", async () => {
    const claude = { providerId: "claude-code", model: "opus", reasoningLevel: "high", source: "default" as const };
    const view = await renderPanel(handlers(INDEX, claude));
    await view.findByText(PI_WARNING);
    expect(view.inspection.rpcCalls.find((call) => call.method === "agentDefaults")?.input).toEqual({ projectId: "p1", prefer: "pi" });
  });
});

describe("needsPiWarning", () => {
  const noIssues: ScratchView = { ...INDEX, efforts: INDEX.efforts.map((effort) => ({ ...effort, issues: [] })) };
  it("warns only off pi, and only when a pi-subagent action is on offer", () => {
    expect(needsPiWarning(INDEX, "pi")).toBe(false);
    expect(needsPiWarning(INDEX, "claude-code")).toBe(true);
    expect(needsPiWarning(noIssues, "claude-code")).toBe(false);
    expect(needsPiWarning({ ...noIssues, piSubagents: { orchestrate: true, tickets: ["demo/02"] } }, "codex")).toBe(true);
    expect(needsPiWarning(null, "codex")).toBe(false);
  });
});
