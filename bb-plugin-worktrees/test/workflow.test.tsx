// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { loadPluginApp, renderSlot, type PluginRpcTestHandlers } from "@get-bb/plugin-sdk/testing/app";
import type { rpcContract, ScratchIndex, ScratchTicket } from "../src/contract";

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

const INDEX: ScratchIndex = {
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
};

function handlers() {
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
    scratch: () => INDEX,
    runTicket: () => ({ threadId: "thr_ticket" }),
    orchestrate: () => ({ threadId: "thr_batch" }),
    chart: () => ({ threadId: "thr_chart" }),
    handoff: unused,
    agentDefaults: () => null,
  } satisfies PluginRpcTestHandlers<typeof rpcContract>;
}

async function renderDialog(onOpenChange = vi.fn()) {
  await loadPluginApp(() => import("../app"));
  const { WorkflowDialog } = await import("../src/ui/WorkflowDialog");
  const view = renderSlot(
    { component: WorkflowDialog },
    { projectId: "p1", worktreePath: PATH, worktreeLabel: "feat", open: true, onOpenChange },
    { rpc: handlers() },
  );
  await view.findByText("Wire it");
  return { view, onOpenChange };
}

afterEach(cleanup);

describe("WorkflowDialog", () => {
  it("shows frontier and blocked tickets, open issues, and the closed counts", async () => {
    const { view } = await renderDialog();
    expect(view.getByText("Ship it")).toBeTruthy();
    expect(view.getByText("blocked by 02")).toBeTruthy();
    expect(view.queryByText("Name it")).toBeNull();
    expect(view.getByText("1/3 tickets closed · 1/3 issues done")).toBeTruthy();
    expect(view.getByText("Build A")).toBeTruthy();
    expect(view.queryByText("Build C")).toBeNull();
    expect(view.getAllByRole("button", { name: "Run" })).toHaveLength(1);
  });

  it("runs a ticket, then closes and navigates to the thread", async () => {
    const { view, onOpenChange } = await renderDialog();
    fireEvent.click(view.getByRole("button", { name: "Run" }));
    await waitFor(() => expect(view.inspection.navigateCalls).toEqual([{ method: "toThread", threadId: "thr_ticket" }]));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(view.inspection.rpcCalls.find((call) => call.method === "runTicket")?.input).toEqual({
      projectId: "p1",
      path: PATH,
      ref: "demo/02",
    });
  });

  it("orchestrates the checked issues and stays put on cmd-click", async () => {
    const { view, onOpenChange } = await renderDialog();
    const orchestrate = view.getByRole("button", { name: "Orchestrate selected" }) as HTMLButtonElement;
    expect(orchestrate.disabled).toBe(true);
    fireEvent.click(view.getAllByRole("checkbox")[1]!);
    fireEvent.click(view.getByRole("button", { name: "Orchestrate 1 selected" }), { metaKey: true });
    await waitFor(() =>
      expect(view.inspection.rpcCalls.find((call) => call.method === "orchestrate")?.input).toMatchObject({
        effort: "demo",
        issues: ["02"],
      }),
    );
    await waitFor(() => expect(view.inspection.rpcCalls.filter((call) => call.method === "scratch")).toHaveLength(2));
    expect(view.inspection.navigateCalls).toEqual([]);
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("charts a new map from the idea", async () => {
    const { view } = await renderDialog();
    fireEvent.change(view.getByLabelText("Idea for a new map"), { target: { value: "  cost tracking " } });
    fireEvent.click(view.getByRole("button", { name: "Chart" }));
    await waitFor(() =>
      expect(view.inspection.rpcCalls.find((call) => call.method === "chart")?.input).toMatchObject({ idea: "cost tracking" }),
    );
  });
});
