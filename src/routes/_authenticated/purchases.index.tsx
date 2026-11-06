import { createFileRoute, Link } from "@tanstack/react-router";
import { csvCell } from "@/lib/csv";
import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { BackLink, useHere } from "@/components/back-link";
import { fromSearch, rememberScroll, takeScroll } from "@/lib/return-to";
import { useOrg } from "@/lib/org";
import { usePurchases, useRefreshAll } from "@/lib/queries";
import { formatMinor } from "@/lib/money";
import { friendlyError } from "@/lib/friendly";
import { STATUS_META, type PurchaseStatus } from "@/lib/status";
import { applyPurchaseFilters, isDate, SORTS, type PurchaseFilters, type PurchaseSort } from "@/lib/purchase-filters";
import { EmptyState, FixtureTag, PageHeader, StatusBadge, ToneBadge, Req, RequiredNote } from "@/components/brand";
import { FieldSelect } from "@/components/field-select";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type Row = {
  id: string; title: string; invoice_reference: string | null; total_minor: number; currency: string;
  source: string; status: string; created_at: string; version: number; requested_by: string;
  is_test_fixture: boolean; fixture_label: string | null; supplier_id: string | null; suppliers: { name: string } | null;
};

// Descriptive next-action labels; null means there is nothing to do.
const NEXT_ACTION: Partial<Record<PurchaseStatus, string>> = {
  draft: "Complete the request",
  needs_clarification: "Complete missing details",
  blocked: "Review the failed rule",
  verification_required: "Review supplier change",
  approval_required: "Review spending approval",
  cleared_for_checkout: "Complete merchant setup",
  payment_pending: "Check payment confirmation",
  failed: "Review failed payment",
};

const STATUS_KEYS = Object.keys(STATUS_META) as PurchaseStatus[];
const SORT_KEYS = SORTS.map((s) => s.value) as string[];

type Search = PurchaseFilters & { from?: string };

