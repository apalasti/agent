import { describe, expect, it } from "vitest";
import { contextWindow, parseTranscript, summarizeTool } from "../src/transcript";
import { fixture, lines } from "./fakes";

const SCRATCH = "/Users/andraspalasti/.bb/plugins/environment-git-worktree/host-data/worktrees/thr_yvvz3re3yb-1/agent/bb/bb-plugin-subagents-prototype/SCRATCH-fields.md";
const PROTOTYPE = "/Users/andraspalasti/.bb/plugins/environment-git-worktree/host-data/worktrees/thr_yvvz3re3yb-1/agent/bb/bb-plugin-subagents-prototype";

const subagent = (name: string) => parseTranscript(fixture(`${name}.jsonl`), { sidechain: true });
const withoutHandback = (text: string) => lines(text).filter((line) => !line.includes("SubagentHandback") && !line.includes("Report delivered")).join("\n");

describe("parseTranscript on a subagent", () => {
  it("reads steps with results, errors, the prompt and the handback report", () => {
    const transcript = subagent("subagent-errors");
    expect(transcript.prompt).toMatch(/^Read-only\. This is a paced demo/);
    expect(transcript.steps.map((step) => [step.kind, step.name, step.isError])).toEqual([
      ["tool", "Bash", true],
      ["text", "text", false],
      ["tool", "Bash", false],
      ["tool", "Bash", false],
      ["tool", "Bash", true],
      ["tool", "Bash", false],
      ["tool", "SubagentHandback", false],
    ]);
    expect(transcript.steps[4]).toMatchObject({
      summary: "Run false as the expected-failure step",
      result: "Exit code 1",
      at: Date.parse("2026-10-08T17:28:05.683Z"),
      endAt: Date.parse("2026-10-08T17:28:06.259Z"),
    });
    expect(transcript.handedBack).toBe(true);
    expect(transcript.report).toMatch(/^There are 17 entries in the agent skills directory/);
    expect(transcript.toolUseIds.has("toolu_01JoknJk4QLditqzhbJt6jsy")).toBe(true);
    expect(transcript.firstAt).toBe(Date.parse("2026-10-08T17:27:53.792Z"));
    expect(transcript.endedTurn).toBe(false);
  });

  it("falls back to the last text as the report when nothing was handed back", () => {
    const transcript = parseTranscript(withoutHandback(fixture("subagent-errors.jsonl")), { sidechain: true });
    expect(transcript.handedBack).toBe(false);
    expect(transcript.report).toMatch(/^The harness blocked the `sleep` prefix/);
  });

  it("is no longer handed back once a follow-up makes it call tools again", () => {
    const resumed = JSON.stringify({
      type: "assistant",
      timestamp: "2026-10-08T18:00:00.000Z",
      message: { role: "assistant", model: "claude-haiku-5-5", content: [{ type: "tool_use", id: "toolu_resumed", name: "Read", input: { file_path: "/tmp/x" } }] },
    });
    const transcript = parseTranscript(`${fixture("subagent-errors.jsonl")}\n${resumed}`, { sidechain: true });
    expect(transcript.handedBack).toBe(false);
  });

  it("leaves an in-flight tool with no result and no end", () => {
    const all = lines(fixture("subagent-writes.jsonl"));
    const beforeBashResult = all.slice(0, all.findIndex((line) => line.includes('"tool_use_id": "toolu_011tu5kuEMpi3XZKzQ2A8C2A"')));
    const transcript = parseTranscript(beforeBashResult.join("\n"), { sidechain: true });
    expect(transcript.steps.at(-1)).toMatchObject({ name: "Bash", result: null, endAt: null, summary: "Count lines in the scratch fields file" });
    expect(transcript.report).toBeNull();
  });

  it("derives file changes from Write and Edit inputs", () => {
    expect(subagent("subagent-writes").files).toEqual([{ path: SCRATCH, added: 21 + 7, removed: 2 }]);
  });

  it("reads the real model id and latest context", () => {
    const transcript = subagent("subagent-writes");
    expect(transcript.model).toBe("claude-haiku-5-5");
    expect(transcript.context).toBe(27122);
  });

  it("skips sidechain lines unless asked for them", () => {
    expect(parseTranscript(fixture("subagent-writes.jsonl"), { sidechain: false }).steps).toEqual([]);
  });

  it("summarizes text and commands by their first non-blank line", () => {
    const said = JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "\n\n  Checking the tests.\nMore" }] } });
    expect(parseTranscript(said, { sidechain: false }).steps[0]?.summary).toBe("Checking the tests.");
    expect(summarizeTool("Bash", { command: "\nnpm test" })).toBe("npm test");
  });

  it("ignores blank and malformed lines", () => {
    const transcript = parseTranscript(`\nnot json\n${fixture("subagent-writes.jsonl")}`, { sidechain: true });
    expect(transcript.steps).toHaveLength(subagent("subagent-writes").steps.length);
  });
});

