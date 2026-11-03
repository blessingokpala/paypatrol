import { describe, expect, it } from "vitest";
import { formatMinor, parseToMinor } from "./money";

describe("money helpers use integer minor units", () => {
  it("parses CA$75 as 7500 cents", () => {
    expect(parseToMinor("75")).toBe(7500);
    expect(parseToMinor("CA$75.00")).toBe(7500);
  });
  it("parses 0.1 + 0.2 style values without float error", () => {
    expect(parseToMinor("80.10")).toBe(8010);
    expect(parseToMinor("0.3")).toBe(30);
  });
  it("rejects more than two decimal places and text", () => {
    expect(parseToMinor("1.005")).toBeNull();
    expect(parseToMinor("abc")).toBeNull();
    expect(parseToMinor("-5")).toBeNull();
  });
  it("formats 18000 as CA$180.00", () => {
    expect(formatMinor(18000, "CAD")).toBe("CA$180.00");
  });
});
