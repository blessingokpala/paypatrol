import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { merchantIdSchema, validateOrder, type PaymentSnapshot } from "./paypal-contract";
import { sandboxToken, sandboxRequest, reconcileSandboxOrder } from "./paypal.server";

const purchaseInput = z.object({ purchaseId: z.string().uuid() });

export const configureSandboxMerchant = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { orgId: string; supplierId: string; merchantId: string; cadConfirmed: boolean }) => z.object({ orgId: z.string().uuid(), supplierId: z.string().uuid(), merchantId: merchantIdSchema, cadConfirmed: z.literal(true) }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: owner } = await context.supabase.rpc("has_org_role", { _org: data.orgId, _role: "owner" });
    if (!owner) throw new Error("Only an owner can configure the Sandbox supplier");
    // Authentication-method time is signed by the auth service, not supplied by the browser.
    const claims = context.claims as { amr?: { method: string; timestamp: number }[] };
    const recent = claims.amr?.some(a => ["password", "oauth", "totp"].includes(a.method) && a.timestamp * 1000 > Date.now() - 300000 && a.timestamp * 1000 <= Date.now() + 30000);
    if (!recent) throw new Error("Confirm your recent PayPatrol sign-in before configuring the supplier");
    const clientId = process.env["PAYPAL_CLIENT_ID"], secret = process.env["PAYPAL_CLIENT_SECRET"];
    if (!clientId || !secret) throw new Error("Sandbox credentials are missing");
    await sandboxToken(clientId, secret);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.rpc("configure_sandbox_merchant", { _org: data.orgId, _supplier: data.supplierId, _merchant: data.merchantId, _actor: context.userId });
    if (error) throw new Error(error.message);
    return { configured: true, merchantId: data.merchantId, cadConfirmed: true, orderValidated: false };
  });

export const getCheckoutState = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth]).inputValidator((input: { purchaseId: string }) => purchaseInput.parse(input))
  .handler(async ({ data, context }) => {
    const { data: purchase } = await context.supabase.from("purchases").select("id,org_id,status,total_minor,currency,requested_recipient,supplier_id").eq("id", data.purchaseId).single();
    if (!purchase) throw new Error("Request not available");
    const { data: payer } = await context.supabase.rpc("has_org_role", { _org: purchase.org_id, _role: "payer" });
    const { data: owner } = await context.supabase.rpc("has_org_role", { _org: purchase.org_id, _role: "owner" });
    if (!payer && !owner) throw new Error("Only payers can open checkout");
    const { data: config } = await context.supabase.from("paypal_merchant_configs").select("merchant_id,supplier_id,cad_confirmed,order_validated_at").eq("org_id", purchase.org_id).maybeSingle();
    const { data: attempt } = await context.supabase.from("payment_attempts").select("id,status,purchase_id").eq("purchase_id", purchase.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
    const { data: order } = attempt ? await context.supabase.from("paypal_orders").select("paypal_order_id").eq("payment_attempt_id", attempt.id).maybeSingle() : { data: null };
    return { configured: Boolean(config?.cad_confirmed && config.merchant_id === purchase.requested_recipient && config.supplier_id === purchase.supplier_id), clientId: process.env["PAYPAL_CLIENT_ID"] ?? null, attempt, orderId: order?.paypal_order_id ?? null, purchaseStatus: purchase.status };
  });

export const createSandboxOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth]).inputValidator((input: { purchaseId: string }) => purchaseInput.parse(input))
  .handler(async ({ data, context }) => {
    const clientId = process.env["PAYPAL_CLIENT_ID"], secret = process.env["PAYPAL_CLIENT_SECRET"];
    if (!clientId || !secret) throw new Error("Sandbox credentials missing");
    const { data: raw, error } = await context.supabase.rpc("begin_sandbox_payment", { _pid: data.purchaseId });
    if (error || !raw) throw new Error(error?.message ?? "Payment controls refused checkout");
    const attempt = raw as unknown as PaymentSnapshot;
    const { data: existing } = await context.supabase.from("paypal_orders").select("paypal_order_id").eq("payment_attempt_id", attempt.id).maybeSingle();
    if (existing) return { orderId: existing.paypal_order_id };
    // PayPal keeps request IDs for a bounded period. Never reissue an old ambiguous create after it expires.
    if (attempt.status !== "creating" || Date.now() - new Date(attempt.created_at).getTime() > 5 * 3600000) throw new Error("Existing payment needs reconciliation; do not start another payment");
    const token = await sandboxToken(clientId, secret);
    const value = `${Math.floor(attempt.amount_minor / 100)}.${String(attempt.amount_minor % 100).padStart(2, "0")}`;
    const order = validateOrder(await sandboxRequest(token, "/v2/checkout/orders", "POST", {
      intent: "CAPTURE", purchase_units: [{ reference_id: attempt.id, custom_id: attempt.digest, invoice_id: `${attempt.purchase_id}-v${attempt.purchase_version}`, payee: { merchant_id: attempt.merchant_id }, amount: { currency_code: attempt.currency, value } }],
      payment_source: { paypal: { experience_context: { shipping_preference: "NO_SHIPPING", user_action: "PAY_NOW" } } },
    }, `create-${attempt.idempotency_key}`), attempt);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const saved = await supabaseAdmin.rpc("record_sandbox_order", { _attempt: attempt.id, _order: order.id, _status: order.status, _merchant: attempt.merchant_id, _amount: attempt.amount_minor, _currency: attempt.currency });
    if (saved.error) throw new Error("PayPal order confirmation could not be saved. Reconcile the existing attempt.");
    return { orderId: order.id };
  });

