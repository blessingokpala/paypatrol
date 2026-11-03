import { friendlyError, humanize } from "@/lib/friendly";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/lib/org";
import { useActivePolicy, useRefreshAll, useSuppliers } from "@/lib/queries";
import { formatMinor, minorToInput, parseToMinor } from "@/lib/money";
import { PageHeader, Panel, ToneBadge } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { RecentSignin } from "@/components/recent-signin";

export const Route = createFileRoute("/_authenticated/rules")({
  head: () => ({ meta: [{ title: "Spending rules — PayPatrol" }, { name: "description", content: "Order limits, weekly limits and approval thresholds." }, { property: "og:title", content: "Spending rules — PayPatrol" }, { property: "og:description", content: "Versioned spending limits protected by recent sign-in." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  component: Rules,
});

function Rules() {
  const org = useOrg();
  const q = useActivePolicy(org.orgId);
  const sups = useSuppliers(org.orgId);
  const refresh = useRefreshAll();
  const a = q.data?.active;
  const isOwner = org.has("owner");
  const [f, setF] = useState({ currency: "", timezone: "", weekly: "", order: "", threshold: "", categories: "", suppliers: [] as string[] });
  useEffect(() => {
    if (a) setF({ currency: a.currency, timezone: a.timezone, weekly: minorToInput(a.weekly_limit_minor), order: minorToInput(a.order_limit_minor), threshold: minorToInput(a.approval_threshold_minor), categories: a.allowed_categories.join(", "), suppliers: a.allowed_supplier_ids });
  }, [a]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const w = parseToMinor(f.weekly), o = parseToMinor(f.order), t = parseToMinor(f.threshold);
    if (w === null || o === null || t === null) { toast.error("Enter amounts like 150.00"); return; }
    if (!confirm("Saving creates a new rules version and cancels approvals on all open requests. Continue?")) return;
    const { error } = await supabase.rpc("update_spending_policy", {
      _org: org.orgId, _currency: f.currency, _timezone: f.timezone, _weekly: w, _order: o, _threshold: t,
      _categories: f.categories.split(",").map((s) => s.trim()).filter(Boolean), _suppliers: f.suppliers,
    });
    if (error) { toast.error(friendlyError(error)); return; }
    toast.success("New rules version saved. Open requests were re-checked.");
    refresh();
  }

  return (
    <>
      <PageHeader title="Spending rules" description="Hard limits are enforced on the server. A purchase approver cannot override them; only an owner can change the rules, which creates a new version." />
      {a?.is_demo && <p className="mb-4 text-sm"><ToneBadge tone="neutral">Fictional demonstration settings</ToneBadge></p>}
      <div className="grid gap-6 lg:grid-cols-[2fr,1fr]">
        <Panel title={a ? `Current rules — version ${a.version}` : "No rules"}>
          <form onSubmit={save} className="grid gap-4 sm:grid-cols-2">
            <fieldset disabled={!isOwner} className="contents">
              <div className="space-y-1"><Label htmlFor="r-o">Per-order limit</Label><Input id="r-o" value={f.order} onChange={(e) => setF({ ...f, order: e.target.value })} /></div>
              <div className="space-y-1"><Label htmlFor="r-w">Weekly limit</Label><Input id="r-w" value={f.weekly} onChange={(e) => setF({ ...f, weekly: e.target.value })} /></div>
              <div className="space-y-1"><Label htmlFor="r-t">Internal approval above</Label><Input id="r-t" value={f.threshold} onChange={(e) => setF({ ...f, threshold: e.target.value })} /></div>
              <div className="space-y-1"><Label htmlFor="r-c">Currency</Label><Input id="r-c" maxLength={3} value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value })} /></div>
              <div className="space-y-1"><Label htmlFor="r-tz">Business timezone</Label><Input id="r-tz" value={f.timezone} onChange={(e) => setF({ ...f, timezone: e.target.value })} /></div>
              <div className="space-y-1"><Label htmlFor="r-cat">Allowed categories (comma-separated)</Label><Input id="r-cat" value={f.categories} onChange={(e) => setF({ ...f, categories: e.target.value })} /></div>
              <fieldset className="space-y-1 sm:col-span-2">
                <legend className="text-sm font-medium">Allowed suppliers (none selected = any approved supplier)</legend>
                {(sups.data ?? []).map((s) => (
                  <label key={s.id} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={f.suppliers.includes(s.id)} onChange={(e) => setF({ ...f, suppliers: e.target.checked ? [...f.suppliers, s.id] : f.suppliers.filter((x) => x !== s.id) })} />
                    {s.name}
                  </label>
                ))}
              </fieldset>
              {isOwner && <div className="sm:col-span-2"><RecentSignin /></div>}
              {isOwner ? <Button type="submit" className="sm:w-fit">Save as new version</Button> : <p className="text-sm text-muted-foreground sm:col-span-2">Only owners can change spending rules.</p>}
            </fieldset>
          </form>
        </Panel>
        <Panel title="Version history">
          <ul className="space-y-2 text-sm">
            {(q.data?.history ?? []).map((p) => (
              <li key={p.id} className="rounded-md border p-2">
                <strong>v{p.version}</strong> {p.is_active && <ToneBadge tone="success">Active</ToneBadge>}
                <div className="text-xs text-muted-foreground">Order {formatMinor(p.order_limit_minor, p.currency)} · Week {formatMinor(p.weekly_limit_minor, p.currency)} · Approval &gt; {formatMinor(p.approval_threshold_minor, p.currency)} · {p.timezone}</div>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </>
  );
}
