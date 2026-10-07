import { describe, expect, it } from "vitest";
import { parseClaudeTranscript } from "../src/claudeTranscript";
import { apportion, composeReport, toMeter, type ComposeInput, type ContextUsage } from "../src/compose";
import { meterSchema, reportSchema, type ContextReport } from "../src/contract";
import { parseTimeline } from "../src/events";
import { parsePiSession } from "../src/piSession";
import { fixture, fixtureEvents, fixtureUsage } from "./fakes";

const CC_SESSION = "0157976d-4556-49bc-8888-0cfb87754f36";

const used = (report: ContextReport) =>
  report.categories.filter((category) => category.kind === "used").reduce((sum, category) => sum + category.tokens, 0);
const category = (report: ContextReport, id: string) => report.categories.find((candidate) => candidate.id === id);

function piProbe(overrides: Partial<ComposeInput> = {}): ContextReport {
  return composeReport({
    threadId: "thr_9znzytnw6r",
    providerId: "pi",
    threadStatus: "idle",
    timeline: parseTimeline(fixtureEvents("pi-probe-events.json")),
    session: parsePiSession(fixture("pi-probe-session.jsonl")),
    source: { kind: "pi-session", path: "/s/pi.jsonl" },
    usage: fixtureUsage("pi-context.json"),
    ...overrides,
  });
}

const withoutPromptSnapshot = (text: string) =>
  text
    .split("\n")
    .filter((line) => !line.includes('"prompt_snapshot"'))
    .join("\n");

function ccProbe(usage: ContextUsage | null, rows = fixtureEvents("cc-probe-events.json"), transcript = fixture("cc-probe-transcript.jsonl")): ContextReport {
  return composeReport({
    threadId: "thr_4p46bmnani",
    providerId: "claude-code",
    threadStatus: "idle",
    timeline: parseTimeline(rows),
    session: parseClaudeTranscript(transcript),
    source: { kind: "claude-transcript", path: "/c/x.jsonl" },
    usage,
  });
}

function snapshotUsage(providerSessionId: string): ContextUsage {
  const usage = fixtureUsage("cc-context-with-snapshot.json") as ContextUsage;
  return { ...usage, usedTokens: 26_140, snapshot: { ...usage.snapshot!, providerSessionId } };
}

