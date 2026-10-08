import { describe, expect, it } from "vitest";
import { formatTokens, percent, toneFor, usageLabel } from "../../src/ui/format";
import { makeMeter } from "./fixtures";

describe("formatTokens", () => {
  it.each([
    [999, "999"],
    [4_120, "4.1k"],
    [27_183, "27k"],
    [1_000_000, "1m"],
    [1_250_000, "1.3m"],
    [-31_000, "-31k"],
  ])("%d → %s", (n, expected) => {
    expect(formatTokens(n)).toBe(expected);
  });
});

describe("toneFor", () => {
  it("is muted below 60%, amber from 60%, red from 85% of the limit", () => {
    expect(toneFor(59_999, 100_000)).toBe("muted");
    expect(toneFor(60_000, 100_000)).toBe("warn");
    expect(toneFor(84_999, 100_000)).toBe("warn");
    expect(toneFor(85_000, 100_000)).toBe("danger");
    expect(toneFor(10, null)).toBe("muted");
  });
});

describe("labels", () => {
  it("shows used / window and the share, with ≈ when estimated", () => {
    expect(usageLabel(makeMeter().window, 27_183)).toBe("27k / 200k · 14%");
    expect(usageLabel(makeMeter({}, { basis: "estimated" }).window, 27_183)).toBe("≈27k / 200k · 14%");
    expect(percent(100, 200_000)).toBe("<1%");
  });
});
