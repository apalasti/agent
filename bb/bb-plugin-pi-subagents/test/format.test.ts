import { describe, expect, it } from "vitest";
import { firstLine } from "../src/text";
import { clock, duration, elapsed, kTokens, shortModel } from "../src/ui/format";

describe("shortModel", () => {
  it("shows Claude ids as a capitalised family and dotted version, without provider or date", () => {
    expect(shortModel("claude-bridge/claude-sonnet-5-5")).toBe("Sonnet 5.5");
    expect(shortModel("claude-bridge/claude-haiku-5-5")).toBe("Haiku 5.5");
    expect(shortModel("claude-haiku-5-5")).toBe("Haiku 5.5");
    expect(shortModel("claude-opus-4-1-20250805")).toBe("Opus 4.1");
    expect(shortModel("claude-sonnet-4-20250514")).toBe("Sonnet 4");
  });

  it("keeps a 1m context suffix as 1M", () => {
    expect(shortModel("claude-opus-4-6[1m]")).toBe("Opus 4.6 1M");
    expect(shortModel("claude-bridge/claude-sonnet-5-5-1m")).toBe("Sonnet 5.5 1M");
  });

  it("passes other ids through minus the provider prefix, and reports a missing model as inherited", () => {
    expect(shortModel("openai/gpt-5.1-codex")).toBe("gpt-5.1-codex");
    expect(shortModel("haiku")).toBe("haiku");
    expect(shortModel(null)).toBe("inherited");
  });
});

describe("duration", () => {
  it("formats seconds, minutes and hours", () => {
    expect(duration(0)).toBe("0s");
    expect(duration(59_400)).toBe("59s");
    expect(duration(511_000)).toBe("8m 31s");
    expect(duration(3_725_000)).toBe("1h 2m");
  });

  it("shows a dash for unknown or negative spans", () => {
    expect(duration(null)).toBe("–");
    expect(duration(-5)).toBe("–");
  });
});

describe("kTokens", () => {
  it("shows thousands with one decimal and millions likewise", () => {
    expect(kTokens(999)).toBe("999");
    expect(kTokens(1_000)).toBe("1k");
    expect(kTokens(162_345)).toBe("162.3k");
    expect(kTokens(200_000)).toBe("200k");
    expect(kTokens(999_960)).toBe("1M");
    expect(kTokens(1_250_000)).toBe("1.3M");
    expect(kTokens(null)).toBe("–");
  });
});

describe("elapsed", () => {
  it("runs to the end, or to now while unfinished, and is absent without a start", () => {
    expect(elapsed(0, 511_000, 900_000)).toBe("8m 31s");
    expect(elapsed(0, null, 12_000)).toBe("12s");
    expect(elapsed(null, null, 12_000)).toBeNull();
  });
});

describe("text", () => {

  it("takes the first non-empty line", () => {
    expect(firstLine("\n  \n  Found 3 files.\nMore")).toBe("Found 3 files.");
    expect(firstLine("")).toBe("");
  });

  it("formats a clock time with seconds", () => {
    expect(clock(new Date(2026, 9, 8, 9, 5, 7).getTime())).toMatch(/09:05:07/);
  });
});
