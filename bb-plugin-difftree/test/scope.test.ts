import { describe, expect, it } from "vitest";
import { defaultScope, scopeLabel, toTarget } from "../src/scope";

describe("defaultScope", () => {
  const feature = { currentBranch: "rework/solution-page", defaultBranch: "main", detached: false };

  it("compares a feature branch with origin/<default> when it exists", () => {
    expect(defaultScope(feature, ["origin/main", "origin/other"])).toEqual({ kind: "all", base: "origin/main" });
  });

  it("falls back to the local default branch without a remote", () => {
    expect(defaultScope(feature, ["upstream/main"])).toEqual({ kind: "all", base: "main" });
  });

  it("shows uncommitted changes on the default branch or detached", () => {
    expect(defaultScope({ ...feature, currentBranch: "main" }, ["origin/main"])).toEqual({ kind: "uncommitted" });
    expect(defaultScope({ ...feature, currentBranch: null, detached: true }, ["origin/main"])).toEqual({ kind: "uncommitted" });
  });
});

describe("toTarget and scopeLabel", () => {
  it("maps each scope kind", () => {
    expect(toTarget({ kind: "uncommitted" })).toEqual({ target: "uncommitted" });
    expect(toTarget({ kind: "all", base: "origin/main" })).toEqual({ target: "all", mergeBaseBranch: "origin/main" });
    expect(toTarget({ kind: "committed", base: "main" })).toEqual({ target: "branch_committed", mergeBaseBranch: "main" });
    expect(scopeLabel({ kind: "uncommitted" })).toBe("Uncommitted");
    expect(scopeLabel({ kind: "all", base: "origin/main" })).toBe("All changes vs origin/main");
    expect(scopeLabel({ kind: "committed", base: "origin/main" })).toBe("Commits vs origin/main");
  });
});
