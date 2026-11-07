import { describe, expect, it } from "vitest";
import { rejectionReasonError, spendingReviewBlock } from "./spending-review";

describe("spending decision eligibility", () => {
  it("allows a different eligible reviewer on an awaiting request", () => {
    expect(spendingReviewBlock({ status: "approval_required", requested_by: "requester" }, "reviewer", true)).toBeNull();
  });
  it("excludes the requester from both decisions", () => {
    expect(spendingReviewBlock({ status: "approval_required", requested_by: "requester" }, "requester", true)).not.toBeNull();
  });
  it("excludes reviewers without payer or owner permission", () => {
    expect(spendingReviewBlock({ status: "approval_required", requested_by: "requester" }, "reviewer", false)).not.toBeNull();
  });
  it.each(["blocked", "verification_required", "cleared_for_checkout", "paid", "cancelled"])("excludes %s requests from spending decisions", (status) => {
    expect(spendingReviewBlock({ status, requested_by: "requester" }, "reviewer", true)).not.toBeNull();
  });
  it("requires a non-whitespace rejection reason", () => {
    expect(rejectionReasonError(" \n ")).not.toBeNull();
    expect(rejectionReasonError("Unsupported recipient")).toBeNull();
  });
});