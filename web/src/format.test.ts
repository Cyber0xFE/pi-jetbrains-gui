import { describe, expect, it } from "vitest";
import { formatCost, formatTokens } from "./format";

describe("formatTokens", () => {
  it("matches the TUI footer thresholds", () => {
    expect(formatTokens(0)).toBe("0");
    expect(formatTokens(999)).toBe("999");
    expect(formatTokens(1_200)).toBe("1.2k");
    expect(formatTokens(9_999)).toBe("10.0k");
    expect(formatTokens(100_000)).toBe("100k");
    expect(formatTokens(524_000)).toBe("524k");
    expect(formatTokens(1_300_000)).toBe("1.3M");
    expect(formatTokens(13_000_000)).toBe("13M");
  });
});

describe("formatCost", () => {
  it("keeps three decimals", () => {
    expect(formatCost(0.043)).toBe("$0.043");
    expect(formatCost(1.5)).toBe("$1.500");
  });
});