export const captureSandboxOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth]).inputValidator((input: { purchaseId: string }) => purchaseInput.parse(input))
  .handler(async ({ data, context }) => {
    const { data: attempts } = await context.supabase.from("payment_attempts").select("*").eq("purchase_id", data.purchaseId).order("created_at", { ascending: false }).limit(1);
    const candidate = attempts?.[0];
    if (!candidate) throw new Error("No payment attempt exists");
    const { data: raw, error } = await context.supabase.rpc("prepare_sandbox_capture", { _attempt: candidate.id });
    if (error || !raw) throw new Error(error?.message ?? "Capture refused");
    const attempt = raw as unknown as PaymentSnapshot & { execute_capture: boolean };
    const { data: stored } = await context.supabase.from("paypal_orders").select("paypal_order_id").eq("payment_attempt_id", attempt.id).single();
    if (!stored) throw new Error("No verified PayPal order exists");
    const clientId = process.env["PAYPAL_CLIENT_ID"], secret = process.env["PAYPAL_CLIENT_SECRET"];
    if (!clientId || !secret) throw new Error("Sandbox credentials missing");
    const token = await sandboxToken(clientId, secret);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    try {
      const order = validateOrder(await sandboxRequest(token, `/v2/checkout/orders/${stored.paypal_order_id}`), attempt);
      if (order.purchase_units[0]?.payments?.captures?.length || !attempt.execute_capture) return await reconcileSandboxOrder(supabaseAdmin, token, attempt, order.id);
      if (order.status !== "APPROVED") {
        await supabaseAdmin.rpc("reset_uncaptured_sandbox_attempt", { _attempt: attempt.id });
        return { status: "pending" as const, orderId: order.id, captureId: null };
      }
      await sandboxRequest(token, `/v2/checkout/orders/${order.id}/capture`, "POST", {}, `capture-${attempt.idempotency_key}`);
      return await reconcileSandboxOrder(supabaseAdmin, token, attempt, order.id);
    } catch {
      await supabaseAdmin.rpc("mark_sandbox_uncertain", { _attempt: attempt.id });
      return { status: "pending" as const, orderId: stored.paypal_order_id, captureId: null };
    }
  });

export const reconcileSandboxPayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth]).inputValidator((input: { purchaseId: string }) => purchaseInput.parse(input))
  .handler(async ({ data, context }) => {
    const { data: purchase } = await context.supabase.from("purchases").select("org_id").eq("id", data.purchaseId).single();
    if (!purchase) throw new Error("Request not available");
    const { data: owner } = await context.supabase.rpc("has_org_role", { _org: purchase.org_id, _role: "owner" });
    const { data: payer } = await context.supabase.rpc("has_org_role", { _org: purchase.org_id, _role: "payer" });
    if (!owner && !payer) throw new Error("Payer required");
    const { data: attempts } = await context.supabase.from("payment_attempts").select("*").eq("purchase_id", data.purchaseId).order("created_at", { ascending: false }).limit(1);
    const raw = attempts?.[0];
    if (!raw) throw new Error("No existing attempt");
    const { data: order } = await context.supabase.from("paypal_orders").select("paypal_order_id").eq("payment_attempt_id", raw.id).single();
    if (!order) return { status: "pending" as const, orderId: null, captureId: null };
    const clientId = process.env["PAYPAL_CLIENT_ID"], secret = process.env["PAYPAL_CLIENT_SECRET"];
    if (!clientId || !secret) throw new Error("Sandbox credentials missing");
    const token = await sandboxToken(clientId, secret);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return reconcileSandboxOrder(supabaseAdmin, token, raw as unknown as PaymentSnapshot, order.paypal_order_id);
  });

export const cancelSandboxCheckout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth]).inputValidator((input: { purchaseId: string }) => purchaseInput.parse(input))
  .handler(async ({ data, context }) => {
    const { data: attempts } = await context.supabase.from("payment_attempts").select("*").eq("purchase_id", data.purchaseId).order("created_at", { ascending: false }).limit(1);
    const attempt = attempts?.[0];
    if (!attempt) throw new Error("Payment not available");
    const { data: owner } = await context.supabase.rpc("has_org_role", { _org: attempt.org_id, _role: "owner" });
    const { data: payer } = await context.supabase.rpc("has_org_role", { _org: attempt.org_id, _role: "payer" });
    if (!owner && !payer) throw new Error("Payer required");
    if (attempt.status !== "ordered") throw new Error("Payment may be executing. Check its confirmation before cancelling.");
    const { data: order } = await context.supabase.from("paypal_orders").select("paypal_order_id").eq("payment_attempt_id", attempt.id).single();
    if (!order) throw new Error("Order is not confirmed");
    const clientId = process.env["PAYPAL_CLIENT_ID"], secret = process.env["PAYPAL_CLIENT_SECRET"];
    if (!clientId || !secret) throw new Error("Sandbox credentials missing");
    const token = await sandboxToken(clientId, secret);
    const verified = validateOrder(await sandboxRequest(token, `/v2/checkout/orders/${order.paypal_order_id}`), attempt as unknown as PaymentSnapshot);
    if (!["CREATED", "PAYER_ACTION_REQUIRED", "APPROVED"].includes(verified.status) || verified.purchase_units[0]?.payments?.captures?.length) throw new Error("Payment outcome is uncertain. Budget remains reserved.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.rpc("cancel_uncaptured_sandbox_attempt", { _attempt: attempt.id });
    if (error) throw new Error(error.message);
    return { cancelled: true };
  });