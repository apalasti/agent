import { describe, expect, it } from "vitest";
import { activitySummary } from "../src/ui/activity";
import { makeStep } from "./uiFixtures";

const tool = (name: string, summary = "", isError = false) => makeStep({ name, summary, isError });

describe("activitySummary", () => {
  it("groups commands, reads and other tools, with failures in parentheses", () => {
    const steps = [
      ...Array.from({ length: 41 }, (_, i) => tool("bash", `cmd ${i}`, i < 4)),
      tool("read", "/w/notes/L6-multi-node-chains.md"),
      tool("get_subagent_result", "abc"),
    ];
    expect(activitySummary(steps)).toBe("Ran 41 commands (4 failed), read L6-multi-node-chains.md, used a tool");
  });

  it("counts distinct files read and edited, and searches", () => {
    const steps = [
      tool("read", "/w/a.ts"),
      tool("read", "/w/b.ts"),
      tool("read", "/w/a.ts"),
      tool("edit", "/w/a.ts"),
      tool("write", "/w/c.ts"),
      tool("grep", "TODO in src"),
      tool("find", "*.ts"),
      tool("ls", "/w"),
    ];
    expect(activitySummary(steps)).toBe("Read 2 files, edited 2 files, searched 3 times");
  });

  it("uses singular forms", () => {
    expect(activitySummary([tool("bash", "ls"), tool("edit", "/w/a.ts"), tool("grep", "x")])).toBe(
      "Ran 1 command, edited a.ts, searched once",
    );
    expect(activitySummary([tool("Agent", "x"), tool("SubagentWorkflow", "y", true)])).toBe("Used 2 tools (1 failed)");
  });

  it("ignores text steps and is empty without tool calls", () => {
    expect(activitySummary([makeStep({ kind: "text", name: "text", summary: "hello" })])).toBe("");
    expect(activitySummary([])).toBe("");
  });
});
