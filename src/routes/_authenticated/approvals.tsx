import { BackLink, useHere } from "@/components/back-link";
import { rememberScroll, safeReturn, takeScroll } from "@/lib/return-to";
import { friendlyError, humanize } from "@/lib/friendly";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrg, useProfiles } from "@/lib/org";
import { useRefreshAll } from "@/lib/queries";
import { formatMinor } from "@/lib/money";
import { EmptyState, FixtureTag, PageHeader, Panel, Req, RequiredNote, ToneBadge } from "@/components/brand";
import { FieldSelect } from "@/components/field-select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CheckCircle2, Clock, X } from "lucide-react";
import { toast } from "sonner";
import type { Tone } from "@/lib/status";

type Search = { from?: string; tab?: "completed"; type?: "spending" | "supplier"; outcome?: "approved" | "rejected" | "history"; q?: string; sort?: "oldest" | "newest" };

type Patch = { [K in keyof Search]?: Search[K] | undefined };

function parseSearch(s: Record<string, unknown>): Search {
  const out: Search = {};
  const f = safeReturn(s["from"]); if (f) out.from = f;
  if (s["tab"] === "completed") out.tab = "completed";
  if (s["type"] === "spending" || s["type"] === "supplier") out.type = s["type"];
  if (s["outcome"] === "approved" || s["outcome"] === "rejected" || s["outcome"] === "history") out.outcome = s["outcome"];
  if (typeof s["q"] === "string" && s["q"]) out.q = s["q"].slice(0, 100);
  if (s["sort"] === "oldest" || s["sort"] === "newest") out.sort = s["sort"];
  return out;
}

