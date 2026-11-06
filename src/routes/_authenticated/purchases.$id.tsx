import { friendlyError, humanize } from "@/lib/friendly";
import type { Database } from "@/integrations/supabase/types";
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
import { RecentSignin } from "@/components/recent-signin";
import { SandboxCheckout } from "@/components/sandbox-checkout";
import { PaymentReadiness } from "@/components/payment-readiness";
import { BackLink, useHere } from "@/components/back-link";
import { fromSearch } from "@/lib/return-to";
import { FieldSelect } from "@/components/field-select";

export const Route = createFileRoute("/_authenticated/purchases/$id")({
  validateSearch: fromSearch,
  head: () => ({ meta: [{ title: "Request review — PayPatrol" }, { name: "description", content: "Compare a request against approved records." }, { property: "og:title", content: "Request review — PayPatrol" }, { property: "og:description", content: "Invoice evidence, recipient comparison and payment controls." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  component: Review,
});

function useReview(id: string) {
  return useQuery({
    queryKey: ["review", id],
    queryFn: async () => {
      const { data: p, error } = await supabase.from("purchases").select("*, suppliers(name, is_demo)").eq("id", id).single();
      if (error) throw error;
      const [items, docs, findings, crs, approvals, res, sv, exs, members, audits] = await Promise.all([
        supabase.from("purchase_line_items").select("*").eq("purchase_id", id),
        supabase.from("invoice_documents").select("*").eq("purchase_id", id),
        supabase.from("findings").select("*").eq("purchase_id", id).eq("purchase_version", p.version).order("created_at"),
        supabase.from("supplier_change_requests").select("*").eq("purchase_id", id).order("created_at", { ascending: false }),
        supabase.from("approvals").select("*").eq("purchase_id", id).order("created_at", { ascending: false }),
        supabase.from("budget_reservations").select("*").eq("purchase_id", id).order("created_at", { ascending: false }),
        p.supplier_version_id ? supabase.from("supplier_versions").select("*").eq("id", p.supplier_version_id).single() : Promise.resolve({ data: null }),
        supabase.from("ai_extractions").select("*").eq("purchase_id", id).order("created_at", { ascending: false }),
        supabase.from("memberships").select("user_id, role").eq("org_id", p.org_id),
        supabase.from("audit_events").select("*").eq("entity_type", "purchase").eq("entity_id", id).order("created_at"),
      ]);
      const crIds = (crs.data ?? []).map((c) => c.id);
      const verifs = crIds.length ? await supabase.from("verification_records").select("*").in("change_request_id", crIds).order("created_at") : { data: [] };
      return { p, items: items.data ?? [], docs: docs.data ?? [], findings: findings.data ?? [], crs: crs.data ?? [], approvals: approvals.data ?? [], res: res.data ?? [], sv: sv.data, verifs: verifs.data ?? [], exs: exs.data ?? [], members: members.data ?? [], audits: audits.data ?? [] };
    },
  });
}

function Review() {
  const { id } = Route.useParams();
  const org = useOrg();
  const names = useProfiles(org.orgId).data ?? {};
  const q = useReview(id);
  const here = useHere();
  const refresh = useRefreshAll();
  const [editing, setEditing] = useState(false);
  const readInvoice = useServerFn(extractInvoiceDetails);
  const [reading, setReading] = useState(false);

  if (q.isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (q.error || !q.data) return <p className="text-sm text-blocked">Request not found or not available to you.</p>;
  const { p, items, docs, findings, crs, approvals, res, sv, verifs, exs, members, audits } = q.data;
  const recipientDiffers = sv && p.requested_recipient && p.requested_recipient.trim().toLowerCase() !== sv.paypal_merchant_id.toLowerCase();
  const activeRes = res.find((r) => r.status === "active");
  const latestExtraction = exs[0];
  const firstDoc = docs[0];
  const isTestData = p.is_test_fixture && (p.fixture_label ?? "").toLowerCase().includes("do not reserve or pay");
  const isDemo = Boolean((p.suppliers as { is_demo?: boolean } | null)?.is_demo);
  const edits = audits.filter((a) => a.action === "purchase_edited");
  const ex = (latestExtraction?.extracted ?? null) as Extraction | null;
  // A value counts as user-provided when the request holds a value the AI reading did not supply or read differently.
  const fromUser = (current: string | null | undefined, extracted: string | undefined) =>
    Boolean(current && current.trim() && (extracted === undefined || extracted.trim() === "" || extracted.trim() !== current.trim()));
  const moneyFromUser = (currentMinor: number | null | undefined, extracted: string | undefined) => {
    if (currentMinor === null || currentMinor === undefined) return false;
    const parsed = extracted ? parseToMinor(extracted) : null;
    return parsed === null || parsed !== currentMinor;
  };
  const exTotalMinor = ex?.total ? parseToMinor(ex.total) : null;
  const amountDiffersFromExtraction = exTotalMinor !== null && exTotalMinor !== p.total_minor;
  const eligibleReviewers = [...new Set(members.filter((m) => (m.role === "change_approver" || m.role === "owner") && m.user_id !== p.requested_by).map((m) => m.user_id))];

  async function call(fn: () => PromiseLike<{ error: { message: string } | null }>, ok: string) {
    const { error } = await fn();
    if (error) { toast.error(friendlyError(error)); return; }
    toast.success(ok);
    refresh();
  }

  const openDoc = async (path: string) => {
    const { data, error } = await supabase.storage.from("invoices").createSignedUrl(path, 120);
    if (error) { toast.error(friendlyError(error)); return; }
    window.open(data.signedUrl, "_blank", "noopener");
  };

  return (
    <>
      <BackLink to="/purchases" label="Back to purchases" />
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
                {d.storage_path && <Button variant="outline" size="sm" onClick={() => { if (d.storage_path) void openDoc(d.storage_path); }}>Open {d.file_name ?? "document"}</Button>}
                {d.source_message ? <pre className="whitespace-pre-wrap rounded-md border bg-muted p-3 font-sans text-sm">{d.source_message}</pre> : <p className="text-sm text-muted-foreground">No message pasted.</p>}
                <p className="text-xs text-muted-foreground">Untrusted content. Shown for comparison only.</p>
              </div>
            ))
          ) : (
            <ProposalSummary claims={p.ai_claims} items={items} />
          )}
        </Panel>

        <div id="request-details">
        <Panel title="Request details" actions={!editing && org.has("preparer", "owner") && p.source === "invoice" && !["paid", "payment_pending", "cancelled", "failed"].includes(p.status) ? <Button size="sm" variant="outline" onClick={() => setEditing(true)}>Correct details</Button> : null}>
          {editing ? <EditForm p={p} onDone={() => { setEditing(false); refresh(); }} /> : (
            <>
            <dl className="grid grid-cols-[auto,1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="text-muted-foreground">Supplier</dt><dd>{(p.suppliers as { name: string } | null)?.name ?? "Not matched"}</dd>
              <dt className="text-muted-foreground">Amount</dt><dd className="flex flex-wrap items-center gap-2 font-semibold">{formatMinor(p.total_minor, p.currency)}{moneyFromUser(p.total_minor, ex?.total) && <ToneBadge tone="info">Provided by user</ToneBadge>}</dd>
              <dt className="text-muted-foreground">Currency</dt><dd className="flex flex-wrap items-center gap-2">{p.currency}{fromUser(p.currency, ex?.currency) && <ToneBadge tone="info">Provided by user</ToneBadge>}</dd>
              {p.source === "invoice" && <><dt className="text-muted-foreground">Invoice reference</dt><dd className="flex flex-wrap items-center gap-2">{p.invoice_reference || <span className="text-muted-foreground">Not provided</span>}{fromUser(p.invoice_reference, ex?.invoice_reference) && <ToneBadge tone="info">Provided by user</ToneBadge>}</dd></>}
              <dt className="text-muted-foreground">Category</dt><dd>{p.category || <span className="text-muted-foreground">Not provided</span>}</dd>
              {p.source === "invoice" && (
                <>
                  <dt className="text-muted-foreground">Invoice date</dt><dd className="flex flex-wrap items-center gap-2">{p.invoice_date || <span className="text-muted-foreground">Not provided</span>}{fromUser(p.invoice_date, ex?.invoice_date) && <ToneBadge tone="info">Provided by user</ToneBadge>}</dd>
                  <dt className="text-muted-foreground">Due date</dt><dd className="flex flex-wrap items-center gap-2">{p.due_date || <span className="text-muted-foreground">Not provided</span>}{fromUser(p.due_date, ex?.due_date) && <ToneBadge tone="info">Provided by user</ToneBadge>}</dd>
                  <dt className="text-muted-foreground">Buyer</dt><dd className="flex flex-wrap items-center gap-2">{p.buyer_name || <span className="text-muted-foreground">Not provided</span>}{fromUser(p.buyer_name, ex?.buyer_name) && <ToneBadge tone="info">Provided by user</ToneBadge>}</dd>
                  <dt className="text-muted-foreground">Subtotal</dt><dd className="flex flex-wrap items-center gap-2">{p.subtotal_minor !== null ? formatMinor(p.subtotal_minor, p.currency) : <span className="text-muted-foreground">Not provided</span>}{moneyFromUser(p.subtotal_minor, ex?.subtotal) && <ToneBadge tone="info">Provided by user</ToneBadge>}</dd>
                  <dt className="text-muted-foreground">Tax</dt><dd className="flex flex-wrap items-center gap-2">{p.tax_minor !== null ? formatMinor(p.tax_minor, p.currency) : <span className="text-muted-foreground">Not provided</span>}{moneyFromUser(p.tax_minor, ex?.tax) && <ToneBadge tone="info">Provided by user</ToneBadge>}</dd>
                  <dt className="text-muted-foreground">Shipping</dt><dd className="flex flex-wrap items-center gap-2">{p.shipping_minor !== null ? formatMinor(p.shipping_minor, p.currency) : <span className="text-muted-foreground">Not provided</span>}{moneyFromUser(p.shipping_minor, ex?.shipping) && <ToneBadge tone="info">Provided by user</ToneBadge>}</dd>
                </>
              )}
            </dl>
            {amountDiffersFromExtraction && exTotalMinor !== null && (
              <p className="mt-3 rounded-md border border-warning/40 bg-warning-soft p-3 text-sm">
                The AI reading of the document says {formatMinor(exTotalMinor, p.currency)}, but this request currently says {formatMinor(p.total_minor, p.currency)}.
                {edits.length > 0 && <> Last changed by {names[edits[edits.length - 1]!.actor_id ?? ""] ?? "a team member"} on {new Date(edits[edits.length - 1]!.created_at).toLocaleString("en-CA")}.</>}
                {" "}Correcting the request never changes the uploaded document.
              </p>
            )}
            {edits.length > 0 && (
              <div className="mt-3">
                <p className="text-xs font-semibold uppercase text-muted-foreground">Correction history</p>
                <ul className="mt-1 space-y-1 text-xs text-muted-foreground">
                  {edits.map((a) => {
                    const d = a.details as { changed?: string[]; reason?: string; previous_version?: number };
                    return (
                      <li key={a.id}>
                        v{d.previous_version ?? "?"} → v{a.entity_version ?? "?"} by {names[a.actor_id ?? ""] ?? "a team member"} on {new Date(a.created_at).toLocaleString("en-CA")}
                        {d.changed?.length ? ` — changed ${d.changed.map((c) => humanize(c)).join(", ")}` : ""}
                        {d.reason ? ` — reason: “${d.reason}”` : " — no reason recorded (before reasons were required)"}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
            </>
          )}
          {items.length > 0 && (
            <table className="mt-4 w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground"><tr><th className="py-1">Line</th><th>Qty</th><th className="text-right">Total</th></tr></thead>
              <tbody>{items.map((i) => <tr key={i.id} className="border-t"><td className="py-1">{i.description}{!i.listing_id && <span className="block text-xs text-muted-foreground">Summary total, not an itemised line. See what AI read below for the invoice's own lines.</span>}</td><td>{i.listing_id ? i.quantity : <span className="text-xs text-muted-foreground">Not itemised</span>}</td><td className="text-right">{formatMinor(i.line_total_minor, p.currency)}</td></tr>)}</tbody>
            </table>
          )}
          {p.source !== "invoice" && <p className="mt-3 text-xs text-muted-foreground">Price and payment recipient were taken from the approved listing and supplier record.</p>}
        </Panel>
        </div>
      </div>

      {p.source === "invoice" && (
      <Panel title="What AI read from the document" className="mt-6" actions={latestExtraction && !editing && org.has("preparer", "owner") && !["paid", "payment_pending", "cancelled", "failed"].includes(p.status) ? <Button size="sm" variant="outline" onClick={() => { setEditing(true); document.getElementById("request-details")?.scrollIntoView({ behavior: "smooth" }); }}>Add missing details</Button> : null}>
        {latestExtraction ? (
          <ExtractionView row={latestExtraction} />
        ) : reading ? (
          <p className="text-sm text-muted-foreground" aria-live="polite">Reading invoice…</p>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">No AI reading recorded for this request.</p>
            {firstDoc?.storage_path && org.has("preparer", "owner") && (
              <Button
                size="sm"
                variant="outline"
                disabled={reading}
                onClick={async () => {
                  const path = firstDoc.storage_path;
                  if (!path) return;
                  setReading(true);
                  const out = await readInvoice({ data: { orgId: org.orgId, storagePath: path, fileName: firstDoc.file_name ?? "document" } });
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
      )}

      <Panel title="Recipient comparison" className="mt-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className={recipientDiffers ? "rounded-md border-2 border-warning bg-warning-soft p-4" : "rounded-md border p-4"}>
            <p className="text-xs font-semibold uppercase text-muted-foreground">Recipient on this request</p>
            {p.requested_recipient?.trim()
              ? <p className="mt-1 font-mono text-sm">{p.requested_recipient}</p>
              : <p className="mt-1 text-sm italic text-muted-foreground">No payment recipient provided.</p>}
            {p.requested_contact && <p className="mt-2 text-xs">Contact given: {p.requested_contact} <span className="text-warning">(not usable for verification)</span></p>}
          </div>
          <div className="rounded-md border bg-selected p-4">
            <p className="text-xs font-semibold uppercase text-muted-foreground">Approved supplier record {sv ? `v${sv.version}` : ""}</p>
            {sv
              ? <p className="mt-1 font-mono text-sm">{sv.paypal_merchant_id}</p>
              : <p className="mt-1 text-sm italic text-muted-foreground">{p.supplier_id ? "Supplier record is loading." : "No approved supplier selected."}</p>}
            {sv && <p className="mt-2 text-xs">Trusted contact: {sv.trusted_contact_channel} {sv.trusted_contact_value}{isDemo ? " (fictional — use the Sandbox account check below)" : ""} · enrolment: {humanize(sv.enrolment_status)}</p>}
          </div>
        </div>
        <p className="mt-3 text-sm">{!sv ? (p.supplier_id ? "Supplier record is loading." : "No approved supplier to compare against. Match this request to an approved supplier or add the supplier through verification.") : recipientDiffers ? <ToneBadge tone="warning">Recipient differs — verification required</ToneBadge> : <ToneBadge tone="success">Recipient matches approved record</ToneBadge>}</p>
      </Panel>

      <Panel title="Findings and next actions" className="mt-6">
        {findings.length === 0 ? <p className="text-sm text-muted-foreground">No issues found. All checks passed.</p> : (
          <ul className="space-y-3">
            {findings.map((f) => (
              <li key={f.id} className="rounded-md border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <ToneBadge tone={f.severity === "block" ? "blocked" : f.severity === "warning" ? "warning" : "info"}>{f.severity === "block" ? "Failed rule" : f.severity === "warning" ? "Hold" : "Note"}</ToneBadge>
                </div>
                <p className="mt-2 text-sm">{f.message}</p>
                {f.next_action && <p className="mt-1 text-sm text-muted-foreground"><span className="font-semibold text-foreground">Next:</span> {f.next_action}</p>}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {crs.map((cr) => (
        <ChangeReview key={cr.id} cr={cr} sv={sv} isDemo={isDemo} members={members} purchaseRequestedBy={p.requested_by}
          current={cr.base_version_id === p.supplier_version_id && cr.proposed_recipient.trim().toLowerCase() === (p.requested_recipient ?? "").trim().toLowerCase()}
          verifs={verifs.filter((v) => v.change_request_id === cr.id)} names={names} onDone={refresh} />
      ))}

      <Panel title="Approvals and checkout" className="mt-6">
        {approvals.length > 0 && (
          <ul className="mb-4 space-y-2 text-sm">
            {approvals.map((a) => (
              <li key={a.id} className="rounded-md border p-3">
                <span className="font-semibold">{names[a.approver_id] ?? "Approver"}</span> approved v{a.purchase_version} · {formatMinor(a.amount_minor, a.currency)} to {a.recipient} · {new Date(a.created_at).toLocaleString("en-CA")}{" "}
                {a.is_valid ? <ToneBadge tone="success">Valid</ToneBadge> : <ToneBadge tone="neutral">No longer valid: {humanize(a.invalidated_reason, "details changed")}</ToneBadge>}
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap gap-2">
          {p.status === "approval_required" && org.has("payer", "owner") && (
            p.requested_by === org.userId
              ? <p className="text-sm text-muted-foreground">You submitted this request, so a different payer must approve it.</p>
              : <Button asChild><Link to="/approvals" search={{ from: here }}>Review in Approvals</Link></Button>
          )}
          {p.status === "approval_required" && !org.has("payer", "owner") && (
            <p className="text-sm text-muted-foreground">
              Spending approval needs the Payer or Business owner role in {org.orgName}. Your roles here: {org.roles.join(", ").replace(/_/g, " ") || "none"}. Accept a Payer invitation from the owner to approve it.
            </p>
          )}
          {p.status === "cleared_for_checkout" && org.has("payer", "owner") && !activeRes && !isTestData && (
            <Button onClick={() => call(() => supabase.rpc("reserve_budget", { _pid: p.id }), "Budget reserved")}>Reserve budget for checkout</Button>
          )}
          {activeRes && (
            <>
              <p className="text-sm">Reserved {formatMinor(activeRes.amount_minor, activeRes.currency)} for v{activeRes.purchase_version}. Uncertain payments keep their reserved budget.</p>
              {org.has("payer", "owner") && p.status !== "payment_pending" && <Button variant="outline" onClick={() => call(() => supabase.rpc("release_reservation", { _pid: p.id }), "Reservation released")}>Release reservation</Button>}
            </>
          )}
          {!["paid", "payment_pending", "cancelled"].includes(p.status) && (
            <Button variant="outline" onClick={() => { const r = prompt("Reason for cancelling?"); if (r) call(() => supabase.rpc("cancel_purchase", { _pid: p.id, _reason: r }), "Request cancelled"); }}>Cancel request</Button>
          )}
          <Button variant="ghost" onClick={() => call(() => supabase.rpc("recheck_purchase", { _pid: p.id }), "Checks re-run")}>Re-run checks</Button>
        </div>
        {isTestData && p.status === "cleared_for_checkout" && <p className="mt-3 text-sm text-muted-foreground">Labelled as test data. Budget reservation and payment are not offered for this request.</p>}
        {!isTestData && p.status === "cleared_for_checkout" && <PaymentReadiness supplierId={p.supplier_id} supplierMerchant={sv?.paypal_merchant_id ?? null} />}
        {!isTestData && !org.has("payer", "owner") && ["cleared_for_checkout", "payment_pending"].includes(p.status) && (
          <p className="mt-3 text-sm text-muted-foreground">Only an owner or payer can reserve budget and pay this request.</p>
        )}
        {!isTestData && org.has("payer", "owner") && ["cleared_for_checkout", "payment_pending", "paid"].includes(p.status) && <SandboxCheckout purchaseId={p.id} onDone={refresh} />}
      </Panel>
    </>
  );
}

function EditForm({ p, onDone }: { p: { id: string; total_minor: number; currency: string; requested_recipient: string | null; invoice_reference: string | null; category: string | null; invoice_date: string | null; due_date: string | null; buyer_name: string | null; subtotal_minor: number | null; tax_minor: number | null; shipping_minor: number | null }; onDone: () => void }) {
  const [f, setF] = useState({
    amount: minorToInput(p.total_minor), currency: p.currency, recipient: p.requested_recipient ?? "",
    ref: p.invoice_reference ?? "", category: p.category ?? "",
    invoiceDate: p.invoice_date ?? "", dueDate: p.due_date ?? "", buyer: p.buyer_name ?? "",
    subtotal: p.subtotal_minor !== null ? minorToInput(p.subtotal_minor) : "",
    tax: p.tax_minor !== null ? minorToInput(p.tax_minor) : "",
    shipping: p.shipping_minor !== null ? minorToInput(p.shipping_minor) : "",
    reason: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const money = (s: string) => (s.trim() === "" ? null : parseToMinor(s));
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const m = parseToMinor(f.amount);
    if (m === null) { setError("Enter the amount like 75.00."); return; }
    for (const [label, v] of [["Subtotal", f.subtotal], ["Tax", f.tax], ["Shipping", f.shipping]] as const) {
      if (v.trim() !== "" && parseToMinor(v) === null) { setError(`Enter ${label.toLowerCase()} like 12.50, or leave it empty.`); return; }
    }
    if (!f.reason.trim()) { setError("A reason is required, so the team can see why this request changed."); return; }
    setSaving(true);
    const args = {
      _pid: p.id, _amount_minor: m, _currency: f.currency, _recipient: f.recipient, _invoice_ref: f.ref, _category: f.category,
      _invoice_date: f.invoiceDate || null, _due_date: f.dueDate || null, _buyer: f.buyer,
      _subtotal_minor: money(f.subtotal), _tax_minor: money(f.tax), _shipping_minor: money(f.shipping), _reason: f.reason.trim(),
    };
    const { error: rpcError } = await supabase.rpc("edit_purchase", args as unknown as Database["public"]["Functions"]["edit_purchase"]["Args"]);
    setSaving(false);
    if (rpcError) { setError(friendlyError(rpcError, "Saving")); return; }
    toast.success("Saved as a new version. Earlier approvals no longer apply.");
    onDone();
  }
  const field = (k: keyof typeof f, label: string, type = "text") => (
    <div className="space-y-1"><Label htmlFor={`e-${k}`}>{label}</Label><Input id={`e-${k}`} type={type} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></div>
  );
  return (
    <form onSubmit={save} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        {field("amount", "Amount")}{field("currency", "Currency")}{field("ref", "Invoice reference")}{field("category", "Category")}
        {field("invoiceDate", "Invoice date", "date")}{field("dueDate", "Due date", "date")}{field("buyer", "Buyer")}
        {field("subtotal", "Subtotal (optional)")}{field("tax", "Tax (optional)")}{field("shipping", "Shipping (optional)")}
      </div>
      {field("recipient", "Recipient")}
      <div className="space-y-1">
        <Label htmlFor="e-reason">Reason for this correction</Label>
        <Textarea id="e-reason" required value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder="Why is this changing? Recorded in Evidence history with your name." />
      </div>
      {error && <p role="alert" className="rounded-md border border-warning/40 bg-warning-soft p-3 text-sm">{error}</p>}
      <p className="text-xs text-warning">Any change creates a new version and invalidates approvals. The uploaded document and the AI reading stay unchanged.</p>
      <div className="flex gap-2"><Button type="submit" disabled={saving}>{saving ? "Saving…" : "Save new version"}</Button><Button type="button" variant="ghost" onClick={onDone}>Cancel</Button></div>
    </form>
  );
}

type CR = { id: string; status: string; proposed_recipient: string; proposed_contact: string | null; proposed_by: string; decided_by: string | null; decision_note: string | null; base_version_id: string };
type SV = { trusted_contact_channel: string; trusted_contact_value: string; paypal_merchant_id: string } | null;
type VR = { id: string; channel: string; channel_value: string; person_contacted: string; contacted_at: string; outcome: string; evidence: string; reviewer_id: string; check_kind?: string };
type Member = { user_id: string; role: string };

function EligibleReviewers({ members, exclude, names, isOwner }: { members: Member[]; exclude: string; names: Record<string, string>; isOwner: boolean }) {
  const eligible = [...new Set(members.filter((m) => (m.role === "change_approver" || m.role === "owner") && m.user_id !== exclude).map((m) => m.user_id))];
  if (eligible.length > 0) return <p className="mt-1">Eligible reviewers: {eligible.map((id) => names[id] ?? "team member").join(", ")}.</p>;
  return (
    <p className="mt-1">
      No eligible reviewer exists in this business yet.{" "}
      {isOwner
        ? <Link to="/settings" className="font-semibold underline underline-offset-2">Add a reviewer under Team &amp; integrations</Link>
        : "Ask an owner to add a reviewer under Team & integrations."}
    </p>
  );
}

function SandboxCheck({ cr, onDone }: { cr: CR; onDone: () => void }) {
  const [f, setF] = useState({ merchant: "", account: "", outcome: "denied", notes: "" });
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const { error } = await supabase.rpc("record_sandbox_account_check", {
      _cr: cr.id, _merchant_seen: f.merchant, _business_account_seen: f.account,
      _outcome: f.outcome as "confirmed" | "denied" | "unreachable", _evidence: f.notes,
    });
    if (error) { toast.error(friendlyError(error)); return; }
    toast.success("Sandbox account check recorded. No real supplier was verified.");
    onDone();
  }
  return (
    <form onSubmit={submit} className="space-y-3 rounded-md border border-dashed p-3">
      <h3 className="font-semibold">Sandbox account check (test only)</h3>
      <p className="text-xs text-muted-foreground">This supplier and its phone number are fictional. Instead of calling, sign in to PayPal Developer, open Sandbox → Accounts, open the Business account linked to the connected app, and read its Merchant ID (Account ID) yourself. Type what you see; do not copy it from this request. This is recorded as a Sandbox account check only — not contact with, or verification of, a real supplier.</p>
      <div className="space-y-1"><Label htmlFor="sb-m">Merchant ID shown in PayPal Developer</Label><Input id="sb-m" required value={f.merchant} onChange={(e) => setF({ ...f, merchant: e.target.value })} /></div>
      <div className="space-y-1"><Label htmlFor="sb-a">Business Sandbox account email you opened</Label><Input id="sb-a" required value={f.account} onChange={(e) => setF({ ...f, account: e.target.value })} /></div>
      <div className="space-y-1">
        <Label htmlFor="sb-o">Result</Label>
        <FieldSelect
          id="sb-o"
          value={f.outcome}
          onChange={(v) => setF({ ...f, outcome: v })}
          options={[
            { value: "denied", label: "Does not match / not the connected app's account" },
            { value: "confirmed", label: "Matches the requested recipient and connected app" },
          ]}
        />
      </div>
      <div className="space-y-1"><Label htmlFor="sb-n">Notes</Label><Textarea id="sb-n" required value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="App name checked, where the ID was shown, CAD listed in wallet" /></div>
      <Button type="submit">Record Sandbox account check</Button>
    </form>
  );
}

function ChangeReview({ cr, sv, verifs, names, onDone, current, isDemo, members, purchaseRequestedBy }: { cr: CR; sv: SV; verifs: VR[]; names: Record<string, string>; onDone: () => void; current: boolean; isDemo: boolean; members: Member[]; purchaseRequestedBy?: string }) {
  const org = useOrg();
  const canReview = org.has("change_approver", "owner") && cr.proposed_by !== org.userId && purchaseRequestedBy !== org.userId;
  const open = cr.status === "pending_verification" || cr.status === "verified_pending_decision";
  const [f, setF] = useState({ channel_value: "", person: "", when: new Date().toISOString().slice(0, 16), outcome: "denied", evidence: "" });
  const [note, setNote] = useState("");

  async function record(e: React.FormEvent) {
    e.preventDefault();
    const { error } = await supabase.rpc("record_verification", {
      _cr: cr.id, _channel_value: f.channel_value, _person: f.person, _contacted_at: new Date(f.when).toISOString(),
      _outcome: f.outcome as "confirmed" | "denied" | "unreachable", _evidence: f.evidence,
    });
    if (error) { toast.error(friendlyError(error)); return; }
    toast.success("Verification recorded");
    onDone();
  }
  async function decide(approve: boolean) {
    const { error } = await supabase.rpc("decide_supplier_change", { _cr: cr.id, _approve: approve, _note: note });
    if (error) { toast.error(friendlyError(error)); return; }
    toast.success(approve ? "Supplier change verified. The new recipient stays unpayable until PayPal enrolment. The decision is listed under Approvals → Completed." : "Supplier change rejected. The original supplier record is kept and this request stays blocked — it was not edited or made payable. The decision is listed under Approvals → Completed.", { duration: 10000 });
    onDone();
  }

  return (
    <Panel title="Supplier payment-detail change" className="mt-6">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        {current
          ? <ToneBadge tone="warning">Applies to the current version of this request</ToneBadge>
          : <ToneBadge tone="neutral">Earlier history</ToneBadge>}
      </div>
      {!current && (
        <p className="mb-2 text-sm text-muted-foreground">
          This record concerns an earlier version of the request and is kept for history. It stays open and enforced, but the hold on the current version comes from the record marked “Applies to the current version of this request”.
        </p>
      )}
      <p className="text-sm">Proposed recipient <span className="font-mono">{cr.proposed_recipient}</span> · submitted by {names[cr.proposed_by] ?? "a team member"} · status <strong>{humanize(cr.status)}</strong></p>
      {cr.status === "superseded"
        ? <p className="mt-1 text-sm text-muted-foreground">Closed automatically, not approved: {cr.decision_note}</p>
        : cr.decision_note && <p className="mt-1 text-sm text-muted-foreground">Decision by {names[cr.decided_by ?? ""] ?? "reviewer"}: {cr.decision_note}</p>}
      {verifs.length > 0 && (
        <ul className="mt-3 space-y-2 text-sm">
          {verifs.map((v) => (
            <li key={v.id} className="rounded-md border p-3">
              {v.check_kind === "paypal_sandbox_account_check" ? (
                <>
                  <ToneBadge tone={v.outcome === "confirmed" ? "success" : "blocked"}>{v.outcome === "confirmed" ? "Sandbox account check: Merchant ID matched" : "Sandbox account check: not confirmed"}</ToneBadge>{" "}
                  Merchant ID seen <span className="font-mono">{v.channel_value}</span> · {v.person_contacted} · {new Date(v.contacted_at).toLocaleString("en-CA")} · recorded by {names[v.reviewer_id] ?? "reviewer"}
                </>
              ) : (
                <>
                  <ToneBadge tone={v.outcome === "confirmed" ? "success" : "blocked"}>{v.outcome === "confirmed" ? "Supplier confirmed" : v.outcome === "denied" ? "Supplier denied" : "Unreachable"}</ToneBadge>{" "}
                  {v.channel} {v.channel_value} · spoke to {v.person_contacted} at {new Date(v.contacted_at).toLocaleString("en-CA")} · recorded by {names[v.reviewer_id] ?? "reviewer"}
                </>
              )}
              <p className="mt-1 text-muted-foreground">{v.evidence}</p>
            </li>
          ))}
        </ul>
      )}
      {open && !canReview && (
        <div className="mt-3 rounded-md bg-warning-soft p-3 text-sm text-warning">
          {cr.proposed_by === org.userId ? (
            <>
              <p>You created this request, so another person must verify the supplier payment details. A different team member with the Change approver or Business owner role can review it.</p>
              <EligibleReviewers members={members} exclude={cr.proposed_by} names={names} isOwner={org.has("owner")} />
            </>
          ) : (
            <p>Only change approvers or owners can verify this change.</p>
          )}
        </div>
      )}
      {open && canReview && (
        <div className="mt-4 grid gap-6 lg:grid-cols-2">
          <SandboxCheck cr={cr} onDone={onDone} />
          {!isDemo && (
          <form onSubmit={record} className="space-y-3">
            <h3 className="font-semibold">Record independent verification</h3>
            <p className="text-xs text-muted-foreground">Use only the trusted contact on record: <strong>{sv?.trusted_contact_channel} {sv?.trusted_contact_value}</strong>. Do not use the contact details in the request.</p>
            <div className="space-y-1"><Label htmlFor="cv">Contact used</Label><Input id="cv" required value={f.channel_value} onChange={(e) => setF({ ...f, channel_value: e.target.value })} placeholder={sv?.trusted_contact_value} /></div>
            <div className="space-y-1"><Label htmlFor="pp">Person contacted</Label><Input id="pp" required value={f.person} onChange={(e) => setF({ ...f, person: e.target.value })} /></div>
            <div className="space-y-1"><Label htmlFor="wh">When</Label><Input id="wh" type="datetime-local" required value={f.when} onChange={(e) => setF({ ...f, when: e.target.value })} /></div>
            <div className="space-y-1">
              <Label htmlFor="oc">Outcome</Label>
              <FieldSelect
                id="oc"
                value={f.outcome}
                onChange={(v) => setF({ ...f, outcome: v })}
                options={[
                  { value: "denied", label: "Supplier denies the change" },
                  { value: "confirmed", label: "Supplier confirms the change" },
                  { value: "unreachable", label: "Could not reach supplier" },
                ]}
              />
            </div>
            <div className="space-y-1"><Label htmlFor="ev">Evidence</Label><Textarea id="ev" required value={f.evidence} onChange={(e) => setF({ ...f, evidence: e.target.value })} placeholder="What was said, call reference, notes" /></div>
            <Button type="submit">Record verification</Button>
          </form>
          )}
          <div className="space-y-3">
            <h3 className="font-semibold">Decide</h3>
            <p className="text-xs text-muted-foreground">Reject if the requested recipient is not supported by the approved supplier record or independent evidence. Rejecting keeps the original supplier record, does not edit the request and does not make it payable.</p>
            <div className="space-y-1"><Label htmlFor="dn">Reason (required to reject)</Label><Textarea id="dn" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Requested recipient TEST does not match the approved PayPal Merchant ID and no evidence supports it." /></div>
            <RecentSignin />
            <div className="flex flex-wrap gap-2">
              <Button variant="destructive" disabled={!note.trim()} onClick={() => decide(false)}>Reject supplier change</Button>
              {cr.status === "verified_pending_decision" && <Button variant="outline" onClick={() => decide(true)}>Approve change</Button>}
            </div>
            {!note.trim() && <p className="text-xs text-muted-foreground">Enter a reason to enable rejection.</p>}
            <p className="text-xs text-muted-foreground">{cr.status === "verified_pending_decision" ? "Approval requires a confirmed verification. An approved new recipient cannot be paid until PayPal enrolment is complete." : "Approval is only offered after a confirmed check is recorded."}</p>
          </div>
        </div>
      )}
    </Panel>
  );
}

type ExtractionRow = {
  model: string;
  created_at: string;
  file_name: string | null;
  extracted: unknown;
  excerpts: unknown;
  uncertain_fields: string[];
  missing_fields: string[];
};

// Only these missing values actually block the checks; the rest are optional context.
const REQUIRED_EXTRACTION_KEYS = new Set(["total", "currency", "requested_payment_recipient", "invoice_reference"]);

function ExtractionView({ row }: { row: ExtractionRow }) {
  const e = row.extracted as Extraction;
  const quotes = (row.excerpts ?? []) as Excerpt[];
  const flag = (k: string) => (row.missing_fields?.includes(k) ? "missing" : row.uncertain_fields?.includes(k) ? "uncertain" : "ok");
  const fields: [string, string, string][] = [
    ["Supplier", e.supplier_name ?? "", "supplier_name"],
    ["Invoice ref", e.invoice_reference ?? "", "invoice_reference"],
    ["Invoice date", e.invoice_date ?? "", "invoice_date"],
    ["Due date", e.due_date ?? "", "due_date"],
    ["Buyer", e.buyer_name ?? "", "buyer_name"],
    ["Subtotal", e.subtotal ?? "", "subtotal"],
    ["Tax", e.tax ?? "", "tax"],
    ["Shipping", e.shipping ?? "", "shipping"],
    ["Total", e.total ?? "", "total"],
    ["Currency", e.currency ?? "", "currency"],
    ["Payment recipient", e.requested_payment_recipient ?? "", "requested_payment_recipient"],
  ];
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Read by {row.model} on {new Date(row.created_at).toLocaleString("en-CA")}
        {row.file_name ? ` · ${row.file_name}` : ""}
      </p>
      <dl className="grid grid-cols-[auto,1fr] gap-x-4 gap-y-1 text-sm">
        {fields.map(([label, value, key]) => (
          <div key={key} className="contents">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="flex flex-wrap items-center gap-2">
              <span className={value ? "" : "italic text-muted-foreground"}>{value || "Not found in document"}</span>
              {flag(key) === "missing" && REQUIRED_EXTRACTION_KEYS.has(key) && <ToneBadge tone="warning">Required before proceeding</ToneBadge>}
              {flag(key) === "uncertain" && <ToneBadge tone="warning">Hard to read</ToneBadge>}
            </dd>
          </div>
        ))}
      </dl>
      {(e.line_items?.length ?? 0) > 0 && (
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted-foreground"><tr><th className="py-1">Line</th><th>Qty</th><th className="text-right">Unit</th><th className="text-right">Amount</th></tr></thead>
          <tbody>{e.line_items.map((l, i) => <tr key={i} className="border-t"><td className="py-1">{l.description}</td><td>{l.quantity}</td><td className="text-right">{l.unit_price}</td><td className="text-right">{l.amount}</td></tr>)}</tbody>
        </table>
      )}
      {e.payment_change_instructions && (
        <div className="rounded-md border-2 border-warning bg-warning-soft p-3">
          <p className="text-xs font-semibold uppercase text-warning">Document asks for payment details to change</p>
          <blockquote className="mt-1 whitespace-pre-wrap text-sm">{e.payment_change_instructions}</blockquote>
          <p className="mt-2 text-xs">Reported as evidence only. It has no authority over who gets paid.</p>
        </div>
      )}
      {quotes.length > 0 && (
        <details>
          <summary className="cursor-pointer text-sm text-muted-foreground">Source quotes ({quotes.length})</summary>
          <ul className="mt-2 space-y-1 text-xs">
            {quotes.map((x, i) => <li key={i} className="text-muted-foreground"><span className="font-medium text-foreground">{x.field}</span> — “{x.quote}”{x.page ? ` (page ${x.page})` : ""}</li>)}
          </ul>
        </details>
      )}
      <p className="text-xs text-muted-foreground">AI output is untrusted. It cannot change spending rules, approve a request, confirm a supplier or move money.</p>
    </div>
  );
}

/** Readable view of what the AI proposal itself claimed. Calculated values live in Request details. */
function ProposalSummary({ claims, items }: { claims: unknown; items: { listing_id: string | null; description: string }[] }) {
  const c = (claims && typeof claims === "object" ? claims : {}) as Record<string, unknown>;
  const listingId = typeof c["listing_id"] === "string" ? c["listing_id"] : null;
  const item = items.find((i) => i.listing_id && i.listing_id === listingId)?.description ?? (listingId ? "Approved listing (name unavailable)" : null);
  const qty = typeof c["quantity"] === "number" ? String(c["quantity"]) : null;
  const total = typeof c["claimed_total_minor"] === "number" ? formatMinor(c["claimed_total_minor"], typeof c["currency"] === "string" ? c["currency"] : "CAD") : null;
  const recipient = typeof c["claimed_recipient"] === "string" && c["claimed_recipient"].trim() ? c["claimed_recipient"] : null;
  const reasoning = typeof c["reasoning"] === "string" && c["reasoning"].trim() ? c["reasoning"] : null;
  const ns = <span className="text-muted-foreground">Not supplied</span>;
  return (
    <div className="space-y-3 text-sm">
      <p className="text-muted-foreground">What the original proposal asked for:</p>
      <dl className="grid grid-cols-[auto,1fr] gap-x-4 gap-y-2">
        <dt className="text-muted-foreground">Item</dt><dd>{item ?? ns}</dd>
        <dt className="text-muted-foreground">Quantity</dt><dd>{qty ?? ns}</dd>
        <dt className="text-muted-foreground">Proposed total</dt><dd>{total ?? ns}</dd>
        <dt className="text-muted-foreground">Proposed payment recipient</dt><dd className={recipient ? "font-mono" : ""}>{recipient ?? ns}</dd>
        {reasoning && <><dt className="text-muted-foreground">Assistant's explanation</dt><dd>{reasoning}</dd></>}
      </dl>
      <p className="text-xs text-muted-foreground">Proposed values are claims only. They never set the price, recipient or approval.</p>
    </div>
  );
}
