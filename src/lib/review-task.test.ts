import { describe, expect, it } from "vitest";
import { currentReviewTask, supplierConfirmationSupported } from "./review-task";
const p = { status: "verification_required", version: 1, requested_by: "submitter", requested_recipient: "TESTONLY00001" };
const c = { status: "pending_verification", proposed_by: "submitter", proposed_recipient: "TESTONLY00001" };
describe("current tasks are independent from unread events", () => {
  it("keeps an open supplier task even when its notification was read", () => expect(currentReviewTask("supplier_review", p, c, "reviewer", true)).toBe(true));
  it("excludes the requester", () => expect(currentReviewTask("supplier_review", p, c, "submitter", true)).toBe(false));
  it("excludes superseded recipient proposals", () => expect(currentReviewTask("supplier_review", { ...p, requested_recipient: "NEW" }, c, "reviewer", true)).toBe(false));
  it("resolved spending alerts are not current tasks", () => expect(currentReviewTask("spending_review", { ...p, status: "cleared_for_checkout" }, null, "reviewer", true)).toBe(false));
  it("requires review permission", () => expect(currentReviewTask("supplier_review", p, c, "reviewer", false)).toBe(false));
});
describe("supplier final confirmation", () => {
  it("never supports TESTONLY00001", () => expect(supplierConfirmationSupported("verified_pending_decision", "TESTONLY00001", "TESTONLY00001", ["TESTONLY00001"], true)).toBe(false));
  it("requires the configured Sandbox merchant and a confirmed check", () => expect(supplierConfirmationSupported("verified_pending_decision", "L8SVBX42QHT3U", "L8SVBX42QHT3U", ["L8SVBX42QHT3U"], true)).toBe(true));
  it("a denied check cannot confirm", () => expect(supplierConfirmationSupported("verified_pending_decision", "L8SVBX42QHT3U", "L8SVBX42QHT3U", [], true)).toBe(false));
});