import { describe, expect, it } from "vitest";
import { changesFromArgs, contextWindow, parsePiSession, summarizeTool } from "../src/piSession";
import { DEMO_CHILD_SESSION, SUBAGENTS_AGENT, SUBAGENTS_SESSION, fixture } from "./fakes";

const message = (timestamp: string, body: Record<string, unknown>) => JSON.stringify({ type: "message", timestamp, message: body });

describe("parsePiSession", () => {
  it("reads a real workflow child session", () => {
    const transcript = parsePiSession(fixture(`sessions/${DEMO_CHILD_SESSION}`));
    expect(transcript).toMatchObject({
      sessionId: "01a11d13-7360-771f-b48d-25439b8dfd46",
      parentSession: "/Users/andraspalasti/.bb/pi-bridge-sessions/pi_e6c62b6b-9ba7-4f95-85af-6183a2877e86.jsonl",
      name: "Explore#ca7df9fa",
      cwd: "/Users/andraspalasti/fun/agent",
      model: "claude-bridge/claude-sonnet-5-5",
      context: 8899,
      peakContext: 8899,
      totalTokens: 9663,
      firstAt: Date.parse("2026-10-08T19:52:56.416Z"),
      lastAt: Date.parse("2026-10-08T19:53:04.170Z"),
      endedTurn: true,
      files: [],
    });
    expect(transcript.prompt).toMatch(/^Read-only\. Look at the path "agents"/);
    expect(transcript.report).toMatch(/^The `agents` directory holds Markdown definitions/);
    expect(transcript.steps.map((step) => [step.kind, step.name])).toEqual([
      ["tool", "bash"],
      ["tool", "bash"],
      ["tool", "StructuredOutput"],
      ["text", "text"],
    ]);
    expect(transcript.steps[0]).toMatchObject({
      at: Date.parse("2026-10-08T19:52:58.439Z"),
      endAt: Date.parse("2026-10-08T19:52:58.470Z"),
      summary: "ls -la agents && find agents -type f -not -path '*/node_modules/*' | head -50",
      isError: false,
    });
    expect(transcript.steps[0]?.result).toMatch(/^total 72/);
  });

  it("reads an Agent-tool session and its .output file alike", () => {
    const session = parsePiSession(fixture(`sessions/${SUBAGENTS_SESSION}`));
    const output = parsePiSession(fixture(`tasks/${SUBAGENTS_AGENT}.output`));
    expect(session).toMatchObject({ name: "Explore#ff796ad3", totalTokens: 49949, context: 41368, endedTurn: true });
    expect(output).toMatchObject({ sessionId: null, parentSession: null, name: null, totalTokens: 49949, context: 41368, endedTurn: true });
    expect(output.model).toBe("claude-bridge/claude-sonnet-5-5");
    expect(output.prompt).toBe(session.prompt);
    expect(output.report).toBe(session.report);
    expect(output.steps.filter((step) => step.kind === "tool")).toHaveLength(12);
    expect(session.report).toMatch(/^Findings below\./);
  });

  it("marks failed tool calls and counts file changes from successful edits and writes", () => {
    const jsonl = [
      message("2026-10-08T10:00:00Z", { role: "user", content: [{ type: "text", text: "Fix it" }] }),
      message("2026-10-08T10:00:01Z", {
        role: "assistant",
        content: [
          { type: "toolCall", id: "t1", name: "bash", arguments: { command: "npm test" } },
          { type: "toolCall", id: "t2", name: "write", arguments: { path: "/w/a.ts", content: "a\nb" } },
          { type: "toolCall", id: "t3", name: "edit", arguments: { path: "/w/a.ts", edits: [{ oldText: "a", newText: "x\ny" }] } },
          { type: "toolCall", id: "t4", name: "edit", arguments: { path: "/w/b.ts", oldText: "q", newText: "r" } },
        ],
        stopReason: "toolUse",
      }),
      message("2026-10-08T10:00:02Z", { role: "toolResult", toolCallId: "t1", toolName: "bash", content: [{ type: "text", text: "Exit 1" }], isError: true }),
      message("2026-10-08T10:00:03Z", { role: "toolResult", toolCallId: "t2", toolName: "write", content: [{ type: "text", text: "ok" }], isError: false }),
      message("2026-10-08T10:00:04Z", { role: "toolResult", toolCallId: "t3", toolName: "edit", content: [{ type: "text", text: "ok" }], isError: false }),
      message("2026-10-08T10:00:05Z", { role: "toolResult", toolCallId: "t4", toolName: "edit", content: [{ type: "text", text: "no match" }], isError: true }),
      message("2026-10-08T10:00:06Z", { role: "assistant", content: [], stopReason: "aborted" }),
    ].join("\n");
    const transcript = parsePiSession(jsonl);
    expect(transcript.steps.map((step) => step.isError)).toEqual([true, false, false, true]);
    expect(transcript.files).toEqual([{ path: "/w/a.ts", added: 4, removed: 1 }]);
    expect(transcript).toMatchObject({ prompt: "Fix it", report: null, endedTurn: false, model: null });
  });

  it("keeps the peak context across a smaller later call and skips unreadable lines", () => {
    const usage = (input: number, cacheRead: number) => ({ input, output: 10, cacheRead, cacheWrite: 0 });
    const jsonl = [
      message("2026-10-08T10:00:00Z", { role: "assistant", content: [], usage: usage(5, 300_000) }),
      "{not json",
      message("2026-10-08T10:00:01Z", { role: "assistant", content: [], usage: usage(5, 1_000) }),
      '{"type":"message","message":{"role":"assi',
    ].join("\n");
    expect(parsePiSession(jsonl)).toMatchObject({ context: 1_005, peakContext: 300_005, totalTokens: 30 });
  });

  it("takes the model from model_change until an assistant reports one", () => {
    const change = JSON.stringify({ type: "model_change", timestamp: "2026-10-08T10:00:00Z", provider: "claude-bridge", modelId: "claude-haiku-5-5" });
    expect(parsePiSession(change).model).toBe("claude-bridge/claude-haiku-5-5");
  });
});

