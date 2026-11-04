import { formatMinor } from "@/lib/money";

/**
 * In-app notifications are derived from real records (purchases and supplier
 * change requests) using explicit event rules — never from an AI guess and
 * never generated just to fill the panel. Priority is separate from payment
 * status: it says how promptly someone should look, not what happened.
 */
export type NotificationPriority = "urgent" | "action" | "update";

export type NotificationLink = { kind: "purchase"; id: string } | { kind: "suppliers" };

export type AppNotification = {
  /** Stable per record + state, so repeated events deduplicate. */
  key: string;
  priority: NotificationPriority;
  title: string;
  detail: string;
  at: string;
  link: NotificationLink;
};

export const PRIORITY_META: Record<NotificationPriority, { label: string; order: number }> = {
  urgent: { label: "Urgent", order: 0 },
  action: { label: "Action required", order: 1 },
  update: { label: "Update", order: 2 },
};

/** Informational events stop appearing after this long; actionable ones persist until resolved. */
export const INFO_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export type NotificationPurchaseRow = {
  id: string;
  title: string;
  status: string;
  total_minor: number;
  currency: string;
  updated_at: string;
};

export type NotificationChangeRow = {
  id: string;
  status: string;
  created_at: string;
  supplierName: string | null;
};

export function deriveNotifications(input: {
  purchases: NotificationPurchaseRow[];
  changeRequests: NotificationChangeRow[];
  now?: number;
}): AppNotification[] {
  const now = input.now ?? Date.now();
  const out: AppNotification[] = [];

  for (const p of input.purchases) {
    const amount = formatMinor(p.total_minor, p.currency);
    const base = { at: p.updated_at, link: { kind: "purchase", id: p.id } as NotificationLink };
    const recent = now - new Date(p.updated_at).getTime() <= INFO_WINDOW_MS;
    switch (p.status) {
      case "failed":
        out.push({ ...base, key: `purchase:${p.id}:failed`, priority: "urgent", title: "Outgoing payment failed", detail: `${p.title} · ${amount} — review the failure before trying again.` });
        break;
      case "verification_required":
        out.push({ ...base, key: `purchase:${p.id}:verification_required`, priority: "action", title: "Payment details need verification", detail: `${p.title} · ${amount} — an independent reviewer must confirm the change.` });
        break;
      case "approval_required":
        out.push({ ...base, key: `purchase:${p.id}:approval_required`, priority: "action", title: "Approval required", detail: `${p.title} · ${amount} is waiting for a payer's approval.` });
        break;
      case "needs_clarification":
        out.push({ ...base, key: `purchase:${p.id}:needs_clarification`, priority: "action", title: "Information missing", detail: `${p.title} · ${amount} — correct the missing details.` });
        break;
      case "blocked":
        out.push({ ...base, key: `purchase:${p.id}:blocked`, priority: "action", title: "Blocked by spending rules", detail: `${p.title} · ${amount} breaks a spending rule.` });
        break;
      case "payment_pending":
        if (recent) out.push({ ...base, key: `purchase:${p.id}:payment_pending`, priority: "update", title: "Payment confirmation pending", detail: `${p.title} · ${amount} — waiting for the PayPal outcome.` });
        break;
      case "paid":
        if (recent) out.push({ ...base, key: `purchase:${p.id}:paid`, priority: "update", title: "Outgoing payment completed", detail: `${p.title} · ${amount} was paid.` });
        break;
      case "cleared_for_checkout":
        if (recent) out.push({ ...base, key: `purchase:${p.id}:cleared_for_checkout`, priority: "update", title: "Ready for checkout", detail: `${p.title} · ${amount} passed all checks.` });
        break;
      default:
        break;
    }
  }

  for (const c of input.changeRequests) {
    const who = c.supplierName ? ` for ${c.supplierName}` : "";
    if (c.status === "pending_verification") {
      out.push({ key: `change:${c.id}:pending_verification`, priority: "action", title: "Supplier payment details changed", detail: `A recipient change${who} is waiting for independent verification.`, at: c.created_at, link: { kind: "suppliers" } });
    } else if (c.status === "verified_pending_decision") {
      out.push({ key: `change:${c.id}:verified_pending_decision`, priority: "action", title: "Supplier change awaiting decision", detail: `A verified change${who} needs an approver's decision.`, at: c.created_at, link: { kind: "suppliers" } });
    }
  }

  const seen = new Set<string>();
  return out
    .filter((n) => (seen.has(n.key) ? false : (seen.add(n.key), true)))
    .sort((a, b) => PRIORITY_META[a.priority].order - PRIORITY_META[b.priority].order || b.at.localeCompare(a.at));
}

export function unreadCount(notifications: AppNotification[], readKeys: Set<string>): number {
  return notifications.filter((n) => !readKeys.has(n.key)).length;
}
