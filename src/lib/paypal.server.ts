import { validateOrder, type PaymentSnapshot } from "./paypal-contract";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

const SANDBOX_API = "https://api-m.sandbox.paypal.com";

export async function sandboxToken(clientId: string, clientSecret: string): Promise<string> {
  const response = await fetch(`${SANDBOX_API}/v1/oauth2/token`, {
    method: "POST", headers: { Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials", signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error("PayPal Sandbox authentication was refused");
  const body = await response.json() as { access_token?: string };
  if (!body.access_token) throw new Error("PayPal did not confirm authentication");
  return body.access_token;
}

export async function sandboxRequest(token: string, path: string, method = "GET", body?: unknown, requestId?: string) {
  const response = await fetch(`${SANDBOX_API}${path}`, {
    method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Prefer: "return=representation", ...(requestId ? { "PayPal-Request-Id": requestId } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error(`PayPal Sandbox request was not confirmed (${response.status})`);
  return response.json() as Promise<unknown>;
}

export async function reconcileSandboxOrder(admin: SupabaseClient<Database>, token: string, attempt: PaymentSnapshot, orderId: string) {
  return recordVerifiedSandboxOrder(admin, attempt, orderId, await sandboxRequest(token, `/v2/checkout/orders/${encodeURIComponent(orderId)}`));
}

export async function recordVerifiedSandboxOrder(admin: SupabaseClient<Database>, attempt: PaymentSnapshot, orderId: string, raw: unknown) {
  const order = validateOrder(raw, attempt, orderId);
  const capture = order.purchase_units[0]?.payments?.captures?.[0];
  if (capture && ["COMPLETED", "PENDING"].includes(capture.status)) {
    const { error } = await admin.rpc("record_sandbox_capture", { _attempt: attempt.id, _order: order.id, _capture: capture.id, _status: capture.status, _merchant: attempt.merchant_id, _amount: attempt.amount_minor, _currency: attempt.currency });
    if (error) throw new Error("Payment confirmation could not be recorded safely");
    return { status: capture.status === "COMPLETED" ? "paid" as const : "pending" as const, orderId: order.id, captureId: capture.id };
  }
  // DENIED/DECLINED: never marks Paid and never releases budget; the reservation
  // stays held for owner review because the provider outcome is not a completed payment.
  if (capture && ["DENIED", "DECLINED"].includes(capture.status)) return { status: "declined" as const, orderId: order.id, captureId: capture.id };
  return { status: "pending" as const, orderId: order.id, captureId: null };
}

// No tokens are persisted or returned to the browser. A successful OAuth check
// proves credential acceptance, not merchant ownership or CAD capability.
export async function authenticateSandbox(clientId: string, clientSecret: string) {
  try {
    const response = await fetch(`${SANDBOX_API}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) return { connected: false as const, reason: "PayPal Sandbox authentication was refused. Check the Sandbox app credentials." };
    const body: unknown = await response.json();
    if (!body || typeof body !== "object" || !("access_token" in body) || typeof body.access_token !== "string" || !body.access_token) {
      return { connected: false as const, reason: "PayPal did not confirm Sandbox authentication." };
    }
    return { connected: true as const, checkedAt: new Date().toISOString() };
  } catch {
    return { connected: false as const, reason: "PayPal Sandbox could not be reached. Try again." };
  }
}