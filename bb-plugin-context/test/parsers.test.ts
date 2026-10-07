import { describe, expect, it } from "vitest";
import { attachmentLabel, parseClaudeTranscript } from "../src/claudeTranscript";
import { parseTimeline, type EventRow } from "../src/events";
import { parsePiSession, toolSubject } from "../src/piSession";
import { fixture, fixtureEvents } from "./fakes";

const PROBE_SESSION = "pi_ae5da616-e0a4-4359-98a7-0c995bb2a235";

/** What the collector still holds for the dead branch when it saw the thread before the edit; bb deletes these rows. */
function deadBranch(): EventRow[] {
  const at = "2026-10-07T16:50:00.000Z";
  const request = (seq: number, text: string): EventRow => ({
    seq,
    type: "client/turn/requested",
    createdAt: at,
    data: { request: { method: seq === 1 ? "thread/start" : "turn/start" }, input: [{ type: "text", text, mentions: [] }] },
  });
  const usage = (seq: number, usedTokens: number): EventRow => ({
    seq,
    type: "thread/contextWindowUsage/updated",
    createdAt: at,
    data: { providerThreadId: "pi_old", contextWindowUsage: { usedTokens, modelContextWindow: 1_000_000 } },
  });
  return [
    request(1, "old first"),
    { seq: 2, type: "thread/identity", createdAt: at, data: { providerThreadId: "pi_old" } },
    usage(10, 16_000),
    request(20, "old second"),
    usage(35, 31_000),
  ];
}

describe("parseTimeline", () => {
  it("keeps the two active turns after an edit and ends with the skipped compaction", () => {
    const timeline = parseTimeline(fixtureEvents("pi-probe-events.json"));
    expect(timeline.currentProviderThreadId).toBe(PROBE_SESSION);
    expect(timeline.turns.map((turn) => [turn.requestSeq, turn.lastSeq])).toEqual([
      [42, 54],
      [55, 67],
    ]);
    expect(timeline.deadRanges).toEqual([[1, 40]]);
    expect(timeline.courseChanges.map((change) => [change.kind, change.beforeTurnIndex])).toEqual([
      ["edited", 1],
      ["compactionSkipped", 3],
    ]);
    expect(timeline.courseChanges[1]).toMatchObject({ tokensBefore: 17_071, tokensAfter: 17_071 });
    expect(timeline.usage.map((point) => point.usedTokens)).toEqual([16_304, 16_711, 17_071, 17_071]);
  });

  it("counts the discarded turns and their last size when the dead branch was seen before the edit", () => {
    const timeline = parseTimeline([...deadBranch(), ...fixtureEvents("pi-probe-events.json")]);
    expect(timeline.turns.map((turn) => turn.requestSeq)).toEqual([42, 55]);
    expect(timeline.usage.every((point) => point.seq > 40)).toBe(true);
    expect(timeline.courseChanges[0]).toMatchObject({ kind: "edited", discardedTurns: 2, tokensBefore: 31_000, tokensAfter: 16_304 });
  });

  it("reads a Claude Code thread after an edit, including the null first usage", () => {
    const timeline = parseTimeline(fixtureEvents("cc-probe-events.json"));
    expect(timeline.currentProviderThreadId).toBe("0157976d-4556-49bc-8888-0cfb87754f36");
    expect(timeline.turns).toHaveLength(1);
    expect(timeline.turns[0]).toMatchObject({ requestSeq: 86, lastSeq: 108 });
    expect(timeline.usage[0]?.usedTokens).toBeNull();
    expect(timeline.courseChanges).toEqual([expect.objectContaining({ kind: "edited", seq: 85, beforeTurnIndex: 1, tokensAfter: 26_140 })]);
  });

  it("places a fork right after the copied turn", () => {
    const timeline = parseTimeline(fixtureEvents("pi-fork-events.json"), { sourceThreadId: "thr_9znzytnw6r" });
    expect(timeline.currentProviderThreadId).toBe("thr_hvxb2yncdz");
    expect(timeline.turns.map((turn) => [turn.requestSeq, turn.lastSeq])).toEqual([[1, 5]]);
    expect(timeline.courseChanges).toEqual([
      expect.objectContaining({ kind: "forked", seq: 8, beforeTurnIndex: 2, sourceThreadId: "thr_9znzytnw6r" }),
    ]);
  });

  it("treats /compact as a course change, not a turn", () => {
    const timeline = parseTimeline(fixtureEvents("pi-probe-events.json"));
    expect(timeline.turns.some((turn) => turn.text.includes("/compact"))).toBe(false);
  });
});

