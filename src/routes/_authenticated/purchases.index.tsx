import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { BackLink, useHere } from "@/components/back-link";
import { fromSearch, rememberScroll, takeScroll } from "@/lib/return-to";
import { useOrg } from "@/lib/org";
import { usePurchases } from "@/lib/queries";
import { formatMinor } from "@/lib/money";
import { STATUS_META, type PurchaseStatus } from "@/lib/status";
import { EmptyState, FixtureTag, PageHeader, StatusBadge } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";

const STATUS_FILTERS = ["verification_required", "approval_required", "blocked", "needs_clarification", "cleared_for_checkout", "payment_pending", "paid"] as const;

export const Route = createFileRoute("/_authenticated/purchases/")({
  validateSearch: (s: Record<string, unknown>): { status?: string; source?: "invoice" | "ai_proposal"; from?: string } => ({
    ...(typeof s["status"] === "string" && (STATUS_FILTERS as readonly string[]).includes(s["status"]) ? { status: s["status"] } : {}),
    ...(s["source"] === "invoice" || s["source"] === "ai_proposal" ? { source: s["source"] } : {}),
    ...fromSearch(s),
  }),
  head: () => ({ meta: [{ title: "Purchases — PayPatrol" }, { name: "description", content: "Invoices and AI purchase proposals in one list." }, { property: "og:title", content: "Purchases — PayPatrol" }, { property: "og:description", content: "PayPatrol invoices, AI proposals and payment-check outcomes." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  component: Purchases,
});

function Purchases() {
  const { orgId } = useOrg();
  const q = usePurchases(orgId);
  const { status, source } = Route.useSearch();
  const navigate = Route.useNavigate();
  const here = useHere();
  const filter: "all" | "invoice" | "ai_proposal" = source ?? "all";
  const setFilter = (f: "all" | "invoice" | "ai_proposal") =>
    navigate({ search: ({ source: _s, ...rest }) => (f === "all" ? rest : { ...rest, source: f }), replace: true });
  // Restore the scroll position saved when a request was opened from this exact view.
  useEffect(() => {
    if (q.isLoading) return;
    const y = takeScroll(here);
    if (y !== null) requestAnimationFrame(() => window.scrollTo(0, y));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.isLoading]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const rows = useMemo(
    () => (q.data ?? []).filter((p) => (filter === "all" || p.source === filter) && (!status || p.status === status)),
    [q.data, filter, status],
  );
  const allChecked = rows.length > 0 && rows.every((p) => selected.has(p.id));
  const someChecked = rows.some((p) => selected.has(p.id));

  function toggleAll() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allChecked) rows.forEach((p) => next.delete(p.id));
      else rows.forEach((p) => next.add(p.id));
      return next;
    });
  }
  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function exportSelected() {
    const chosen = rows.filter((p) => selected.has(p.id));
    if (chosen.length === 0) { toast.error("Select at least one request first."); return; }
    const lines = [["title", "supplier", "amount", "currency", "source", "date", "status", "next_action"].join(",")];
    for (const p of chosen) {
      lines.push([
        p.title,
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
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div role="group" aria-label="Filter by source" className="flex gap-2">
          {(["all", "invoice", "ai_proposal"] as const).map((f) => (
            <Button key={f} size="sm" variant={filter === f ? "default" : "outline"} onClick={() => setFilter(f)} aria-pressed={filter === f}>
              {f === "all" ? "All" : f === "invoice" ? "Invoices" : "AI proposals"}
            </Button>
          ))}
        </div>
        {status && (
          <Button size="sm" variant="outline" onClick={() => navigate({ search: ({ status: _st, ...rest }) => rest, replace: true })}>
            Showing: {STATUS_META[status as PurchaseStatus]?.label ?? status} — clear
          </Button>
        )}
      </div>
      {q.isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : rows.length === 0 ? <EmptyState>No requests match.</EmptyState> : (
        <>
          <div className="mb-2 flex flex-wrap items-center gap-3 text-sm">
            <span className="text-muted-foreground">
              {selected.size === 0 ? "Select requests to export their summaries." : `${selected.size} selected`}
            </span>
            {selected.size > 0 && (
              <>
                <Button size="sm" variant="outline" onClick={exportSelected}>Export selected (CSV)</Button>
                <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Clear selection</Button>
              </>
            )}
            <span className="text-xs text-muted-foreground">Selection covers the requests currently shown by the filters above.</span>
          </div>
          <div className="overflow-x-auto rounded-lg border bg-card">
            <table className="w-full text-sm">
              <thead className="bg-muted text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="w-10 px-3 py-3">
                    <Checkbox
                      aria-label="Select all shown requests"
                      checked={allChecked ? true : someChecked ? "indeterminate" : false}
                      onCheckedChange={toggleAll}
                    />
                  </th>
                  <th className="px-4 py-3">Request</th>
                  <th className="px-4 py-3">Supplier</th>
                  <th className="px-4 py-3 text-right">Amount</th>
                  <th className="px-4 py-3">Source</th>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Next action</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.map((p) => (
                  <tr key={p.id} className="hover:bg-selected/50">
                    <td className="px-3 py-3">
                      <Checkbox
                        aria-label={`Select ${p.title}`}
                        checked={selected.has(p.id)}
                        onCheckedChange={() => toggleOne(p.id)}
                      />
                    </td>
                    <td className="px-4 py-3">
                      <Link to="/purchases/$id" params={{ id: p.id }} search={{ from: here }} onClick={() => rememberScroll(here)} className="font-medium text-brand-deep underline-offset-2 hover:underline">{p.title}</Link>
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
