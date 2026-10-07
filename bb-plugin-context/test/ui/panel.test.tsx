// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { ContextReport } from "../../src/contract";
import { makeCourseChange, makeReport, makeTurn, rpcHandlers } from "./fixtures";

afterEach(cleanup);

async function panelSlot() {
  const app = await loadPluginApp(() => import("../../app"));
  const panel = app.threadPanelActions.find((slot) => slot.id === "context")!;
  expect(panel.layout).toBe("flush");
  expect(panel.icon).toBe("context-gauge");
  expect(app.icons.map((icon) => icon.name)).toContain("context-gauge");
  return panel;
}

const sdk = {
  threads: {
    editMessage: async () => ({ ok: true as const, operationId: "op", requestSequence: 99 }),
    fork: async () => ({ id: "thr_forked" }) as never,
    compact: async () => ({ ok: true as const }),
    clearContext: async () => ({ ok: true as const }),
  },
};

async function renderPanel(report: ContextReport) {
  const rendered = renderSlot(await panelSlot(), { threadId: "thr_1", params: null }, { rpc: rpcHandlers({ report: () => report }), sdk });
  await rendered.findByRole("list", { name: "Turns" });
  return rendered;
}

function turnRow(rendered: Awaited<ReturnType<typeof renderPanel>>, index: number) {
  return rendered.getByRole("listitem", { name: `Turn ${index}` });
}

