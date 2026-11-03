export type PurchaseStatus =
  | "draft"
  | "needs_clarification"
  | "blocked"
  | "verification_required"
  | "approval_required"
  | "cleared_for_checkout"
  | "payment_pending"
  | "paid"
  | "failed"
  | "cancelled";

export type Tone = "warning" | "blocked" | "success" | "info" | "neutral";

export const STATUS_META: Record<PurchaseStatus, { label: string; tone: Tone; next: string }> = {
  draft: { label: "Draft", tone: "neutral", next: "Complete the request" },
  needs_clarification: { label: "Needs clarification", tone: "warning", next: "Correct missing details" },
  blocked: { label: "Blocked", tone: "blocked", next: "Payment unavailable — see failed rule" },
  verification_required: { label: "Verification required", tone: "warning", next: "Independent reviewer must verify" },
  approval_required: { label: "Approval required", tone: "info", next: "Payer approval needed" },
  cleared_for_checkout: { label: "Cleared for checkout", tone: "success", next: "Checkout locked pending merchant verification" },
  payment_pending: { label: "Payment pending", tone: "info", next: "Awaiting PayPal outcome" },
  paid: { label: "Paid", tone: "success", next: "None" },
  failed: { label: "Failed", tone: "blocked", next: "Review failure" },
  cancelled: { label: "Cancelled", tone: "neutral", next: "None" },
};

export const ROLE_LABELS: Record<string, string> = {
  owner: "Business owner",
  preparer: "Request preparer",
  change_approver: "Change approver",
  payer: "Payer",
};
