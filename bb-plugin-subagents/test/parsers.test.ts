import { describe, expect, it } from "vitest";
import { applyEvents, parseLaunchResult, parseLaunches, parseStatusRef, turnActive } from "../src/events";
import { appendSession, emptySession, encodeCwd, parseSession } from "../src/session";
import { appendTranscript, emptyTranscript, parseTranscript, summarizeToolCall, tailEntries, transcriptPrompt } from "../src/transcript";
import { fixture, fixtureEvents, lines } from "./fakes";

describe("parseLaunches", () => {
  it("reads background launches, their ids, output files and get_subagent_result statuses", () => {
    const state = parseLaunches(fixtureEvents("probe-events.json"));
    const launches = [...state.launches.values()];
    expect(launches.map((launch) => [launch.callId, launch.description, launch.type, launch.agentId, launch.background])).toEqual([
      ["daf579d39d-i1", "count files", "Explore", "3a2ff4b2-3d37-45c", true],
      ["daf579d39d-i2", "read readme", "Explore", "27e7abbc-45cf-47d", true],
    ]);
    expect(launches[0]?.outputFile).toBe(
      "/var/folders/hb/z0645d0501q_35ylknn4gl3c0000gn/T/pi-subagents-501/private-tmp-wt-demo/01a112d8-24e3-74f4-8ac4-0f1c30093e1e/tasks/3a2ff4b2-3d37-45c.output",
    );
    expect(state.statusRefs.get("27e7abbc-45cf-47d")?.status).toBe("completed");
    expect(state.providerThreadIds).toEqual(["pi_f7522fe0-34e0-44a8-9ce8-aad83df06b33"]);
    expect(turnActive(state)).toBe(false);
  });

  it("reads a foreground launch: no agent id in the result, the report inline", () => {
    const state = parseLaunches(fixtureEvents("foreground-events.json"));
    const [launch] = [...state.launches.values()];
    expect(launch).toMatchObject({ callId: "da8aac31f0-i45", requestedBackground: false, background: false, agentId: null });
    expect(launch?.resultText).toMatch(/^Agent completed in 29\.7s/);
    expect(state.providerThreadIds).toEqual(["pi_b8f629db-1e91-404b-a066-47c0c8740a13", "thr_gtg4kt23i2"]);
  });

  it("is incremental: applying a prefix then the rest equals applying everything", () => {
    const rows = fixtureEvents("probe-events.json");
    const whole = parseLaunches(rows);
    const split = parseLaunches(rows.slice(0, 5));
    expect(turnActive(split)).toBe(true);
    applyEvents(split, rows);
    expect([...split.launches.values()]).toEqual([...whole.launches.values()]);
    expect(turnActive(split)).toBe(false);
  });

  it("parses launch and status texts", () => {
    expect(parseLaunchResult("Agent queued in background.\nAgent ID: abc\nType: X\n")).toEqual({
      agentId: "abc",
      outputFile: null,
      background: true,
    });
    expect(parseStatusRef("Agent: abc\nType: Explore | Status: stopped (STOPPED…) | Tool uses: 2")).toEqual({
      agentId: "abc",
      status: "stopped",
    });
  });
});

