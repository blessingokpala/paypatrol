import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { extractInvoiceDetails } from "@/lib/ai/ai.functions";
import type { Excerpt, Extraction } from "@/lib/ai/schemas";
import { useOrg, useProfiles } from "@/lib/org";
import { useRefreshAll } from "@/lib/queries";
import { formatMinor, minorToInput, parseToMinor } from "@/lib/money";
import { FixtureTag, PageHeader, Panel, StatusBadge, ToneBadge } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/purchases/$id")({
  head: () => ({ meta: [{ title: "Request review — PayPatrol" }, { name: "description", content: "Compare a request against approved records." }] }),
  component: Review,
});

function useReview(id: string) {
  return useQuery({
    queryKey: ["review", id],
    queryFn: async () => {
      const { data: p, error } = await supabase.from("purchases").select("*, suppliers(name)").eq("id", id).single();
      if (error) throw error;
      const [items, docs, findings, crs, approvals, res, sv, exs] = await Promise.all([
        supabase.from("purchase_line_items").select("*").eq("purchase_id", id),
        supabase.from("invoice_documents").select("*").eq("purchase_id", id),
        supabase.from("findings").select("*").eq("purchase_id", id).eq("purchase_version", p.version).order("created_at"),
        supabase.from("supplier_change_requests").select("*").eq("purchase_id", id).order("created_at", { ascending: false }),
        supabase.from("approvals").select("*").eq("purchase_id", id).order("created_at", { ascending: false }),
        supabase.from("budget_reservations").select("*").eq("purchase_id", id).order("created_at", { ascending: false }),
        p.supplier_version_id ? supabase.from("supplier_versions").select("*").eq("id", p.supplier_version_id).single() : Promise.resolve({ data: null }),
        supabase.from("ai_extractions").select("*").eq("purchase_id", id).order("created_at", { ascending: false }),
      ]);
      const crIds = (crs.data ?? []).map((c) => c.id);
      const verifs = crIds.length ? await supabase.from("verification_records").select("*").in("change_request_id", crIds).order("created_at") : { data: [] };
      return { p, items: items.data ?? [], docs: docs.data ?? [], findings: findings.data ?? [], crs: crs.data ?? [], approvals: approvals.data ?? [], res: res.data ?? [], sv: sv.data, verifs: verifs.data ?? [], exs: exs.data ?? [] };
    },
  });
}

