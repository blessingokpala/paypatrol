import { createFileRoute } from "@tanstack/react-router";
import { authenticateCronRequest } from "@/integrations/supabase/cron-auth";
import { sandboxToken, reconcileSandboxOrder } from "@/lib/paypal.server";
import type { PaymentSnapshot } from "@/lib/paypal-contract";

export const Route = createFileRoute("/api/public/jobs/paypal-maintenance")({ server: { handlers: { POST: async ({ request }) => {
  const failure = await authenticateCronRequest(request);
  if (failure) return failure;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: reservations } = await supabaseAdmin.from("budget_reservations").select("org_id").eq("status", "active").lt("expires_at", new Date().toISOString()).limit(100);
  for (const orgId of new Set(reservations?.map(r => r.org_id))) await supabaseAdmin.rpc("expire_safe_reservations", { _org: orgId });
  const clientId = process.env["PAYPAL_CLIENT_ID"], secret = process.env["PAYPAL_CLIENT_SECRET"];
  let reconciled = 0;
  if (clientId && secret) {
    const { data: attempts } = await supabaseAdmin.from("payment_attempts").select("*").in("status", ["capturing", "confirmation_pending"]).limit(20);
    if (attempts?.length) {
      const token = await sandboxToken(clientId, secret);
      for (const attempt of attempts) {
        const { data: order } = await supabaseAdmin.from("paypal_orders").select("paypal_order_id").eq("payment_attempt_id", attempt.id).single();
        if (!order) continue;
        try { await reconcileSandboxOrder(supabaseAdmin, token, attempt as unknown as PaymentSnapshot, order.paypal_order_id); reconciled++; } catch { /* Preserve unresolved attempts and their budget. */ }
      }
    }
  }
  return Response.json({ ok: true, reconciled });
} } } });