export const Route = createFileRoute("/_authenticated/purchases/")({
  validateSearch: (s: Record<string, unknown>): Search => ({
    ...(typeof s["q"] === "string" && s["q"] !== "" ? { q: s["q"].slice(0, 200) } : {}),
    ...(typeof s["status"] === "string" && (STATUS_KEYS as string[]).includes(s["status"]) ? { status: s["status"] } : {}),
    ...(s["source"] === "invoice" || s["source"] === "ai_proposal" ? { source: s["source"] } : {}),
    ...(typeof s["supplier"] === "string" && /^(unmatched|[0-9a-f-]{36})$/i.test(s["supplier"]) ? { supplier: s["supplier"] } : {}),
    ...(isDate(s["dfrom"]) ? { dfrom: s["dfrom"] } : {}),
    ...(isDate(s["dto"]) ? { dto: s["dto"] } : {}),
    ...(typeof s["sort"] === "string" && SORT_KEYS.includes(s["sort"]) && s["sort"] !== "newest" ? { sort: s["sort"] as PurchaseSort } : {}),
    ...fromSearch(s),
  }),
  head: () => ({ meta: [{ title: "Purchases — PayPatrol" }, { name: "description", content: "Search and filter invoices and AI purchase proposals in one list." }, { property: "og:title", content: "Purchases — PayPatrol" }, { property: "og:description", content: "PayPatrol invoices, AI proposals and payment-check outcomes." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  component: Purchases,
});

function Purchases() {
  const { orgId, has, userId } = useOrg();
  const q = usePurchases(orgId);
  const refresh = useRefreshAll();
  const search = Route.useSearch();
  const { status, source, supplier, dfrom, dto } = search;
  const sort = search.sort ?? "newest";
  const navigate = Route.useNavigate();
  const here = useHere();
  const filter: "all" | "invoice" | "ai_proposal" = source ?? "all";
  const [text, setText] = useState(search.q ?? "");
  const [showFilters, setShowFilters] = useState(false);
  useEffect(() => { setText(search.q ?? ""); }, [search.q]);

  type Key = "q" | "status" | "source" | "supplier" | "dfrom" | "dto" | "sort";
  const setParam = (k: Key, v: string | undefined) =>
    navigate({
      search: (prev: Search) => {
        const next: Record<string, unknown> = { ...prev };
        if (v === undefined || v === "") delete next[k]; else next[k] = v;
        return next as Search;
      },
      replace: true,
    });
  const clearAll = () => navigate({ search: (prev: Search) => (prev.from ? { from: prev.from } : {}), replace: true });

  // Debounce typing into the URL so it survives refresh and back navigation.
  useEffect(() => {
    const v = text.trim();
    if (v === (search.q ?? "")) return;
    const t = setTimeout(() => setParam("q", v || undefined), 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  useEffect(() => {
    if (q.isLoading) return;
    const y = takeScroll(here);
    if (y !== null) requestAnimationFrame(() => window.scrollTo(0, y));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.isLoading]);

  const all = q.data ?? [];
  const supplierOptions = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of all) if (p.supplier_id) m.set(p.supplier_id, (p.suppliers as { name: string } | null)?.name ?? "Supplier");
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1])).map(([value, label]) => ({ value, label }));
  }, [all]);
  const rows = useMemo(
    () => applyPurchaseFilters(all as unknown as Parameters<typeof applyPurchaseFilters>[0], { q: search.q, source, status, supplier, dfrom, dto, sort }) as unknown as typeof all,
    [all, search.q, source, status, supplier, dfrom, dto, sort],
  );

  // Selection never outlives the filters it was made under, so hidden records cannot be exported.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const scopeKey = JSON.stringify([search.q, source, status, supplier, dfrom, dto]);
  useEffect(() => { setSelected(new Set()); }, [scopeKey]);
  const visibleSelected = rows.filter((p) => selected.has(p.id)) as unknown as Row[];
  const allChecked = rows.length > 0 && visibleSelected.length === rows.length;
  const someChecked = visibleSelected.length > 0;
  const [panelFor, setPanelFor] = useState<Row | null>(null);
  const [batch, setBatch] = useState<null | "review" | "approve" | "reject">(null);
  // Eligibility is re-checked on the server by the RPCs; these lists only decide what is offered.
  const approvable = visibleSelected.filter((p) => p.status === "approval_required" && p.requested_by !== userId); // labelled test data may be approved: approval never reserves budget or pays
  const rejectable = visibleSelected.filter((p) => ["draft", "needs_clarification", "blocked", "verification_required", "approval_required", "cleared_for_checkout"].includes(p.status));

  function toggleAll() {
    setSelected(allChecked ? new Set() : new Set(rows.map((p) => p.id)));
  }
  function toggleOne(id: string) {
    setSelected((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }

  function exportSelected() {
    const chosen = visibleSelected;
    if (chosen.length === 0) { toast.error("Select at least one request first."); return; }
    const lines = [["title", "invoice_reference", "supplier", "amount", "currency", "source", "submitted", "status", "next_action"].join(",")];
    for (const p of chosen) {
      lines.push([
        p.title,
        p.invoice_reference ?? "",
        (p.suppliers as { name: string } | null)?.name ?? "Unmatched",
        formatMinor(p.total_minor, p.currency),
        p.currency,
        p.source === "invoice" ? "Invoice" : "AI proposal",
        new Date(p.created_at).toLocaleDateString("en-CA"),
        STATUS_META[p.status as PurchaseStatus]?.label ?? p.status,
        STATUS_META[p.status as PurchaseStatus]?.next ?? "",
      ].map(csvCell).join(","));
    }
    const url = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "paypatrol-purchases.csv";
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Exported ${chosen.length} request${chosen.length === 1 ? "" : "s"}.`);
  }

  const chips: { key: Key; label: string }[] = [];
  if (search.q) chips.push({ key: "q", label: `Search: “${search.q}”` });
  if (source) chips.push({ key: "source", label: source === "invoice" ? "Invoices" : "AI proposals" });
  if (status) chips.push({ key: "status", label: `Status: ${STATUS_META[status as PurchaseStatus]?.label ?? status}` });
  if (supplier) chips.push({ key: "supplier", label: `Supplier: ${supplier === "unmatched" ? "Unmatched" : supplierOptions.find((o) => o.value === supplier)?.label ?? "Selected supplier"}` });
  if (dfrom) chips.push({ key: "dfrom", label: `Submitted from ${dfrom}` });
  if (dto) chips.push({ key: "dto", label: `Submitted to ${dto}` });

  return (
    <>
      <BackLink to="/overview" label="Back to overview" optional />
      <PageHeader
        title="Purchases"
        description="Invoices and AI proposals pass through the same checks."
        actions={
          <>
            <Button asChild><Link to="/purchases/new-invoice" search={{ from: here }}>Check an invoice</Link></Button>
            <Button asChild variant="outline"><Link to="/purchases/new-proposal" search={{ from: here }}>Create AI purchase request</Link></Button>
          </>
        }
      />

      <div className="mb-3">
        <Label htmlFor="purchase-search" className="sr-only">Search purchases</Label>
        <Input
          id="purchase-search"
          type="search"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Search requests, invoice references or suppliers"
          className="bg-card text-sm"
        />
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div role="group" aria-label="Filter by source" className="flex gap-2">
          {(["all", "invoice", "ai_proposal"] as const).map((f) => (
            <Button key={f} size="sm" variant={filter === f ? "default" : "outline"} onClick={() => setParam("source", f === "all" ? undefined : f)} aria-pressed={filter === f}>
              {f === "all" ? "All" : f === "invoice" ? "Invoices" : "AI proposals"}
            </Button>
          ))}
        </div>
      </div>

      {(() => { const n = [status, supplier, dfrom, dto].filter(Boolean).length + (sort !== "newest" ? 1 : 0); return (
        <Button size="sm" variant="outline" className="mb-3 sm:hidden" aria-expanded={showFilters} aria-controls="purchase-filters" onClick={() => setShowFilters((v) => !v)}>
          {showFilters ? "Hide filters" : "Filters and sorting"}{n ? ` (${n})` : ""}
        </Button>
      ); })()}
      <div id="purchase-filters" className={`mb-3 grid-cols-2 gap-2 sm:grid sm:grid-cols-3 lg:grid-cols-5 ${showFilters ? "grid" : "hidden"}`}>
        <div className="col-span-2 sm:col-span-1">
          <Label htmlFor="f-status" className="mb-1 block text-xs text-muted-foreground">Status</Label>
          <FieldSelect id="f-status" value={status ?? ""} onChange={(v) => setParam("status", v)} placeholder="Any status"
            options={[{ value: "", label: "Any status" }, ...STATUS_KEYS.map((s) => ({ value: s, label: STATUS_META[s].label }))]} />
        </div>
        <div className="col-span-2 sm:col-span-1">
          <Label htmlFor="f-supplier" className="mb-1 block text-xs text-muted-foreground">Supplier</Label>
          <FieldSelect id="f-supplier" value={supplier ?? ""} onChange={(v) => setParam("supplier", v)} placeholder="Any supplier"
            options={[{ value: "", label: "Any supplier" }, ...supplierOptions, { value: "unmatched", label: "Unmatched" }]} />
        </div>
        <div>
          <Label htmlFor="f-dfrom" className="mb-1 block text-xs text-muted-foreground">Submitted from</Label>
          <Input id="f-dfrom" type="date" value={dfrom ?? ""} max={dto} onChange={(e) => setParam("dfrom", e.target.value)} className="bg-card" />
        </div>
        <div>
          <Label htmlFor="f-dto" className="mb-1 block text-xs text-muted-foreground">Submitted to</Label>
          <Input id="f-dto" type="date" value={dto ?? ""} min={dfrom} onChange={(e) => setParam("dto", e.target.value)} className="bg-card" />
        </div>
        <div className="col-span-2 sm:col-span-1">
          <Label htmlFor="f-sort" className="mb-1 block text-xs text-muted-foreground">Sort by</Label>
          <FieldSelect id="f-sort" value={sort} onChange={(v) => setParam("sort", v === "newest" ? undefined : v)} options={SORTS} />
        </div>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm" aria-live="polite">
        <span className="font-medium">
          {q.isLoading ? "Loading…" : `${rows.length} of ${all.length} request${all.length === 1 ? "" : "s"}`}
        </span>
        {chips.map((c) => (
          <button key={c.key} type="button" onClick={() => setParam(c.key, undefined)}
            className="inline-flex items-center gap-1 rounded-full border bg-selected px-2.5 py-0.5 text-xs hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={`Remove filter ${c.label}`}>
            {c.label}<X className="h-3 w-3" aria-hidden />
          </button>
        ))}
        {chips.length > 0 && <Button size="sm" variant="ghost" onClick={clearAll}>Clear all</Button>}
      </div>

      {q.isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : rows.length === 0 ? (
        <EmptyState>
          <p className="font-medium">No purchases match your search</p>
          {chips.length > 0 && <Button size="sm" variant="outline" className="mt-3" onClick={clearAll}>Clear search and filters</Button>}
        </EmptyState>
      ) : (
        <>
          <div role="region" aria-label="Selection actions" className="sticky top-14 z-20 -mx-4 mb-2 flex flex-wrap items-center gap-2 border-b bg-background/95 px-4 py-2 text-sm backdrop-blur sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
            <span className="text-muted-foreground">
              {visibleSelected.length === 0 ? "Select requests to review or export them." : `${visibleSelected.length} of ${rows.length} shown selected`}
            </span>
            {visibleSelected.length > 0 && (
              <>
                <Button size="sm" variant="outline" onClick={() => setBatch("review")}>Review selected</Button>
                <Button size="sm" variant="outline" onClick={exportSelected}>Export selected (CSV)</Button>
                {has("payer", "owner") && (
                  <Button size="sm" variant="outline" disabled={approvable.length === 0} onClick={() => setBatch("approve")}>
                    Approve eligible ({approvable.length})
                  </Button>
                )}
                {has("preparer", "owner") && (
                  <Button size="sm" variant="outline" disabled={rejectable.length === 0} onClick={() => setBatch("reject")}>
                    Reject eligible ({rejectable.length})
                  </Button>
                )}
                <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Clear selection</Button>
              </>
            )}
            <span className="w-full text-xs text-muted-foreground">Selection covers only the matching requests shown below and resets when search or filters change.</span>
            {has("payer", "owner") && visibleSelected.some((p) => !approvable.includes(p)) && (
              <div className="w-full rounded-md border border-warning/40 bg-warning-soft p-2 text-xs" aria-live="polite">
                <p className="font-semibold text-foreground">Why some selected requests can't be approved here</p>
                <ul className="mt-1 space-y-1">
                  {visibleSelected.filter((p) => !approvable.includes(p)).map((p) => (
                    <li key={p.id}>
                      <span className="font-medium">{p.fixture_label ?? p.title}</span> ({formatMinor(p.total_minor, p.currency)}): {exclusionReason(p, userId)}{" "}
                      <Link to="/purchases/$id" params={{ id: p.id }} search={{ from: here }} className="font-semibold text-brand-deep underline">{exclusionAction(p)}</Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          <ul className="space-y-2 sm:hidden" aria-label="Requests">
            {rows.map((p) => (
              <li key={p.id} className="flex gap-3 rounded-lg border bg-card p-3">
                <Checkbox className="mt-1" aria-label={`Select ${p.title}`} checked={selected.has(p.id)} onCheckedChange={() => toggleOne(p.id)} />
                <div className="min-w-0 flex-1 space-y-1">
                  <Link to="/purchases/$id" params={{ id: p.id }} search={{ from: here }} onClick={() => rememberScroll(here)} className="block font-medium text-brand-deep underline-offset-2 hover:underline">{p.title}</Link>
                  {p.invoice_reference && <div className="text-xs text-muted-foreground">Ref {p.invoice_reference}</div>}
                  {p.is_test_fixture && <FixtureTag label={p.fixture_label} />}
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono tabular-nums font-semibold">{formatMinor(p.total_minor, p.currency)}</span>
                    <StatusBadge status={p.status} />
                  </div>
                  {NEXT_ACTION[p.status as PurchaseStatus] && (
                    <button type="button" onClick={() => setPanelFor(p as unknown as Row)} className="text-left text-sm text-brand-deep underline">
                      Next: {NEXT_ACTION[p.status as PurchaseStatus]}
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
          <div className="relative hidden overflow-x-auto rounded-lg border bg-card sm:block">
            <table className="w-full text-sm">
              <thead className="bg-muted text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="w-10 px-3 py-3">
                    <Checkbox aria-label="Select all matching requests" checked={allChecked ? true : someChecked ? "indeterminate" : false} onCheckedChange={toggleAll} />
                  </th>
                  <th className="px-4 py-3">Request</th>
                  <th className="px-4 py-3">Supplier</th>
                  <th className="px-4 py-3 text-right">Amount</th>
                  <th className="px-4 py-3">Source</th>
                  <th className="px-4 py-3">Submitted</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Next action</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.map((p) => (
                  <tr key={p.id} className="hover:bg-selected/50">
                    <td className="px-3 py-3">
                      <Checkbox aria-label={`Select ${p.title}`} checked={selected.has(p.id)} onCheckedChange={() => toggleOne(p.id)} />
                    </td>
                    <td className="px-4 py-3">
                      <Link to="/purchases/$id" params={{ id: p.id }} search={{ from: here }} onClick={() => rememberScroll(here)} className="font-medium text-brand-deep underline-offset-2 hover:underline">{p.title}</Link>
                      {p.invoice_reference && <div className="text-xs text-muted-foreground">Ref {p.invoice_reference}</div>}
                      {p.is_test_fixture && <div className="mt-1"><FixtureTag label={p.fixture_label} /></div>}
                    </td>
                    <td className="px-4 py-3">{(p.suppliers as { name: string } | null)?.name ?? "Unmatched"}</td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums">{formatMinor(p.total_minor, p.currency)}</td>
                    <td className="px-4 py-3">{p.source === "invoice" ? "Invoice" : "AI proposal"}</td>
                    <td className="px-4 py-3 whitespace-nowrap">{new Date(p.created_at).toLocaleDateString("en-CA")}</td>
                    <td className="px-4 py-3"><StatusBadge status={p.status} /></td>
                    <td className="px-4 py-3">
                      {NEXT_ACTION[p.status as PurchaseStatus] ? (
                        <button type="button" onClick={() => setPanelFor(p as unknown as Row)} className="text-left text-brand-deep underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                          {NEXT_ACTION[p.status as PurchaseStatus]}
                        </button>
                      ) : (
                        <span className="text-muted-foreground">None</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {panelFor && <NextActionPanel p={panelFor} here={here} onClose={() => setPanelFor(null)} />}
      {batch && (
        <BatchDialog kind={batch} rows={visibleSelected} approvable={approvable} rejectable={rejectable} userId={userId} here={here}
          onClose={() => setBatch(null)} onDone={() => { setBatch(null); setSelected(new Set()); refresh(); }} />
      )}
    </>
  );
}

/** Side panel explaining what holds a request and what the viewer may do next. Full-width on mobile. */
function NextActionPanel({ p, here, onClose }: { p: Row; here: string; onClose: () => void }) {
  const { has, userId } = useOrg();
  const findings = useQuery({
    queryKey: ["findings", p.id, p.version],
    queryFn: async () => {
      const { data } = await supabase.from("findings").select("*").eq("purchase_id", p.id).eq("purchase_version", p.version).order("created_at");
      return data ?? [];
    },
  });
  const status = p.status as PurchaseStatus;
  const detail = { to: "/purchases/$id", params: { id: p.id }, search: { from: here } } as const;
  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={`Next action for ${p.title}`}>
      <button type="button" aria-label="Close" className="absolute inset-0 bg-foreground/30" onClick={onClose} />
      <div className="absolute inset-0 overflow-y-auto bg-card p-6 sm:inset-y-0 sm:left-auto sm:right-0 sm:w-full sm:max-w-md sm:border-l sm:shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">{p.title}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {formatMinor(p.total_minor, p.currency)} · {p.suppliers?.name ?? "Unmatched"} · submitted {new Date(p.created_at).toLocaleDateString("en-CA")}
            </p>
          </div>
          <Button size="sm" variant="ghost" onClick={onClose} aria-label="Close panel"><X className="h-4 w-4" /></Button>
        </div>
        <div className="mt-3"><StatusBadge status={p.status} /></div>
        {status === "failed" && <p className="mt-3 rounded-md border border-warning/40 bg-warning-soft p-3 text-sm">A payment was attempted for this request and did not complete. Any reserved budget stays in place until the outcome is certain.</p>}
        {status === "blocked" && <p className="mt-3 rounded-md border bg-muted p-3 text-sm">This request was stopped before any payment was attempted.</p>}
        <h3 className="mt-4 text-xs font-semibold uppercase text-muted-foreground">What is holding it</h3>
        {findings.isLoading ? <p className="mt-2 text-sm text-muted-foreground">Loading checks…</p> : (findings.data ?? []).length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">No failed rules on the current version.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {(findings.data ?? []).map((f) => (
              <li key={f.id} className="rounded-md border p-3 text-sm">
                <ToneBadge tone={f.severity === "block" ? "blocked" : f.severity === "warning" ? "warning" : "info"}>{f.severity === "block" ? "Failed rule" : f.severity === "warning" ? "Hold" : "Note"}</ToneBadge>
                <p className="mt-1">{f.message}</p>
                {f.next_action && <p className="mt-1 text-muted-foreground"><span className="font-semibold text-foreground">Next:</span> {f.next_action}</p>}
              </li>
            ))}
          </ul>
        )}
        <h3 className="mt-4 text-xs font-semibold uppercase text-muted-foreground">What you can do</h3>
        <div className="mt-2 flex flex-col items-start gap-2">
          {status === "needs_clarification" && (has("preparer", "owner")
            ? <Button asChild size="sm"><Link {...detail} onClick={() => rememberScroll(here)}>Open and complete missing details</Link></Button>
            : <p className="text-sm text-muted-foreground">A request preparer or owner must complete the missing details.</p>)}
          {status === "verification_required" && <Button asChild size="sm"><Link {...detail} onClick={() => rememberScroll(here)}>Open supplier-change review</Link></Button>}
          {status === "approval_required" && (has("payer", "owner") && p.requested_by !== userId
            ? <Button asChild size="sm"><Link to="/approvals" search={{ from: here }}>Review in Approvals</Link></Button>
            : <p className="text-sm text-muted-foreground">A different team member with the payer or owner role must approve this exact version.</p>)}
          {status === "cleared_for_checkout" && (has("payer", "owner")
            ? <Button asChild size="sm"><Link {...detail} onClick={() => rememberScroll(here)}>Open checkout</Link></Button>
            : <p className="text-sm text-muted-foreground">Only an owner or payer can reserve budget and pay.</p>)}
          {(status === "payment_pending" || status === "failed") && <Button asChild size="sm"><Link {...detail} onClick={() => rememberScroll(here)}>Check payment confirmation</Link></Button>}
          {status === "blocked" && (
            <>
              <Button asChild size="sm" variant="outline"><Link {...detail} onClick={() => rememberScroll(here)}>Open request</Link></Button>
              {has("owner")
                ? <Button asChild size="sm" variant="outline"><Link to="/rules">Review spending rules</Link></Button>
                : <p className="text-sm text-muted-foreground">Only an owner can change the spending rules that stopped this request.</p>}
            </>
          )}
          {status === "draft" && <Button asChild size="sm"><Link {...detail} onClick={() => rememberScroll(here)}>Open the request</Link></Button>}
        </div>
      </div>
    </div>
  );
}

function whyNotApprove(p: Row, userId: string): string {
  if (p.status !== "approval_required") return `not awaiting spending approval (${STATUS_META[p.status as PurchaseStatus]?.label ?? p.status})`;
  if (p.requested_by === userId) return "you submitted it, so a different payer must approve it";
  return "";
}
function exclusionReason(p: Row, userId: string): string {
  if (p.status === "verification_required") return "supplier payment details must be independently verified first — this is a separate review, not spending approval.";
  if (p.status === "blocked") return "it breaks a hard spending rule, so no approval can override it. Revise or cancel it.";
  if (p.status === "needs_clarification") return "details are missing and must be corrected first.";
  if (p.status === "approval_required" && p.requested_by === userId) return "you submitted it, so a different Payer or Business owner must approve it.";
  if (p.status !== "approval_required") return `it is not awaiting spending approval (${STATUS_META[p.status as PurchaseStatus]?.label ?? p.status}).`;
  return "";
}
function exclusionAction(p: Row): string {
  if (p.status === "verification_required") return "Open supplier review";
  if (p.status === "blocked") return "See the failed rule";
  if (p.status === "needs_clarification") return "Add missing details";
  return "Open request";
}
function whyNotReject(p: Row): string {
  if (p.status === "payment_pending") return "payment outcome is uncertain — never cancelled in bulk";
  if (["paid", "failed", "cancelled"].includes(p.status)) return `already ${(STATUS_META[p.status as PurchaseStatus]?.label ?? p.status).toLowerCase()}`;
  return "";
}

/** Controlled batch review: approve or reject only genuinely eligible requests, re-validated by the server. */
function BatchDialog({ kind, rows, approvable, rejectable, userId, here, onClose, onDone }: {
  kind: "review" | "approve" | "reject"; rows: Row[]; approvable: Row[]; rejectable: Row[]; userId: string; here: string;
  onClose: () => void; onDone: () => void;
}) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<{ id: string; title: string; ok: boolean; message: string }[] | null>(null);

  async function runApprove() {
    setBusy(true);
    const out: NonNullable<typeof results> = [];
    for (const p of approvable) {
      const { error } = await supabase.rpc("approve_purchase", { _pid: p.id, _version: p.version, _via: "batch", ...(note ? { _note: note } : {}) });
      out.push({ id: p.id, title: p.title, ok: !error, message: error ? friendlyError(error, "Approval") : "Approved" });
    }
    setResults(out);
    setBusy(false);
  }
  async function runReject() {
    if (!note.trim()) return;
    setBusy(true);
    const out: NonNullable<typeof results> = [];
    for (const p of rejectable) {
      // Awaiting spending approval and decided by someone else: record a spending rejection.
      // Anything else is a request cancellation, kept distinct from rejection.
      const spending = p.status === "approval_required" && p.requested_by !== userId;
      const { error } = spending
        ? await supabase.rpc("reject_spending", { _pid: p.id, _version: p.version, _reason: note.trim() })
        : await supabase.rpc("cancel_purchase", { _pid: p.id, _reason: note.trim() });
      out.push({ id: p.id, title: p.title, ok: !error, message: error ? friendlyError(error, "Rejection") : spending ? "Spending rejected" : "Request cancelled" });
    }
    setResults(out);
    setBusy(false);
  }

  const eligible = kind === "approve" ? approvable : rejectable;
  const excluded = rows.filter((r) => !eligible.some((a) => a.id === r.id));
  const why = (p: Row) => (kind === "approve" ? whyNotApprove(p, userId) : whyNotReject(p));

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-center sm:items-center" role="dialog" aria-modal="true"
      aria-label={kind === "review" ? "Review selected" : kind === "approve" ? "Approve eligible requests" : "Reject eligible requests"}>
      <button type="button" aria-label="Close" className="absolute inset-0 bg-foreground/30" onClick={onClose} />
      <div className="relative max-h-full w-full overflow-y-auto bg-card p-6 sm:max-w-lg sm:rounded-lg sm:border sm:shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-lg font-semibold">
            {kind === "review" ? `Review ${rows.length} selected` : kind === "approve" ? "Approve eligible requests" : "Reject eligible requests"}
          </h2>
          <Button size="sm" variant="ghost" onClick={onClose} aria-label="Close dialog"><X className="h-4 w-4" /></Button>
        </div>

        {results ? (
          <>
            <ul className="mt-4 space-y-2 text-sm">
              {results.map((r) => (
                <li key={r.id} className="rounded-md border p-3">
                  <span className="font-medium">{r.title}</span> — {r.ok ? <ToneBadge tone="success">{r.message}</ToneBadge> : <ToneBadge tone="blocked">{r.message}</ToneBadge>}
                </li>
              ))}
            </ul>
            <Button className="mt-4" onClick={onDone}>Done</Button>
          </>
        ) : kind === "review" ? (
          <ul className="mt-4 space-y-2 text-sm">
            {rows.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3">
                <Link to="/purchases/$id" params={{ id: p.id }} search={{ from: here }} onClick={() => { rememberScroll(here); onClose(); }} className="font-medium text-brand-deep underline-offset-2 hover:underline">{p.title}</Link>
                <StatusBadge status={p.status} />
              </li>
            ))}
          </ul>
        ) : (
          <>
            <p className="mt-3 text-sm text-muted-foreground">
              {kind === "approve"
                ? "Approval applies only to the exact current version of each request. Spending limits, supplier holds and missing information are re-checked when each approval runs — selecting a request never overrides them."
                : "Rejection cancels the request and keeps its history. Requests with an uncertain payment outcome are never included."}
            </p>
            <h3 className="mt-4 text-xs font-semibold uppercase text-muted-foreground">Eligible ({eligible.length})</h3>
            <ul className="mt-2 space-y-1 text-sm">
              {eligible.map((p) => <li key={p.id}>{p.title} — {formatMinor(p.total_minor, p.currency)}</li>)}
              {eligible.length === 0 && <li className="text-muted-foreground">None of the selected requests are eligible.</li>}
            </ul>
            {excluded.length > 0 && (
              <>
                <h3 className="mt-4 text-xs font-semibold uppercase text-muted-foreground">Excluded ({excluded.length})</h3>
                <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
                  {excluded.map((p) => <li key={p.id}>{p.title} — {why(p)}</li>)}
                </ul>
              </>
            )}
            <div className="mt-4 space-y-1">
              {kind === "reject" && <RequiredNote />}
              <Label htmlFor="batch-note">{kind === "approve" ? "Note (optional)" : <>Reason for rejection{<Req />}</>}</Label>
              <Textarea id="batch-note" aria-required={kind === "reject"} aria-describedby="batch-note-help" value={note} onChange={(e) => setNote(e.target.value)} placeholder={kind === "reject" ? "Why are these being rejected?" : "Optional"} />
              {kind === "reject" && <p id="batch-note-help" className={`text-xs ${note.trim() ? "text-muted-foreground" : "font-medium text-destructive"}`}>{note.trim() ? "Reason recorded with each rejection." : "Enter a reason to enable rejection."}</p>}
            </div>
            <div className="mt-4 flex gap-2">
              {kind === "approve"
                ? <Button disabled={busy || eligible.length === 0} onClick={runApprove}>{busy ? "Approving…" : `Approve ${eligible.length} request${eligible.length === 1 ? "" : "s"}`}</Button>
                : <Button variant="destructive" disabled={busy || eligible.length === 0 || !note.trim()} onClick={runReject}>{busy ? "Rejecting…" : `Reject ${eligible.length} request${eligible.length === 1 ? "" : "s"}`}</Button>}
              <Button variant="ghost" onClick={onClose}>Cancel</Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
