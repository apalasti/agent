import { describe, expect, it } from "vitest";
import { pathRoots, relativePath, resolvePath, shortenSummary } from "../src/paths";

const AGENT = "/Users/andraspalasti/fun/agent";
const roots = pathRoots([AGENT]);

describe("shortenSummary", () => {
  it("drops a leading cd into the agent's root and relativizes paths under it", () => {
    expect(shortenSummary(`bash: cd ${AGENT} && git add bb-plugin-subagents`, roots)).toBe("bash: git add bb-plugin-subagents");
    expect(shortenSummary(`bash: cd ${AGENT}/; npm test`, roots)).toBe("bash: npm test");
    expect(shortenSummary(`read: ${AGENT}/bb-plugin-worktrees/DESIGN.md`, roots)).toBe("read: bb-plugin-worktrees/DESIGN.md");
    expect(shortenSummary(`bash: ls ${AGENT}`, roots)).toBe("bash: ls .");
  });

  it("abbreviates a cd elsewhere to its basename", () => {
    expect(shortenSummary(`bash: cd ${AGENT}/bb-plugin-worktrees && git diff --stat`, roots)).toBe(
      "bash: cd …/bb-plugin-worktrees && git diff --stat",
    );
    expect(shortenSummary("bash: cd /tmp/bbui && cat > t1.mjs <<'EOF'", roots)).toBe("bash: cd …/bbui && cat > t1.mjs <<'EOF'");
    expect(shortenSummary("bash: cd src && ls", roots)).toBe("bash: cd src && ls");
  });

  it("leaves paths outside the roots and look-alike prefixes alone", () => {
    const outside = "bash: S=/Users/andraspalasti/.bb/runtime/global-skills/x && cat $S";
    expect(shortenSummary(outside, roots)).toBe(outside);
    expect(shortenSummary(`read: ${AGENT}-other/a.ts`, roots)).toBe(`read: ${AGENT}-other/a.ts`);
  });

  it("treats /tmp and /private/tmp as the same root", () => {
    const tmp = pathRoots(["/tmp/wt-demo"]);
    expect(shortenSummary("bash: cd /private/tmp/wt-demo && sleep 40", tmp)).toBe("bash: sleep 40");
    expect(shortenSummary('bash: echo hi > "/tmp/wt-demo/scratch-note.txt"', tmp)).toBe('bash: echo hi > "scratch-note.txt"');
  });
});

describe("paths", () => {
  it("relativizes, resolves and orders roots longest first", () => {
    expect(pathRoots(["/tmp/a", null, "/tmp/a/b/"])).toEqual(["/private/tmp/a/b", "/private/tmp/a", "/tmp/a/b", "/tmp/a"]);
    expect(relativePath(`${AGENT}/x/y.ts`, roots)).toBe("x/y.ts");
    expect(relativePath("/elsewhere/y.ts", roots)).toBe("/elsewhere/y.ts");
    expect(resolvePath("../b/./c.ts", "/w/a")).toBe("/w/b/c.ts");
    expect(resolvePath("/abs.ts", "/w")).toBe("/abs.ts");
    expect(resolvePath("rel.ts", null)).toBe("rel.ts");
  });
});
