// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { loadPluginApp, renderSlot, type PluginRpcTestHandlers } from "@get-bb/plugin-sdk/testing/app";
import type { Agent, rpcContract, ThreadAgents, Workflow } from "../src/contract";
import { makeAgent, makeStep, makeWorkflow, rpcHandlers, T0, threadAgents } from "./uiFixtures";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function slots() {
  const app = await loadPluginApp(() => import("../app"));
  return {
    panel: app.threadPanelActions.find((slot) => slot.id === "pi-subagents")!,
    pill: app.threadHeaderActions.find((slot) => slot.id === "pi-subagents")!,
  };
}

async function renderPanel(agents: Agent[], workflows: Workflow[] = []) {
  const { panel } = await slots();
  return renderSlot(panel, { threadId: "thr_1", params: null }, { rpc: rpcHandlers(threadAgents(agents, { workflows })) });
}

async function renderPill(agents: Agent[], workflows: Workflow[] = [], isCompactViewport = false) {
  const { pill } = await slots();
  return renderSlot(
    pill,
    { threadId: "thr_1", projectId: "p1", isCompactViewport },
    { rpc: rpcHandlers(threadAgents(agents, { workflows })), openThreadPanel: () => true },
  );
}

const running = (agentId: string, overrides: Partial<Agent> = {}) =>
  makeAgent(agentId, { status: "running", endedAt: null, report: null, ...overrides });

const notebook = makeAgent("ag-notebook", {
  description: "Notebook for L6.01",
  agentType: "Agent",
  model: "claude-bridge/claude-sonnet-5-5",
  endedAt: T0 + 511_000,
  totalTokens: 162_345,
  prompt: "Write the notebook for lesson L6.01.",
  report: "The notebook is written.",
  steps: [
    ...Array.from({ length: 41 }, (_, i) => makeStep({ summary: `cmd ${i}`, isError: i < 4 })),
    makeStep({ name: "read", summary: "/w/L6-multi-node-chains.md", input: '{"path":"/w/L6-multi-node-chains.md"}' }),
    makeStep({ name: "get_subagent_result", summary: "x" }),
    makeStep({ name: "Agent", summary: "y" }),
  ],
});

describe("agent cards", () => {
  it("shows title, type, status, duration, model, tokens and tool uses", async () => {
    const rendered = await renderPanel([notebook]);
    const card = await rendered.findByRole("article", { name: "Notebook for L6.01" });
    for (const text of ["Notebook for L6.01", "Agent", "Completed", "8m 31s", "Sonnet 5.5", "162.3k tokens", "44 tool uses"])
      expect(within(card).getByText(text)).toBeTruthy();
    expect(within(card).getByRole("button", { name: "View transcript" })).toBeTruthy();
  });

  it("lists running agents first, then finished newest first, each with a status word", async () => {
    const rendered = await renderPanel([
      makeAgent("oldest-done", { startedAt: T0 }),
      makeAgent("no-report", { status: "needs-look", report: null, startedAt: T0 + 1 }),
      running("worker", { startedAt: T0 + 2 }),
      makeAgent("broken", { status: "failed", report: null, startedAt: T0 + 3 }),
      makeAgent("mystery", { status: "unknown", report: null, startedAt: T0 + 4 }),
    ]);
    const cards = await rendered.findAllByRole("article");
    expect(cards.map((card) => card.getAttribute("aria-label"))).toEqual(["worker", "mystery", "broken", "no-report", "oldest-done"]);
    expect(cards.map((card) => card.textContent)).toEqual([
      expect.stringContaining("Running"),
      expect.stringContaining("Unknown"),
      expect.stringContaining("Failed"),
      expect.stringContaining("No report"),
      expect.stringContaining("Completed"),
    ]);
    expect(within(cards[2]!).getByText("Failed").className).toContain("text-destructive");
    expect(within(cards[3]!).getByText("No report").className).toContain("text-warning-text");
  });

  it("shows what a running agent is doing now", async () => {
    const rendered = await renderPanel([
      running("worker", { steps: [makeStep({ at: Date.now() - 2_000, endAt: null, result: null, summary: "npm test" })] }),
      running("pondering", { steps: [makeStep()] }),
    ]);
    expect((await rendered.findByRole("article", { name: "worker" })).textContent).toContain("bash: npm test · 2s");
    expect(rendered.getByRole("article", { name: "pondering" }).textContent).toContain("thinking");
  });

  it("lists workflow children only under their workflow", async () => {
    const rendered = await renderPanel([makeAgent("top"), makeAgent("child", { workflowId: "wf_1" })], [makeWorkflow("wf_1")]);
    const cards = await rendered.findAllByRole("article");
    expect(cards.map((card) => card.getAttribute("aria-label"))).toEqual(["wf_1", "top"]);
  });

  it("says so when the thread has no subagents or workflows", async () => {
    const rendered = await renderPanel([]);
    expect((await rendered.findByRole("status")).textContent).toBe("No pi subagents or workflows in this thread.");
  });
});