export const Route = createFileRoute("/_authenticated/approvals")({
  validateSearch: parseSearch,
  head: () => ({ meta: [{ title: "Approvals — PayPatrol" }, { name: "description", content: "Approve exact request versions." }, { property: "og:title", content: "Approvals — PayPatrol" }, { property: "og:description", content: "Review approvals bound to exact PayPatrol request versions." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  component: Approvals,
});

function Approvals() {
  const here = useHere();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/approvals" });
  const tab = search.tab === "completed" ? "completed" : "pending";
  const setSearch = (patch: Patch) => navigate({
    search: (prev) => {
      const next: Record<string, unknown> = { ...prev, ...patch };
      for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k];
      return next as Search;
    },
    replace: true,
  });

  return (
    <>
      <BackLink to="/overview" label="Back to overview" optional />
      <PageHeader title="Approvals" description="Each approval is bound to one version. Any change to amount, currency, recipient, supplier record or rules cancels it. Approval cannot override a hard limit." />
      <div role="tablist" aria-label="Approval views" className="mb-6 grid w-full grid-cols-2 gap-2 rounded-xl border bg-muted/60 p-1.5 sm:inline-grid sm:w-auto">
        {([["pending", "Pending", "Awaiting a decision", Clock], ["completed", "Completed", "Recorded decisions", CheckCircle2]] as const).map(([t, label, sub, Icon]) => {
          const active = tab === t;
          return (
            <button key={t} role="tab" aria-selected={active} aria-controls={`panel-${t}`} id={`tab-${t}`}
              onClick={() => setSearch(t === "pending" ? { tab: undefined, type: undefined, outcome: undefined, q: undefined, sort: undefined } : { tab: "completed" })}
              className={`flex min-h-12 items-center gap-2.5 rounded-lg px-4 py-2 text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${active ? "bg-primary text-primary-foreground shadow-md" : "text-muted-foreground hover:bg-card hover:text-foreground"}`}>
              <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${active ? "bg-primary-foreground/20" : "bg-card"}`}><Icon className="h-4 w-4" aria-hidden /></span>
              <span className="leading-tight"><span className="block text-sm font-bold">{label}</span><span className={`block text-xs ${active ? "text-primary-foreground/85" : ""}`}>{sub}</span></span>
            </button>
          );
        })}
      </div>
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === "completed" ? <Completed here={here} search={search} setSearch={setSearch} /> : <Pending here={here} />}
      </div>
    </>
  );
}

function Pending({ here }: { here: string }) {
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
  const [tried, setTried] = useState<Record<string, boolean>>({});

  async function approve(id: string, version: number) {
    const { error } = await supabase.rpc("approve_purchase", { _pid: id, _version: version, _note: notes[id] ?? "", _via: "individual" });
    if (error) { toast.error(friendlyError(error)); return; }
    toast.success("Spending approved for this exact version. This does not verify the recipient or pay anything. The record is under Completed.", { duration: 10000 });
    refresh();
  }
  async function reject(id: string, version: number) {
    const reason = (notes[id] ?? "").trim();
    if (!reason) { setTried({ ...tried, [id]: true }); return; }
    const { error } = await supabase.rpc("reject_spending", { _pid: id, _version: version, _reason: reason });
    if (error) { toast.error(friendlyError(error)); return; }
    toast.success("Spending rejected. The decision and reason are under Completed and in Evidence history.", { duration: 10000 });
    refresh();
  }

  return (
    <>
      <p className="mb-4 text-sm text-muted-foreground">Two queues: <a href="#spending" className="font-medium text-brand-deep underline">Spending approvals</a> (Payer or Business owner) and <a href="#supplier-reviews" className="font-medium text-brand-deep underline">Supplier payment-detail reviews</a> (Change approver or Business owner). Nobody can approve or verify their own request.</p>
      <h2 id="spending" className="mb-3 text-lg font-bold">Spending approvals</h2>
      {!org.has("payer", "owner") && <p className="mb-4 rounded-md bg-warning-soft p-3 text-sm text-warning">You can view this queue but only payers or owners can approve or reject spending.</p>}
      {q.isLoading ? <p className="text-sm">Loading…</p> : (q.data ?? []).length === 0 ? <EmptyState>No spending requests awaiting approval. This does not mean there are no supplier reviews — see below.</EmptyState> : (
        <div className="space-y-4">
          {(q.data ?? []).map((p) => {
            const sv = p.supplier_versions as { version: number; paypal_merchant_id: string } | null;
            const own = p.requested_by === org.userId;
            const missing = tried[p.id] && !(notes[p.id] ?? "").trim();
            return (
              <Panel key={p.id} title={p.title} actions={<Link to="/purchases/$id" params={{ id: p.id }} search={{ from: here }} className="text-sm text-brand-bright underline">Full review</Link>}>
                {p.is_test_fixture && <div className="mb-2"><FixtureTag /></div>}
                <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                  <div><dt className="text-muted-foreground">Request version</dt><dd className="font-semibold">v{p.version}</dd></div>
                  <div><dt className="text-muted-foreground">Amount</dt><dd className="font-semibold">{formatMinor(p.total_minor, p.currency)}</dd></div>
                  <div><dt className="text-muted-foreground">Currency</dt><dd>{p.currency}</dd></div>
                  <div><dt className="text-muted-foreground">Recipient</dt><dd className="break-all font-mono text-xs">{p.requested_recipient}</dd></div>
                  <div><dt className="text-muted-foreground">Supplier</dt><dd>{(p.suppliers as { name: string } | null)?.name} (record v{sv?.version})</dd></div>
                  <div><dt className="text-muted-foreground">Rules version</dt><dd>v{(p.spending_policies as { version: number } | null)?.version}</dd></div>
                  <div><dt className="text-muted-foreground">Requested by</dt><dd>{names[p.requested_by] ?? "Team member"}</dd></div>
                  <div><dt className="text-muted-foreground">Fingerprint</dt><dd className="font-mono text-xs">{p.digest?.slice(0, 12)}</dd></div>
                </dl>
                <ul className="mt-3 space-y-1 text-sm">
                  {p.findings.map((f) => <li key={f.id}><ToneBadge tone="info">Note</ToneBadge> {f.message}</li>)}
                </ul>
                {org.has("payer", "owner") && (own ? (
                  <p className="mt-3 text-sm text-muted-foreground">You submitted this request. Another payer must approve or reject it.</p>
                ) : (
                  <div className="mt-4 space-y-2">
                    <RequiredNote />
                    <Label htmlFor={`note-${p.id}`}>Note or reason (required to reject)<Req /></Label>
                    <Textarea id={`note-${p.id}`} aria-invalid={missing || undefined} aria-describedby={`note-help-${p.id}`}
                      placeholder="Optional when approving; explain why when rejecting" value={notes[p.id] ?? ""} onChange={(e) => setNotes({ ...notes, [p.id]: e.target.value })} className="sm:max-w-xl" />
                    <p id={`note-help-${p.id}`} className={`text-xs ${missing ? "font-medium text-destructive" : "text-muted-foreground"}`} role={missing ? "alert" : undefined}>
                      {missing ? "Enter a reason before rejecting this spending request." : "Optional for approval. Required only to reject."}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <Button onClick={() => approve(p.id, p.version)}>Approve v{p.version} for {formatMinor(p.total_minor, p.currency)}</Button>
                      <Button variant="outline" onClick={() => reject(p.id, p.version)}>Reject spending</Button>
                    </div>
                  </div>
                ))}
              </Panel>
            );
          })}
        </div>
      )}
      <SupplierReviews here={here} />
    </>
  );
}

function SupplierReviews({ here }: { here: string }) {
  const org = useOrg();
  const names = useProfiles(org.orgId).data ?? {};
  const q = useQuery({
    queryKey: ["supplier-reviews", org.orgId],
    queryFn: async () => {
      const { data, error } = await supabase.from("supplier_change_requests").select("id, status, proposed_recipient, proposed_by, purchase_id, created_at, suppliers(name), purchases(title, version, requested_by, requested_recipient, is_test_fixture)").eq("org_id", org.orgId).in("status", ["pending_verification", "verified_pending_decision"]).order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
  const canReview = org.has("change_approver", "owner");
  return (
    <section className="mt-8">
      <h2 id="supplier-reviews" className="mb-3 text-lg font-bold">Supplier payment-detail reviews</h2>
      {!canReview && <p className="mb-4 rounded-md bg-warning-soft p-3 text-sm text-warning">Only change approvers or owners can verify supplier payment details.</p>}
      {q.isLoading ? <p className="text-sm">Loading…</p> : (q.data ?? []).length === 0 ? <EmptyState>No supplier payment-detail changes awaiting review.</EmptyState> : (
        <ul className="space-y-3">
          {(q.data ?? []).map((c) => {
            const pur = c.purchases as { title: string; version: number; requested_by: string; requested_recipient: string | null; is_test_fixture: boolean } | null;
            const appliesNow = !pur || (pur.requested_recipient ?? "").trim().toLowerCase() === c.proposed_recipient.trim().toLowerCase();
            const own = c.proposed_by === org.userId || pur?.requested_by === org.userId;
            return (
              <li key={c.id} className="rounded-lg border bg-card p-4 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-semibold">{(c.suppliers as { name: string } | null)?.name ?? "Supplier"} → new recipient <span className="break-all font-mono text-xs">{c.proposed_recipient}</span></p>
                  <ToneBadge tone="warning">Awaiting supplier verification</ToneBadge>
                </div>
                <div className="mt-1 flex flex-wrap gap-2">
                  <ToneBadge tone={appliesNow ? "warning" : "neutral"}>{appliesNow ? "Applies to the current request version — active hold" : "Earlier request version — still open"}</ToneBadge>
                  {pur?.is_test_fixture && <FixtureTag />}
                </div>
                <p className="mt-1 text-muted-foreground">{pur ? `For ${pur.title} (v${pur.version}). ` : ""}Raised by {names[c.proposed_by] ?? "a team member"} on {new Date(c.created_at).toLocaleDateString("en-CA")}.</p>
                {own && <p className="mt-1 text-muted-foreground">You raised or requested this, so a different reviewer must verify it.</p>}
                <div className="mt-2">
                  {c.purchase_id
                    ? <Link to="/purchases/$id" params={{ id: c.purchase_id }} search={{ from: here }} hash="supplier-change" className="font-medium text-brand-deep underline">{canReview && !own ? "Open review" : "View request"}</Link>
                    : <Link to="/suppliers" className="font-medium text-brand-deep underline">Open Suppliers</Link>}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

type Decision = {
  key: string;
  type: "spending" | "supplier";
  outcome: "approved" | "rejected" | "history";
  label: string;
  tone: Tone;
  ref: string;
  title: string;
  amount: string;
  version: number | null;
  reviewer: string;
  at: string | null;
  reason: string | null;
  reasonLabel: string;
  extra: string | null;
  purchaseId: string | null;
  supplier: string | null;
  fixture: boolean;
  hash?: string;
};

const OUTCOME_WORD: Record<string, string> = { approved: "approved or verified", rejected: "rejected", history: "earlier-history" };
const TYPE_WORD: Record<string, string> = { spending: "spending", supplier: "supplier review" };

function Completed({ here, search, setSearch }: { here: string; search: Search; setSearch: (p: Patch) => void }) {
  const org = useOrg();
  const names = useProfiles(org.orgId).data ?? {};
  const data = useQuery({
    queryKey: ["approvals-completed-all", org.orgId],
    queryFn: async () => {
      const [ap, rj, sc] = await Promise.all([
        supabase.from("approvals").select("id, purchase_id, purchase_version, amount_minor, currency, approver_id, is_valid, invalidated_reason, approval_method, note, created_at, purchases(title, invoice_reference, is_test_fixture, status, suppliers(name))").eq("org_id", org.orgId).order("created_at", { ascending: false }).limit(500),
        supabase.from("audit_events").select("id, entity_id, entity_version, actor_id, details, created_at").eq("org_id", org.orgId).eq("action", "spending_rejected").order("created_at", { ascending: false }).limit(500),
        supabase.from("supplier_change_requests").select("id, status, proposed_recipient, decided_by, decided_at, decision_note, purchase_id, suppliers(name), purchases(title, invoice_reference, total_minor, currency, is_test_fixture, version, status)").eq("org_id", org.orgId).in("status", ["approved", "rejected", "superseded"]).order("decided_at", { ascending: false }).limit(500),
      ]);
      if (ap.error) throw ap.error; if (rj.error) throw rj.error; if (sc.error) throw sc.error;
      const rjIds = [...new Set((rj.data ?? []).map((r) => r.entity_id).filter(Boolean) as string[])];
      const rjP = rjIds.length ? await supabase.from("purchases").select("id, title, invoice_reference, is_test_fixture, status, suppliers(name)").in("id", rjIds) : { data: [] as never[] };
      return { ap: ap.data ?? [], rj: rj.data ?? [], sc: sc.data ?? [], rjP: rjP.data ?? [] };
    },
  });

  const all: Decision[] = useMemo(() => {
    if (!data.data) return [];
    const out: Decision[] = [];
    for (const a of data.data.ap) {
      const pur = a.purchases as { title: string; invoice_reference: string | null; is_test_fixture: boolean; status: string; suppliers: { name: string } | null } | null;
      out.push({
        key: `a-${a.id}`, type: "spending", outcome: "approved", label: "Spending approved", tone: a.is_valid ? "success" : "neutral",
        ref: pur?.invoice_reference ?? pur?.title ?? "Request", title: pur?.title ?? "", amount: formatMinor(a.amount_minor, a.currency), version: a.purchase_version,
        reviewer: names[a.approver_id] ?? "a team member", at: a.created_at, reason: a.note, reasonLabel: "Note",
        extra: [a.approval_method === "batch" ? "Batch approval" : a.approval_method === "individual" ? "Individual approval" : null, !a.is_valid ? `No longer valid${a.invalidated_reason ? `: ${a.invalidated_reason}` : ""}` : null, pur ? `Request now: ${humanize(pur.status)}` : null].filter(Boolean).join(" · "),
        purchaseId: a.purchase_id, supplier: pur?.suppliers?.name ?? null, fixture: !!pur?.is_test_fixture,
      });
    }
    const pmap = new Map(data.data.rjP.map((p: { id: string }) => [p.id, p as { id: string; title: string; invoice_reference: string | null; is_test_fixture: boolean; status: string; suppliers: { name: string } | null }]));
    for (const r of data.data.rj) {
      const d = (r.details ?? {}) as Record<string, unknown>;
      const pur = r.entity_id ? pmap.get(r.entity_id) : undefined;
      out.push({
        key: `r-${r.id}`, type: "spending", outcome: "rejected", label: "Spending rejected", tone: "blocked",
        ref: pur?.invoice_reference ?? pur?.title ?? "Request", title: pur?.title ?? "", amount: typeof d["amount_minor"] === "number" ? formatMinor(d["amount_minor"], String(d["currency"] ?? "CAD")) : "—", version: r.entity_version,
        reviewer: names[r.actor_id ?? ""] ?? "a team member", at: r.created_at, reason: typeof d["reason"] === "string" ? d["reason"] : null, reasonLabel: "Reason",
        extra: pur ? `Request now: ${humanize(pur.status)}` : null, purchaseId: r.entity_id, supplier: pur?.suppliers?.name ?? null, fixture: !!pur?.is_test_fixture,
      });
    }
    for (const c of data.data.sc) {
      const pur = c.purchases as { title: string; invoice_reference: string | null; total_minor: number; currency: string; is_test_fixture: boolean; version: number; status: string } | null;
      const outcome = c.status === "approved" ? "approved" : c.status === "rejected" ? "rejected" : "history";
      out.push({
        key: `s-${c.id}`, type: "supplier", outcome,
        label: outcome === "approved" ? "Supplier change verified" : outcome === "rejected" ? "Supplier change rejected" : "Earlier history (not verified)",
        tone: outcome === "approved" ? "success" : outcome === "rejected" ? "blocked" : "neutral",
        ref: pur?.invoice_reference ?? pur?.title ?? "Supplier record", title: pur?.title ?? "", amount: pur ? formatMinor(pur.total_minor, pur.currency) : "—", version: null,
        reviewer: c.status === "superseded" ? "Closed automatically" : names[c.decided_by ?? ""] ?? "a reviewer", at: c.decided_at,
        reason: c.decision_note, reasonLabel: c.status === "rejected" ? "Reason" : "Note",
        extra: [`Proposed recipient ${c.proposed_recipient}`, c.status === "rejected" ? "Request not cancelled; recipient unchanged" : null, pur ? `Request now: ${humanize(pur.status)}` : null].filter(Boolean).join(" · "),
        purchaseId: c.purchase_id, supplier: (c.suppliers as { name: string } | null)?.name ?? null, fixture: !!pur?.is_test_fixture, hash: "supplier-change",
      });
    }
    return out;
  }, [data.data, names]);

  const sort = search.sort ?? "newest";
  const qText = (search.q ?? "").trim().toLowerCase();
  const rows = useMemo(() => {
    const r = all.filter((d) =>
      (!search.type || d.type === search.type) &&
      (!search.outcome || d.outcome === search.outcome) &&
      (!qText || [d.ref, d.title, d.supplier ?? ""].some((s) => s.toLowerCase().includes(qText))));
    r.sort((a, b) => { const x = a.at ?? "", y = b.at ?? ""; return sort === "oldest" ? x.localeCompare(y) : y.localeCompare(x); });
    return r;
  }, [all, search.type, search.outcome, qText, sort]);

  useEffect(() => {
    if (data.isLoading) return;
    const y = takeScroll(here);
    if (y !== null) requestAnimationFrame(() => window.scrollTo(0, y));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.isLoading]);

  const [qDraft, setQDraft] = useState(search.q ?? "");
  useEffect(() => { setQDraft(search.q ?? ""); }, [search.q]);
  const chips: { label: string; clear: Patch }[] = [];
  if (search.type) chips.push({ label: search.type === "spending" ? "Spending" : "Supplier payment details", clear: { type: undefined } });
  if (search.outcome) chips.push({ label: search.outcome === "approved" ? "Approved / Verified" : search.outcome === "rejected" ? "Rejected" : "Earlier history", clear: { outcome: undefined } });
  if (search.q) chips.push({ label: `“${search.q}”`, clear: { q: undefined } });
  if (search.sort === "oldest") chips.push({ label: "Oldest first", clear: { sort: undefined } });
  const when = (t: string | null) => (t ? new Date(t).toLocaleString("en-CA", { dateStyle: "medium", timeStyle: "short" }) : "—");
  const emptyText = `No ${search.outcome ? OUTCOME_WORD[search.outcome] + " " : ""}${search.type ? TYPE_WORD[search.type] + " " : ""}decisions match these filters.`;

  return (
    <>
      <div className="mb-4 grid gap-3 rounded-lg border bg-card p-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-1 sm:col-span-2 lg:col-span-1">
          <Label htmlFor="ap-q">Search</Label>
          <form onSubmit={(e) => { e.preventDefault(); setSearch({ q: qDraft.trim() || undefined }); }}>
            <Input id="ap-q" type="search" value={qDraft} onChange={(e) => setQDraft(e.target.value)} onBlur={() => setSearch({ q: qDraft.trim() || undefined })} placeholder="Title, reference or supplier" />
          </form>
        </div>
        <div className="space-y-1"><Label htmlFor="ap-type">Review type</Label>
          <FieldSelect id="ap-type" value={search.type ?? "all"} onChange={(v) => setSearch({ type: v === "all" ? undefined : (v as Search["type"]) })}
            options={[{ value: "all", label: "All types" }, { value: "spending", label: "Spending" }, { value: "supplier", label: "Supplier payment details" }]} /></div>
        <div className="space-y-1"><Label htmlFor="ap-outcome">Outcome</Label>
          <FieldSelect id="ap-outcome" value={search.outcome ?? "all"} onChange={(v) => setSearch({ outcome: v === "all" ? undefined : (v as Search["outcome"]) })}
            options={[{ value: "all", label: "All outcomes" }, { value: "approved", label: "Approved / Verified" }, { value: "rejected", label: "Rejected" }, { value: "history", label: "Earlier history (not verified)" }]} /></div>
        <div className="space-y-1"><Label htmlFor="ap-sort">Sort</Label>
          <FieldSelect id="ap-sort" value={sort} onChange={(v) => setSearch({ sort: v === "newest" ? undefined : "oldest" })}
            options={[{ value: "newest", label: "Newest decision first" }, { value: "oldest", label: "Oldest decision first" }]} /></div>
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm" aria-live="polite">
        <span className="font-semibold">{data.isLoading ? "Loading…" : `${rows.length} decision${rows.length === 1 ? "" : "s"}`}</span>
        {chips.map((c) => (
          <button key={c.label} onClick={() => setSearch(c.clear)} className="inline-flex items-center gap-1 rounded-full border bg-selected px-2.5 py-0.5 text-xs font-medium text-brand-deep" aria-label={`Remove filter ${c.label}`}>
            {c.label}<X className="h-3 w-3" aria-hidden />
          </button>
        ))}
        {chips.length > 0 && <Button variant="link" size="sm" className="h-auto p-0" onClick={() => setSearch({ type: undefined, outcome: undefined, q: undefined, sort: undefined })}>Clear filters</Button>}
      </div>
      <p className="mb-3 text-xs text-muted-foreground">Request cancellations are not rejections and are listed in Evidence history. Earlier history means a supplier proposal stopped applying after the request changed — it was neither verified nor rejected.</p>
      {data.isLoading ? null : rows.length === 0 ? <EmptyState>{emptyText}</EmptyState> : (
        <ul className="space-y-2">
          {rows.map((d) => (
            <li key={d.key} className="rounded-lg border bg-card p-4 text-sm">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <p className="min-w-0 break-words font-semibold">{d.ref}{d.version ? ` · v${d.version}` : ""} · {d.amount}</p>
                <ToneBadge tone={d.tone}>{d.label}</ToneBadge>
              </div>
              {d.title && d.title !== d.ref && <p className="text-muted-foreground">{d.title}</p>}
              <p className="mt-1 text-muted-foreground">{d.type === "spending" ? "Spending" : "Supplier payment details"} · {d.reviewer.startsWith("Closed") ? d.reviewer : `By ${d.reviewer}`} · {when(d.at)}</p>
              {d.extra && <p className="mt-1 break-words text-muted-foreground">{d.extra}</p>}
              {d.reason && <p className="mt-1">{d.reasonLabel}: {d.reason}</p>}
              <div className="mt-2 flex flex-wrap items-center gap-3">
                {d.fixture && <FixtureTag />}
                {d.purchaseId && <Link to="/purchases/$id" params={{ id: d.purchaseId }} search={{ from: here }} {...(d.hash ? { hash: d.hash } : {})} onClick={() => rememberScroll(here)} className="font-medium text-brand-deep underline">Open request</Link>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
