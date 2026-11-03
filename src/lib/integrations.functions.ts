import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// Reports whether integration secrets exist, never their values. Owners only.
// Later: PayPal Orders v2 create/capture and Gemini calls live in protected
// server functions next to this file; the browser never holds these secrets.
export const getIntegrationStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { orgId: string }) => input)
  .handler(async ({ data, context }) => {
    const { data: isOwner, error } = await context.supabase.rpc("has_org_role", { _org: data.orgId, _role: "owner" });
    if (error || !isOwner) throw new Error("Only owners can view integration settings");
    return {
      paypal: Boolean(process.env["PAYPAL_CLIENT_ID"] && process.env["PAYPAL_CLIENT_SECRET"]),
      gemini: Boolean(process.env["GEMINI_API_KEY"]),
    };
  });