describe("transcript view", () => {
  async function openNotebook(agent = notebook) {
    const rendered = await renderPanel([agent, makeAgent("other")]);
    const card = await rendered.findByRole("article", { name: agent.description });
    fireEvent.click(within(card).getByRole("button", { name: "View transcript" }));
    return rendered;
  }

  it("replaces the list with model, prompt, activity summary and report, and goes back", async () => {
    const rendered = await openNotebook();
    expect(rendered.queryAllByRole("article")).toHaveLength(0);
    expect(rendered.getByRole("heading", { name: "Notebook for L6.01" })).toBeTruthy();
    expect(rendered.getByText("Model").nextSibling!.textContent).toBe("Sonnet 5.5");
    expect(rendered.getByText("Write the notebook for lesson L6.01.")).toBeTruthy();
    expect(rendered.getByRole("button", { name: /Ran 41 commands \(4 failed\), read L6-multi-node-chains.md, used 2 tools/ })).toBeTruthy();
    expect(rendered.getByText("The notebook is written.")).toBeTruthy();

    fireEvent.click(rendered.getByRole("button", { name: "Back" }));
    expect(await rendered.findAllByRole("article")).toHaveLength(2);
  });

  it("expands the activity summary into steps with their input", async () => {
    const rendered = await openNotebook();
    expect(rendered.queryByText("/w/L6-multi-node-chains.md")).toBeNull();
    fireEvent.click(rendered.getByRole("button", { name: /Ran 41 commands/ }));
    fireEvent.click(rendered.getByText("/w/L6-multi-node-chains.md"));
    expect(rendered.getByText('{"path":"/w/L6-multi-node-chains.md"}')).toBeTruthy();
  });

  it("clamps a long prompt behind Show more and copies the raw prompt", async () => {
    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(900);
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(240);
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    const rendered = await openNotebook();

    fireEvent.click(rendered.getByRole("button", { name: "Show more" }));
    expect(rendered.getByRole("button", { name: "Show less" })).toBeTruthy();
    fireEvent.click(rendered.getByRole("button", { name: "Copy prompt" }));
    expect(writeText).toHaveBeenCalledWith("Write the notebook for lesson L6.01.");
  });

  it("shows a short prompt without a Show more toggle", async () => {
    const rendered = await openNotebook();
    expect(rendered.queryByRole("button", { name: "Show more" })).toBeNull();
  });

  it("says a finished agent handed back no report, and shows a running agent's live activity", async () => {
    const silent = await openNotebook(makeAgent("silent", { status: "needs-look", report: null }));
    expect(silent.getByText("No report handed back").className).toContain("text-warning-text");
    cleanup();
    const busy = await openNotebook(running("busy", { steps: [makeStep({ at: Date.now(), endAt: null, result: null, summary: "npm test" })] }));
    expect(busy.getByText(/bash: npm test/)).toBeTruthy();
  });

  it("drafts a steer instruction for a running agent", async () => {
    const rendered = await openNotebook(running("a1b2c3", { description: "scan repo" }));
    expect(rendered.queryByRole("button", { name: "Follow up…" })).toBeNull();
    fireEvent.click(rendered.getByRole("button", { name: "Steer…" }));
    expect(rendered.inspection.composer.text).toContain("Use steer_subagent on agent `a1b2c3`:");
  });

  it("offers no actions while the lead still waits on the agent's call", async () => {
    const rendered = await openNotebook(running("toolu_1", { description: "plan", callId: "toolu_1", pending: true }));
    expect(rendered.queryByRole("button", { name: "Steer…" })).toBeNull();
    expect(rendered.queryByRole("button", { name: "Follow up…" })).toBeNull();
  });

  it("stays open when a pending agent's call returns its real id", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    let data = threadAgents([running("toolu_1", { description: "plan", callId: "toolu_1", pending: true })]);
    const { panel } = await slots();
    const rendered = renderSlot(panel, { threadId: "thr_1", params: null }, { rpc: { threadAgents: () => data } });
    fireEvent.click(within(await rendered.findByRole("article", { name: "plan" })).getByRole("button", { name: "View transcript" }));

    data = threadAgents([makeAgent("7a77e17d-4851", { description: "plan", callId: "toolu_1", report: "Planned." })]);
    act(() => void vi.advanceTimersByTime(2_000));
    await rendered.findByText("Planned.");
    expect(rendered.getByRole("heading", { name: "plan" })).toBeTruthy();
    expect(rendered.getByRole("button", { name: "Follow up…" })).toBeTruthy();
  });

  it("drafts a follow up for a finished agent", async () => {
    const rendered = await openNotebook(makeAgent("f00d"));
    expect(rendered.queryByRole("button", { name: "Steer…" })).toBeNull();
    fireEvent.click(rendered.getByRole("button", { name: "Follow up…" }));
    expect(rendered.inspection.composer.text).toContain("Resume agent `f00d` (Agent tool, resume) and");
  });
});

