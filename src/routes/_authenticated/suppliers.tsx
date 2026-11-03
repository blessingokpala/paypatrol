import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrg, useProfiles } from "@/lib/org";
import { useRefreshAll, useSuppliers } from "@/lib/queries";
import { EmptyState, PageHeader, Panel, ToneBadge } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/suppliers")({
  head: () => ({ meta: [{ title: "Suppliers — PayPatrol" }, { name: "description", content: "Approved recipients, trusted contacts and version history." }, { property: "og:title", content: "Suppliers — PayPatrol" }, { property: "og:description", content: "PayPatrol approved recipient records and trusted supplier contacts." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  component: Suppliers,
});

function Suppliers() {
  const org = useOrg();
  const q = useSuppliers(org.orgId);
  const names = useProfiles(org.orgId).data ?? {};
  const refresh = useRefreshAll();
  const [adding, setAdding] = useState(false);

  async function approve(id: string) {
    const { error } = await supabase.rpc("approve_supplier_baseline", { _supplier: id });
    if (error) { toast.error(error.message); return; }
    toast.success("Supplier approved");
    refresh();
  }

  return (
    <>
      <PageHeader
        title="Suppliers"
        description="Approved payment recipients. Changes to these records only happen through independent verification."
        actions={org.has("owner") ? <Button onClick={() => setAdding(!adding)}>{adding ? "Close" : "Propose supplier"}</Button> : null}
      />
      {adding && <AddSupplier onDone={() => { setAdding(false); refresh(); }} />}
      {(q.data ?? []).length === 0 ? <EmptyState>No suppliers yet.</EmptyState> : (
        <div className="space-y-4">
          {(q.data ?? []).map((s) => {
            const c = s.current;
            return (
              <Panel key={s.id} title={s.name} actions={<ToneBadge tone={s.status === "active" ? "success" : "warning"}>{s.status === "active" ? "Approved" : s.status.replace("_", " ")}</ToneBadge>}>
                {c && (
                  <dl className="grid gap-3 text-sm sm:grid-cols-3">
                    <div><dt className="text-muted-foreground">Approved recipient</dt><dd className="font-mono text-xs">{c.paypal_merchant_id}</dd></div>
                    <div><dt className="text-muted-foreground">Trusted contact</dt><dd>{c.trusted_contact_channel}: {c.trusted_contact_value}</dd></div>
                    <div><dt className="text-muted-foreground">PayPal enrolment</dt><dd>{c.enrolment_status === "demo_fixture" ? <ToneBadge tone="neutral">Fictional demo record</ToneBadge> : c.enrolment_status === "enrolled" ? <ToneBadge tone="success">Enrolled</ToneBadge> : <ToneBadge tone="warning">{c.enrolment_status.replace("_", " ")} — unpayable</ToneBadge>}</dd></div>
                    <div className="sm:col-span-2"><dt className="text-muted-foreground">Verification evidence</dt><dd>{c.verification_evidence}</dd></div>
                    <div><dt className="text-muted-foreground">Approver</dt><dd>{c.approved_by ? names[c.approved_by] ?? "—" : s.is_demo ? "Seeded demo record" : "Pending"}{c.approved_at ? ` · ${new Date(c.approved_at).toLocaleDateString("en-CA")}` : ""}</dd></div>
                  </dl>
                )}
                {s.status === "pending_approval" && org.has("owner", "change_approver") && (
                  c?.created_by === org.userId
                    ? <p className="mt-3 text-sm text-muted-foreground">You proposed this supplier. A different owner or change approver must approve it.</p>
                    : <Button className="mt-3" onClick={() => approve(s.id)}>Approve supplier baseline</Button>
                )}
                <details className="mt-4">
                  <summary className="cursor-pointer text-sm font-semibold">Version history ({s.versions.length})</summary>
                  <table className="mt-2 w-full text-sm">
                    <thead className="text-left text-xs text-muted-foreground"><tr><th>Version</th><th>Recipient</th><th>Status</th><th>Enrolment</th><th>Approved by</th></tr></thead>
                    <tbody>
                      {s.versions.map((v) => (
                        <tr key={v.id} className="border-t"><td className="py-1">v{v.version}</td><td className="font-mono text-xs">{v.paypal_merchant_id}</td><td>{v.status}</td><td>{v.enrolment_status.replace("_", " ")}</td><td>{v.approved_by ? names[v.approved_by] ?? "—" : "—"}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </details>
              </Panel>
            );
          })}
        </div>
      )}
    </>
  );
}

function AddSupplier({ onDone }: { onDone: () => void }) {
  const { orgId } = useOrg();
  const [f, setF] = useState({ name: "", merchant: "", email: "", channel: "phone", value: "", evidence: "" });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  async function save(e: React.FormEvent) {
    e.preventDefault();
    const { error } = await supabase.rpc("create_supplier", { _org: orgId, _name: f.name, _merchant: f.merchant, _email: f.email, _channel: f.channel, _channel_value: f.value, _evidence: f.evidence });
    if (error) { toast.error(error.message); return; }
    toast.success("Supplier proposed. A second person must approve it.");
    onDone();
  }
  return (
    <Panel title="Propose a supplier" className="mb-6">
      <form onSubmit={save} className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1"><Label htmlFor="sn">Legal or trading name</Label><Input id="sn" required value={f.name} onChange={set("name")} /></div>
        <div className="space-y-1"><Label htmlFor="sm">PayPal merchant ID</Label><Input id="sm" required value={f.merchant} onChange={set("merchant")} /></div>
        <div className="space-y-1"><Label htmlFor="se">Billing email</Label><Input id="se" type="email" value={f.email} onChange={set("email")} /></div>
        <div className="grid grid-cols-[auto,1fr] gap-2">
          <div className="space-y-1"><Label htmlFor="sc">Trusted channel</Label>
            <select id="sc" value={f.channel} onChange={set("channel")} className="h-9 rounded-md border border-input bg-card px-2 text-sm"><option value="phone">Phone</option><option value="email">Email</option><option value="in_person">In person</option></select>
          </div>
          <div className="space-y-1"><Label htmlFor="sv">Trusted contact</Label><Input id="sv" required value={f.value} onChange={set("value")} /></div>
        </div>
        <div className="space-y-1 sm:col-span-2"><Label htmlFor="sev">How was this relationship independently established?</Label><Textarea id="sev" required value={f.evidence} onChange={set("evidence")} /></div>
        <p className="text-xs text-muted-foreground sm:col-span-2">A merchant ID identifies a PayPal account; it does not prove who owns it. New suppliers start unenrolled and cannot be paid until enrolment is complete.</p>
        <Button type="submit" className="sm:w-fit">Propose supplier</Button>
      </form>
    </Panel>
  );
}
