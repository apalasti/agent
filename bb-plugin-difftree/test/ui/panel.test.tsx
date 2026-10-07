// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { loadPluginApp, renderSlot, type CapturedPluginApp } from "@get-bb/plugin-sdk/testing/app";
import type { PluginCommandRegistration } from "@get-bb/plugin-sdk/app";
import { DIFF_CHANGED, type TreeResult } from "../../src/contract";
import { buildTree, initialExpanded, visibleRows } from "../../src/tree";
import { REFETCH_DEBOUNCE_MS } from "../../src/ui/useDiffTree";
import { available, branchesFixture, ENV, NU_FILES, NU_TREE, patchFor, rpcHandlers, TRUNCATED_TREE } from "./fixtures";

afterEach(cleanup);

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  Element.prototype.scrollIntoView ??= () => {};
});

async function loadApp() {
  return loadPluginApp(() => import("../../app"));
}

async function panelSlot() {
  const app = await loadApp();
  return app.threadPanelActions.find((slot) => slot.id === "tree")!;
}

type Handlers = Parameters<typeof rpcHandlers>[0];

async function renderPanel(tree: TreeResult | (() => TreeResult) = NU_TREE, handlers: Handlers = {}) {
  const rendered = renderSlot(
    await panelSlot(),
    { threadId: "thr_1", params: null },
    { rpc: rpcHandlers({ tree: typeof tree === "function" ? tree : () => tree, ...handlers }) },
  );
  return rendered;
}

type Rendered = Awaited<ReturnType<typeof renderPanel>>;

async function treeOf(rendered: Rendered) {
  return rendered.findByRole("tree", { name: "Changed files" });
}

function row(rendered: Rendered, path: string): HTMLElement {
  const found = rendered.container.querySelector<HTMLElement>(`[role="treeitem"][data-path="${path}"]`);
  if (!found) throw new Error(`no row for ${path}`);
  return found;
}

function rowPaths(rendered: Rendered): string[] {
  return Array.from(rendered.container.querySelectorAll('[role="treeitem"]'), (item) => item.getAttribute("data-path")!);
}

function fileRowCount(rendered: Rendered): number {
  return rendered.container.querySelectorAll('[role="treeitem"]:not([aria-expanded])').length;
}

describe("registration", () => {
  it("adds a flush thread panel tab and a thread-only palette command bound to ⌘⇧D", async () => {
    const app = await loadApp();
    const panel = app.threadPanelActions.find((slot) => slot.id === "tree")!;
    expect(panel).toMatchObject({ title: "Diff tree", layout: "flush" });

    // The harness collects commands under a name its CapturedPluginApp type does not declare.
    const commands = (app as CapturedPluginApp & { commandPaletteActions: PluginCommandRegistration[] }).commandPaletteActions;
    const command = commands.find((entry) => entry.id === "show")!;
    expect(command.title).toBe("Diff tree: show this thread's changes");
    expect(command.defaultShortcut).toMatchObject({ key: "d", mod: true, shift: true });

    const opened: unknown[] = [];
    const context = (threadId: string | null) => ({
      threadId,
      projectId: null,
      openPanel: (options: unknown) => {
        opened.push(options);
        return true;
      },
    });
    expect(command.isAvailable!(context(null))).toBe(false);
    expect(command.isAvailable!(context("thr_1"))).toBe(true);
    await command.run(context("thr_1"));
    expect(opened).toEqual([{ actionId: "tree" }]);
  });
});

