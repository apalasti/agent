import type { PluginRpcTestHandlers } from "@get-bb/plugin-sdk/testing/app";
import type { Category, ContextReport, CourseChange, Meter, rpcContract, Turn } from "../../src/contract";

function entry(id: string, label: string, tokens: number, detail: string | null = null, turnIndex: number | null = null) {
  return { id, label, detail, tokens, turnIndex, children: [] };
}

/** Shaped after cc-context-with-snapshot.json (Claude Code, 200k window, autocompact at 167k). */
export const CATEGORIES: Category[] = [
  { id: "system", label: "System prompt", kind: "used", tokens: 3_650, entries: [] },
  {
    id: "tools",
    label: "Tool definitions",
    kind: "used",
    tokens: 5_207,
    entries: [entry("t-bash", "Bash", 1_420), entry("t-read", "Read", 880)],
  },
  { id: "memory", label: "Memory files", kind: "used", tokens: 936, entries: [entry("m-1", "AGENTS.md", 936, "/Users/me/fun/agent/AGENTS.md")] },
  { id: "skills", label: "Skills", kind: "used", tokens: 6_333, entries: [] },
  { id: "user", label: "Your messages", kind: "used", tokens: 1_210, entries: [] },
  { id: "assistant", label: "Assistant text", kind: "used", tokens: 2_100, entries: [] },
  {
    id: "toolResults",
    label: "Tool results",
    kind: "used",
    tokens: 6_704,
    entries: [
      {
        id: "r-read",
        label: "Read",
        detail: null,
        tokens: 5_100,
        turnIndex: null,
        children: [
          { id: "r-read-1", label: "Read", detail: "/tmp/wt-demo/skills/show-me/SKILL.md", tokens: 4_100, turnIndex: 2 },
          { id: "r-read-2", label: "Read", detail: "/tmp/wt-demo/README.md", tokens: 1_000, turnIndex: 1 },
        ],
      },
      entry("r-bash", "Bash", 1_604),
    ],
  },
  { id: "reserved", label: "Autocompact buffer", kind: "reserved", tokens: 33_000, entries: [] },
  { id: "free", label: "Free space", kind: "free", tokens: 140_860, entries: [] },
  {
    id: "deferred",
    label: "Available on demand",
    kind: "deferred",
    tokens: 17_970,
    entries: [entry("d-1", "mcp__bb-bridge__update_environment_directory", 377)],
  },
];

export function makeTurn(index: number, overrides: Partial<Turn> = {}): Turn {
  return {
    index,
    requestSeq: index * 20 - 1,
    lastSeq: index * 20 + 15,
    at: `2026-10-07T10:0${index}:00.000Z`,
    preview: `Message ${index}`,
    text: `Message ${index} full text`,
    textTruncated: false,
    state: "inContext",
    tokensBefore: 16_000 + (index - 1) * 5_000,
    tokensAfter: 16_000 + index * 5_000,
    measured: true,
    largest: [],
    editable: true,
    running: false,
    ...overrides,
  };
}

export function makeCourseChange(kind: CourseChange["kind"], beforeTurnIndex: number, overrides: Partial<CourseChange> = {}): CourseChange {
  return {
    kind,
    seq: 100 + beforeTurnIndex,
    at: "2026-10-07T10:30:00.000Z",
    beforeTurnIndex,
    tokensBefore: null,
    tokensAfter: null,
    discardedTurns: null,
    sourceThreadId: null,
    ...overrides,
  };
}

export function makeMeter(overrides: Partial<Meter> = {}, window: Partial<Meter["window"]> = {}): Meter {
  return {
    threadId: "thr_1",
    providerId: "claude-code",
    threadStatus: "idle",
    window: {
      usedTokens: 26_140,
      contextWindow: 200_000,
      autoCompactAt: 167_000,
      model: "claude-haiku-4-5-20251001",
      measuredAt: "2026-10-07T10:05:00.000Z",
      basis: "measured",
      recomputing: false,
      ...window,
    },
    segments: CATEGORIES.filter((c) => (c.kind === "used" || c.kind === "reserved") && c.tokens > 0).map(({ id, label, tokens }) => ({
      id,
      label,
      tokens,
    })),
    top: [
      { id: "toolResults", label: "Tool results", tokens: 6_704 },
      { id: "skills", label: "Skills", tokens: 6_333 },
      { id: "tools", label: "Tool definitions", tokens: 5_207 },
    ],
    ...overrides,
  };
}

export function makeReport(overrides: Partial<ContextReport> = {}, window: Partial<Meter["window"]> = {}): ContextReport {
  return {
    ...makeMeter({}, window),
    categories: CATEGORIES,
    largest: [
      { id: "r-read-1", label: "Read", detail: "/tmp/wt-demo/skills/show-me/SKILL.md", tokens: 4_100, turnIndex: 2, categoryId: "toolResults" },
      { id: "r-read-2", label: "Read", detail: "/tmp/wt-demo/README.md", tokens: 1_000, turnIndex: 1, categoryId: "toolResults" },
    ],
    turns: [makeTurn(1), makeTurn(2)],
    courseChanges: [],
    source: { kind: "claude-snapshot", path: null, calibration: null },
    notes: ["Per-item numbers are estimates calibrated to bb's total"],
    ...overrides,
  };
}

export function rpcHandlers(
  overrides: Partial<PluginRpcTestHandlers<typeof rpcContract>> = {},
): PluginRpcTestHandlers<typeof rpcContract> {
  const unused = (method: string) => () => {
    throw new Error(`unexpected rpc ${method}`);
  };
  return { meter: unused("meter"), report: unused("report"), ...overrides };
}
