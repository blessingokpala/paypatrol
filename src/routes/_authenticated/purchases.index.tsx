import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useOrg } from "@/lib/org";
import { usePurchases } from "@/lib/queries";
import { formatMinor } from "@/lib/money";
import { STATUS_META, type PurchaseStatus } from "@/lib/status";
import { EmptyState, FixtureTag, PageHeader, StatusBadge } from "@/components/brand";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/purchases/")({
  head: () => ({ meta: [{ title: "Purchases — PayPatrol" }, { name: "description", content: "Invoices and AI purchase proposals in one list." }, { property: "og:title", content: "Purchases — PayPatrol" }, { property: "og:description", content: "PayPatrol invoices, AI proposals and payment-check outcomes." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  component: Purchases,
});

function Purchases() {
  const { orgId } = useOrg();
  const q = usePurchases(orgId);
  const [filter, setFilter] = useState<"all" | "invoice" | "ai_proposal">("all");
  const rows = (q.data ?? []).filter((p) => filter === "all" || p.source === filter);
  return (
    <>
      <PageHeader
        title="Purchases"
        description="Invoices and AI proposals pass through the same checks."
        actions={
          <>
            <Button asChild><Link to="/purchases/new-invoice">Check an invoice</Link></Button>
            <Button asChild variant="outline"><Link to="/purchases/new-proposal">Create AI purchase request</Link></Button>
          </>
        }
      />
      <div role="group" aria-label="Filter by source" className="mb-4 flex gap-2">
        {(["all", "invoice", "ai_proposal"] as const).map((f) => (
          <Button key={f} size="sm" variant={filter === f ? "default" : "outline"} onClick={() => setFilter(f)} aria-pressed={filter === f}>
            {f === "all" ? "All" : f === "invoice" ? "Invoices" : "AI proposals"}
          </Button>
        ))}
      </div>
      {q.isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : rows.length === 0 ? <EmptyState>No requests yet.</EmptyState> : (
        <div className="overflow-x-auto rounded-lg border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-muted text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
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
                  <td className="px-4 py-3">
                    <Link to="/purchases/$id" params={{ id: p.id }} className="font-medium text-brand-deep underline-offset-2 hover:underline">{p.title}</Link>
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
      )}
    </>
  );
}
