import { describe, it, expect } from "vitest";
import { formatDate } from "./shared.ts";

describe("formatDate", () => {
  it("formats a valid ISO date", () => {
    const result = formatDate("2026-07-06T10:30:00Z");
    expect(result).toContain("2026");
    expect(result).toContain("07");
    expect(result).toContain("06");
  });

  it("formats without Z suffix", () => {
    const result = formatDate("2026-01-01T00:00:00");
    expect(result).toContain("2026");
  });

  it("returns the original string for invalid dates", () => {
    const result = formatDate("not-a-date");
    expect(result).toBe("not-a-date");
  });

  it("returns the original string for empty input", () => {
    const result = formatDate("");
    expect(result).toBe("");
  });
});
