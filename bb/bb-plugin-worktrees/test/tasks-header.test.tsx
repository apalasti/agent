// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { loadPluginApp, renderSlot, type PluginRpcTestHandlers } from "@get-bb/plugin-sdk/testing/app";
import type { rpcContract } from "../src/contract";

const PATH = "/repo-worktrees/feat";

function handlers(inWorktree = true) {
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
    scratch: unused,
    scratchSummary: () => ({ readyTickets: 2, openIssues: 1, handoffs: 0 }),
    runTicket: unused,
    orchestrate: unused,
    chart: unused,
    handoff: unused,
    agentDefaults: unused,
    threadWorktree: () => (inWorktree ? { projectId: "p1", path: PATH, label: "feat" } : null),
  } satisfies PluginRpcTestHandlers<typeof rpcContract>;
}

async function renderButton(rpc = handlers()) {
  await loadPluginApp(() => import("../app"));
  const { TasksHeaderButton } = await import("../src/ui/tasks/TasksHeaderButton");
  return renderSlot(
    { component: TasksHeaderButton },
    { threadId: "thr_here", projectId: "p1", isCompactViewport: false },
    { rpc, openThreadPanel: () => true },
  );
}

afterEach(cleanup);

describe("TasksHeaderButton", () => {
  it("shows the runnable count and opens the Tasks panel", async () => {
    const view = await renderButton();
    const button = await view.findByRole("button", { name: "Open Tasks: 2 ready tickets · 1 open issue" });
    expect(button.textContent).toBe("Tasks3");
    fireEvent.click(button);
    expect(view.inspection.navigateCalls).toEqual([{ method: "openThreadPanel", options: { actionId: "tasks" } }]);
  });

  it("renders nothing for a thread outside any worktree", async () => {
    const view = await renderButton(handlers(false));
    await waitFor(() => expect(view.inspection.rpcCalls.some((call) => call.method === "threadWorktree")).toBe(true));
    expect(view.queryByRole("button")).toBeNull();
  });
});