describe("parseTranscript on a lead", () => {
  const lead = parseTranscript(fixture("lead.jsonl"), { sidechain: false });

  it("takes file changes from structuredPatch, create content and bashEditDiff", () => {
    expect(lead.files).toEqual([
      { path: `${PROTOTYPE}/src/contract.ts`, added: 10, removed: 0 },
      { path: `${PROTOTYPE}/server.ts`, added: 1, removed: 1 },
      { path: `${PROTOTYPE}/README.md`, added: 4, removed: 2 },
    ]);
  });

  it("keeps the latest context apart from the peak", () => {
    expect(lead.context).toBe(69858);
    expect(lead.peakContext).toBe(111817);
    expect(lead.model).toBe("claude-opus-5-5");
  });

  it("has no report and notices the turn ended", () => {
    expect(lead.report).toBeNull();
    expect(lead.endedTurn).toBe(true);
  });

  it("ignores synthetic model ids", () => {
    const synthetic = JSON.stringify({ type: "assistant", message: { model: "<synthetic>", content: [] } });
    expect(parseTranscript(`${fixture("lead.jsonl")}\n${synthetic}`, { sidechain: false }).model).toBe("claude-opus-5-5");
  });
});

describe("summarizeTool", () => {
  it.each([
    ["Bash", { description: "Run tests", command: "npm test" }, "Run tests"],
    ["Bash", { command: "cd /repo && npm test\nnpm run lint" }, "npm test"],
    ["Bash", { command: "cd /repo; ls" }, "ls"],
    ["Read", { file_path: "/a.ts" }, "/a.ts"],
    ["MultiEdit", { file_path: "/b.ts", edits: [] }, "/b.ts"],
    ["Grep", { pattern: "foo", path: "src" }, "foo in src"],
    ["Glob", { pattern: "**/*.ts" }, "**/*.ts"],
    ["Agent", { description: "Explore code" }, "Explore code"],
    ["Task", { description: "Old name" }, "Old name"],
    ["WebFetch", { url: "https://x.dev" }, "https://x.dev"],
    ["WebSearch", { query: "vitest each" }, "vitest each"],
    ["SubagentHandback", { message: "long report" }, "report back"],
    ["TodoWrite", { todos: [] }, '{"todos":[]}'],
  ])("%s %j → %s", (name, input, summary) => {
    expect(summarizeTool(name, input)).toBe(summary);
  });

  it("clips unknown tool input", () => {
    expect(summarizeTool("Custom", { blob: "x".repeat(500) })).toHaveLength(121);
  });
});

describe("contextWindow", () => {
  it("is 200k by default, 1M for [1m] models or usage beyond 200k", () => {
    expect(contextWindow("claude-haiku-5-5", 150_000)).toBe(200_000);
    expect(contextWindow(null, 0)).toBe(200_000);
    expect(contextWindow("claude-opus-5-5[1m]", 10)).toBe(1_000_000);
    expect(contextWindow("claude-opus-5-5", 200_001)).toBe(1_000_000);
  });
});