describe("composeReport", () => {
  it("scales pi estimates so the used categories sum exactly to bb's total", () => {
    const report = piProbe();
    expect(reportSchema.parse(report)).toEqual(report);
    expect(report.window).toMatchObject({ usedTokens: 17_071, contextWindow: 1_000_000, basis: "measured", recomputing: false });
    expect(used(report)).toBe(17_071);
    expect(report.source.kind).toBe("pi-session");
    expect(report.source.calibration).toBeGreaterThan(1);
    expect(report.source.calibration).toBeLessThan(1.1);
    expect(category(report, "tools")?.entries).toHaveLength(15);
    expect(category(report, "free")?.tokens).toBe(1_000_000 - 17_071);
    expect(report.segments.map((segment) => segment.id)[0]).toBe("system");
    expect(report.top.map((segment) => segment.id)[0]).toBe("tools");
    expect(report.turns.map((turn) => [turn.index, turn.requestSeq, turn.tokensAfter, turn.measured])).toEqual([
      [1, 42, 16_304, true],
      [2, 55, 17_071, true],
    ]);
    expect(report.turns[1]?.tokensBefore).toBe(16_304);
    expect(report.turns[0]?.tokensBefore).toBe(
      ["system", "tools", "memory", "skills"].reduce((sum, id) => sum + (category(report, id)?.tokens ?? 0), 0),
    );
    expect(report.turns[1]?.largest[0]).toMatchObject({ label: "bash", detail: "seq 1 300", turnIndex: 2 });
    expect(report.courseChanges.map((change) => change.kind)).toEqual(["edited", "compactionSkipped"]);
  });

  it("groups tool results per tool with the largest single results as children", () => {
    const report = composeReport({
      threadId: "thr_x",
      providerId: "pi",
      threadStatus: "idle",
      timeline: parseTimeline([]),
      session: parsePiSession(fixture("pi-compacted-session.jsonl")),
      source: { kind: "pi-session", path: null },
      usage: null,
    });
    const results = category(report, "toolResults");
    const bash = results?.entries.find((entry) => entry.label === "bash");
    expect(bash?.children.length).toBeGreaterThan(1);
    expect(bash?.children.length).toBeLessThanOrEqual(10);
    expect(bash?.tokens).toBeGreaterThanOrEqual(bash?.children[0]?.tokens ?? 0);
    expect(report.window.basis).toBe("estimated");
  });

  it("keeps Claude's snapshot categories and splits the rest across the transcript", () => {
    const report = ccProbe(snapshotUsage(CC_SESSION));
    expect(reportSchema.parse(report)).toEqual(report);
    expect(report.source.kind).toBe("claude-snapshot");
    expect(category(report, "system")?.tokens).toBe(2933 + 717);
    expect(category(report, "tools")?.tokens).toBe(5207);
    expect(category(report, "memory")?.entries.map((entry) => entry.label)).toContain("/Users/andraspalasti/.claude/CLAUDE.md");
    expect(category(report, "skills")?.tokens).toBe(6333);
    expect(category(report, "reserved")?.tokens).toBe(33_000);
    expect(category(report, "deferred")?.tokens).toBe(2390 + 15_580);
    expect(used(report)).toBe(26_140);
    expect(report.window.autoCompactAt).toBe(967_000);
    expect(report.segments.some((segment) => segment.id === "deferred")).toBe(false);
    expect(report.segments.at(-1)?.id).toBe("reserved");
  });

  it("shows the residual as not-in-transcript when Claude has no snapshot", () => {
    const report = ccProbe(fixtureUsage("cc-context-no-snapshot.json"), undefined, withoutPromptSnapshot(fixture("cc-probe-transcript.jsonl")));
    expect(report.source.kind).toBe("claude-transcript");
    const residual = category(report, "unattributed");
    expect(residual?.label).toBe("System prompt, tools & skills (not in transcript)");
    expect(used(report)).toBe(26_140);
    expect(report.window.basis).toBe("measured");
  });

  it("scales the transcript's own prompt snapshot down to bb's total when it overshoots", () => {
    const report = ccProbe(fixtureUsage("cc-context-no-snapshot.json"));
    expect(category(report, "unattributed")).toBeUndefined();
    expect(report.source.calibration).toBeLessThan(1);
    expect(used(report)).toBe(26_140);
    expect(category(report, "tools")?.entries.map((entry) => entry.label)).toContain("Bash");
  });

  it("ignores a snapshot taken for another provider session", () => {
    const report = ccProbe(snapshotUsage("7a0b6685-5f1b-481c-be7c-47181be4d5b8"), undefined, withoutPromptSnapshot(fixture("cc-probe-transcript.jsonl")));
    expect(report.source.kind).toBe("claude-transcript");
    expect(report.window.autoCompactAt).toBeNull();
    expect(category(report, "reserved")).toBeUndefined();
    expect(category(report, "unattributed")).toBeDefined();
  });

  it("estimates and marks recomputing while the edited session has no measurement", () => {
    const rows = fixtureEvents("cc-probe-events.json").filter((row) => row.seq <= 88);
    const report = ccProbe(fixtureUsage("cc-context-no-snapshot.json"), rows);
    expect(report.window).toMatchObject({ basis: "estimated", recomputing: true, measuredAt: null });
    expect(report.window.usedTokens).toBeGreaterThan(0);
    expect(report.notes[0]).toMatch(/Recomputing/);
  });

  it("scales estimates by the thread's last calibration while there is no measurement", () => {
    const rows = fixtureEvents("cc-probe-events.json").filter((row) => row.seq <= 88);
    const plain = ccProbe(null, rows);
    const scaled = composeReport({
      threadId: "thr_4p46bmnani",
      providerId: "claude-code",
      threadStatus: "idle",
      timeline: parseTimeline(rows),
      session: parseClaudeTranscript(fixture("cc-probe-transcript.jsonl")),
      source: { kind: "claude-transcript", path: null },
      usage: null,
      priorCalibration: 0.75,
    });
    expect(scaled.window.basis).toBe("estimated");
    expect(scaled.window.usedTokens).toBeCloseTo((plain.window.usedTokens ?? 0) * 0.75, -2);
  });

  it("estimates a fresh fork from its copied session", () => {
    const report = composeReport({
      threadId: "thr_hvxb2yncdz",
      providerId: "pi",
      threadStatus: "idle",
      timeline: parseTimeline(fixtureEvents("pi-fork-events.json"), { sourceThreadId: "thr_9znzytnw6r" }),
      session: parsePiSession(fixture("pi-fork-session.jsonl")),
      source: { kind: "pi-session", path: null },
      usage: fixtureUsage("pi-fork-context-null.json"),
    });
    expect(report.window).toMatchObject({ basis: "estimated", recomputing: true, contextWindow: null });
    expect(report.window.usedTokens).toBe(used(report));
    expect(report.turns).toHaveLength(1);
    expect(report.turns[0]?.measured).toBe(false);
    expect(report.courseChanges[0]).toMatchObject({ kind: "forked", beforeTurnIndex: 2 });
  });

  it("gives remote threads bb's total only", () => {
    const report = piProbe({ remote: true });
    expect(report.source).toEqual({ kind: "bb-only", path: null, calibration: null });
    expect(report.categories.map((entry) => entry.id)).toEqual(["unattributed", "free"]);
  });

  it("renders nothing without any total", () => {
    const report = piProbe({ session: null, source: { kind: "bb-only", path: null }, usage: null, timeline: parseTimeline([]) });
    expect(report.window.basis).toBe("none");
    expect(report.segments).toEqual([]);
  });

  it("marks the last turn running and nothing editable while the thread runs", () => {
    const userSent = parseTimeline(fixtureEvents("pi-probe-events.json"));
    userSent.turns = userSent.turns.map((turn) => ({ ...turn, userSent: true }));
    expect(piProbe({ timeline: userSent }).turns.map((turn) => [turn.editable, turn.notEditableReason])).toEqual([
      [true, null],
      [true, null],
    ]);
    const report = piProbe({ threadStatus: "active", timeline: userSent });
    expect(report.turns.map((turn) => [turn.editable, turn.running, turn.notEditableReason])).toEqual([
      [false, false, "The thread is running"],
      [false, true, "The thread is running"],
    ]);
    expect(meterSchema.parse(toMeter(report))).toEqual(toMeter(report));
  });
});

it("does not offer to edit messages another thread sent, which bb refuses", () => {
  expect(piProbe().turns.map((turn) => [turn.editable, turn.notEditableReason])).toEqual([
    [false, "Sent by another thread or an agent"],
    [false, "Sent by another thread or an agent"],
  ]);
});

describe("apportion", () => {
  it("sums exactly to the target", () => {
    expect(apportion([1, 1, 1], 10)).toEqual([4, 3, 3]);
    expect(apportion([5, 0, 5], 7).reduce((a, b) => a + b, 0)).toBe(7);
  });
});
