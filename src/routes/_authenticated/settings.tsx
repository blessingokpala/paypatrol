import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrg, useProfiles } from "@/lib/org";
import { getIntegrationStatus } from "@/lib/integrations.functions";
import { testAiConnection } from "@/lib/ai/ai.functions";
import { ROLE_LABELS } from "@/lib/status";
import { PageHeader, Panel, ToneBadge } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { configureSandboxMerchant } from "@/lib/paypal.functions";
import { useSuppliers } from "@/lib/queries";
import { RecentSignin } from "@/components/recent-signin";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({ meta: [{ title: "Team & integrations — PayPatrol" }, { name: "description", content: "Members, roles and integration status." }, { property: "og:title", content: "Team & integrations — PayPatrol" }, { property: "og:description", content: "PayPatrol team permissions and verified integration status." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  component: Settings,
});

const ROLES = ["owner", "preparer", "change_approver", "payer"] as const;

function Settings() {
  const org = useOrg();
  const qc = useQueryClient();
  const names = useProfiles(org.orgId).data ?? {};
  const statusFn = useServerFn(getIntegrationStatus);
  const isOwner = org.has("owner");
  const members = useQuery({
    queryKey: ["members", org.orgId],
    queryFn: async () => {
      const { data, error } = await supabase.from("memberships").select("*").eq("org_id", org.orgId);
      if (error) throw error;
      return data ?? [];
    },
  });
  const status = useQuery({ queryKey: ["integrations", org.orgId], enabled: isOwner, queryFn: () => statusFn({ data: { orgId: org.orgId } }) });
  const testFn = useServerFn(testAiConnection);
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<{ ok: boolean; text: string } | null>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<(typeof ROLES)[number]>("change_approver");
  const configureFn = useServerFn(configureSandboxMerchant);
  const suppliers = useSuppliers(org.orgId);
  const [merchantId, setMerchantId] = useState("L8SVBX42QHT3U");
  const [supplierId, setSupplierId] = useState("");
  const [cadConfirmed, setCadConfirmed] = useState(false);
  const [configuring, setConfiguring] = useState(false);

  const byUser = new Map<string, string[]>();
  for (const m of members.data ?? []) byUser.set(m.user_id, [...(byUser.get(m.user_id) ?? []), m.role]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const { error } = await supabase.rpc("add_member_by_email", { _org: org.orgId, _email: email, _role: role });
    if (error) { toast.error(error.message); return; }
    toast.success("Role added");
    setEmail("");
    qc.invalidateQueries();
  }
  async function remove(user: string, r: (typeof ROLES)[number]) {
    const { error } = await supabase.rpc("remove_member_role", { _org: org.orgId, _user: user, _role: r });
    if (error) { toast.error(error.message); return; }
    qc.invalidateQueries();
  }

  return (
    <>
      <PageHeader title="Team & integrations" description="Each person signs in with their own account. Independent review only works with separate people." />
      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Members and roles">
          <ul className="divide-y text-sm">
            {[...byUser].map(([uid, roles]) => (
              <li key={uid} className="py-3">
                <p className="font-medium">{names[uid] ?? uid.slice(0, 8)}{uid === org.userId && " (you)"}</p>
                <div className="mt-1 flex flex-wrap gap-1">
                  {roles.map((r) => (
                    <span key={r} className="inline-flex items-center gap-1 rounded bg-selected px-2 py-0.5 text-xs">
                      {ROLE_LABELS[r]}
                      {isOwner && <button aria-label={`Remove ${ROLE_LABELS[r]}`} className="font-bold" onClick={() => remove(uid, r as (typeof ROLES)[number])}>×</button>}
                    </span>
                  ))}
                </div>
              </li>
            ))}
          </ul>
          {isOwner && (
            <form onSubmit={add} className="mt-4 space-y-3 border-t pt-4">
              <div className="space-y-1"><Label htmlFor="m-email">Email of an existing account</Label><Input id="m-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></div>
              <div className="space-y-1">
                <Label htmlFor="m-role">Role</Label>
                <select id="m-role" value={role} onChange={(e) => setRole(e.target.value as (typeof ROLES)[number])} className="h-9 w-full rounded-md border border-input bg-card px-3 text-sm">
                  {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                </select>
              </div>
              <Button type="submit">Add role</Button>
            </form>
          )}
        </Panel>
        <Panel title="Integrations (restricted)">
          {!isOwner ? <p className="text-sm text-muted-foreground">Only owners can view integration settings.</p> : (
            <ul className="space-y-4 text-sm">
              <li className="space-y-2">
                <div className="flex items-start justify-between gap-3">
                  <div><p className="font-medium">Gemini (invoice extraction, proposals, explanations)</p><p className="text-xs text-muted-foreground">Server-side only. Cannot change rules, approve, verify suppliers or capture payments.</p></div>
                  {status.data?.gemini ? <ToneBadge tone="success">Key present</ToneBadge> : <ToneBadge tone="warning">AI not connected</ToneBadge>}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={testing}
                    onClick={async () => {
                      setTesting(true);
                      const out = await testFn({ data: { orgId: org.orgId } });
                      setTesting(false);
                      setTest(out.ok ? { ok: true, text: `Connected · ${out.model} · ${new Date(out.at).toLocaleString("en-CA")}` } : { ok: false, text: out.error.message });
                    }}
                  >
                    {testing ? "Testing…" : "Test connection"}
                  </Button>
                  {test && <ToneBadge tone={test.ok ? "success" : "warning"}>{test.ok ? "Connection verified" : "AI not connected"}</ToneBadge>}
                </div>
                {test && <p className="text-xs text-muted-foreground">{test.text}</p>}
                <p className="text-xs text-muted-foreground">This badge only appears after a real model request succeeds. A key being present is not a connection.</p>
              </li>
               <li className="space-y-2">
                 <div className="flex flex-wrap items-start justify-between gap-3">
                   <p className="font-medium">PayPal Sandbox</p>
                   {status.isFetching ? <ToneBadge tone="info">Checking authentication…</ToneBadge> : status.data?.paypal ? <ToneBadge tone="success">PayPal Sandbox connected</ToneBadge> : <ToneBadge tone="warning">PayPal not connected</ToneBadge>}
                 </div>
                 <p className="text-xs text-muted-foreground">{status.data?.checkoutEnabled ? `Sandbox supplier configured: ${status.data.merchant?.merchant_id}. ${status.data.merchant?.order_validated_at ? "PayPal order payee verified." : "PayPal order payee must be verified before capture."}` : "Checkout locked until an owner confirms the Sandbox supplier with recent sign-in."} A connection or order is not a completed payment.</p>
                 {status.data?.paypalCheck.connected ? <p className="text-xs text-muted-foreground">Authentication checked {new Date(status.data.paypalCheck.checkedAt).toLocaleString("en-CA")}. This is not payment confirmation.</p> : <p className="text-xs text-warning">{status.data?.paypalCheck.reason ?? (status.error ? "Could not verify the connection." : "Connection not verified.")}</p>}
                 <Button size="sm" variant="outline" disabled={status.isFetching} onClick={() => status.refetch()}>Check Sandbox connection</Button>
                 <ToneBadge tone={status.data?.webhookConfigured ? "success" : "warning"}>{status.data?.webhookConfigured ? "Webhook configured" : "Webhook registration required"}</ToneBadge>
                 <div className="space-y-3 border-t pt-3">
                   <Label htmlFor="sandbox-merchant">Sandbox Business Merchant ID</Label>
                   <Input id="sandbox-merchant" value={merchantId} onChange={e => setMerchantId(e.target.value.trim())} maxLength={13} />
                   <Label htmlFor="sandbox-supplier">Approved supplier represented by this Business account</Label>
                   <select id="sandbox-supplier" className="h-9 w-full rounded-md border border-input bg-card px-3 text-sm" value={supplierId} onChange={e => setSupplierId(e.target.value)}>
                     <option value="">Select supplier</option>
                     {(suppliers.data ?? []).filter(s => s.status === "active").map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                   </select>
                   <label className="flex items-start gap-2 text-xs"><input type="checkbox" checked={cadConfirmed} onChange={e => setCadConfirmed(e.target.checked)} />I confirmed this is the connected app’s Business account and CAD is listed in its wallet.</label>
                   <RecentSignin />
                   <Button size="sm" disabled={!supplierId || !cadConfirmed || configuring} onClick={async () => {
                     if (!confirm("Create a new Sandbox supplier baseline? Historical requested recipients will not be rewritten and open requests will be rechecked.")) return;
                     setConfiguring(true);
                     try { await configureFn({ data: { orgId: org.orgId, supplierId, merchantId, cadConfirmed } }); toast.success("Sandbox supplier configured. PayPal will validate the order payee before capture."); qc.invalidateQueries(); }
                     catch (e) { toast.error(e instanceof Error ? e.message : "Supplier configuration failed"); }
                     finally { setConfiguring(false); }
                   }}>Configure Sandbox supplier</Button>
                 </div>
              </li>
              <li className="text-xs text-muted-foreground">Secret values are never shown here.</li>
            </ul>
          )}
        </Panel>
      </div>
    </>
  );
}
