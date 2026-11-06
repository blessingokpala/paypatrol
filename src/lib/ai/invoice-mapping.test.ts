import { describe, expect, it } from "vitest";
import { extractionSchema } from "./schemas";
import { mapExtraction } from "./invoice-mapping";

const allowed = ["packaging", "cleaning", "office"];

describe("invoice reading → form mapping", () => {
  it("keeps the payee name out of the merchant ID field", () => {
    const m = mapExtraction(extractionSchema.parse({ payment_recipient_name: "Willow Peak Retail Supplies (fictional)", paypal_merchant_id: "TESTONLY00001" }), allowed);
    expect(m.recipient).toBe("TESTONLY00001");
    expect(m.recipientName).toBe("Willow Peak Retail Supplies (fictional)");
  });

  it("never puts a name into the merchant ID, even if the model does", () => {
    const m = mapExtraction(extractionSchema.parse({ paypal_merchant_id: "Willow Peak Retail Supplies (fictional)" }), allowed);
    expect(m.recipient).toBe("");
    expect(m.recipientName).toBe("Willow Peak Retail Supplies (fictional)");
  });

  it("does not substitute a permitted category for one the rules do not allow", () => {
    const m = mapExtraction(extractionSchema.parse({ category_stated: "retail supplies" }), allowed);
    expect(m.category).toBe("");
    expect(m.categoryStated).toBe("retail supplies");
    expect(m.categoryPermitted).toBe(false);
  });

  it("fills a stated category that the rules permit", () => {
    expect(mapExtraction(extractionSchema.parse({ category_stated: "Packaging" }), allowed).category).toBe("packaging");
  });
});
