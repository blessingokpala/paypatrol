type Purchase = { status: string; version: number; requested_by: string; requested_recipient?: string | null };
type Change = { status: string; proposed_by: string; proposed_recipient: string };
export function currentReviewTask(kind: string, purchase: Purchase | null, change: Change | null, userId: string, hasRole: boolean): boolean {
  if (!hasRole || !purchase || purchase.requested_by === userId) return false;
  if (kind === "spending_review") return purchase.status === "approval_required";
  return kind === "supplier_review" && !!change && change.proposed_by !== userId &&
    ["pending_verification", "verified_pending_decision"].includes(change.status) &&
    !["paid", "cancelled", "failed"].includes(purchase.status) &&
    (purchase.requested_recipient ?? "").trim().toLowerCase() === change.proposed_recipient.trim().toLowerCase();
}
export function supplierConfirmationSupported(status: string, proposed: string, merchant: string | null, confirmedRecipients: string[], isSandbox: boolean): boolean {
  if (status !== "verified_pending_decision" || /^(TEST|DEMO-|NEW-MERCHANT)/i.test(proposed)) return false;
  if (isSandbox && (!merchant || proposed.trim().toUpperCase() !== merchant.trim().toUpperCase())) return false;
  return confirmedRecipients.some(r => r.trim().toUpperCase() === proposed.trim().toUpperCase());
}