describe("transcript", () => {
  it("parses turns, tool calls with results, model and the final text; dedupes the doubled prompt", () => {
    const state = parseTranscript(fixture("probe-27e7abbc.output"));
    expect(state.agentId).toBe("27e7abbc-45cf-47d");
    expect(state.turns).toBe(3);
    expect(state.toolCalls).toBe(3);
    expect(state.model).toBe("claude-sonnet-5-5");
    expect(state.lastStopReason).toBe("stop");
    expect(state.entries.map((entry) => entry.kind)).toEqual(["prompt", "tool", "tool", "tool", "text"]);
    expect(state.entries[2]).toMatchObject({ kind: "tool", name: "bash", summary: "bash: sleep 30", result: "(no output)" });
    expect(state.lastActivity).toMatch(/^`\/private\/tmp\/wt-demo\/README\.md` contains/);
    expect(state.startedAt).toBe("2026-10-06T20:12:02.306Z");
  });

  it("reads byte chunks incrementally, holding back a partial line", () => {
    const text = fixture("foreground-b0a2601e.output");
    const bytes = Buffer.from(text, "utf8");
    const whole = parseTranscript(text);
    const state = emptyTranscript();
    for (const cut of [1, 700, 701, 5000, 9000, bytes.length]) {
      appendTranscript(state, bytes.subarray(state.offset, cut));
    }
    expect(state.offset).toBe(bytes.length);
    expect(state.entries).toEqual(whole.entries);
    expect(state.turns).toBe(whole.turns);
    expect(whole.turns).toBe(6);
    expect(whole.toolCalls).toBe(7);
  });

  it("tracks nested Agent calls and their background ids", () => {
    const transcript = [
      { message: { role: "user", content: "parent task" }, timestamp: "t0", agentId: "parent" },
      {
        message: {
          role: "assistant",
          content: [
            { type: "toolCall", id: "c1", name: "Agent", arguments: { description: "child", subagent_type: "Explore", prompt: "p1" } },
          ],
          stopReason: "toolUse",
        },
        timestamp: "t1",
      },
      {
        message: { role: "toolResult", toolCallId: "c1", content: [{ type: "text", text: "Nested agent started in background. Agent ID: kid-1" }] },
        timestamp: "t2",
      },
    ]
      .map((entry) => JSON.stringify(entry))
      .join("\n");
    const state = parseTranscript(transcript);
    expect(state.nested).toEqual([
      expect.objectContaining({ callId: "c1", description: "child", background: true, agentId: "kid-1", resultText: null }),
    ]);
  });

  it("summarizes tool calls and reads an output file's prompt", () => {
    expect(summarizeToolCall("read", { path: "/a/b" })).toBe("read: /a/b");
    expect(summarizeToolCall("custom", { x: 1, query: "hello\nworld" })).toBe("custom: hello");
    expect(summarizeToolCall("noargs", {})).toBe("noargs");
    expect(transcriptPrompt(lines(fixture("probe-3a2ff4b2.output"))[0] ?? "")).toMatch(/^Count the files/);
  });

  it("keeps the prompt when tailing", () => {
    const { entries } = parseTranscript(fixture("foreground-b0a2601e.output"));
    const tail = tailEntries(entries, 3);
    expect(tail.truncated).toBe(true);
    expect(tail.entries.map((entry) => entry.kind)).toEqual(["prompt", "tool", "text"]);
  });
});

describe("session", () => {
  it("reads the header and subagents:record entries", () => {
    const state = parseSession(fixture("probe-session.jsonl"));
    expect(state.sessionId).toBe("01a112d8-24e3-74f4-8ac4-0f1c30093e1e");
    expect(state.cwd).toBe("/private/tmp/wt-demo");
    expect([...state.records.keys()]).toEqual(["3a2ff4b2-3d37-45c", "27e7abbc-45cf-47d"]);
    expect(state.records.get("3a2ff4b2-3d37-45c")).toMatchObject({ status: "completed", completedAt: 1791317547729 });
    expect(state.agentResults.map((result) => [result.agentId, result.modelName, result.status])).toEqual([
      ["3a2ff4b2-3d37-45c", "sonnet 5.5 1m", "background"],
      ["27e7abbc-45cf-47d", "sonnet 5.5 1m", "background"],
    ]);
  });

  it("finds a foreground agent id only in the persisted tool result", () => {
    const state = emptySession();
    const bytes = Buffer.from(fixture("foreground-session.jsonl"), "utf8");
    appendSession(state, bytes.subarray(0, 200));
    appendSession(state, bytes.subarray(state.offset));
    expect(state.agentResults).toEqual([
      expect.objectContaining({ agentId: "b0a2601e-c4a4-483", description: "Survey pi extensions' integration points", status: "completed" }),
    ]);
    expect(state.records.get("b0a2601e-c4a4-483")?.status).toBe("completed");
  });

  it("encodes a cwd like pi-subagents", () => {
    expect(encodeCwd("/private/tmp/wt-demo")).toBe("private-tmp-wt-demo");
    expect(encodeCwd("/Users/andraspalasti/fun/agent")).toBe("Users-andraspalasti-fun-agent");
  });
});
