import { describe, expect, it } from "vitest";
import { makeMeter } from "./fixtures";

describe("keepWindowWhileRecomputing", () => {
  it("keeps the previous window size while the new session has no measurement", async () => {
    const { keepWindowWhileRecomputing } = await import("../../src/ui/data");
    const before = makeMeter();
    const after = makeMeter({}, { contextWindow: null, autoCompactAt: null, recomputing: true, basis: "estimated" });
    expect(keepWindowWhileRecomputing(before, after).window).toMatchObject({ contextWindow: 200_000, autoCompactAt: 167_000, basis: "estimated" });
    expect(keepWindowWhileRecomputing(null, after).window.contextWindow).toBeNull();
    const settled = makeMeter({}, { contextWindow: null, recomputing: false });
    expect(keepWindowWhileRecomputing(before, settled).window.contextWindow).toBeNull();
  });

  it("prefers the window the backend reports while recomputing", async () => {
    const { keepWindowWhileRecomputing } = await import("../../src/ui/data");
    const before = makeMeter();
    const after = makeMeter({}, { contextWindow: 1_000_000, autoCompactAt: null, recomputing: true, basis: "estimated" });
    expect(keepWindowWhileRecomputing(before, after).window).toMatchObject({ contextWindow: 1_000_000, autoCompactAt: null });
  });
});
