import { describe, expect, it } from "vitest";
import { deriveNotifications, unreadCount, INFO_WINDOW_MS, type NotificationPurchaseRow } from "./notifications";

const NOW = new Date("2026-11-03T12:00:00Z").getTime();
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();

function purchase(over: Partial<NotificationPurchaseRow>): NotificationPurchaseRow {
  return { id: "p1", title: "Bags", status: "draft", total_minor: 7500, currency: "CAD", updated_at: iso(0), ...over };
}

describe("deriveNotifications", () => {
  it("marks a failed outgoing payment as urgent", () => {
    const n = deriveNotifications({ purchases: [purchase({ status: "failed" })], changeRequests: [], now: NOW });
    expect(n).toHaveLength(1);
    expect(n[0]?.priority).toBe("urgent");
    expect(n[0]?.title).toBe("Outgoing payment failed");
  });

  it("marks verification, approval, clarification and blocked as action required", () => {
    for (const status of ["verification_required", "approval_required", "needs_clarification", "blocked"]) {
      const n = deriveNotifications({ purchases: [purchase({ status })], changeRequests: [], now: NOW });
      expect(n[0]?.priority).toBe("action");
    }
  });

  it("uses factual labels, never fraud verdicts", () => {
    const n = deriveNotifications({
      purchases: [purchase({ status: "verification_required" }), purchase({ id: "p2", status: "blocked" })],
      changeRequests: [{ id: "c1", status: "pending_verification", created_at: iso(0), supplierName: "Harbourside" }],
      now: NOW,
    });
    const text = n.map((x) => `${x.title} ${x.detail}`).join(" ");
    expect(text).not.toMatch(/fake|fraud|real supplier|safe to pay/i);
  });

  it("drops informational events older than the window but keeps actionable ones", () => {
    const old = iso(INFO_WINDOW_MS + 1000);
    const n = deriveNotifications({
      purchases: [
        purchase({ id: "old-paid", status: "paid", updated_at: old }),
        purchase({ id: "old-blocked", status: "blocked", updated_at: old }),
      ],
      changeRequests: [],
      now: NOW,
    });
    expect(n.map((x) => x.key)).toEqual(["purchase:old-blocked:blocked"]);
  });

  it("deduplicates repeated events with the same key", () => {
    const n = deriveNotifications({
      purchases: [purchase({ status: "blocked" }), purchase({ status: "blocked" })],
      changeRequests: [],
      now: NOW,
    });
    expect(n).toHaveLength(1);
  });

  it("sorts urgent before action before update, newest first within a priority", () => {
    const n = deriveNotifications({
      purchases: [
        purchase({ id: "a", status: "paid" }),
        purchase({ id: "b", status: "failed", updated_at: iso(60_000) }),
        purchase({ id: "c", status: "blocked" }),
      ],
      changeRequests: [],
      now: NOW,
    });
    expect(n.map((x) => x.key)).toEqual(["purchase:b:failed", "purchase:c:blocked", "purchase:a:paid"]);
  });

  it("links each notification to its exact record", () => {
    const n = deriveNotifications({ purchases: [purchase({ id: "p9", status: "blocked" })], changeRequests: [], now: NOW });
    expect(n[0]?.link).toEqual({ kind: "purchase", id: "p9" });
  });
});

describe("unreadCount", () => {
  it("counts only notifications whose key is not read", () => {
    const n = deriveNotifications({
      purchases: [purchase({ id: "a", status: "blocked" }), purchase({ id: "b", status: "failed" })],
      changeRequests: [],
      now: NOW,
    });
    expect(unreadCount(n, new Set())).toBe(2);
    expect(unreadCount(n, new Set(["purchase:a:blocked"]))).toBe(1);
    expect(unreadCount(n, new Set(["purchase:a:blocked", "purchase:b:failed"]))).toBe(0);
  });
});
