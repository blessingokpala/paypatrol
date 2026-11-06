import { friendlyError, humanize } from "@/lib/friendly";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrg, useProfiles } from "@/lib/org";
import { useRefreshAll, useSuppliers } from "@/lib/queries";
import { EmptyState, PageHeader, Panel, ToneBadge, Req } from "@/components/brand";
import { FieldSelect } from "@/components/field-select";
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
    if (error) { toast.error(friendlyError(error)); return; }
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
              <Panel key={s.id} title={s.name} actions={<div className="flex flex-wrap gap-2">{s.is_test_supplier && <ToneBadge tone="neutral">Fictional test supplier</ToneBadge>}<ToneBadge tone={s.status === "active" ? "success" : "warning"}>{s.status === "active" ? "Approved" : s.status === "draft" ? "Draft — unverified, not payable" : humanize(s.status)}</ToneBadge></div>}>
                {c && (
                  <dl className="grid gap-3 text-sm sm:grid-cols-3">
                    <div><dt className="text-muted-foreground">{s.status === "active" ? "Approved recipient" : "Proposed recipient (unverified)"}</dt><dd className="font-mono text-xs">{c.paypal_merchant_id || <span className="font-sans italic text-muted-foreground">Payment recipient not provided</span>}</dd></div>
                    <div><dt className="text-muted-foreground">Trusted contact</dt><dd>{c.trusted_contact_value ? `${c.trusted_contact_channel}: ${c.trusted_contact_value}` : <span className="italic text-muted-foreground">Missing</span>}</dd></div>
                    <div><dt className="text-muted-foreground">PayPal enrolment</dt><dd>{c.enrolment_status === "demo_fixture" ? <ToneBadge tone="neutral">Fictional demo record</ToneBadge> : c.enrolment_status === "enrolled" ? <ToneBadge tone="success">Enrolled</ToneBadge> : <ToneBadge tone="warning">{humanize(c.enrolment_status)} — unpayable</ToneBadge>}</dd></div>
                    <div className="sm:col-span-2"><dt className="text-muted-foreground">Verification evidence</dt><dd>{c.verification_evidence || <span className="italic text-muted-foreground">Missing — no independent check recorded</span>}</dd></div>
                    <div><dt className="text-muted-foreground">Approver</dt><dd>{c.approved_by ? names[c.approved_by] ?? "Team member" : s.is_demo ? "Seeded demo record" : "Pending"}{c.approved_at ? ` · ${new Date(c.approved_at).toLocaleDateString("en-CA")}` : ""}</dd></div>
                  </dl>
                )}
                {s.status !== "active" && (
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <Button asChild size="sm" variant="outline"><Link to="/purchases/new-invoice" search={{ supplier: s.id, from: "/suppliers" }}>Check an invoice</Link></Button>
                    <span className="text-xs text-muted-foreground">The invoice stays linked to this unverified supplier. Checks run; payment stays unavailable.</span>
                  </div>
                )}
                {s.status === "draft" && c && <DraftCompletion supplierId={s.id} current={c} canSubmit={org.has("owner")} onDone={refresh} />}
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
                        <tr key={v.id} className="border-t"><td className="py-1">v{v.version}</td><td className="font-mono text-xs">{v.paypal_merchant_id}</td><td>{humanize(v.status)}</td><td>{humanize(v.enrolment_status)}</td><td>{v.approved_by ? names[v.approved_by] ?? "Team member" : "Not yet approved"}</td></tr>
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

const PAY = <span className="ml-1 text-xs font-normal text-muted-foreground">(Required for payment setup)</span>;

