import { describe, expect, it } from "vitest";
import { fromStored, matchCategory, toStored, categoryOptions } from "./categories";

describe("purchase categories", () => {
  it("treats capitalisation as the same predefined category", () => {
    expect(matchCategory("PACKAGING")).toBe("packaging");
    expect(matchCategory("Office Supplies")).toBe("office");
  });
  it("requires wording when Other is chosen", () => {
    expect(toStored({ choice: "other", other: "  " })).toBeNull();
    expect(toStored({ choice: "other", other: " Seasonal decor " })).toBe("Seasonal decor");
  });
  it("requires a choice (no default)", () => {
    expect(toStored({ choice: "", other: "" })).toBeNull();
  });
  it("reopens a saved custom value as Other with its wording", () => {
    expect(fromStored("Seasonal decor")).toEqual({ choice: "other", other: "Seasonal decor" });
    expect(fromStored("packaging")).toEqual({ choice: "packaging", other: "" });
  });
  it("does not duplicate an existing business category that differs only by case", () => {
    expect(categoryOptions(["Packaging", "office"]).filter((o) => o.id === "packaging")).toHaveLength(1);
  });
});
