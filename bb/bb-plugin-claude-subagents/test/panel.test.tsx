// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { loadPluginApp, renderSlot, type PluginRpcTestHandlers } from "@get-bb/plugin-sdk/testing/app";
import type { Agent, rpcContract, ThreadAgents } from "../src/contract";
import { makeAgent, makeStep, rpcHandlers, T0, threadAgents } from "./uiFixtures";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

async function slots() {
  const app = await loadPluginApp(() => import("../app"));
  return {
    panel: app.threadPanelActions.find((slot) => slot.id === "claude-subagents")!,
    pill: app.threadHeaderActions.find((slot) => slot.id === "claude-subagents")!,
  };
}

async function renderPanel(agents: Agent[]) {
  const { panel } = await slots();
  return renderSlot(panel, { threadId: "thr_1", params: null }, { rpc: rpcHandlers(threadAgents(agents)) });
}

async function renderPill(agents: Agent[], isCompactViewport = false) {
  const { pill } = await slots();
  return renderSlot(
    pill,
    { threadId: "thr_1", projectId: "p1", isCompactViewport },
    { rpc: rpcHandlers(threadAgents(agents)), openThreadPanel: () => true },
  );
}

const running = (agentId: string, overrides: Partial<Agent> = {}) =>
  makeAgent(agentId, { status: "running", endedAt: null, report: null, ...overrides });

describe("Claude subagents panel", () => {
  it("lists running agents first, then finished newest first, each with a status word", async () => {
    const rendered = await renderPanel([
      makeAgent("oldest-done", { startedAt: T0 }),
      makeAgent("no-report", { status: "needs-look", report: null, startedAt: T0 + 1 }),
      running("worker", { startedAt: T0 + 2 }),
      makeAgent("broken", { status: "failed", report: null, startedAt: T0 + 3 }),
      makeAgent("mystery", { status: "unknown", report: null, startedAt: T0 + 4 }),
    ]);
    const rows = await rendered.findAllByRole("article");
    expect(rows.map((row) => row.getAttribute("aria-label"))).toEqual(["worker", "mystery", "broken", "no-report", "oldest-done"]);
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining("Running"),
      expect.stringContaining("Unknown"),
      expect.stringContaining("Failed"),
      expect.stringContaining("No report"),
      expect.stringContaining("Done"),
    ]);
    expect(rendered.getByText("Done").parentElement!.className).toContain("text-success-foreground");
    expect(rendered.getByText(/1 running/).textContent).toBe("1 running · 4 finished");
  });

  it("shows what a running agent is doing and how a finished one ended", async () => {
    const rendered = await renderPanel([
      running("worker", { steps: [makeStep({ at: Date.now() - 2_000, endAt: null, result: null, summary: "run tests" })] }),
      makeAgent("reporter", { report: "\nFound 3 files.\nDetails follow." }),
      makeAgent("silent", { status: "needs-look", report: null, files: [{ path: "/w/src/a.ts", added: 4, removed: 1 }] }),
    ]);
    expect((await rendered.findByRole("article", { name: "worker" })).textContent).toContain("Bash: run tests");
    expect(rendered.getByRole("article", { name: "reporter" }).textContent).toContain("↳ Found 3 files.");
    const silent = rendered.getByRole("article", { name: "silent" });
    expect(silent.textContent).toContain("No report handed back");
    expect(silent.textContent).toContain("src/a.ts+4−1");
  });

  it("links changed files inside the workspace and names the rest", async () => {
    const files = [
      { path: "/w/src/a.ts", added: 4, removed: 1 },
      { path: "/Users/me/notes.md", added: 2, removed: 0 },
    ];
    const rendered = await renderPanel([makeAgent("editor", { files })]);
    const row = await rendered.findByRole("article", { name: "editor" });
    expect(within(row).getAllByRole("link").map((link) => link.textContent)).toEqual(["src/a.ts"]);
    expect(row.textContent).toContain("~/notes.md+2−0");
  });

  it("drafts a stop instruction naming the agent id in the composer", async () => {
    const rendered = await renderPanel([running("a1b2c3", { description: "scan repo" })]);
    fireEvent.click(await rendered.findByRole("button", { name: "Stop…" }));
    expect(rendered.inspection.composer.text).toContain("a1b2c3");
    expect(rendered.inspection.composer.text).toContain("TaskStop");
  });

  it("offers a follow up for finished agents instead of stop and steer", async () => {
    const rendered = await renderPanel([makeAgent("f00d")]);
    fireEvent.click(await rendered.findByRole("button", { name: "Follow up…" }));
    expect(rendered.queryByRole("button", { name: "Stop…" })).toBeNull();
    expect(rendered.inspection.composer.text).toContain("f00d");
  });

  it("opens an agent's brief, steps and report", async () => {
    const rendered = await renderPanel([
      makeAgent("reader", { prompt: "Read the README", report: "The README is short.", steps: [makeStep({ summary: "cat README.md" })] }),
    ]);
    fireEvent.click(await rendered.findByRole("button", { name: "reader" }));
    const detail = rendered.getByRole("region", { name: "Steps of reader" });
    expect(detail.textContent).toContain("cat README.md");
    expect(detail.textContent).toContain("The README is short.");
    fireEvent.click(rendered.getByText("cat README.md"));
    expect(detail.textContent).toContain('{"command":"npm test"}');
  });

  it("says so when the thread has no subagents", async () => {
    const rendered = await renderPanel([]);
    expect((await rendered.findByRole("status")).textContent).toBe("No Claude Code subagents in this thread.");
  });
});

