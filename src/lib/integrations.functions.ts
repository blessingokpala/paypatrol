import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { authenticateSandbox } from "@/lib/paypal.server";

// Reports whether integration secrets exist, never their values. Owners only.
// Later: PayPal Orders v2 create/capture and Gemini calls live in protected
// server functions next to this file; the browser never holds these secrets.
export const getIntegrationStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { orgId: string }) => z.object({ orgId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: isOwner, error } = await context.supabase.rpc("has_org_role", { _org: data.orgId, _role: "owner" });
    if (error || !isOwner) throw new Error("Only owners can view integration settings");
    const clientId = process.env["PAYPAL_CLIENT_ID"];
    const clientSecret = process.env["PAYPAL_CLIENT_SECRET"];
    const paypal = clientId && clientSecret
      ? await authenticateSandbox(clientId, clientSecret)
      : { connected: false as const, reason: "Sandbox credentials have not been configured." };
    return {
      paypal: paypal.connected,
      paypalCheck: paypal,
      checkoutEnabled: false,
      gemini: Boolean(process.env["GEMINI_API_KEY"]),
    };
  });