function Review() {
  const { id } = Route.useParams();
  const org = useOrg();
  const names = useProfiles(org.orgId).data ?? {};
  const q = useReview(id);
  const refresh = useRefreshAll();
  const [editing, setEditing] = useState(false);

  if (q.isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (q.error || !q.data) return <p className="text-sm text-blocked">Request not found or not available to you.</p>;
  const { p, items, docs, findings, crs, approvals, res, sv, verifs, exs } = q.data;
  const readInvoice = useServerFn(extractInvoiceDetails);
  const [reading, setReading] = useState(false);
  const recipientDiffers = sv && p.requested_recipient && p.requested_recipient.trim().toLowerCase() !== sv.paypal_merchant_id.toLowerCase();
  const activeRes = res.find((r) => r.status === "active");

  async function call(fn: () => PromiseLike<{ error: { message: string } | null }>, ok: string) {
    const { error } = await fn();
    if (error) { toast.error(error.message); return; }
    toast.success(ok);
    refresh();
  }

  const openDoc = async (path: string) => {
    const { data, error } = await supabase.storage.from("invoices").createSignedUrl(path, 120);
    if (error) { toast.error(error.message); return; }
    window.open(data.signedUrl, "_blank", "noopener");
  };

  return (
    <>
      <div className="mb-2 text-sm"><Link to="/purchases" className="text-brand-bright underline">← Purchases</Link></div>
      <PageHeader
        title={p.title}
        description={`${p.source === "invoice" ? "Invoice" : "AI proposal"} · version ${p.version} · submitted by ${names[p.requested_by] ?? "a team member"} on ${new Date(p.created_at).toLocaleString("en-CA")}`}
        actions={<StatusBadge status={p.status} />}
      />
      {p.is_test_fixture && <div className="mb-4"><FixtureTag label={p.fixture_label} /></div>}

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title={p.source === "invoice" ? "Source document and message" : "Proposal content"}>
          {p.source === "invoice" ? (
            docs.length === 0 ? <p className="text-sm text-muted-foreground">No document attached.</p> : docs.map((d) => (
              <div key={d.id} className="space-y-3">
                {d.storage_path && <Button variant="outline" size="sm" onClick={() => openDoc(d.storage_path!)}>Open {d.file_name ?? "document"}</Button>}
                {d.source_message ? <pre className="whitespace-pre-wrap rounded-md border bg-muted p-3 font-sans text-sm">{d.source_message}</pre> : <p className="text-sm text-muted-foreground">No message pasted.</p>}
                <p className="text-xs text-muted-foreground">Untrusted content. Shown for comparison only.</p>
              </div>
            ))
          ) : (
            <div className="space-y-2 text-sm">
              <p>Submitted fields (as received):</p>
              <pre className="whitespace-pre-wrap rounded-md border bg-muted p-3 text-xs">{JSON.stringify(p.ai_claims, null, 2)}</pre>
              <p className="text-xs text-muted-foreground">These are the assistant's own claims. The server resolved price, total, currency and recipient from the approved listing and supplier record.</p>
            </div>
          )}
        </Panel>

        <Panel title="Request details" actions={!editing && org.has("preparer", "owner") && p.source === "invoice" && !["paid", "payment_pending", "cancelled", "failed"].includes(p.status) ? <Button size="sm" variant="outline" onClick={() => setEditing(true)}>Correct details</Button> : null}>
          {editing ? <EditForm p={p} onDone={() => { setEditing(false); refresh(); }} /> : (
            <dl className="grid grid-cols-[auto,1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="text-muted-foreground">Supplier</dt><dd>{(p.suppliers as { name: string } | null)?.name ?? "Not matched"}</dd>
              <dt className="text-muted-foreground">Amount</dt><dd className="font-semibold">{formatMinor(p.total_minor, p.currency)}</dd>
              <dt className="text-muted-foreground">Currency</dt><dd>{p.currency}</dd>
              <dt className="text-muted-foreground">Invoice ref</dt><dd>{p.invoice_reference ?? "—"}</dd>
              <dt className="text-muted-foreground">Category</dt><dd>{p.category ?? "—"}</dd>
            </dl>
          )}
          {items.length > 0 && (
            <table className="mt-4 w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground"><tr><th className="py-1">Line</th><th>Qty</th><th className="text-right">Total</th></tr></thead>
              <tbody>{items.map((i) => <tr key={i.id} className="border-t"><td className="py-1">{i.description}</td><td>{i.quantity}</td><td className="text-right">{formatMinor(i.line_total_minor, p.currency)}</td></tr>)}</tbody>
            </table>
          )}
        </Panel>
      </div>

      <Panel title="What AI read from the document" className="mt-6">
        {exs.length > 0 ? (
          <ExtractionView row={exs[0]} />
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">No AI reading recorded for this request.</p>
            {docs[0]?.storage_path && org.has("preparer", "owner") && (
              <Button
                size="sm"
                variant="outline"
                disabled={reading}
                onClick={async () => {
                  setReading(true);
                  const out = await readInvoice({ data: { orgId: org.orgId, storagePath: docs[0].storage_path!, fileName: docs[0].file_name ?? "document" } });
                  setReading(false);
                  if (!out.ok) { toast.error(out.error.message); return; }
                  await supabase.rpc("link_extraction", { _extraction: out.extractionId, _purchase: id });
                  refresh();
                }}
              >
                {reading ? "Reading…" : "Read this document with AI"}
              </Button>
            )}
          </div>
        )}
      </Panel>

      <Panel title="Recipient comparison" className="mt-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className={recipientDiffers ? "rounded-md border-2 border-warning bg-warning-soft p-4" : "rounded-md border p-4"}>
            <p className="text-xs font-semibold uppercase text-muted-foreground">Requested in this request</p>
            <p className="mt-1 font-mono text-sm">{p.requested_recipient ?? "—"}</p>
            {p.requested_contact && <p className="mt-2 text-xs">Contact given: {p.requested_contact} <span className="text-warning">(not usable for verification)</span></p>}
          </div>
          <div className="rounded-md border bg-selected p-4">
            <p className="text-xs font-semibold uppercase text-muted-foreground">Approved supplier record {sv ? `v${sv.version}` : ""}</p>
            <p className="mt-1 font-mono text-sm">{sv?.paypal_merchant_id ?? "No approved record"}</p>
            {sv && <p className="mt-2 text-xs">Trusted contact: {sv.trusted_contact_channel} {sv.trusted_contact_value} · enrolment: {sv.enrolment_status.replace("_", " ")}</p>}
          </div>
        </div>
        <p className="mt-3 text-sm">{!sv ? "No approved supplier to compare against." : recipientDiffers ? <ToneBadge tone="warning">Recipient differs — verification required</ToneBadge> : <ToneBadge tone="success">Recipient matches approved record</ToneBadge>}</p>
      </Panel>

      <Panel title="Findings and next actions" className="mt-6">
        {findings.length === 0 ? <p className="text-sm text-muted-foreground">No issues found. All checks passed.</p> : (
          <ul className="space-y-3">
            {findings.map((f) => (
              <li key={f.id} className="rounded-md border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <ToneBadge tone={f.severity === "block" ? "blocked" : f.severity === "warning" ? "warning" : "info"}>{f.severity === "block" ? "Failed rule" : f.severity === "warning" ? "Hold" : "Note"}</ToneBadge>
                  <code className="text-xs text-muted-foreground">{f.code}</code>
                </div>
                <p className="mt-2 text-sm">{f.message}</p>
                {f.next_action && <p className="mt-1 text-sm text-muted-foreground"><span className="font-semibold text-foreground">Next:</span> {f.next_action}</p>}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {crs.map((cr) => (
        <ChangeReview key={cr.id} cr={cr} sv={sv} verifs={verifs.filter((v) => v.change_request_id === cr.id)} names={names} onDone={refresh} />
      ))}

      <Panel title="Approvals and checkout" className="mt-6">
        {approvals.length > 0 && (
          <ul className="mb-4 space-y-2 text-sm">
            {approvals.map((a) => (
              <li key={a.id} className="rounded-md border p-3">
                <span className="font-semibold">{names[a.approver_id] ?? "Approver"}</span> approved v{a.purchase_version} · {formatMinor(a.amount_minor, a.currency)} to {a.recipient} · {new Date(a.created_at).toLocaleString("en-CA")}{" "}
                {a.is_valid ? <ToneBadge tone="success">Valid</ToneBadge> : <ToneBadge tone="neutral">Invalidated: {a.invalidated_reason}</ToneBadge>}
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap gap-2">
          {p.status === "approval_required" && org.has("payer", "owner") && (
            p.requested_by === org.userId
              ? <p className="text-sm text-muted-foreground">You submitted this request, so a different payer must approve it.</p>
              : <Button asChild><Link to="/approvals">Review in Approvals</Link></Button>
          )}
          {p.status === "cleared_for_checkout" && org.has("payer", "owner") && !activeRes && (
            <Button onClick={() => call(() => supabase.rpc("reserve_budget", { _pid: p.id }), "Budget reserved")}>Reserve budget for checkout</Button>
          )}
          {activeRes && (
            <>
              <p className="text-sm">Reserved {formatMinor(activeRes.amount_minor, activeRes.currency)} for v{activeRes.purchase_version}. <span className="font-semibold text-warning">PayPal not connected</span> — checkout is unavailable, no order has been created.</p>
              {org.has("payer", "owner") && <Button variant="outline" onClick={() => call(() => supabase.rpc("release_reservation", { _pid: p.id }), "Reservation released")}>Release reservation</Button>}
            </>
          )}
          {!["paid", "payment_pending", "cancelled"].includes(p.status) && (
            <Button variant="outline" onClick={() => { const r = prompt("Reason for cancelling?"); if (r) call(() => supabase.rpc("cancel_purchase", { _pid: p.id, _reason: r }), "Request cancelled"); }}>Cancel request</Button>
          )}
          <Button variant="ghost" onClick={() => call(() => supabase.rpc("recheck_purchase", { _pid: p.id }), "Checks re-run")}>Re-run checks</Button>
        </div>
      </Panel>
    </>
  );
}

function EditForm({ p, onDone }: { p: { id: string; total_minor: number; currency: string; requested_recipient: string | null; invoice_reference: string | null; category: string | null }; onDone: () => void }) {
  const [f, setF] = useState({ amount: minorToInput(p.total_minor), currency: p.currency, recipient: p.requested_recipient ?? "", ref: p.invoice_reference ?? "", category: p.category ?? "" });
  async function save(e: React.FormEvent) {
    e.preventDefault();
    const m = parseToMinor(f.amount);
    if (m === null) { toast.error("Enter the amount like 75.00"); return; }
    const { error } = await supabase.rpc("edit_purchase", { _pid: p.id, _amount_minor: m, _currency: f.currency, _recipient: f.recipient, _invoice_ref: f.ref, _category: f.category });
    if (error) { toast.error(error.message); return; }
    toast.success("Saved as a new version. Earlier approvals no longer apply.");
    onDone();
  }
  const field = (k: keyof typeof f, label: string) => (
    <div className="space-y-1"><Label htmlFor={`e-${k}`}>{label}</Label><Input id={`e-${k}`} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></div>
  );
  return (
    <form onSubmit={save} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">{field("amount", "Amount")}{field("currency", "Currency")}{field("ref", "Invoice reference")}{field("category", "Category")}</div>
      {field("recipient", "Recipient")}
      <p className="text-xs text-warning">Changing amount, currency or recipient creates a new version and invalidates approvals.</p>
      <div className="flex gap-2"><Button type="submit">Save new version</Button><Button type="button" variant="ghost" onClick={onDone}>Cancel</Button></div>
    </form>
  );
}

type CR = { id: string; status: string; proposed_recipient: string; proposed_contact: string | null; proposed_by: string; decided_by: string | null; decision_note: string | null };
type SV = { trusted_contact_channel: string; trusted_contact_value: string; paypal_merchant_id: string } | null;
type VR = { id: string; channel: string; channel_value: string; person_contacted: string; contacted_at: string; outcome: string; evidence: string; reviewer_id: string };

function ChangeReview({ cr, sv, verifs, names, onDone }: { cr: CR; sv: SV; verifs: VR[]; names: Record<string, string>; onDone: () => void }) {
  const org = useOrg();
  const canReview = org.has("change_approver", "owner") && cr.proposed_by !== org.userId;
  const open = cr.status === "pending_verification" || cr.status === "verified_pending_decision";
  const [f, setF] = useState({ channel_value: "", person: "", when: new Date().toISOString().slice(0, 16), outcome: "denied", evidence: "" });
  const [note, setNote] = useState("");

  async function record(e: React.FormEvent) {
    e.preventDefault();
    const { error } = await supabase.rpc("record_verification", {
      _cr: cr.id, _channel_value: f.channel_value, _person: f.person, _contacted_at: new Date(f.when).toISOString(),
      _outcome: f.outcome as "confirmed" | "denied" | "unreachable", _evidence: f.evidence,
    });
    if (error) { toast.error(error.message); return; }
    toast.success("Verification recorded");
    onDone();
  }
  async function decide(approve: boolean) {
    const { error } = await supabase.rpc("decide_supplier_change", { _cr: cr.id, _approve: approve, _note: note });
    if (error) { toast.error(error.message); return; }
    toast.success(approve ? "Change approved. New recipient stays unpayable until PayPal enrolment." : "Change rejected. Original supplier record retained.");
    onDone();
  }

  return (
    <Panel title="Supplier payment-detail change" className="mt-6">
      <p className="text-sm">Proposed recipient <span className="font-mono">{cr.proposed_recipient}</span> · submitted by {names[cr.proposed_by] ?? "a team member"} · status <strong>{cr.status.replaceAll("_", " ")}</strong></p>
      {cr.decision_note && <p className="mt-1 text-sm text-muted-foreground">Decision by {names[cr.decided_by ?? ""] ?? "reviewer"}: {cr.decision_note}</p>}
      {verifs.length > 0 && (
        <ul className="mt-3 space-y-2 text-sm">
          {verifs.map((v) => (
            <li key={v.id} className="rounded-md border p-3">
              <ToneBadge tone={v.outcome === "confirmed" ? "success" : "blocked"}>{v.outcome === "confirmed" ? "Supplier confirmed" : v.outcome === "denied" ? "Supplier denied" : "Unreachable"}</ToneBadge>{" "}
              {v.channel} {v.channel_value} · spoke to {v.person_contacted} at {new Date(v.contacted_at).toLocaleString("en-CA")} · recorded by {names[v.reviewer_id] ?? "reviewer"}
              <p className="mt-1 text-muted-foreground">{v.evidence}</p>
            </li>
          ))}
        </ul>
      )}
      {open && !canReview && (
        <p className="mt-3 rounded-md bg-warning-soft p-3 text-sm text-warning">
          {cr.proposed_by === org.userId ? "You submitted this request. A different change approver or owner must verify it." : "Only change approvers or owners can verify this change."}
        </p>
      )}
      {open && canReview && (
        <div className="mt-4 grid gap-6 lg:grid-cols-2">
          <form onSubmit={record} className="space-y-3">
            <h3 className="font-semibold">Record independent verification</h3>
            <p className="text-xs text-muted-foreground">Use only the trusted contact on record: <strong>{sv?.trusted_contact_channel} {sv?.trusted_contact_value}</strong>. Do not use the contact details in the request.</p>
            <div className="space-y-1"><Label htmlFor="cv">Contact used</Label><Input id="cv" required value={f.channel_value} onChange={(e) => setF({ ...f, channel_value: e.target.value })} placeholder={sv?.trusted_contact_value} /></div>
            <div className="space-y-1"><Label htmlFor="pp">Person contacted</Label><Input id="pp" required value={f.person} onChange={(e) => setF({ ...f, person: e.target.value })} /></div>
            <div className="space-y-1"><Label htmlFor="wh">When</Label><Input id="wh" type="datetime-local" required value={f.when} onChange={(e) => setF({ ...f, when: e.target.value })} /></div>
            <div className="space-y-1">
              <Label htmlFor="oc">Outcome</Label>
              <select id="oc" value={f.outcome} onChange={(e) => setF({ ...f, outcome: e.target.value })} className="h-9 w-full rounded-md border border-input bg-card px-3 text-sm">
                <option value="denied">Supplier denies the change</option>
                <option value="confirmed">Supplier confirms the change</option>
                <option value="unreachable">Could not reach supplier</option>
              </select>
            </div>
            <div className="space-y-1"><Label htmlFor="ev">Evidence</Label><Textarea id="ev" required value={f.evidence} onChange={(e) => setF({ ...f, evidence: e.target.value })} placeholder="What was said, call reference, notes" /></div>
            <Button type="submit">Record verification</Button>
          </form>
          {cr.status === "verified_pending_decision" && (
            <div className="space-y-3">
              <h3 className="font-semibold">Decide</h3>
              <div className="space-y-1"><Label htmlFor="dn">Decision note</Label><Textarea id="dn" value={note} onChange={(e) => setNote(e.target.value)} /></div>
              <div className="flex flex-wrap gap-2">
                <Button variant="destructive" onClick={() => decide(false)}>Reject change, keep original</Button>
                <Button variant="outline" onClick={() => decide(true)}>Approve change</Button>
              </div>
              <p className="text-xs text-muted-foreground">Approval requires a confirmed verification. An approved new recipient cannot be paid until PayPal enrolment is complete.</p>
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}
