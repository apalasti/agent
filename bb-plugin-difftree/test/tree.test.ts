import { describe, expect, it } from "vitest";
import { allDirPaths, buildTree, filterFiles, initialExpanded, visibleRows, type DirNode } from "../src/tree";
import { file } from "./fakes";

const files = [
  file("frontend/src/components/a.ts", 10, 2),
  file("frontend/src/components/b.ts", 5, 0),
  file("frontend/src/pages/Page.tsx", 1, 1),
  file("irrops/solution_decks.py", 3, 4),
  file("README.md", 2, 0),
  file("new/name.ts", 0, 0, { changeKind: "renamed", previousPath: "old/name.ts" }),
];

describe("buildTree", () => {
  it("sums counts into every ancestor and the root", () => {
    const root = buildTree(files);
    expect(root).toMatchObject({ additions: 21, deletions: 7, fileCount: 6 });
    const frontend = root.children.find((c) => c.name === "frontend/src") as DirNode;
    expect(frontend).toMatchObject({ kind: "dir", path: "frontend/src", additions: 16, deletions: 3, fileCount: 3 });
  });

  it("compresses single-child chains and sorts folders before files", () => {
    const root = buildTree(files);
    expect(root.children.map((c) => c.name)).toEqual(["frontend/src", "irrops", "new", "README.md"]);
    const frontend = root.children[0] as DirNode;
    expect(frontend.children.map((c) => c.name)).toEqual(["components", "pages"]);
    expect(frontend.children[1]).toMatchObject({ path: "frontend/src/pages" });
  });

  it("compresses a chain nested below a branching folder", () => {
    const root = buildTree([file("a/x/y/z.ts", 1, 0), file("a/w.ts", 1, 0)]);
    const a = root.children[0] as DirNode;
    expect(a.children.map((c) => [c.name, c.path])).toEqual([
      ["x/y", "a/x/y"],
      ["w.ts", "a/w.ts"],
    ]);
  });
});

describe("visibleRows, initialExpanded, allDirPaths, filterFiles", () => {
  it("walks only expanded folders", () => {
    const root = buildTree(files);
    expect(visibleRows(root, new Set()).map((r) => r.node.name)).toEqual(["frontend/src", "irrops", "new", "README.md"]);
    const open = visibleRows(root, new Set(["frontend/src"])).map((r) => `${r.depth}:${r.node.name}`);
    expect(open.slice(0, 3)).toEqual(["0:frontend/src", "1:components", "1:pages"]);
  });

  it("opens breadth-first within the budget", () => {
    const root = buildTree(files);
    expect(initialExpanded(root, 100)).toEqual(allDirPaths(root));
    expect(initialExpanded(root, 4)).toEqual(new Set());
    expect([...initialExpanded(root, 6)]).toEqual(["frontend/src"]);
  });

  it("filters on path and previous path, case-insensitively", () => {
    expect(filterFiles(files, "DECKS").map((f) => f.path)).toEqual(["irrops/solution_decks.py"]);
    expect(filterFiles(files, "old/").map((f) => f.path)).toEqual(["new/name.ts"]);
    expect(filterFiles(files, "  ")).toHaveLength(files.length);
  });
});
