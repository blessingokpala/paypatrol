export type SpendingReviewRequest = { status: string; requested_by: string };

export function spendingReviewBlock(request: SpendingReviewRequest, userId: string, hasRole: boolean): string | null {
  if (request.status !== "approval_required") return "This request is not awaiting spending approval. See its current status and findings.";
  if (request.requested_by === userId) return "You submitted this request. A different team member with the Payer or Business owner role must approve or reject it.";
  if (!hasRole) return "The Payer or Business owner role is required to approve or reject spending in this business.";
  return null;
}

export function rejectionReasonError(reason: string): string | null {
  return reason.trim() ? null : "Enter a reason before confirming rejection.";
}