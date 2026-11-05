import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/lib/org";
import { ToneBadge } from "@/components/brand";

/**
 * Separates "the request passed its checks" from "this business can actually pay".
 * A recipient that matches a supplier record is not proof that a Sandbox merchant
 * has been configured for the selected business.
 */
export function PaymentReadiness({ supplierId, supplierMerchant }: { supplierId: string | null; supplierMerchant: string | null }) {
  const org = useOrg();
  const cfg = useQuery({
    queryKey: ["merchant-config", org.orgId],
    queryFn: async () => {
      const { data, error } = await supabase.from("paypal_merchant_configs").select("merchant_id, supplier_id, cad_confirmed").eq("org_id", org.orgId).maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  if (cfg.isLoading) return null;
  const c = cfg.data;
  const missing: { text: string; link?: boolean }[] = [];
  if (!c) missing.push({ text: "No PayPal Sandbox business account has been configured for this business.", link: true });
  else {
    if (!c.cad_confirmed) missing.push({ text: "CAD has not been confirmed for this business's Sandbox account.", link: true });
    if (supplierId && c.supplier_id !== supplierId) missing.push({ text: "The Sandbox account is configured for a different supplier than this request.", link: true });
    if (supplierMerchant && c.merchant_id.toLowerCase() !== supplierMerchant.toLowerCase()) missing.push({ text: "The supplier's approved recipient does not match the configured Sandbox Merchant ID." });
  }
  if (!org.has("payer", "owner")) missing.push({ text: "Your account needs the Payer or Business owner role in this business." });

  return (
    <div className="mt-4 space-y-2 rounded-md border bg-secondary/40 p-3 text-sm">
      <div className="flex flex-wrap gap-2">
        <ToneBadge tone="success">Request checks passed</ToneBadge>
        {missing.length ? <ToneBadge tone="warning">Payment setup incomplete</ToneBadge> : <ToneBadge tone="success">Payment setup complete</ToneBadge>}
      </div>
      {missing.length > 0 && (
        <>
          <p className="text-muted-foreground">Payment for <span className="font-semibold text-foreground">{org.orgName}</span> stays locked until:</p>
          <ul className="list-disc space-y-1 pl-5">
            {missing.map((m) => (
              <li key={m.text}>{m.text}{m.link && org.has("owner") && <> <Link to="/settings" className="font-medium text-brand-deep underline">Open Team & integrations</Link></>}</li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">A recipient that matches a supplier record does not prove that a Sandbox merchant is set up for this business.</p>
        </>
      )}
    </div>
  );
}