describe("workflows", () => {
  const tour = makeWorkflow("wf_tour", {
    name: "demo-repo-tour",
    description: "Tour the repo",
    phases: ["Map", "Suggest", "Synthesize"],
    done: 2,
    totalTokens: 87_842,
  });
  const children = [
    makeAgent("child-b", { description: "Suggest improvements", workflowId: "wf_tour", startedAt: T0 + 2 }),
    makeAgent("child-a", { description: "Map the repo", workflowId: "wf_tour", startedAt: T0 + 1 }),
  ];

  it("shows a workflow card above the agent cards", async () => {
    const rendered = await renderPanel([makeAgent("top"), ...children], [tour]);
    const card = await rendered.findByRole("article", { name: "demo-repo-tour" });
    for (const text of ["Workflow", "Completed", "25s", "3 phases", "2/2 agents", "87.8k tokens"]) expect(within(card).getByText(text)).toBeTruthy();
  });

  it("opens the workflow, a child's transcript, and back to the workflow and the list", async () => {
    const rendered = await renderPanel([makeAgent("top"), ...children], [tour]);
    fireEvent.click(within(await rendered.findByRole("article", { name: "demo-repo-tour" })).getByRole("button", { name: "View agents" }));

    expect(rendered.getByRole("heading", { name: "demo-repo-tour" })).toBeTruthy();
    expect(rendered.getByText("Tour the repo")).toBeTruthy();
    expect(rendered.getByText("Map · Suggest · Synthesize")).toBeTruthy();
    expect(rendered.getAllByRole("article").map((card) => card.getAttribute("aria-label"))).toEqual(["Map the repo", "Suggest improvements"]);

    fireEvent.click(within(rendered.getByRole("article", { name: "Map the repo" })).getByRole("button", { name: "View transcript" }));
    expect(rendered.getByRole("heading", { name: "Map the repo" })).toBeTruthy();
    expect(rendered.queryByRole("button", { name: "Follow up…" })).toBeNull();
    expect(rendered.queryByRole("button", { name: "Steer…" })).toBeNull();

    fireEvent.click(rendered.getByRole("button", { name: "Back" }));
    expect(rendered.getByRole("heading", { name: "demo-repo-tour" })).toBeTruthy();
    fireEvent.click(rendered.getByRole("button", { name: "Back" }));
    expect(rendered.getAllByRole("article").map((card) => card.getAttribute("aria-label"))).toEqual(["demo-repo-tour", "top"]);
  });
});

