import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrg, useProfiles } from "@/lib/org";
import { useRefreshAll } from "@/lib/queries";
import { formatMinor } from "@/lib/money";
import { EmptyState, FixtureTag, PageHeader, Panel, ToneBadge } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/approvals")({
  head: () => ({ meta: [{ title: "Approvals — PayPatrol" }, { name: "description", content: "Approve exact request versions." }, { property: "og:title", content: "Approvals — PayPatrol" }, { property: "og:description", content: "Review approvals bound to exact PayPatrol request versions." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  component: Approvals,
});

function Approvals() {
  const org = useOrg();
  const names = useProfiles(org.orgId).data ?? {};
  const refresh = useRefreshAll();
  const q = useQuery({
    queryKey: ["approval-queue", org.orgId],
    queryFn: async () => {
      const { data, error } = await supabase.from("purchases").select("*, suppliers(name), supplier_versions(version, paypal_merchant_id), spending_policies(version)").eq("org_id", org.orgId).eq("status", "approval_required").order("created_at");
      if (error) throw error;
      const ids = (data ?? []).map((p) => p.id);
      const f = ids.length ? await supabase.from("findings").select("*").in("purchase_id", ids) : { data: [] };
      return (data ?? []).map((p) => ({ ...p, findings: (f.data ?? []).filter((x) => x.purchase_id === p.id && x.purchase_version === p.version) }));
    },
  });
  const [notes, setNotes] = useState<Record<string, string>>({});

  async function approve(id: string, version: number) {
    const { error } = await supabase.rpc("approve_purchase", { _pid: id, _version: version, _note: notes[id] ?? "" });
    if (error) { toast.error(error.message); return; }
    toast.success("Approved this exact version");
    refresh();
  }

  return (
    <>
      <PageHeader title="Approvals" description="Each approval is bound to one version. Any change to amount, currency, recipient, supplier record or rules cancels it. Approval cannot override a hard limit." />
      {!org.has("payer", "owner") && <p className="mb-4 rounded-md bg-warning-soft p-3 text-sm text-warning">You can view this queue but only payers or owners can approve.</p>}
      {q.isLoading ? <p className="text-sm">Loading…</p> : (q.data ?? []).length === 0 ? <EmptyState>No requests awaiting approval.</EmptyState> : (
        <div className="space-y-4">
          {(q.data ?? []).map((p) => {
            const sv = p.supplier_versions as { version: number; paypal_merchant_id: string } | null;
            const own = p.requested_by === org.userId;
            return (
              <Panel key={p.id} title={p.title} actions={<Link to="/purchases/$id" params={{ id: p.id }} className="text-sm text-brand-bright underline">Full review</Link>}>
                {p.is_test_fixture && <div className="mb-2"><FixtureTag /></div>}
                <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                  <div><dt className="text-muted-foreground">Request version</dt><dd className="font-semibold">v{p.version}</dd></div>
                  <div><dt className="text-muted-foreground">Amount</dt><dd className="font-semibold">{formatMinor(p.total_minor, p.currency)}</dd></div>
                  <div><dt className="text-muted-foreground">Currency</dt><dd>{p.currency}</dd></div>
                  <div><dt className="text-muted-foreground">Recipient</dt><dd className="font-mono text-xs">{p.requested_recipient}</dd></div>
                  <div><dt className="text-muted-foreground">Supplier</dt><dd>{(p.suppliers as { name: string } | null)?.name} (record v{sv?.version})</dd></div>
                  <div><dt className="text-muted-foreground">Rules version</dt><dd>v{(p.spending_policies as { version: number } | null)?.version}</dd></div>
                  <div><dt className="text-muted-foreground">Requested by</dt><dd>{names[p.requested_by] ?? "—"}</dd></div>
                  <div><dt className="text-muted-foreground">Fingerprint</dt><dd className="font-mono text-xs">{p.digest?.slice(0, 12)}</dd></div>
                </dl>
                <ul className="mt-3 space-y-1 text-sm">
                  {p.findings.map((f) => <li key={f.id}><ToneBadge tone="info">Note</ToneBadge> {f.message}</li>)}
                </ul>
                {org.has("payer", "owner") && (own ? (
                  <p className="mt-3 text-sm text-muted-foreground">You submitted this request. Another payer must approve it.</p>
                ) : (
                  <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-end">
                    <Textarea aria-label="Approval note" placeholder="Optional note" value={notes[p.id] ?? ""} onChange={(e) => setNotes({ ...notes, [p.id]: e.target.value })} className="sm:max-w-md" />
                    <Button onClick={() => approve(p.id, p.version)}>Approve v{p.version} for {formatMinor(p.total_minor, p.currency)}</Button>
                  </div>
                ))}
              </Panel>
            );
          })}
        </div>
      )}
    </>
  );
}
