import { describe, expect, it } from "vitest";
import { returnLabel, safeReturn } from "./return-to";

describe("return destinations", () => {
  it("accepts internal list views with their filters", () => {
    expect(safeReturn("/purchases?status=blocked&from=%2Foverview")).toBe("/purchases?status=blocked&from=%2Foverview");
    expect(returnLabel("/purchases?status=blocked")).toBe("Back to purchases");
    expect(returnLabel("/overview")).toBe("Back to overview");
  });
  it("rejects external, protocol-relative and unknown destinations", () => {
    expect(safeReturn("https://evil.example")).toBeUndefined();
    expect(safeReturn("//evil.example/overview")).toBeUndefined();
    expect(safeReturn("/\\evil.example")).toBeUndefined();
    expect(safeReturn("/auth")).toBeUndefined();
  });
});
