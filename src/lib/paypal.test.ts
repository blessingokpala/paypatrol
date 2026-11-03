import { afterEach, describe, expect, it, vi } from "vitest";
import { authenticateSandbox, recordVerifiedSandboxOrder, reconcileSandboxOrder } from "./paypal.server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { validateOrder, type PaymentSnapshot } from "./paypal-contract";

afterEach(() => vi.unstubAllGlobals());
describe("Sandbox authentication", () => {
  it("connects only after a successful token response and never returns the token", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ access_token: "scripted-test-token" }));
    vi.stubGlobal("fetch", fetcher);
    const result = await authenticateSandbox("fixture-client", "fixture-secret");
    expect(result.connected).toBe(true);
    expect(result).not.toHaveProperty("access_token");
    expect(fetcher.mock.calls[0]?.[0]).toBe("https://api-m.sandbox.paypal.com/v1/oauth2/token");
  });
  it("does not connect on refused credentials", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 401 })));
    expect((await authenticateSandbox("fixture-client", "fixture-secret")).connected).toBe(false);
  });
  it("does not connect without an access token", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({})));
    expect((await authenticateSandbox("fixture-client", "fixture-secret")).connected).toBe(false);
  });
});

describe("authorised order comparison", () => {
  const attempt: PaymentSnapshot = { id: "attempt-1", purchase_id: "purchase-1", purchase_version: 2, amount_minor: 7500, currency: "CAD", merchant_id: "L8SVBX42QHT3U", digest: "digest-1", idempotency_key: "operation-1", status: "ordered", created_at: "2026-11-03T00:00:00Z" };
  const order = () => ({ id: "ORDER-1", status: "APPROVED", intent: "CAPTURE", purchase_units: [{ reference_id: attempt.id, custom_id: attempt.digest, invoice_id: "purchase-1-v2", payee: { merchant_id: attempt.merchant_id }, amount: { currency_code: "CAD", value: "75.00" } }] });
  it("accepts exactly CA$75 to the authorised merchant and version", () => expect(validateOrder(order(), attempt).id).toBe("ORDER-1"));
  it("rejects a changed recipient", () => { const o = order(); const u = o.purchase_units[0]; if (u) u.payee.merchant_id = "22SVBX42QHT3U"; expect(() => validateOrder(o, attempt)).toThrow(); });
  it("rejects CA$180 in place of CA$75", () => { const o = order(); const u = o.purchase_units[0]; if (u) u.amount.value = "180.00"; expect(() => validateOrder(o, attempt)).toThrow(); });
  it("rejects a stale purchase version", () => { const o = order(); const u = o.purchase_units[0]; if (u) u.invoice_id = "purchase-1-v1"; expect(() => validateOrder(o, attempt)).toThrow(); });
  it("rejects non-CAD currency", () => { const o = order(); const u = o.purchase_units[0]; if (u) u.amount.currency_code = "USD"; expect(() => validateOrder(o, attempt)).toThrow(); });
  it("rejects a different provider order ID", () => expect(() => validateOrder(order(), attempt, "OTHER-ORDER")).toThrow());
  const capturedOrder = (status = "COMPLETED", value = "75.00") => ({ ...order(), status: "COMPLETED", purchase_units: order().purchase_units.map(u => ({ ...u, payments: { captures: [{ id: "CAPTURE-1", status, amount: { currency_code: "CAD", value } }] } })) });
  function adminFixture() {
    const rpc = vi.fn().mockResolvedValue({ error: null });
    return { rpc, admin: { rpc } as unknown as SupabaseClient<Database> };
  }
  it("records Paid only from a verified completed CA$75 capture", async () => {
    const { rpc, admin } = adminFixture();
    expect((await recordVerifiedSandboxOrder(admin, attempt, "ORDER-1", capturedOrder())).status).toBe("paid");
    expect(rpc).toHaveBeenCalledWith("record_sandbox_capture", expect.objectContaining({ _capture: "CAPTURE-1", _amount: 7500, _currency: "CAD", _merchant: "L8SVBX42QHT3U", _status: "COMPLETED" }));
  });
  it("a pending capture never returns Paid", async () => {
    const { admin } = adminFixture();
    expect((await recordVerifiedSandboxOrder(admin, attempt, "ORDER-1", capturedOrder("PENDING"))).status).toBe("pending");
  });
  it("a changed actual merchant never writes payment confirmation", async () => {
    const { rpc, admin } = adminFixture(); const raw = capturedOrder();
    const unit = raw.purchase_units[0]; if (unit) unit.payee.merchant_id = "22SVBX42QHT3U";
    await expect(recordVerifiedSandboxOrder(admin, attempt, "ORDER-1", raw)).rejects.toThrow();
    expect(rpc).not.toHaveBeenCalled();
  });
  it("a wrong capture total never writes payment confirmation", async () => {
    const { rpc, admin } = adminFixture();
    await expect(recordVerifiedSandboxOrder(admin, attempt, "ORDER-1", capturedOrder("COMPLETED", "180.00"))).rejects.toThrow();
    expect(rpc).not.toHaveBeenCalled();
  });
  it("a provider timeout cannot record Paid or create a new order", async () => {
    const { rpc, admin } = adminFixture(); const fetcher = vi.fn().mockRejectedValue(new Error("Timeout")); vi.stubGlobal("fetch", fetcher);
    await expect(reconcileSandboxOrder(admin, "scripted-token", attempt, "ORDER-1")).rejects.toThrow();
    expect(rpc).not.toHaveBeenCalled(); expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]?.[1].method).toBe("GET");
  });
});