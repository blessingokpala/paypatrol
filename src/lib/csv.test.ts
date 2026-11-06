import { describe, expect, it } from "vitest";
import { csvCell } from "./csv";

describe("spreadsheet export safety", () => {
  it("neutralizes formula-leading invoice references", () => {
    expect(csvCell('=HYPERLINK("https://example.invalid")')).toBe('"\'=HYPERLINK(""https://example.invalid"")"');
  });
  it("neutralizes profile names and whitespace-prefixed formulas", () => {
    for (const value of ["+1+1", "-1+1", "@SUM(1)", "  =1+1", "\t=1+1", "\r=1+1"]) {
      expect(csvCell(value).startsWith('"\'')).toBe(true);
    }
  });
  it("preserves ordinary values and escapes quotes exactly once", () => {
    expect(csvCell('Invoice "A", CAD')).toBe('"Invoice ""A"", CAD"');
    expect(csvCell(13500)).toBe('"13500"');
    expect(csvCell(null)).toBe('""');
  });
});