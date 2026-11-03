import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import { BackLink, useHere } from "@/components/back-link";
import { fromSearch, rememberScroll, takeScroll } from "@/lib/return-to";
import { useOrg } from "@/lib/org";
import { usePurchases } from "@/lib/queries";
import { formatMinor } from "@/lib/money";
import { STATUS_META, type PurchaseStatus } from "@/lib/status";
import { applyPurchaseFilters, isDate, SORTS, type PurchaseFilters, type PurchaseSort } from "@/lib/purchase-filters";
import { EmptyState, FixtureTag, PageHeader, StatusBadge } from "@/components/brand";
import { FieldSelect } from "@/components/field-select";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

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
  const { orgId } = useOrg();
  const q = usePurchases(orgId);
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
  const visibleSelected = rows.filter((p) => selected.has(p.id));
  const allChecked = rows.length > 0 && visibleSelected.length === rows.length;
  const someChecked = visibleSelected.length > 0;

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
      ].map((v) => `"${String(v).replaceAll('"', '""')}"`).join(","));
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
          className="bg-card text-sm placeholder:text-muted-foreground/70"
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
          <div className="mb-2 flex flex-wrap items-center gap-3 text-sm">
            <span className="text-muted-foreground">
              {visibleSelected.length === 0 ? "Select requests to export their summaries." : `${visibleSelected.length} of ${rows.length} shown selected`}
            </span>
            {visibleSelected.length > 0 && (
              <>
                <Button size="sm" variant="outline" onClick={exportSelected}>Export selected (CSV)</Button>
                <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Clear selection</Button>
              </>
            )}
            <span className="text-xs text-muted-foreground">Selection covers only the matching requests shown below and resets when search or filters change.</span>
          </div>
          <div className="relative overflow-x-auto rounded-lg border bg-card">
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
                      {p.is_test_fixture && <div className="mt-1"><FixtureTag /></div>}
                    </td>
                    <td className="px-4 py-3">{(p.suppliers as { name: string } | null)?.name ?? "Unmatched"}</td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums">{formatMinor(p.total_minor, p.currency)}</td>
                    <td className="px-4 py-3">{p.source === "invoice" ? "Invoice" : "AI proposal"}</td>
                    <td className="px-4 py-3 whitespace-nowrap">{new Date(p.created_at).toLocaleDateString("en-CA")}</td>
                    <td className="px-4 py-3"><StatusBadge status={p.status} /></td>
                    <td className="px-4 py-3 text-muted-foreground">{STATUS_META[p.status as PurchaseStatus]?.next}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
