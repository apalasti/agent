// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { CONTEXT_CHANGED } from "../../src/contract";
import { makeMeter, rpcHandlers } from "./fixtures";

afterEach(cleanup);

async function meterBanner() {
  const app = await loadPluginApp(() => import("../../app"));
  const customization = app.composerCustomizations.find((c) => c.id === "meter")!;
  expect(customization.scopes).toEqual(["thread"]);
  const banner = customization.banners![0]!;
  expect(banner.chrome).toBe("bare");
  return banner;
}

const threadScope = { scope: { kind: "thread" as const, threadId: "thr_1" } };

describe("Composer meter", () => {
  it("renders the numbers and the top three categories", async () => {
    const rendered = renderSlot(await meterBanner(), {}, { composer: threadScope, rpc: rpcHandlers({ meter: () => makeMeter() }) });
    const button = await rendered.findByRole("button", { name: "Context: 26k of 200k tokens used, open breakdown" });
    expect(button.textContent).toContain("26k / 200k · 13%");
    expect(button.textContent).toContain("Tool results 6.7k");
    expect(button.textContent).toContain("Skills 6.3k");
    expect(button.textContent).toContain("Tools 5.2k");
    expect(button.getAttribute("title")).toContain("Memory files: 936");
    expect(rendered.inspection.rpcCalls).toEqual([{ method: "meter", input: { threadId: "thr_1" } }]);
  });

  it("marks an estimate with ≈ and says it is recomputing", async () => {
    const rendered = renderSlot(await meterBanner(), {}, {
      composer: threadScope,
      rpc: rpcHandlers({ meter: () => makeMeter({}, { basis: "estimated", usedTokens: 16_400, recomputing: true }) }),
    });
    const button = await rendered.findByRole("button", { name: /^Context: about 16k/ });
    expect(button.textContent).toContain("≈16k / 200k");
    expect(button.textContent).toContain("recomputing");
  });

  it("renders nothing when there is no basis", async () => {
    const rendered = renderSlot(await meterBanner(), {}, {
      composer: threadScope,
      rpc: rpcHandlers({ meter: () => makeMeter({}, { basis: "none", usedTokens: null }) }),
    });
    await waitFor(() => expect(rendered.inspection.rpcCalls.length).toBe(1));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(rendered.container.innerHTML).toBe("");
  });

  it("renders nothing outside a thread composer", async () => {
    const rendered = renderSlot(await meterBanner(), {}, {
      composer: { scope: { kind: "new-thread", projectId: "p1" } },
      rpc: rpcHandlers({ meter: () => makeMeter() }),
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(rendered.container.innerHTML).toBe("");
    expect(rendered.inspection.rpcCalls).toEqual([]);
  });

  it("opens the Context panel on click", async () => {
    const rendered = renderSlot(await meterBanner(), {}, { composer: threadScope, rpc: rpcHandlers({ meter: () => makeMeter() }) });
    fireEvent.click(await rendered.findByRole("button", { name: /^Context:/ }));
    expect(rendered.inspection.navigateCalls).toEqual([
      expect.objectContaining({ method: "openThreadPanel", options: expect.objectContaining({ actionId: "context" }) }),
    ]);
  });

  it("refetches only for its own thread's change signal", async () => {
    let used = 26_140;
    const rendered = renderSlot(await meterBanner(), {}, {
      composer: threadScope,
      rpc: rpcHandlers({ meter: () => makeMeter({}, { usedTokens: used }) }),
    });
    await rendered.findByText(/26k \/ 200k/);
    used = 41_000;
    await rendered.behavior.emitRealtime(CONTEXT_CHANGED, { threadId: "thr_other" });
    expect(rendered.inspection.rpcCalls.length).toBe(1);
    await rendered.behavior.emitRealtime(CONTEXT_CHANGED, { threadId: "thr_1" });
    await rendered.findByText(/41k \/ 200k/);
  });
});

describe("keepWindowWhileRecomputing", () => {
  it("keeps the previous window size while the new session has no measurement", async () => {
    const { keepWindowWhileRecomputing } = await import("../../src/ui/data");
    const before = makeMeter();
    const after = makeMeter({}, { contextWindow: null, autoCompactAt: null, recomputing: true, basis: "estimated" });
    expect(keepWindowWhileRecomputing(before, after).window).toMatchObject({ contextWindow: 200_000, autoCompactAt: 167_000, basis: "estimated" });
    expect(keepWindowWhileRecomputing(null, after).window.contextWindow).toBeNull();
    const settled = makeMeter({}, { contextWindow: null, recomputing: false });
    expect(keepWindowWhileRecomputing(before, settled).window.contextWindow).toBeNull();
  });

  it("prefers the window the backend reports while recomputing", async () => {
    const { keepWindowWhileRecomputing } = await import("../../src/ui/data");
    const before = makeMeter();
    const after = makeMeter({}, { contextWindow: 1_000_000, autoCompactAt: null, recomputing: true, basis: "estimated" });
    expect(keepWindowWhileRecomputing(before, after).window).toMatchObject({ contextWindow: 1_000_000, autoCompactAt: null });
  });
});
