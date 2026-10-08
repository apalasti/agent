import { describe, expect, it } from "vitest";
import {
  activityCounts,
  clockTime,
  fileTarget,
  panelSummary,
  staleness,
  elapsedMs,
  finalTextIndex,
  formatDuration,
  orderSubagents,
  pillText,
  shortId,
  tally,
  toolSummary,
} from "../src/ui/format";
import { makeSubagent } from "./uiFixtures";

describe("orderSubagents", () => {
  it("puts running agents first, then newest first, unknown start times last", () => {
    const ordered = orderSubagents([
      makeSubagent("old", { startedAt: "2026-10-06T09:00:00Z" }),
      makeSubagent("nostart", { startedAt: null }),
      makeSubagent("new", { startedAt: "2026-10-06T11:00:00Z" }),
      makeSubagent("run-old", { status: "running", startedAt: "2026-10-06T08:00:00Z" }),
      makeSubagent("run-new", { status: "running", startedAt: "2026-10-06T12:00:00Z" }),
    ]);
    expect(ordered.map((agent) => agent.callId)).toEqual(["run-new", "run-old", "new", "old", "nostart"]);
  });

  it("keeps input order for ties", () => {
    const ordered = orderSubagents([makeSubagent("a"), makeSubagent("b")]);
    expect(ordered.map((agent) => agent.callId)).toEqual(["a", "b"]);
  });
});

describe("elapsed", () => {
  const now = Date.parse("2026-10-06T10:02:05Z");

  it("ticks against now while running", () => {
    expect(elapsedMs(makeSubagent("a", { status: "running", finishedAt: null }), now)).toBe(125_000);
  });

  it("freezes at finishedAt, falling back to updatedAt", () => {
    expect(elapsedMs(makeSubagent("a"), now)).toBe(30_000);
    expect(elapsedMs(makeSubagent("a", { finishedAt: null, updatedAt: "2026-10-06T10:00:10Z" }), now)).toBe(10_000);
  });

  it("is unknown without a start time", () => {
    expect(elapsedMs(makeSubagent("a", { startedAt: null }), now)).toBeNull();
  });

  it("formats seconds, minutes and hours", () => {
    expect(formatDuration(0)).toBe("0s");
    expect(formatDuration(59_999)).toBe("59s");
    expect(formatDuration(65_000)).toBe("1m 05s");
    expect(formatDuration(3_725_000)).toBe("1h 02m");
  });
});

describe("labels", () => {
  it("summarises the pill", () => {
    expect(pillText(tally([makeSubagent("a", { status: "running" }), makeSubagent("b"), makeSubagent("c")]))).toBe(
      "1 running · 2 done",
    );
    expect(pillText(tally([makeSubagent("a", { status: "running" })]))).toBe("1 running");
    expect(pillText(tally([makeSubagent("a")]))).toBe("1 subagent");
    expect(pillText({ running: 0, total: 5 })).toBe("5 subagents");
  });

  it("counts turns and tools", () => {
    expect(activityCounts({ turns: 1, toolCalls: 0 })).toBe("1 turn · 0 tools");
  });

  it("shortens agent ids to the segment bb's rows show first", () => {
    expect(shortId("27e7abbc-45cf-47d0-9b1a-000000000000")).toBe("27e7abbc");
    expect(shortId("plain")).toBe("plain");
  });
});

describe("toolSummary", () => {
  it("drops a repeated tool name prefix", () => {
    expect(toolSummary("bash", "bash: sleep 20")).toBe("sleep 20");
    expect(toolSummary("read", "README.md")).toBe("README.md");
  });
});

describe("finalTextIndex", () => {
  it("finds the trailing text entry that repeats the result", () => {
    const entries = [
      { kind: "prompt" as const, at: null, text: "go" },
      { kind: "text" as const, at: null, text: "The count is 3.\n" },
      { kind: "tool" as const, at: null, callId: null, name: "bash", summary: "", args: "", result: "", isError: false },
    ];
    expect(finalTextIndex(entries, "The count is 3.")).toBe(1);
    expect(finalTextIndex(entries, "Something else")).toBe(-1);
    expect(finalTextIndex(entries, null)).toBe(-1);
  });
});

describe("staleness", () => {
  const now = Date.parse("2026-10-06T10:30:00Z");
  const running = (updatedAt: string) => makeSubagent("a", { status: "running", finishedAt: null, updatedAt });

  it("stays quiet for fresh or finished agents", () => {
    expect(staleness(running("2026-10-06T10:29:50Z"), now)).toBeNull();
    expect(staleness(makeSubagent("a", { updatedAt: "2026-10-06T09:00:00Z" }), now)).toBeNull();
  });

  it("ticks up, then warns after ten minutes", () => {
    expect(staleness(running("2026-10-06T10:29:18Z"), now)).toEqual({ text: "updated 42s ago", warn: false });
    expect(staleness(running("2026-10-06T10:25:00Z"), now)).toEqual({ text: "updated 5m ago", warn: false });
    expect(staleness(running("2026-10-06T10:18:00Z"), now)).toEqual({ text: "no activity for 12m", warn: true });
    expect(staleness(running("2026-10-06T08:00:00Z"), now)).toEqual({ text: "no activity for 2h 30m", warn: true });
  });
});

describe("panelSummary", () => {
  it("counts by status and sums elapsed time", () => {
    const now = Date.parse("2026-10-06T10:01:00Z");
    const agents = [
      makeSubagent("a", { status: "running", finishedAt: null, startedAt: "2026-10-06T10:00:00Z" }),
      makeSubagent("b", { startedAt: "2026-10-06T10:00:00Z", finishedAt: "2026-10-06T10:02:12Z" }),
      makeSubagent("c", { status: "failed", startedAt: null }),
    ];
    expect(panelSummary(agents, now)).toBe("1 running · 1 done · 1 failed · 3m 12s total");
    expect(panelSummary([], now)).toBe("");
  });
});

describe("fileTarget", () => {
  const env = { id: "env_1", hostId: "host_1", path: "/tmp/wt-demo" };
  it("links files under the environment as workspace files and others as host files", () => {
    expect(fileTarget("/private/tmp/wt-demo/scratch-note.txt", env)).toEqual({
      kind: "workspace",
      environmentId: "env_1",
      path: "scratch-note.txt",
    });
    expect(fileTarget("/etc/hosts", env)).toEqual({ kind: "host", hostId: "host_1", path: "/etc/hosts" });
    expect(fileTarget("relative.txt", env)).toBeNull();
    expect(fileTarget("/etc/hosts", null)).toBeNull();
  });
});

describe("clockTime", () => {
  it("formats local HH:MM:SS", () => {
    const at = new Date(2026, 9, 6, 9, 5, 7).toISOString();
    expect(clockTime(at)).toBe("09:05:07");
    expect(clockTime(null)).toBeNull();
  });
});