describe("Context panel", () => {
  it("shows the totals, basis and notes", async () => {
    const rendered = await renderPanel(makeReport());
    const header = rendered.container.querySelector("header")!;
    expect(header.textContent).toContain("26k");
    expect(header.textContent).toContain("/ 200k tokens");
    expect(header.textContent).toContain("autocompact at 167k");
    expect(header.textContent).toContain("Measured by bb");
    expect(header.textContent).toContain("Per-item numbers are estimates");
  });

  it("expands categories into entries and tool results into their largest items", async () => {
    const rendered = await renderPanel(makeReport());
    const categories = rendered.getByRole("list", { name: "Context categories" });
    expect(within(categories).queryByText("Bash")).toBeNull();
    fireEvent.click(within(categories).getByRole("button", { name: /Tool definitions/ }));
    expect(within(categories).getByRole("group", { name: "Tool definitions entries" }).textContent).toContain("Bash");

    fireEvent.click(within(categories).getByRole("button", { name: /Tool results/ }));
    const results = within(categories).getByRole("group", { name: "Tool results entries" });
    fireEvent.click(within(results).getByRole("button", { name: /Read/ }));
    expect(within(results).getByRole("group", { name: "Read items" }).textContent).toContain("/tmp/wt-demo/skills/show-me/SKILL.md");

    const onDemand = rendered.getByRole("list", { name: "Available on demand" });
    expect(onDemand.textContent).toContain("18k");
    expect(categories.textContent).not.toContain("Available on demand");
  });

  it("places course-change dividers before the right turn", async () => {
    const report = makeReport({
      turns: [makeTurn(1), makeTurn(2), makeTurn(3)],
      courseChanges: [
        makeCourseChange("edited", 2, { discardedTurns: 2, tokensBefore: 52_000, tokensAfter: 21_000 }),
        makeCourseChange("compacted", 3, { tokensBefore: 161_000, tokensAfter: 24_000 }),
        makeCourseChange("compactionSkipped", 4),
      ],
    });
    const rendered = await renderPanel(report);
    const items = Array.from(rendered.getByRole("list", { name: "Turns" }).children).map((li) =>
      li.getAttribute("data-course-change") ?? `turn ${li.getAttribute("data-turn")}`,
    );
    expect(items).toEqual(["turn 1", "edited", "turn 2", "compacted", "turn 3", "compactionSkipped"]);
    expect(rendered.getByText("Edited: 2 turns (31k) discarded")).toBeTruthy();
    expect(rendered.getByText("Compacted 161k → 24k")).toBeTruthy();
    expect(rendered.getByText("Compaction skipped (session too small)")).toBeTruthy();
  });

  it("edits from a turn: shows the rewind numbers, then reruns with that turn's request seq", async () => {
    const rendered = await renderPanel(makeReport({ turns: [makeTurn(1), makeTurn(2), makeTurn(3)] }));
    fireEvent.click(within(turnRow(rendered, 2)).getByRole("button", { name: "Edit from here…" }));
    const editor = rendered.getByRole("group", { name: "Edit turn 2" });
    expect(editor.textContent).toContain("Rewinds to ≈21k (frees 5.1k) · discards turns 2–3");
    const textarea = within(editor).getByRole("textbox") as HTMLTextAreaElement;
    expect(textarea.value).toBe("Message 2 full text");
    fireEvent.change(textarea, { target: { value: "Try again, shorter" } });
    fireEvent.click(within(editor).getByRole("button", { name: "Rerun" }));
    await waitFor(() => expect(rendered.inspection.sdkCalls.length).toBe(1));
    const [call] = rendered.inspection.sdkCalls;
    expect(call!.method).toBe("threads.editMessage");
    expect(call!.args[0]).toMatchObject({
      threadId: "thr_1",
      expectedRequestSequence: 39,
      input: [{ type: "text", text: "Try again, shorter", mentions: [] }],
    });
    await waitFor(() => expect(rendered.queryByRole("group", { name: "Edit turn 2" })).toBeNull());
  });

  it("forks from a turn's last seq and opens the fork", async () => {
    const rendered = await renderPanel(makeReport());
    fireEvent.click(within(turnRow(rendered, 1)).getByRole("button", { name: "Fork from here" }));
    await waitFor(() => expect(rendered.inspection.navigateCalls).toEqual([{ method: "toThread", threadId: "thr_forked" }]));
    expect(rendered.inspection.sdkCalls[0]).toMatchObject({
      method: "threads.fork",
      args: [{ sourceThreadId: "thr_1", sourceSeqEnd: 35 }],
    });
  });

  it("disables every action while the thread runs, and explains why", async () => {
    const rendered = await renderPanel(makeReport({ threadStatus: "active", turns: [makeTurn(1), makeTurn(2, { running: true })] }));
    for (const index of [1, 2]) {
      const edit = within(turnRow(rendered, index)).getByRole("button", { name: "Edit from here…" }) as HTMLButtonElement;
      const fork = within(turnRow(rendered, index)).getByRole("button", { name: "Fork from here" }) as HTMLButtonElement;
      expect(edit.disabled).toBe(true);
      expect(fork.disabled).toBe(true);
      expect(edit.parentElement!.getAttribute("title")).toBe("Wait for the current turn to finish");
    }
    expect((rendered.getByRole("button", { name: "Compact" }) as HTMLButtonElement).disabled).toBe(true);
    expect((rendered.getByRole("button", { name: "Clear context" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("disables actions on a turn that is not editable", async () => {
    const rendered = await renderPanel(makeReport({ turns: [makeTurn(1, { editable: false }), makeTurn(2)] }));
    expect((within(turnRow(rendered, 1)).getByRole("button", { name: "Edit from here…" }) as HTMLButtonElement).disabled).toBe(true);
    expect((within(turnRow(rendered, 2)).getByRole("button", { name: "Edit from here…" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("compacts only after confirming, stating the current size", async () => {
    const rendered = await renderPanel(makeReport());
    fireEvent.click(rendered.getByRole("button", { name: "Compact" }));
    const dialog = await rendered.findByRole("alertdialog");
    expect(dialog.textContent).toContain("26k tokens");
    expect(rendered.inspection.sdkCalls).toEqual([]);
    fireEvent.click(within(dialog).getByRole("button", { name: "Compact" }));
    await waitFor(() => expect(rendered.inspection.sdkCalls).toEqual([{ method: "threads.compact", args: [{ threadId: "thr_1" }] }]));
  });

  it("explains an empty thread", async () => {
    const rendered = renderSlot(await panelSlot(), { threadId: "thr_1" , params: null }, {
      rpc: rpcHandlers({
        report: () => makeReport({ turns: [], categories: [], segments: [], top: [], largest: [] }, { basis: "none", usedTokens: null }),
      }),
    });
    expect((await rendered.findByRole("status")).textContent).toBe("No context recorded yet: send a message first.");
  });

  it("shows an error with Retry, and keeps the last good report on a failed refresh", async () => {
    let fail = true;
    const rendered = renderSlot(await panelSlot(), { threadId: "thr_1", params: null }, {
      rpc: rpcHandlers({
        report: () => {
          if (fail) throw new Error("collector exploded");
          return makeReport();
        },
      }),
    });
    expect((await rendered.findByRole("alert")).textContent).toContain("collector exploded");
    fail = false;
    fireEvent.click(rendered.getByRole("button", { name: "Retry" }));
    await rendered.findByRole("list", { name: "Turns" });
    fail = true;
    await rendered.behavior.emitRealtime("context-changed", { threadId: "thr_1" });
    expect((await rendered.findByRole("alert")).textContent).toContain("Couldn't refresh");
    expect(rendered.getByRole("list", { name: "Turns" })).toBeTruthy();
  });
});