describe("header pill", () => {
  it("is hidden when the thread has no subagents", async () => {
    const rendered = await renderPill([]);
    await waitFor(() => expect(rendered.inspection.rpcCalls).toHaveLength(1));
    expect(rendered.queryByRole("button")).toBeNull();
  });

  it("shows a green done count when every finished agent reported", async () => {
    const rendered = await renderPill([makeAgent("a"), makeAgent("b")]);
    await rendered.findByRole("button", { name: "Claude subagents: 2 done" });
    expect(rendered.getByText("2 done").className).toContain("text-success-foreground");
  });

  it("asks for a look when a finished agent failed or handed back nothing", async () => {
    const rendered = await renderPill([makeAgent("a"), makeAgent("b", { status: "failed" }), makeAgent("c", { status: "needs-look" })]);
    await rendered.findByRole("button", { name: "Claude subagents: 2 need a look" });
    expect(rendered.getByText("2 need a look").className).toContain("text-warning-text");
  });

  it("shows running work and opens the panel", async () => {
    const rendered = await renderPill([makeAgent("a"), running("b", { steps: [makeStep({ endAt: null, result: null })] })]);
    const button = await rendered.findByRole("button", { name: "Claude subagents: 1 running" });
    expect(button.textContent).toContain("Bash: npm test");
    fireEvent.click(button);
    expect(rendered.inspection.navigateCalls).toEqual([{ method: "openThreadPanel", options: { actionId: "claude-subagents" } }]);
  });

  it("hides the live label on compact viewports", async () => {
    const rendered = await renderPill([running("b", { steps: [makeStep({ endAt: null, result: null })] })], true);
    expect((await rendered.findByRole("button", { name: "Claude subagents: 1 running" })).textContent).not.toContain("Bash");
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
    await rendered.findByRole("button", { name: "Claude subagents: 1 done" });
  });

  it("ignores a response older than the one already shown", async () => {
    const { rendered, answer } = await twoPollsInFlight();
    await answer(1, threadAgents([makeAgent("a"), makeAgent("b")]));
    await answer(0, threadAgents([makeAgent("a")]));
    expect(rendered.getByRole("button", { name: "Claude subagents: 2 done" })).toBeTruthy();
  });

  it("does not show the previous thread's agents after switching threads", async () => {
    const { rendered, switchTo } = await renderPillWith((threadId) =>
      threadId === "thr_1" ? Promise.resolve(threadAgents([makeAgent("a")])) : new Promise(() => {}),
    );
    await rendered.findByRole("button", { name: "Claude subagents: 1 done" });
    switchTo("thr_2");
    await waitFor(() => expect(rendered.inspection.rpcCalls).toHaveLength(2));
    expect(rendered.queryByRole("button")).toBeNull();
  });
});