describe("parsePiSession", () => {
  it("splits the probe session into categories with one entry per tool", () => {
    const session = parsePiSession(fixture("pi-probe-session.jsonl"));
    const categories = new Set(session.items.map((item) => item.category));
    for (const id of ["system", "tools", "memory", "skills", "user", "assistant", "toolCalls", "toolResults"]) expect(categories).toContain(id);
    expect(session.items.filter((item) => item.category === "tools")).toHaveLength(15);
    expect(session.items.filter((item) => item.category === "system").map((item) => item.label)).toEqual(
      expect.arrayContaining(["preamble", "tools", "rules", "docs", "addendum", "cwd"]),
    );
    const bash = session.items.find((item) => item.category === "toolResults");
    expect(bash).toMatchObject({ label: "bash", detail: "seq 1 300", userOrdinal: 1 });
    expect(session.model).toBe("claude-opus-5-5");
  });

  it("applies the last compaction: summary in, entries before firstKeptEntryId out", () => {
    const text = fixture("pi-compacted-session.jsonl");
    const session = parsePiSession(text);
    const keys = new Set(session.items.map((item) => item.key.split(":")[0]));
    expect(session.items.filter((item) => item.category === "summary")).toHaveLength(1);
    expect(keys.has("3ffda866")).toBe(true);
    expect(keys.has("0cd12fab")).toBe(true);
    const lines = text.split("\n").filter(Boolean).map((line) => JSON.parse(line) as { id?: string });
    const firstKept = lines.findIndex((entry) => entry.id === "0cd12fab");
    const dropped = lines.slice(4, firstKept).map((entry) => entry.id).filter((id): id is string => typeof id === "string");
    expect(dropped.length).toBeGreaterThan(10);
    for (const id of dropped) expect(keys.has(id)).toBe(false);
    expect(session.compactedBeforeOrdinal).not.toBeNull();
    expect(session.compactions.map((compaction) => compaction.tokensBefore)).toEqual([161_703, 172_004]);
  });

  it("drops context_edit targets", () => {
    const lines = fixture("pi-compacted-session.jsonl").split("\n");
    const beforeSecondCompaction = lines.slice(0, lines.findIndex((line) => line.includes('"id": "3ffda866"'))).join("\n");
    const withEdits = parsePiSession(beforeSecondCompaction);
    const keys = new Set(withEdits.items.map((item) => item.key.split(":")[0]));
    expect(keys.has("af21c821")).toBe(true);
    for (const target of ["de5f7a51", "0f9a1267", "3171a688"]) expect(keys.has(target)).toBe(false);
    const edited = parsePiSession(`${beforeSecondCompaction}\n${JSON.stringify({ type: "context_edit", id: "e1", targetId: "af21c821", replacement: null })}`);
    expect(new Set(edited.items.map((item) => item.key.split(":")[0])).has("af21c821")).toBe(false);
  });

  it("ignores a partial last line and unknown entry types", () => {
    const text = fixture("pi-probe-session.jsonl");
    const full = parsePiSession(text);
    const noisy = parsePiSession(`${text}{"type":"future_thing","id":"x"}\n{"type":"message","id":"half","message":{"role":"user","con`);
    expect(noisy.items).toEqual(full.items);
  });
});

describe("parseClaudeTranscript", () => {
  it("reads the probe transcript: prompt snapshot, attachments, the message and reply", () => {
    const session = parseClaudeTranscript(fixture("cc-probe-transcript.jsonl"));
    const by = (category: string) => session.items.filter((item) => item.category === category);
    expect(by("user")).toHaveLength(1);
    expect(by("user")[0]?.userText).toContain("Reply with the single word ok.");
    expect(by("tools").map((item) => item.label)).toContain("Bash");
    expect(by("system")).toHaveLength(1);
    expect(by("memory")).toHaveLength(1);
    expect(by("skills")).toHaveLength(1);
    expect(by("thinking")).toHaveLength(1);
    expect(by("assistant")[0]?.detail).toBe("ok");
    expect(session.model).toBe("claude-haiku-4-5-20251001");
  });

  it("keeps only what follows the last compact_boundary, plus preserved messages and the summary", () => {
    const session = parseClaudeTranscript(fixture("cc-compact-transcript.jsonl"));
    const keys = session.items.map((item) => item.key.split(":")[0]);
    expect(keys).toEqual(["u3", "s1", "c1", "at1", "u5", "a5", "a6"]);
    expect(session.items.find((item) => item.key === "s1:0")?.category).toBe("summary");
    expect(session.items.find((item) => item.key === "c1:text")?.category).toBe("other");
    expect(session.items.filter((item) => item.userText !== undefined).map((item) => item.userOrdinal)).toEqual([1, 2]);
    expect(session.compactedBeforeOrdinal).toBe(1);
    expect(session.compactions).toEqual([{ tokensBefore: 50_000, tokensAfter: null }]);
  });

  it("resolves tool result subjects from the matching tool_use", () => {
    const text = fixture("cc-compact-transcript.jsonl").split("\n").slice(0, 8).join("\n");
    const session = parseClaudeTranscript(text);
    const results = session.items.filter((item) => item.category === "toolResults");
    expect(results.map((item) => [item.label, item.detail])).toEqual([
      ["Read", "/repo/README.md"],
      ["Bash", "npm test -- --reporter=verbose --run all the things please …"],
    ]);
  });
});

describe("attachmentLabel", () => {
  it("turns Claude Code attachment kinds into readable labels", () => {
    expect(attachmentLabel("sandbox_instructions")).toBe("Sandbox instructions");
    expect(attachmentLabel("mcp_instructions_delta")).toBe("MCP instructions (update)");
    expect(attachmentLabel("environment")).toBe("Environment");
  });
});

describe("toolSubject", () => {
  it("picks the path, command or pattern", () => {
    expect(toolSubject("read", { path: "/a/SKILL.md" })).toBe("/a/SKILL.md");
    expect(toolSubject("grep", { pattern: "foo.*bar", path: "." })).toBe("foo.*bar");
    expect(toolSubject("find", { pattern: "*.ts" })).toBe("*.ts");
    expect(toolSubject("bash", { command: "x".repeat(100) })).toHaveLength(60);
  });
});
