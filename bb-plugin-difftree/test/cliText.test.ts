import { beforeEach, describe, expect, it } from "vitest";
import { renderTreeText } from "../src/cliText";
import type { TreeResult } from "../src/contract";
import { createDiffService, type DiffService } from "../src/service";
import { FakeDiffSdk, MemoryScopeStore, WORKTREE_THREAD, file } from "./fakes";

let service: DiffService;
beforeEach(() => {
  service = createDiffService(new FakeDiffSdk(), new MemoryScopeStore());
});

const full = { depth: null, maxLines: 200 };

describe("renderTreeText on the 76-file branch", () => {
  it("prints a header, folders with trailing slashes and right-aligned counts", async () => {
    const lines = renderTreeText(await service.tree({ threadId: WORKTREE_THREAD, scope: null }), full).split("\n");
    expect(lines[0]).toBe("rework/solution-page · All changes vs origin/main · 76 files +3133 -4256");
    expect(lines[1]).toBe("Deployment/package-twine/                              +14    -0");
    expect(lines).toContain("frontend/                                            +2000 -1387");
    expect(lines).toContain("        M useWhatIfComparison.ts                       +88   -18");
    expect(lines).toContain("  D test_solution_shortlist.py                          +0 -1986");
    expect(lines).toContain("? GLOSSARY.md                                          +13    -0");
    expect(new Set(lines.slice(1).map((line) => line.length))).toEqual(new Set([lines[1]!.length]));
    expect(lines.filter((line) => /^ *[^ ]+\/ /.test(line))).toHaveLength(43);
    expect(lines).toHaveLength(1 + 43 + 76);
  });

  it("collapses folders below --depth", async () => {
    const lines = renderTreeText(await service.tree({ threadId: WORKTREE_THREAD, scope: null }), { depth: 1, maxLines: 200 }).split("\n");
    expect(lines.slice(1).map((line) => line.split(/\s+/)[0])).toEqual([
      "Deployment/package-twine/",
      "docs/",
      "frontend/",
      "irrops/",
      "migrations/versions/",
      "recommendation_service/",
      "service/",
      "services_common/",
      "test/",
      "?",
      "M",
      "M",
    ]);
  });
});

describe("renderTreeText on the capped 500-file list", () => {
  it("notes bb's cap, caps the rows, and shows binaries and renames", async () => {
    const result = await service.tree({ threadId: WORKTREE_THREAD, scope: { kind: "all", base: "main" } });
    const capped = renderTreeText(result, full).split("\n");
    expect(capped[0]).toBe("rework/solution-page · All changes vs main · 500 files +72788 -15552");
    expect(capped[1]).toBe("bb capped the list at 500 files; totals cover only those.");
    expect(capped).toHaveLength(2 + 199 + 1);
    expect(capped.at(-1)).toBe("… 359 more rows");
    expect(capped[5]).toMatch(/^ {6}M ml\.json +binary$/);

    const all = renderTreeText(result, { depth: null, maxLines: 10_000 }).split("\n");
    expect(all).toContain("        R ctot.ts ← frontend/src/assets/ctot.ts                    +2     -2");
  });
});

describe("renderTreeText edge cases", () => {
  const base: Extract<TreeResult, { outcome: "available" }> = {
    outcome: "available",
    environmentId: "env_1",
    scope: { kind: "uncommitted" },
    scopeIsDefault: true,
    currentBranch: null,
    mergeBaseRef: null,
    files: [],
    truncated: false,
    totals: { files: 0, additions: 0, deletions: 0 },
  };

  it("says when there are no changes", () => {
    expect(renderTreeText(base, full)).toBe("(detached) · Uncommitted · 0 files +0 -0\nNo changes.");
  });

  it("clips very long names to keep the count columns aligned", () => {
    const long = `${"deep/".repeat(20)}file.ts`;
    const lines = renderTreeText({ ...base, files: [file(long, 1, 1)], totals: { files: 1, additions: 1, deletions: 1 } }, full).split("\n");
    expect(lines[1]).toMatch(/…  \+1 -1$/);
    expect(lines[1]!.length).toBe(72 + 2 + 5);
  });

  it("prints the message for other outcomes", () => {
    expect(renderTreeText({ outcome: "no_environment", environmentId: null, scope: null, message: "Thread x has no environment." }, full)).toBe(
      "Thread x has no environment.",
    );
  });
});
