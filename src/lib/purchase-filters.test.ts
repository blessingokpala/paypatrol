import { describe, expect, it } from "vitest";
import { applyPurchaseFilters, type FilterableRow } from "./purchase-filters";

const r = (o: Partial<FilterableRow> & { title: string }): FilterableRow => ({
  invoice_reference: null, supplier_id: null, suppliers: null, source: "invoice", status: "blocked",
  created_at: "2026-11-03T12:00:00Z", total_minor: 1000, ...o,
});
const rows = [
  r({ title: "Bags", invoice_reference: "PP-CHECKOUT-20261103", supplier_id: "s1", suppliers: { name: "Harbourside Packaging Co." }, status: "verification_required", total_minor: 7500, created_at: "2026-11-03T15:00:00Z" }),
  r({ title: "Lids", source: "ai_proposal", total_minor: 50000, created_at: "2026-11-01T15:00:00Z" }),
  r({ title: "Cups", source: "ai_proposal", supplier_id: "s1", suppliers: { name: "Harbourside Packaging Co." }, total_minor: 2500, created_at: "2026-11-02T15:00:00Z" }),
];

describe("purchase search and filters", () => {
  it("searches titles, invoice references and supplier names", () => {
    expect(applyPurchaseFilters(rows, { q: "checkout-2026" }).map((p) => p.title)).toEqual(["Bags"]);
    expect(applyPurchaseFilters(rows, { q: "harbourside" }).map((p) => p.title)).toEqual(["Bags", "Cups"]);
    expect(applyPurchaseFilters(rows, { q: "lids" }).map((p) => p.title)).toEqual(["Lids"]);
  });
  it("combines search, source tab, status and supplier", () => {
    expect(applyPurchaseFilters(rows, { q: "harbourside", source: "ai_proposal", status: "blocked", supplier: "s1" }).map((p) => p.title)).toEqual(["Cups"]);
    expect(applyPurchaseFilters(rows, { supplier: "unmatched" }).map((p) => p.title)).toEqual(["Lids"]);
  });
  it("filters by inclusive submission-date range", () => {
    expect(applyPurchaseFilters(rows, { dfrom: "2026-11-02", dto: "2026-11-02" }).map((p) => p.title)).toEqual(["Cups"]);
  });
  it("defaults to newest first and sorts by amount", () => {
    expect(applyPurchaseFilters(rows, {}).map((p) => p.title)).toEqual(["Bags", "Cups", "Lids"]);
    expect(applyPurchaseFilters(rows, { sort: "amount_desc" }).map((p) => p.title)).toEqual(["Lids", "Bags", "Cups"]);
    expect(applyPurchaseFilters(rows, { sort: "amount_asc" }).map((p) => p.title)).toEqual(["Cups", "Bags", "Lids"]);
  });
  it("returns nothing when no row matches", () => {
    expect(applyPurchaseFilters(rows, { q: "zzz" })).toEqual([]);
  });
});