describe("Diff tree panel", () => {
  it("shows the summary and the initial breadth-first expansion", async () => {
    const rendered = await renderPanel();
    await treeOf(rendered);
    const summary = rendered.container.querySelector("[data-summary]")!;
    expect(summary.textContent).toContain("76 files");
    expect(summary.textContent).toContain("+3133");
    expect(summary.textContent).toContain("−4256");
    expect(summary.textContent).toContain("base 9a94438");

    const root = buildTree(NU_FILES);
    expect(rowPaths(rendered)).toEqual(visibleRows(root, initialExpanded(root, 40)).map((r) => r.node.path));
    expect(row(rendered, "docs").getAttribute("aria-expanded")).toBe("true");
    expect(row(rendered, "frontend/src").getAttribute("aria-expanded")).toBe("false");
    expect(row(rendered, "Deployment/package-twine").textContent).toContain("Deployment/package-twine/");
  });

  it("renders file rows with a change-kind letter, counts and the untracked flag", async () => {
    const rendered = await renderPanel();
    await treeOf(rendered);
    const decks = row(rendered, "irrops/solution_decks.py");
    expect(decks.querySelector("[data-change-kind]")!.textContent).toBe("A");
    expect(decks.textContent).toContain("+110");
    expect(decks.textContent).toContain("−0");
    expect(row(rendered, "irrops/solution_shortlist.py").querySelector("[data-change-kind]")!.textContent).toBe("D");
    const glossary = row(rendered, "GLOSSARY.md").querySelector("[data-change-kind]")!;
    expect(glossary.getAttribute("data-change-kind")).toBe("untracked");
    expect(glossary.getAttribute("title")).toMatch(/^Untracked/);
  });

  it("toggles folders on click and expands or collapses everything", async () => {
    const rendered = await renderPanel();
    await treeOf(rendered);
    fireEvent.click(row(rendered, "frontend/src"));
    expect(row(rendered, "frontend/src").getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(row(rendered, "docs"));
    expect(rendered.container.querySelector('[data-path="docs/data-flow.md"]')).toBeNull();

    fireEvent.click(rendered.getByRole("button", { name: "Expand all" }));
    expect(fileRowCount(rendered)).toBe(76);
    fireEvent.click(rendered.getByRole("button", { name: "Collapse all" }));
    expect(rowPaths(rendered)).toEqual(buildTree(NU_FILES).children.map((node) => node.path));
  });

  it("filters by path, opens the matching folders, and clears on Escape", async () => {
    const rendered = await renderPanel();
    await treeOf(rendered);
    const filter = rendered.getByRole("textbox", { name: "Filter files" });
    fireEvent.change(filter, { target: { value: "SolutionPage" } });
    const paths = rowPaths(rendered);
    expect(paths).toContain("frontend/src/pages/SolutionPage.tsx");
    expect(paths.every((path) => path.toLowerCase().includes("solution") || !path.includes("."))).toBe(true);
    expect(row(rendered, "frontend/src/pages").getAttribute("aria-expanded")).toBe("true");

    fireEvent.change(filter, { target: { value: "no-such-file" } });
    expect(rendered.getByText(/No changed file matches/)).toBeTruthy();

    fireEvent.keyDown(filter, { key: "Escape" });
    expect((filter as HTMLInputElement).value).toBe("");
    expect(row(rendered, "frontend/src").getAttribute("aria-expanded")).toBe("false");
  });

  it("opens a file's patch inline and closes it again", async () => {
    const rendered = await renderPanel(NU_TREE, { patch: ({ path }) => patchFor(path) });
    await treeOf(rendered);
    fireEvent.click(rendered.getByRole("button", { name: "Expand all" }));
    fireEvent.click(row(rendered, "frontend/src/pages/SolutionPage.tsx"));
    const diff = await rendered.findByTestId("bb-diff");
    expect(diff.getAttribute("data-path")).toBe("frontend/src/pages/SolutionPage.tsx");
    expect(diff.textContent).toContain("diff --git a/frontend/src/pages/SolutionPage.tsx");
    expect(rendered.inspection.rpcCalls.find((call) => call.method === "patch")!.input).toEqual({
      threadId: "thr_1",
      scope: { kind: "all", base: "origin/main" },
      path: "frontend/src/pages/SolutionPage.tsx",
    });
    expect(row(rendered, "frontend/src/pages/SolutionPage.tsx").getAttribute("aria-selected")).toBe("true");

    fireEvent.click(row(rendered, "frontend/src/pages/SolutionPage.tsx"));
    expect(rendered.queryByTestId("bb-diff")).toBeNull();
  });

  it("explains binary and too-large files instead of fetching their patch", async () => {
    const files = NU_FILES.map((file) =>
      file.path === "versions.json" ? { ...file, binary: true } : file.path === "GLOSSARY.md" ? { ...file, tooLarge: true } : file,
    );
    const rendered = await renderPanel(available(files));
    await treeOf(rendered);
    expect(row(rendered, "versions.json").textContent).toContain("binary");
    fireEvent.click(row(rendered, "versions.json"));
    fireEvent.click(row(rendered, "GLOSSARY.md"));
    expect(rendered.getByRole("group", { name: "Patch for versions.json" }).textContent).toContain("Binary file");
    expect(rendered.getByRole("group", { name: "Patch for GLOSSARY.md" }).textContent).toContain("too large");
    expect(rendered.inspection.rpcCalls.some((call) => call.method === "patch")).toBe(false);
  });

  it("opens a file in bb's preview, but offers no open button for a deleted file", async () => {
    const rendered = await renderPanel();
    await treeOf(rendered);
    fireEvent.click(within(row(rendered, "irrops/solution_decks.py")).getByRole("button", { name: "Open irrops/solution_decks.py" }));
    expect(rendered.inspection.navigateCalls).toEqual([
      {
        method: "experimental_openFilePreview",
        options: { target: { kind: "workspace", environmentId: ENV, path: "irrops/solution_decks.py" }, location: null },
      },
    ]);
    expect(within(row(rendered, "irrops/solution_shortlist.py")).queryByRole("button")).toBeNull();
    expect(rendered.queryByTestId("bb-diff")).toBeNull();
  });

  it("moves through rows with the keyboard and opens folders with →", async () => {
    const rendered = await renderPanel();
    await treeOf(rendered);
    const first = row(rendered, "Deployment/package-twine");
    expect(first.tabIndex).toBe(0);
    first.focus();
    fireEvent.keyDown(first, { key: "ArrowDown" });
    expect(document.activeElement).toBe(row(rendered, "Deployment/package-twine/versions.json"));
    fireEvent.keyDown(document.activeElement!, { key: "ArrowLeft" });
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(first, { key: "ArrowLeft" });
    expect(first.getAttribute("aria-expanded")).toBe("false");
    fireEvent.keyDown(first, { key: "ArrowRight" });
    expect(first.getAttribute("aria-expanded")).toBe("true");
    fireEvent.keyDown(first, { key: "ArrowRight" });
    expect(document.activeElement).toBe(row(rendered, "Deployment/package-twine/versions.json"));
  });

  it("warns when bb capped the file list", async () => {
    const rendered = await renderPanel(TRUNCATED_TREE);
    await treeOf(rendered);
    expect(rendered.getByRole("note").textContent).toBe(
      "bb lists at most 500 changed files, so some are missing here, and the totals cover only these 500.",
    );
    expect(rendered.getByRole("button", { name: "Base branch: main" })).toBeTruthy();
  });

  it("shows the empty and not-available states, keeping the scope picker when there is a scope", async () => {
    let rendered = await renderPanel(available([], { scope: { kind: "uncommitted" } }));
    expect((await rendered.findByText(/No changes/)).textContent).toBe("No changes · Uncommitted");
    cleanup();

    rendered = await renderPanel({
      outcome: "unavailable",
      environmentId: ENV,
      scope: { kind: "all", base: "origin/gone" },
      message: "Unknown base branch origin/gone",
    });
    expect((await rendered.findByText("Unknown base branch origin/gone")).closest("[role=status]")!.textContent).toContain(
      "Changes unavailable",
    );
    expect(rendered.getByRole("button", { name: "Scope: All changes" })).toBeTruthy();
    expect(rendered.getByRole("button", { name: "Base branch: origin/gone" })).toBeTruthy();
    cleanup();

    rendered = await renderPanel({ outcome: "no_environment", environmentId: null, scope: null, message: "This thread has no environment." });
    expect((await rendered.findByRole("status")).textContent).toContain("No environment");
    expect(rendered.queryByRole("button", { name: /^Scope/ })).toBeNull();
  });

  it("shows an error with Retry when the first load fails", async () => {
    let fail = true;
    const rendered = await renderPanel(() => {
      if (fail) throw new Error("rpc exploded");
      return NU_TREE;
    });
    expect((await rendered.findByRole("alert")).textContent).toContain("rpc exploded");
    fail = false;
    fireEvent.click(rendered.getByRole("button", { name: "Retry" }));
    await treeOf(rendered);
  });

  it("refetches on its environment's change signal only, keeping expansion, open patches and the filter", async () => {
    let files = NU_FILES;
    const rendered = await renderPanel(() => available(files), { patch: ({ path }) => patchFor(path) });
    await treeOf(rendered);
    fireEvent.click(row(rendered, "frontend/src"));
    fireEvent.click(row(rendered, "frontend/src/pages"));
    fireEvent.click(row(rendered, "frontend/src/pages/SolutionPage.tsx"));
    await rendered.findByTestId("bb-diff");
    const treeCalls = () => rendered.inspection.rpcCalls.filter((call) => call.method === "tree").length;
    const patchCalls = () => rendered.inspection.rpcCalls.filter((call) => call.method === "patch").length;
    expect(treeCalls()).toBe(1);

    await rendered.behavior.emitRealtime(DIFF_CHANGED, { environmentId: "env_other" });
    await act(() => new Promise((resolve) => setTimeout(resolve, REFETCH_DEBOUNCE_MS + 50)));
    expect(treeCalls()).toBe(1);

    files = [...NU_FILES, { ...NU_FILES[0]!, path: "frontend/src/pages/NewPage.tsx", changeKind: "added" }];
    await rendered.behavior.emitRealtime(DIFF_CHANGED, { environmentId: ENV });
    await rendered.behavior.emitRealtime(DIFF_CHANGED, { environmentId: ENV });
    await waitFor(() => expect(rendered.container.querySelector('[data-path="frontend/src/pages/NewPage.tsx"]')).not.toBeNull());
    expect(treeCalls()).toBe(2);
    expect(row(rendered, "frontend/src/pages").getAttribute("aria-expanded")).toBe("true");
    expect(rendered.getByTestId("bb-diff")).toBeTruthy();
    expect(patchCalls()).toBe(1);

    files = NU_FILES.map((file) => (file.path === "frontend/src/pages/SolutionPage.tsx" ? { ...file, additions: file.additions + 5 } : file));
    await rendered.behavior.emitRealtime(DIFF_CHANGED, { environmentId: ENV });
    await waitFor(() => expect(patchCalls()).toBe(2));

    const filter = rendered.getByRole("textbox", { name: "Filter files" }) as HTMLInputElement;
    fireEvent.change(filter, { target: { value: "pages/" } });
    files = NU_FILES;
    await rendered.behavior.emitRealtime(DIFF_CHANGED, { environmentId: ENV });
    await waitFor(() => expect(treeCalls()).toBe(4));
    expect(filter.value).toBe("pages/");
    const shownFiles = rowPaths(rendered).filter((path) => !row(rendered, path).hasAttribute("aria-expanded"));
    expect(shownFiles).toContain("frontend/src/pages/SolutionPage.tsx");
    expect(shownFiles.every((path) => path.includes("pages/"))).toBe(true);
  });

  it("changes the scope through set_scope and shows the tree it returns", async () => {
    const rendered = await renderPanel(NU_TREE, {
      set_scope: ({ scope }) => available(NU_FILES.slice(0, 2), { scope: scope ?? { kind: "uncommitted" }, scopeIsDefault: scope === null }),
    });
    await treeOf(rendered);
    fireEvent.keyDown(rendered.getByRole("button", { name: "Scope: All changes" }), { key: "Enter" });
    fireEvent.click(await rendered.findByRole("menuitemradio", { name: /Commits/ }));
    await waitFor(() => expect(rendered.container.querySelector("[data-summary]")!.textContent).toContain("2 files"));
    expect(rendered.inspection.rpcCalls.at(-1)).toEqual({
      method: "set_scope",
      input: { threadId: "thr_1", scope: { kind: "committed", base: "origin/main" } },
    });

    fireEvent.keyDown(rendered.getByRole("button", { name: "Scope: Commits" }), { key: "Enter" });
    fireEvent.click(await rendered.findByRole("menuitem", { name: /Reset to this environment's default/ }));
    await waitFor(() =>
      expect(rendered.inspection.rpcCalls.at(-1)).toEqual({ method: "set_scope", input: { threadId: "thr_1", scope: null } }),
    );
  });

  it("asks for a base when switching away from Uncommitted with none known", async () => {
    const rendered = await renderPanel(available(NU_FILES.slice(0, 1), { scope: { kind: "uncommitted" } }), {
      branches: () => branchesFixture(),
      set_scope: ({ scope }) => available(NU_FILES, { scope: scope!, scopeIsDefault: false }),
    });
    await treeOf(rendered);
    expect(rendered.queryByRole("button", { name: /^Base branch/ })).toBeNull();
    fireEvent.keyDown(rendered.getByRole("button", { name: "Scope: Uncommitted" }), { key: "Enter" });
    fireEvent.click(await rendered.findByRole("menuitemradio", { name: /All changes/ }));
    await within(document.body).findByPlaceholderText("Search branches…");
    expect(rendered.inspection.rpcCalls.some((call) => call.method === "set_scope")).toBe(false);
    fireEvent.click(await within(document.body).findByRole("option", { name: "origin/main" }));
    await waitFor(() =>
      expect(rendered.inspection.rpcCalls.at(-1)).toEqual({
        method: "set_scope",
        input: { threadId: "thr_1", scope: { kind: "all", base: "origin/main" } },
      }),
    );
  });

  it("picks a base branch from a searchable list", async () => {
    const queries: (string | undefined)[] = [];
    const rendered = await renderPanel(NU_TREE, {
      branches: ({ query }) => {
        queries.push(query);
        const all = branchesFixture();
        const match = (name: string) => query === undefined || name.includes(query);
        return { local: all.local.filter(match), remote: all.remote.filter(match), truncated: false };
      },
      set_scope: ({ scope }) => available(NU_FILES, { scope: scope!, scopeIsDefault: false }),
    });
    await treeOf(rendered);
    fireEvent.click(rendered.getByRole("button", { name: "Base branch: origin/main" }));
    const search = await within(document.body).findByPlaceholderText("Search branches…");
    await waitFor(() => expect(within(document.body).getByRole("option", { name: "origin/main" })).toBeTruthy());
    fireEvent.change(search, { target: { value: "demo-main" } });
    await waitFor(() => expect(queries.at(-1)).toBe("demo-main"));
    await waitFor(() => expect(within(document.body).queryByRole("option", { name: "origin/main" })).toBeNull());
    fireEvent.click(within(document.body).getByRole("option", { name: "daa/demo-main" }));
    await waitFor(() =>
      expect(rendered.inspection.rpcCalls.at(-1)).toEqual({
        method: "set_scope",
        input: { threadId: "thr_1", scope: { kind: "all", base: "daa/demo-main" } },
      }),
    );
    await waitFor(() => expect(rendered.getByRole("button", { name: "Base branch: daa/demo-main" })).toBeTruthy());
  });
});