function AddSupplier({ onDone }: { onDone: () => void }) {
  const { orgId } = useOrg();
  const [f, setF] = useState({ name: "", merchant: "", email: "", channel: "phone", value: "", evidence: "", isTest: false });
  const set = (k: "name" | "merchant" | "email" | "value" | "evidence") => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!f.name.trim()) { toast.error("Enter the supplier name to save a draft."); return; }
    const { error } = await supabase.rpc("save_supplier_draft", { _org: orgId, _name: f.name, _merchant: f.merchant, _email: f.email, _channel: f.channel, _channel_value: f.value, _evidence: f.evidence, _is_test: f.isTest });
    if (error) { toast.error(friendlyError(error)); return; }
    toast.success("Supplier saved as a draft. It is unverified and cannot be paid. You can check invoices against it now.");
    onDone();
  }
  return (
    <Panel title="Propose a supplier" className="mb-6">
      <form onSubmit={save} className="grid gap-4 sm:grid-cols-2">
        <p className="text-xs text-muted-foreground sm:col-span-2"><span className="text-destructive" aria-hidden>*</span> Required to save a draft. Nothing else is needed to check invoices.</p>
        <div className="space-y-1"><Label htmlFor="sn">Legal or trading name<Req /></Label><Input id="sn" required value={f.name} onChange={set("name")} /></div>
        <div className="space-y-1"><Label htmlFor="se">Billing email</Label><Input id="se" type="email" value={f.email} onChange={set("email")} /><p className="text-xs text-muted-foreground">Reference only; never used to verify payment details.</p></div>
        <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={f.isTest} onChange={(e) => setF({ ...f, isTest: e.target.checked })} />Fictional test supplier (label it as test data)</label>
        <details className="rounded-md border bg-muted/30 p-3 sm:col-span-2">
          <summary className="cursor-pointer text-sm font-semibold">Set up this supplier for payment</summary>
          <p className="mt-1 text-xs text-muted-foreground">Optional for invoice checking. Required before this supplier can receive payment.</p>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <div className="space-y-1"><Label htmlFor="sm">PayPal merchant ID{PAY}</Label><Input id="sm" className="font-mono" value={f.merchant} onChange={set("merchant")} /><p className="text-xs text-muted-foreground">Confirmed with the supplier through a trusted channel. IDs starting with TESTONLY can never be paid.</p></div>
            <div className="grid grid-cols-[auto,1fr] gap-2">
              <div className="space-y-1"><Label htmlFor="sc">Trusted channel</Label>
                <FieldSelect id="sc" value={f.channel} onChange={(v) => setF({ ...f, channel: v })} options={[{ value: "phone", label: "Phone" }, { value: "email", label: "Email" }, { value: "in_person", label: "In person" }]} />
              </div>
              <div className="space-y-1"><Label htmlFor="sv">Trusted contact{PAY}</Label><Input id="sv" value={f.value} onChange={set("value")} /></div>
            </div>
            <div className="space-y-1 sm:col-span-2"><Label htmlFor="sev">How was this relationship independently established?{PAY}</Label><Textarea id="sev" value={f.evidence} onChange={set("evidence")} placeholder="Leave empty if no independent check has happened yet." /><p className="text-xs text-muted-foreground">Invoice details, dummy merchant IDs and fictional contacts are not evidence.</p></div>
            <p className="text-xs text-muted-foreground sm:col-span-2">A merchant ID identifies a PayPal account; it does not prove who owns it. After saving, request approval from the draft; a different owner or Change approver must approve before any payment.</p>
          </div>
        </details>
        <Button type="submit" className="sm:w-fit">Save supplier draft</Button>
      </form>
    </Panel>
  );
}

function DraftCompletion({ supplierId, current, canSubmit, onDone }: { supplierId: string; current: { paypal_merchant_id: string; trusted_contact_channel: string; trusted_contact_value: string; verification_evidence: string | null }; canSubmit: boolean; onDone: () => void }) {
  const [f, setF] = useState({ merchant: current.paypal_merchant_id, channel: current.trusted_contact_channel || "phone", value: current.trusted_contact_value, evidence: current.verification_evidence ?? "" });
  const missing = [!f.merchant.trim() && "PayPal merchant ID", !f.value.trim() && "trusted contact", !f.evidence.trim() && "independent verification evidence"].filter(Boolean) as string[];
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const { error } = await supabase.rpc("submit_supplier_draft", { _supplier: supplierId, _merchant: f.merchant, _channel: f.channel, _channel_value: f.value, _evidence: f.evidence });
    if (error) { toast.error(friendlyError(error)); return; }
    toast.success("Submitted for approval. A different owner or change approver must approve it.");
    onDone();
  }
  return (
    <div className="mt-4 rounded-md border border-warning/40 bg-warning-soft p-3 text-sm">
      <p className="font-semibold">Draft — unverified and cannot be paid.</p>
      {missing.length > 0 ? <p>Payment setup not complete (optional for invoice checking): {missing.join(", ")} missing.</p> : <p>All payment setup details are filled in.</p>}
      {canSubmit ? (
        <details className="mt-3 rounded-md border bg-card p-3">
        <summary className="cursor-pointer font-semibold">Set up this supplier for payment</summary>
        <p className="mt-1 text-xs text-muted-foreground">Optional for invoice checking. Required before this supplier can receive payment.</p>
        <form onSubmit={submit} className="mt-3 grid gap-3 sm:grid-cols-2">
          <p className="text-xs text-muted-foreground sm:col-span-2">Fields marked <span className="text-destructive" aria-hidden>*</span> are required for payment setup.</p>
          <div className="space-y-1"><Label htmlFor={`dm-${supplierId}`}>PayPal merchant ID<Req /><span className="sr-only"> (required for payment setup)</span></Label><Input id={`dm-${supplierId}`} required className="font-mono" value={f.merchant} onChange={(e) => setF({ ...f, merchant: e.target.value })} /><p className="text-xs text-muted-foreground">Confirmed with the supplier through a trusted channel, not copied from an invoice.</p></div>
          <div className="space-y-1"><Label htmlFor={`dv-${supplierId}`}>Trusted contact<Req /><span className="sr-only"> (required for payment setup)</span></Label><Input id={`dv-${supplierId}`} required value={f.value} onChange={(e) => setF({ ...f, value: e.target.value })} /><p className="text-xs text-muted-foreground">From a source you already trust, never from the invoice.</p></div>
          <div className="space-y-1 sm:col-span-2"><Label htmlFor={`de-${supplierId}`}>Independent verification evidence<Req /><span className="sr-only"> (required for payment setup)</span></Label><Textarea id={`de-${supplierId}`} required value={f.evidence} onChange={(e) => setF({ ...f, evidence: e.target.value })} /><p className="text-xs text-muted-foreground">Describe a check that actually happened. Fictional contacts and dummy IDs are not evidence.</p></div>
          <Button type="submit" size="sm" className="sm:w-fit">Request approval</Button>
        </form>
        </details>
      ) : <p className="mt-1 text-xs">A Business owner can complete payment setup later. It is not needed to check invoices.</p>}
    </div>
  );
}
