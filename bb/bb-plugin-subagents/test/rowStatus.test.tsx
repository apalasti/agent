// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, waitFor } from "@testing-library/react";
import { loadPluginApp, mountPluginContentScripts, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { ThreadSummary } from "../src/contract";
import { rpcHandlers } from "./uiFixtures";
import { diffRowStatuses, rowStatusFor, RowStatusPoller } from "../src/rowStatus";

describe("diffRowStatuses", () => {
  it("sets new and changed running threads and clears ones that stopped", () => {
    const applied = new Map([
      ["same", "1 subagent running"],
      ["changed", "1 subagent running"],
      ["stopped", "2 subagents running"],
    ]);
    const threads: ThreadSummary[] = [
      { threadId: "same", running: 1, total: 1 },
      { threadId: "changed", running: 2, total: 3 },
      { threadId: "stopped", running: 0, total: 2 },
      { threadId: "new", running: 1, total: 1 },
    ];
    const { set, clear, next } = diffRowStatuses(applied, threads);
    expect(set).toEqual([
      ["changed", rowStatusFor(2)],
      ["new", rowStatusFor(1)],
    ]);
    expect(clear).toEqual(["stopped"]);
    expect([...next.keys()]).toEqual(["same", "changed", "new"]);
  });

  it("labels the status for the sidebar", () => {
    expect(rowStatusFor(2)).toEqual({ icon: "Bot", label: "2 subagents running", tone: "running" });
  });
});

describe("row status content script", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("decorates running threads, updates on the next poll and clears on dispose", async () => {
    let threads: ThreadSummary[] = [
      { threadId: "t1", running: 2, total: 2 },
      { threadId: "t2", running: 0, total: 1 },
    ];
    const app = await loadPluginApp(() => import("../app"));
    const scripts = await mountPluginContentScripts(app, { pluginId: "subagents" });
    const overlay = app.appOverlays.find((slot) => slot.id === "row-status-poller")!;
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderSlot(overlay, {}, { rpc: rpcHandlers({ summaries: () => ({ threads }) }) });

    await waitFor(() => expect(scripts.inspection.getThreadRowStatus("t1")).toEqual(rowStatusFor(2)));
    expect(scripts.inspection.getThreadRowStatus("t2")).toBeNull();

    threads = [{ threadId: "t1", running: 0, total: 2 }];
    await vi.advanceTimersByTimeAsync(3_100);
    await waitFor(() => expect(scripts.inspection.getThreadRowStatus("t1")).toBeNull());

    await scripts.lifecycle.dispose();
    expect(scripts.inspection.disposed).toBe(true);
  });

  it("does nothing on a client without the row-status setter", async () => {
    const app = await loadPluginApp(() => import("../app"));
    const scripts = await mountPluginContentScripts(app, { pluginId: "subagents", omitExperimentalThreadRowStatus: true });
    const summaries = vi.fn(() => ({ threads: [{ threadId: "t1", running: 1, total: 1 }] }));
    const rendered = renderSlot({ component: RowStatusPoller }, {}, { rpc: rpcHandlers({ summaries }) });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(rendered.inspection.rpcCalls).toEqual([]);
    expect(scripts.inspection.threadRowStatusCalls).toEqual([]);
    await scripts.lifecycle.dispose();
  });
});