describe("summarizeTool", () => {
  it.each([
    ["bash", { command: "cd /w && npm test\nmore" }, "npm test"],
    ["read", { path: "/w/a.ts", offset: 3 }, "/w/a.ts"],
    ["edit", { path: "/w/a.ts", edits: [] }, "/w/a.ts"],
    ["write", { path: "/w/b.ts", content: "" }, "/w/b.ts"],
    ["grep", { pattern: "foo", path: "src" }, "foo in src"],
    ["find", { pattern: "*.ts" }, "*.ts"],
    ["ls", { path: "/w" }, "/w"],
    ["Agent", { description: "Map it", prompt: "…" }, "Map it"],
    ["SubagentWorkflow", { script: "export const meta = { name: 'demo-repo-tour' }" }, "demo-repo-tour"],
    ["SubagentWorkflow", { scriptPath: "/t/wf_1.workflow.js" }, "wf_1.workflow.js"],
    ["SubagentWorkflow", {}, "workflow"],
    ["get_subagent_result", { agent_id: "ff796ad3-63be-402", wait: true }, "ff796ad3-63be-402"],
    ["steer_subagent", { agent_id: "ff796ad3-63be-402", message: "stop" }, "ff796ad3-63be-402"],
    ["StructuredOutput", { file: "a" }, '{"file":"a"}'],
  ])("summarizes %s", (name, args, summary) => {
    expect(summarizeTool(name, args)).toBe(summary);
  });
});

describe("changesFromArgs", () => {
  it("counts written lines, edit blocks and legacy edits", () => {
    expect(changesFromArgs("write", { path: "/a", content: "1\n2\n3" })).toEqual([{ path: "/a", added: 3, removed: 0 }]);
    expect(changesFromArgs("edit", { path: "/a", edits: [{ oldText: "1\n2", newText: "3" }, { oldText: "", newText: "4\n5" }] })).toEqual([
      { path: "/a", added: 3, removed: 2 },
    ]);
    expect(changesFromArgs("edit", { path: "/a", oldText: "1", newText: "2\n3" })).toEqual([{ path: "/a", added: 2, removed: 1 }]);
    expect(changesFromArgs("bash", { command: "rm /a" })).toEqual([]);
    expect(changesFromArgs("write", { content: "x" })).toEqual([]);
  });
});

describe("contextWindow", () => {
  it("is 1M for a 1m model hint, a [1m] id or a peak past 200k, else 200k", () => {
    expect(contextWindow("claude-bridge/claude-sonnet-5-5", 50_000, "sonnet 5.5 1m")).toBe(1_000_000);
    expect(contextWindow("claude-opus-4-6[1m]", 50_000)).toBe(1_000_000);
    expect(contextWindow("claude-bridge/claude-opus-5-5", 200_001)).toBe(1_000_000);
    expect(contextWindow("claude-bridge/claude-opus-5-5", 200_000, "opus 5.5")).toBe(200_000);
    expect(contextWindow(null, 0, null)).toBe(200_000);
  });
});
