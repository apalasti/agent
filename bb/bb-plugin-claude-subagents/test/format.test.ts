import { describe, expect, it } from "vitest";
import { firstLine } from "../src/text";
import { clock, duration, kTokens, relPath, shortModel } from "../src/ui/format";

describe("shortModel", () => {
  it("drops the claude prefix and turns version dashes into a dotted version", () => {
    expect(shortModel("claude-haiku-5-5")).toBe("haiku 5.5");
    expect(shortModel("claude-opus-4-1-20250805")).toBe("opus 4.1");
    expect(shortModel("claude-sonnet-4-20250514")).toBe("sonnet 4");
    expect(shortModel("claude-opus-4-6[1m]")).toBe("opus 4.6[1m]");
  });

  it("keeps aliases and reports a missing model as inherited", () => {
    expect(shortModel("haiku")).toBe("haiku");
    expect(shortModel(null)).toBe("inherited");
  });
});

describe("duration", () => {
  it("formats seconds, minutes and hours", () => {
    expect(duration(0)).toBe("0s");
    expect(duration(59_400)).toBe("59s");
    expect(duration(80_000)).toBe("1m 20s");
    expect(duration(3_725_000)).toBe("1h 2m");
  });

  it("shows a dash for unknown or negative spans", () => {
    expect(duration(null)).toBe("–");
    expect(duration(-5)).toBe("–");
  });
});

describe("kTokens", () => {
  it("rounds to thousands from 1000 up", () => {
    expect(kTokens(999)).toBe("999");
    expect(kTokens(1_000)).toBe("1k");
    expect(kTokens(12_600)).toBe("13k");
    expect(kTokens(null)).toBe("–");
  });
});

describe("paths and text", () => {
  it("makes paths relative to the workspace, else home-relative", () => {
    expect(relPath("/w/src/a.ts", "/w")).toBe("src/a.ts");
    expect(relPath("/Users/me/notes.md", "/w")).toBe("~/notes.md");
    expect(relPath("/etc/hosts", null)).toBe("/etc/hosts");
  });

  it("takes the first non-empty line", () => {
    expect(firstLine("\n  \n  Found 3 files.\nMore")).toBe("Found 3 files.");
    expect(firstLine("")).toBe("");
  });

  it("formats a clock time with seconds", () => {
    expect(clock(new Date(2026, 9, 8, 9, 5, 7).getTime())).toMatch(/09:05:07/);
  });
});