describe("header pill", () => {
  it("is hidden when the thread has no subagents or workflows", async () => {
    const rendered = await renderPill([]);
    await waitFor(() => expect(rendered.inspection.rpcCalls).toHaveLength(1));
    expect(rendered.queryByRole("button")).toBeNull();
  });

  it("shows a green done count when every finished agent reported", async () => {
    const rendered = await renderPill([makeAgent("a"), makeAgent("b")]);
    await rendered.findByRole("button", { name: "Subagents: 2 done" });
    expect(rendered.getByText("2 done").className).toContain("text-success");
  });

  it("asks for a look when a finished agent failed or handed back nothing", async () => {
    const rendered = await renderPill([makeAgent("a"), makeAgent("b", { status: "failed" }), makeAgent("c", { status: "needs-look" })]);
    await rendered.findByRole("button", { name: "Subagents: 2 need a look" });
    expect(rendered.getByText("2 need a look").className).toContain("text-warning-text");
  });

  it("does not count workflow children as agents", async () => {
    const rendered = await renderPill([makeAgent("a"), running("child", { workflowId: "wf_1" })], [makeWorkflow("wf_1")]);
    await rendered.findByRole("button", { name: "Subagents: 2 done" });
  });

  it("shows running work and opens the panel", async () => {
    const rendered = await renderPill([makeAgent("a"), running("b", { steps: [makeStep({ endAt: null, result: null })] })]);
    const button = await rendered.findByRole("button", { name: "Subagents: 1 running" });
    expect(button.textContent).toContain("bash: npm test");
    fireEvent.click(button);
    expect(rendered.inspection.navigateCalls).toEqual([{ method: "openThreadPanel", options: { actionId: "pi-subagents" } }]);
  });

  it("counts running workflows next to running agents", async () => {
    const rendered = await renderPill([running("a"), running("b")], [makeWorkflow("wf_1", { status: "running", endedAt: null })]);
    await rendered.findByRole("button", { name: "Subagents: 2 running · 1 workflow" });
  });

  it("names a workflow that runs alone", async () => {
    const rendered = await renderPill([makeAgent("a")], [makeWorkflow("wf_1", { name: "demo-repo-tour", status: "running", endedAt: null })]);
    await rendered.findByRole("button", { name: "Subagents: Workflow: demo-repo-tour" });
  });

  it("hides the live label on compact viewports", async () => {
    const rendered = await renderPill([running("b", { steps: [makeStep({ endAt: null, result: null })] })], [], true);
    expect((await rendered.findByRole("button", { name: "Subagents: 1 running" })).textContent).not.toContain("bash");
  });
});

describe("polling", () => {
  async function renderPillWith(threadAgentsFor: (threadId: string) => Promise<ThreadAgents>) {
    const { pill } = await slots();
    const props = { threadId: "thr_1", projectId: "p1", isCompactViewport: false };
    const rpc: PluginRpcTestHandlers<typeof rpcContract> = { threadAgents: ({ threadId }) => threadAgentsFor(threadId) };
    const rendered = renderSlot(pill, props, { rpc, openThreadPanel: () => true });
    return { rendered, switchTo: (threadId: string) => rendered.lifecycle.rerender(<pill.component {...props} threadId={threadId} />) };
  }

  async function twoPollsInFlight() {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const pending: ((data: ThreadAgents) => void)[] = [];
    const { rendered } = await renderPillWith(() => new Promise((resolve) => pending.push(resolve)));
    await waitFor(() => expect(pending).toHaveLength(1));
    act(() => void vi.advanceTimersByTime(15_000));
    await waitFor(() => expect(pending).toHaveLength(2));
    const answer = (index: number, data: ThreadAgents) => act(async () => pending[index]!(data));
    return { rendered, answer };
  }

  it("shows a response that arrives after the next poll went out", async () => {
    const { rendered, answer } = await twoPollsInFlight();
    await answer(0, threadAgents([makeAgent("a")]));
    await rendered.findByRole("button", { name: "Subagents: 1 done" });
  });

  it("ignores a response older than the one already shown", async () => {
    const { rendered, answer } = await twoPollsInFlight();
    await answer(1, threadAgents([makeAgent("a"), makeAgent("b")]));
    await answer(0, threadAgents([makeAgent("a")]));
    expect(rendered.getByRole("button", { name: "Subagents: 2 done" })).toBeTruthy();
  });

  it("does not show the previous thread's agents after switching threads", async () => {
    const { rendered, switchTo } = await renderPillWith((threadId) =>
      threadId === "thr_1" ? Promise.resolve(threadAgents([makeAgent("a")])) : new Promise(() => {}),
    );
    await rendered.findByRole("button", { name: "Subagents: 1 done" });
    switchTo("thr_2");
    await waitFor(() => expect(rendered.inspection.rpcCalls).toHaveLength(2));
    expect(rendered.queryByRole("button")).toBeNull();
  });
});
