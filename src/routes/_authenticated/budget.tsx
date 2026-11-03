import { fromSearch } from "@/lib/return-to";
import { createFileRoute } from "@tanstack/react-router";
import { useOrg } from "@/lib/org";
import { useBudget, usePurchases } from "@/lib/queries";
import { formatMinor } from "@/lib/money";
import { PageHeader, Panel, StatusBadge } from "@/components/brand";
import { BackLink } from "@/components/back-link";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/budget")({
  validateSearch: fromSearch,
  head: () => ({ meta: [{ title: "Weekly budget — PayPatrol" }, { name: "description", content: "Weekly limit, spent, reserved and available budget." }, { property: "og:title", content: "Weekly budget — PayPatrol" }, { property: "og:description", content: "PayPatrol weekly budget breakdown." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  component: BudgetPage,
});

function BudgetPage() {
  const { orgId } = useOrg();
  const budget = useBudget(orgId);
  const purchases = usePurchases(orgId);
  const reservations = useQuery({
    queryKey: ["reservations", orgId],
    queryFn: async () => {
      const { data, error } = await supabase.from("budget_reservations").select("*").eq("org_id", orgId).eq("status", "active");
      if (error) throw error;
      return data ?? [];
    },
  });
  const b = budget.data;
  const ready = Boolean(b) && !reservations.isLoading;
  useEffect(() => {
    if (ready && window.location.hash === "#active-reservations") {
      const el = document.getElementById("active-reservations");
      el?.scrollIntoView({ block: "start" });
      (el?.nextElementSibling as HTMLElement | null)?.focus?.();
    }
  }, [ready]);
  const reservedIds = new Set((reservations.data ?? []).map((r) => r.purchase_id));
  const reservedPurchases = (purchases.data ?? []).filter((p) => reservedIds.has(p.id));

  return (
    <>
      <BackLink to="/overview" label="Back to overview" />
      <PageHeader title="Weekly budget" description="How this week's limit is being used. Reservations hold budget for checkout; uncertain payments keep their reservation." />
      {budget.isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : !b ? <p className="text-sm text-muted-foreground">No budget information available.</p> : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Weekly limit" value={formatMinor(b.weekly_limit_minor, b.currency)} />
            <Stat label="Spent" value={formatMinor(b.spent_minor, b.currency)} />
            <Stat label="Reserved" value={formatMinor(b.reserved_minor, b.currency)} />
            <Stat label="Available" value={formatMinor(b.available_minor, b.currency)} />
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Week starts {new Date(b.week_start).toLocaleDateString("en-CA", { timeZone: b.timezone })} ({b.timezone}) · rules version {b.policy_version}. Limits are changed under Spending rules.
          </p>
          <div id="active-reservations" className="scroll-mt-20" />
          <Panel title="Active reservations" className="mt-6">
            {reservedPurchases.length === 0 ? (
              <p className="text-sm text-muted-foreground">No budget is reserved right now.</p>
            ) : (
              <ul className="divide-y">
                {reservedPurchases.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                    <Link to="/purchases/$id" params={{ id: p.id }} search={{ from: here }} className="font-medium text-brand-deep underline-offset-2 hover:underline">{p.title}</Link>
                    <span className="flex items-center gap-3">
                      <span className="font-mono text-sm tabular-nums">{formatMinor(p.total_minor, p.currency)}</span>
                      <StatusBadge status={p.status} />
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </>
      )}
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-bold">{value}</p>
    </div>
  );
}
