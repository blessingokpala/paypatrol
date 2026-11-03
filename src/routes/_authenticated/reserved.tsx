import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fromSearch } from "@/lib/return-to";
import { useOrg } from "@/lib/org";
import { useBudget } from "@/lib/queries";
import { formatMinor } from "@/lib/money";
import { EmptyState, PageHeader, StatusBadge } from "@/components/brand";
import { BackLink, useHere } from "@/components/back-link";

export const Route = createFileRoute("/_authenticated/reserved")({
  validateSearch: fromSearch,
  head: () => ({ meta: [{ title: "Reserved purchases — PayPatrol" }, { name: "description", content: "Purchases with budget set aside for checkout this week." }, { property: "og:title", content: "Reserved purchases — PayPatrol" }, { property: "og:description", content: "Active budget reservations in PayPatrol." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  component: ReservedPage,
});

function ReservedPage() {
  const { orgId } = useOrg();
  const here = useHere();
  const budget = useBudget(orgId);
  const weekStart = budget.data?.week_start ?? null;
  // Same records and conditions as the Reserved card (org_budget_summary):
  // this organisation, status = active, period_start = the current policy week.
  const q = useQuery({
    queryKey: ["reserved", orgId, weekStart],
    enabled: Boolean(weekStart),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("budget_reservations")
        .select("id, amount_minor, currency, created_at, expires_at, purchase_version, purchases(id, title, status, suppliers(name))")
        .eq("org_id", orgId)
        .eq("status", "active")
        .eq("period_start", weekStart as string)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
  const rows = q.data ?? [];
  const b = budget.data;
  const listed = rows.reduce((n, r) => n + Number(r.amount_minor), 0);

  return (
    <>
      <BackLink to="/overview" label="Back to overview" />
      <PageHeader title="Reserved purchases" description="Purchases with budget set aside for checkout in the current week. Uncertain payments keep their reservation until resolved." />
      {budget.isLoading || q.isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : !b ? (
        <EmptyState>No spending rules are active, so nothing can be reserved yet.</EmptyState>
      ) : rows.length === 0 ? (
        <div className="rounded-lg border bg-card p-6">
          <p className="font-semibold">No reserved purchases</p>
          <p className="mt-1 text-sm text-muted-foreground">Budget is set aside when an eligible purchase is reserved for checkout.</p>
        </div>
      ) : (
        <>
          <p className="mb-3 text-sm">Total reserved this week: <strong>{formatMinor(listed, b.currency)}</strong>{listed !== b.reserved_minor && <span className="ml-2 text-blocked">Does not match the overview total — refresh to update.</span>}</p>
          <div className="overflow-x-auto rounded-lg border bg-card">
            <table className="w-full text-sm">
              <thead className="bg-muted text-left text-xs uppercase text-muted-foreground"><tr><th className="px-4 py-3">Purchase</th><th className="px-4 py-3">Supplier</th><th className="px-4 py-3 text-right">Reserved</th><th className="px-4 py-3">Reserved on</th><th className="px-4 py-3">Payment status</th></tr></thead>
              <tbody className="divide-y">
                {rows.map((r) => {
                  const p = r.purchases as { id: string; title: string; status: string; suppliers: { name: string } | null } | null;
                  return (
                    <tr key={r.id}>
                      <td className="px-4 py-3">{p ? <Link to="/purchases/$id" params={{ id: p.id }} search={{ from: here }} className="font-medium text-brand-deep underline-offset-2 hover:underline">{p.title}</Link> : "Purchase not available"}<span className="block text-xs text-muted-foreground">Version {r.purchase_version}</span></td>
                      <td className="px-4 py-3">{p?.suppliers?.name ?? "Not matched"}</td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums">{formatMinor(Number(r.amount_minor), r.currency)}</td>
                      <td className="px-4 py-3 whitespace-nowrap">{new Date(r.created_at).toLocaleString("en-CA")}</td>
                      <td className="px-4 py-3">{p ? <StatusBadge status={p.status} /> : "Not recorded"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
