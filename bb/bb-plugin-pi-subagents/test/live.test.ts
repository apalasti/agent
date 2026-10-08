import { describe, expect, it } from "vitest";
import { contextTone, liveState } from "../src/ui/live";
import { makeAgent, makeStep, T0 } from "./uiFixtures";

describe("liveState", () => {
  it("is starting since the agent started when there are no steps", () => {
    expect(liveState(makeAgent("a", { status: "running", steps: [] }), T0 + 5_000)).toEqual({
      label: "starting",
      since: T0,
      inFlight: false,
    });
  });

  it("falls back to now when the start time is unknown", () => {
    expect(liveState(makeAgent("a", { startedAt: null }), T0 + 5_000).since).toBe(T0 + 5_000);
  });

  it("is in flight on an unfinished tool call", () => {
    const steps = [makeStep(), makeStep({ at: T0 + 2_000, endAt: null, name: "Grep", summary: "TODO in src", result: null })];
    expect(liveState(makeAgent("a", { steps }), T0 + 9_000)).toEqual({
      label: "Grep: TODO in src",
      since: T0 + 2_000,
      inFlight: true,
    });
  });

  it("is thinking since the last step ended", () => {
    const steps = [makeStep({ at: T0, endAt: T0 + 3_000 })];
    expect(liveState(makeAgent("a", { steps }), T0 + 9_000)).toEqual({ label: "thinking", since: T0 + 3_000, inFlight: false });
  });

  it("is thinking since a text step began when it has no end", () => {
    const steps = [makeStep({ kind: "text", at: T0 + 4_000, endAt: null, result: null })];
    expect(liveState(makeAgent("a", { steps }), T0 + 9_000)).toEqual({ label: "thinking", since: T0 + 4_000, inFlight: false });
  });
});

describe("contextTone", () => {
  it("is ok under 60%, warn from 60% to 85%, critical above", () => {
    expect(contextTone(119_999, 200_000)).toBe("ok");
    expect(contextTone(120_000, 200_000)).toBe("warn");
    expect(contextTone(170_000, 200_000)).toBe("warn");
    expect(contextTone(170_001, 200_000)).toBe("critical");
  });

  it("treats an empty window as ok", () => {
    expect(contextTone(10, 0)).toBe("ok");
  });
});
