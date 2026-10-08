// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import { useRef } from "react";
import { loadPluginApp, mountPluginContentScripts, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { CONTEXT_CHANGED } from "../../src/contract";
import { useFooterSlot } from "../../src/ui/footerSlot";
import { makeCourseChange, makeMeter, makeReport, rpcHandlers } from "./fixtures";

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

async function ringAction() {
  const app = await loadPluginApp(() => import("../../app"));
  const customization = app.composerCustomizations.find((c) => c.id === "ring")!;
  expect(customization.scopes).toEqual(["thread"]);
  expect(customization.banners).toBeUndefined();
  return customization.actions!.find((action) => action.id === "ring")!;
}

const threadScope = { scope: { kind: "thread" as const, threadId: "thr_1" } };

async function openCard(button: HTMLElement) {
  fireEvent.focus(button);
  return waitFor(() => {
    const card = document.querySelector<HTMLElement>("[data-radix-popper-content-wrapper]");
    expect(card).not.toBeNull();
    return card!;
  });
}

describe("Context ring", () => {
  it("names the numbers and draws the ring against the window", async () => {
    const rendered = renderSlot(await ringAction(), {}, { composer: threadScope, rpc: rpcHandlers({ meter: () => makeMeter() }) });
    const button = await rendered.findByRole("button", { name: "Context: 13% used, 26k of 200k tokens" });
    expect(button.textContent).toBe("13%");
    expect(button.querySelector("svg")!.hasAttribute("data-dashed")).toBe(false);
    expect(rendered.inspection.rpcCalls).toEqual([{ method: "meter", input: { threadId: "thr_1" } }]);
  });

  it("follows the tone of the usable limit", async () => {
    const rendered = renderSlot(await ringAction(), {}, {
      composer: threadScope,
      rpc: rpcHandlers({ meter: () => makeMeter({}, { usedTokens: 150_000 }) }),
    });
    const button = await rendered.findByRole("button", { name: /^Context: 75% used/ });
    expect(button.querySelector("svg")!.getAttribute("class")).toContain("text-destructive");
  });

  it("marks an estimate with ≈ and a dashed ring, and says it is recomputing", async () => {
    const rendered = renderSlot(await ringAction(), {}, {
      composer: threadScope,
      rpc: rpcHandlers({ meter: () => makeMeter({}, { basis: "estimated", usedTokens: 16_400, recomputing: true }) }),
    });
    const button = await rendered.findByRole("button", { name: "Context: about 8% used, 16k of 200k tokens" });
    expect(button.textContent).toBe("≈8%");
    expect(button.querySelector("svg")!.hasAttribute("data-dashed")).toBe(true);
    const card = await openCard(button);
    expect(card.querySelector("[data-headline]")!.textContent).toBe("≈16k / 200k tokens · 8%recomputingautocompact at 167k");
  });

  it("renders nothing when there is no basis", async () => {
    const rendered = renderSlot(await ringAction(), {}, {
      composer: threadScope,
      rpc: rpcHandlers({ meter: () => makeMeter({}, { basis: "none", usedTokens: null }) }),
    });
    await waitFor(() => expect(rendered.inspection.rpcCalls.length).toBe(1));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(rendered.container.textContent).toBe("");
    expect(rendered.queryByRole("button")).toBeNull();
  });

  it("renders nothing outside a thread composer", async () => {
    const rendered = renderSlot(await ringAction(), {}, {
      composer: { scope: { kind: "new-thread", projectId: "p1" } },
      rpc: rpcHandlers({ meter: () => makeMeter() }),
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(rendered.container.innerHTML).toBe("");
    expect(rendered.inspection.rpcCalls).toEqual([]);
  });

  it("renders inline in the action slot when there is no composer footer", async () => {
    const rendered = renderSlot(await ringAction(), {}, { composer: threadScope, rpc: rpcHandlers({ meter: () => makeMeter() }) });
    const button = await rendered.findByRole("button", { name: /^Context:/ });
    expect(rendered.container.contains(button)).toBe(true);
    expect(document.querySelector("[data-context-plugin-ring]")).toBeNull();
  });

  it("opens the Context panel on click", async () => {
    const rendered = renderSlot(await ringAction(), {}, { composer: threadScope, rpc: rpcHandlers({ meter: () => makeMeter() }) });
    fireEvent.click(await rendered.findByRole("button", { name: /^Context:/ }));
    expect(rendered.inspection.navigateCalls).toEqual([
      expect.objectContaining({ method: "openThreadPanel", options: expect.objectContaining({ actionId: "context" }) }),
    ]);
  });

  it("shows the categories in the hover card and fetches the report only once it opens", async () => {
    const report = makeReport({
      courseChanges: [makeCourseChange("edited", 1), makeCourseChange("compacted", 2, { tokensBefore: 161_000, tokensAfter: 24_000 })],
    });
    const rendered = renderSlot(await ringAction(), {}, {
      composer: threadScope,
      rpc: rpcHandlers({ meter: () => makeMeter(), report: () => report }),
    });
    const button = await rendered.findByRole("button", { name: /^Context:/ });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(rendered.inspection.rpcCalls.map((call) => call.method)).toEqual(["meter"]);

    const card = await openCard(button);
    expect(card.querySelector("[data-headline]")!.textContent).toBe("26k / 200k tokens · 13%autocompact at 167k");
    const categories = Array.from(card.querySelectorAll('[aria-label="Used context"] li')).map((li) => li.textContent);
    expect(categories).toEqual([
      "Tool results6.7k26%",
      "Skills6.3k24%",
      "Tool definitions5.2k20%",
      "System prompt3.6k14%",
      "Assistant text2.1k8%",
      "Your messages1.2k5%",
      "Memory files9364%",
    ]);
    await waitFor(() => expect(card.querySelector('[aria-label="Largest items"]')).not.toBeNull());
    expect(rendered.inspection.rpcCalls.map((call) => call.method)).toEqual(["meter", "report"]);
    const largest = Array.from(card.querySelectorAll('[aria-label="Largest items"] li')).map((li) => li.textContent);
    expect(largest).toEqual(["Read/tmp/wt-demo/skills/show-me/SKILL.md#24.1k", "Read/tmp/wt-demo/README.md#11k"]);
    expect(card.querySelector("[data-course-change]")!.textContent).toBe("Compacted 161k → 24k");

    fireEvent.click(within(card).getByRole("button", { name: "Show details" }));
    expect(rendered.inspection.navigateCalls).toEqual([
      expect.objectContaining({ method: "openThreadPanel", options: expect.objectContaining({ actionId: "context" }) }),
    ]);
  });

  it("refetches only for its own thread's change signal", async () => {
    let used = 26_140;
    const rendered = renderSlot(await ringAction(), {}, {
      composer: threadScope,
      rpc: rpcHandlers({ meter: () => makeMeter({}, { usedTokens: used }) }),
    });
    await rendered.findByRole("button", { name: /26k of 200k/ });
    used = 41_000;
    await rendered.behavior.emitRealtime(CONTEXT_CHANGED, { threadId: "thr_other" });
    expect(rendered.inspection.rpcCalls.length).toBe(1);
    await rendered.behavior.emitRealtime(CONTEXT_CHANGED, { threadId: "thr_1" });
    await rendered.findByRole("button", { name: /41k of 200k/ });
  });
});

describe("hide-native-ring content script", () => {
  it("hides bb's ring only beside a filled plugin slot, and its disposer removes the rule", async () => {
    const app = await loadPluginApp(() => import("../../app"));
    const mounted = await mountPluginContentScripts(app, { pluginId: "context" });
    expect(mounted.inspection.mountedIds).toEqual(["hide-native-ring"]);
    const style = document.head.querySelector('style[data-context-plugin="hide-native-ring"]')!;
    expect(style.textContent).toBe(
      '[data-follow-up-composer-footer]:has([data-context-plugin-ring]:not(:empty)) button[aria-label^="Context window"] { display: none; }',
    );
    await mounted.lifecycle.dispose();
    expect(document.head.querySelector('style[data-context-plugin="hide-native-ring"]')).toBeNull();
  });
});

function composerDom({ withRing }: { withRing: boolean }) {
  document.body.innerHTML = `
    <div data-follow-up-composer>
      <div data-promptbox-standard-actions><div data-action></div></div>
      <div data-follow-up-composer-footer>
        <div data-left></div>
        <div data-right>${withRing ? '<button aria-label="Context window 10% used"></button>' : ""}</div>
      </div>
    </div>`;
  return document.querySelector<HTMLElement>("[data-action]")!;
}

function SlotProbe() {
  const anchor = useRef<HTMLSpanElement>(null);
  const slot = useFooterSlot(anchor);
  return <span ref={anchor} data-has-slot={slot === null ? "no" : "yes"} />;
}

const slot = () => document.querySelector("[data-context-plugin-ring]");
const nativeRing = () => document.querySelector('button[aria-label^="Context window"]');

describe("useFooterSlot", () => {
  it("inserts the slot just before bb's ring and removes it on unmount", () => {
    const container = composerDom({ withRing: true });
    const { unmount } = render(<SlotProbe />, { container });
    expect(slot()!.nextElementSibling).toBe(nativeRing());
    unmount();
    expect(slot()).toBeNull();
  });

  it("moves before bb's ring when the ring appears later", async () => {
    const container = composerDom({ withRing: false });
    render(<SlotProbe />, { container });
    const right = document.querySelector("[data-right]")!;
    expect(slot()!.parentElement).toBe(right);
    await act(async () => {
      right.insertAdjacentHTML("beforeend", '<button aria-label="Context window 4% used"></button>');
      await Promise.resolve();
    });
    expect(slot()!.nextElementSibling).toBe(nativeRing());
  });

  it("re-inserts itself when bb re-renders the footer", async () => {
    const container = composerDom({ withRing: true });
    render(<SlotProbe />, { container });
    const footer = document.querySelector("[data-follow-up-composer-footer]")!;
    await act(async () => {
      footer.innerHTML = '<div data-left></div><div data-right><button aria-label="Context window 12% used"></button></div>';
      await Promise.resolve();
    });
    expect(document.querySelectorAll("[data-context-plugin-ring]").length).toBe(1);
    expect(slot()!.nextElementSibling).toBe(nativeRing());
  });

  it("gives no slot outside a follow-up composer", () => {
    const { container } = render(<SlotProbe />);
    expect(container.querySelector("[data-has-slot]")!.getAttribute("data-has-slot")).toBe("no");
    expect(slot()).toBeNull();
  });
});
