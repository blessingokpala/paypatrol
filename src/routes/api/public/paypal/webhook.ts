import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { sandboxRequest, sandboxToken, reconcileSandboxOrder } from "@/lib/paypal.server";
import type { PaymentSnapshot } from "@/lib/paypal-contract";

const eventSchema = z.object({ id: z.string().min(1).max(150), event_type: z.string().max(100), resource: z.object({ supplementary_data: z.object({ related_ids: z.object({ order_id: z.string().min(1).max(100) }) }).optional(), id: z.string().optional() }) });
export const Route = createFileRoute("/api/public/paypal/webhook")({
  server: { handlers: { POST: async ({ request }) => {
    if (!["paypal-auth-algo", "paypal-cert-url", "paypal-transmission-id", "paypal-transmission-sig", "paypal-transmission-time"].every(name => request.headers.get(name))) return new Response("Invalid signature", { status: 401 });
    const clientId = process.env["PAYPAL_CLIENT_ID"], secret = process.env["PAYPAL_CLIENT_SECRET"], webhookId = process.env["PAYPAL_WEBHOOK_ID"];
    if (!clientId || !secret || !webhookId) return new Response("Webhook not configured", { status: 503 });
    if (Number(request.headers.get("content-length") ?? 0) > 100000) return new Response("Too large", { status: 413 });
    try {
      const text = await request.text();
      if (text.length > 100000) return new Response("Too large", { status: 413 });
      const raw: unknown = JSON.parse(text);
      const event = eventSchema.parse(raw);
      const authAlgo = request.headers.get("paypal-auth-algo"), certUrl = request.headers.get("paypal-cert-url"), transmissionId = request.headers.get("paypal-transmission-id"), transmissionSig = request.headers.get("paypal-transmission-sig"), transmissionTime = request.headers.get("paypal-transmission-time");
      if (!authAlgo || !certUrl || !transmissionId || !transmissionSig || !transmissionTime) return new Response("Invalid signature", { status: 401 });
      const token = await sandboxToken(clientId, secret);
      const verified = await sandboxRequest(token, "/v1/notifications/verify-webhook-signature", "POST", { auth_algo: authAlgo, cert_url: certUrl, transmission_id: transmissionId, transmission_sig: transmissionSig, transmission_time: transmissionTime, webhook_id: webhookId, webhook_event: raw }) as { verification_status?: string };
      if (verified.verification_status !== "SUCCESS") return new Response("Invalid signature", { status: 401 });
      const orderId = event.resource.supplementary_data?.related_ids.order_id;
      if (!orderId || !["PAYMENT.CAPTURE.COMPLETED", "PAYMENT.CAPTURE.PENDING", "PAYMENT.CAPTURE.DENIED"].includes(event.event_type)) return new Response("Ignored", { status: 200 });
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: order } = await supabaseAdmin.from("paypal_orders").select("payment_attempt_id,org_id").eq("paypal_order_id", orderId).maybeSingle();
      if (!order) return new Response("Unknown payment", { status: 404 });
      const { data: attempt } = await supabaseAdmin.from("payment_attempts").select("*").eq("id", order.payment_attempt_id).eq("org_id", order.org_id).single();
      if (!attempt) return new Response("Unknown payment", { status: 404 });
      const { data: apply, error } = await supabaseAdmin.rpc("record_verified_sandbox_event", { _event: event.id, _type: event.event_type, _order: orderId });
      if (error) return new Response("Could not record event", { status: 500 });
      if (!apply) return new Response("Already processed", { status: 200 });
      await reconcileSandboxOrder(supabaseAdmin, token, attempt as unknown as PaymentSnapshot, orderId);
      const finished = await supabaseAdmin.rpc("finish_sandbox_event", { _event: event.id });
      if (finished.error) return new Response("Event processing is pending", { status: 500 });
      return new Response("Accepted", { status: 200 });
    } catch { return new Response("Webhook not confirmed", { status: 400 }); }
  } } },
});