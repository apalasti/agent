// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { SUBAGENTS_CHANGED } from "../src/contract";
import { makeSubagent, rpcHandlers } from "./uiFixtures";

afterEach(cleanup);

async function slots() {
  const app = await loadPluginApp(() => import("../app"));
  return {
    panel: app.threadPanelActions.find((slot) => slot.id === "subagents")!,
    pill: app.threadHeaderActions.find((slot) => slot.id === "subagents")!,
  };
}

describe("Subagents panel", () => {
  it("lists running agents first with their details", async () => {
    const { panel } = await slots();
    expect(panel.layout).toBe("flush");
    const rendered = renderSlot(
      panel,
      { threadId: "thr_1", params: null },
      {
        rpc: rpcHandlers({
          threadSubagents: ({ threadId }) => ({
            threadId,
            subagents: [
              makeSubagent("done", { description: "count files", startedAt: "2026-10-06T11:00:00Z" }),
              makeSubagent("live", {
                description: "read readme",
                status: "running",
                finishedAt: null,
                model: "claude-sonnet-5-5",
                lastActivity: "bash: sleep 30",
                agentId: "27e7abbc-45cf-47d0-9b1a-0000",
              }),
            ],
          }),
        }),
      },
    );
    const cards = await rendered.findAllByRole("article");
    expect(cards.map((card) => card.getAttribute("aria-label"))).toEqual(["read readme", "count files"]);
    expect(cards[0]!.textContent).toContain("claude-sonnet-5-5");
    expect(cards[0]!.textContent).toContain("2 turns · 3 tools");
    expect(cards[0]!.textContent).toContain("bash: sleep 30");
    expect(rendered.getByRole("button", { name: "Copy agent id 27e7abbc-45cf-47d0-9b1a-0000" }).textContent).toContain("27e7abbc");
    expect(rendered.getByText("1 running · 1 done")).toBeTruthy();
  });

  it("explains itself when the thread has no subagents", async () => {
    const { panel } = await slots();
    const rendered = renderSlot(
      panel,
      { threadId: "thr_1", params: null },
      { rpc: rpcHandlers({ threadSubagents: ({ threadId }) => ({ threadId, subagents: [] }) }) },
    );
    expect((await rendered.findByRole("status")).textContent).toMatch(/launched with the Agent tool/);
  });

  it("expands a card into its transcript with nested children", async () => {
    const { panel } = await slots();
    const rendered = renderSlot(
      panel,
      { threadId: "thr_1", params: null },
      {
        rpc: rpcHandlers({
          threadSubagents: ({ threadId }) => ({
            threadId,
            subagents: [makeSubagent("parent", { description: "lead", result: "All 3 files counted." })],
          }),
          transcript: ({ callId }) =>
            callId === "parent"
              ? {
                  entries: [
                    { kind: "prompt", at: null, text: "Count the files\nthen report" },
                    {
                      kind: "tool",
                      at: null,
                      callId: "c1",
                      name: "bash",
                      summary: "git ls-files | wc -l",
                      args: '{"command":"git ls-files | wc -l"}',
                      result: "3",
                      isError: false,
                    },
                    { kind: "text", at: null, text: "All 3 files counted." },
                  ],
                  truncated: false,
                  children: [makeSubagent("child", { description: "nested helper", parentAgentId: "parent" })],
                }
              : { entries: [], truncated: false, children: [] },
        }),
      },
    );
    fireEvent.click(await rendered.findByRole("button", { name: "Show transcript of lead" }));
    await rendered.findByText("git ls-files | wc -l");
    expect(rendered.getByLabelText("Final result").textContent).toContain("All 3 files counted.");
    expect(rendered.queryByLabelText("bash result")).toBeNull();
    fireEvent.click(rendered.getByText("git ls-files | wc -l"));
    expect(rendered.getByLabelText("bash result").textContent).toBe("3");
    expect(rendered.getByRole("article", { name: "nested helper" })).toBeTruthy();
    expect(rendered.inspection.rpcCalls.filter((call) => call.method === "transcript")).toHaveLength(1);
  });

  it("refetches on the realtime signal", async () => {
    const { panel } = await slots();
    let count = 0;
    const rendered = renderSlot(
      panel,
      { threadId: "thr_1", params: null },
      {
        rpc: rpcHandlers({
          threadSubagents: ({ threadId }) => {
            count += 1;
            return { threadId, subagents: Array.from({ length: count }, (_, index) => makeSubagent(`a${index}`)) };
          },
        }),
      },
    );
    await rendered.findAllByRole("article");
    await rendered.behavior.emitRealtime(SUBAGENTS_CHANGED, { threadId: "thr_1" });
    await waitFor(() => expect(rendered.getAllByRole("article")).toHaveLength(2));
    await rendered.behavior.emitRealtime(SUBAGENTS_CHANGED, { threadId: "thr_other" });
    expect(count).toBe(2);
  });
});

describe("header pill", () => {
  it("is hidden when the thread has no subagents", async () => {
    const { pill } = await slots();
    const rendered = renderSlot(
      pill,
      { threadId: "thr_1", projectId: "p1", isCompactViewport: false },
      { rpc: rpcHandlers({ summaries: () => ({ threads: [] }) }) },
    );
    await waitFor(() => expect(rendered.inspection.rpcCalls).toHaveLength(1));
    expect(rendered.queryByRole("button")).toBeNull();
  });

  it("shows running work and opens the panel", async () => {
    const { pill } = await slots();
    const rendered = renderSlot(
      pill,
      { threadId: "thr_1", projectId: "p1", isCompactViewport: false },
      {
        rpc: rpcHandlers({ summaries: () => ({ threads: [{ threadId: "thr_1", running: 2, total: 5 }] }) }),
        openThreadPanel: () => true,
      },
    );
    const button = await rendered.findByRole("button", { name: /Subagents: 2 running, 3 done/ });
    expect(button.textContent).toBe("2 running · 3 done");
    fireEvent.click(button);
    expect(rendered.inspection.navigateCalls).toEqual([{ method: "openThreadPanel", options: { actionId: "subagents" } }]);
  });
});
