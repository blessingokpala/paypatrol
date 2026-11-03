import { createFileRoute, Link } from "@tanstack/react-router";
import { fromSearch } from "@/lib/return-to";
import { useOrg } from "@/lib/org";
import { useBudget } from "@/lib/queries";
import { formatMinor } from "@/lib/money";
import { PageHeader, Panel } from "@/components/brand";
import { BackLink } from "@/components/back-link";

export const Route = createFileRoute("/_authenticated/budget")({
  validateSearch: fromSearch,
  head: () => ({ meta: [{ title: "Weekly budget — PayPatrol" }, { name: "description", content: "Weekly limit, spent, reserved and available budget." }, { property: "og:title", content: "Weekly budget — PayPatrol" }, { property: "og:description", content: "PayPatrol weekly budget breakdown." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  component: BudgetPage,
});

function BudgetPage() {
  const { orgId } = useOrg();
  const budget = useBudget(orgId);
  const b = budget.data;

  return (
    <>
      <BackLink to="/overview" label="Back to overview" />
      <PageHeader title="Weekly budget" description="How this week's limit is being used. Available = weekly limit − reserved − spent, for the current week only." />
      {budget.isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : !b ? <p className="text-sm text-muted-foreground">No spending rules are active, so there is no weekly budget yet.</p> : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Weekly limit" value={formatMinor(b.weekly_limit_minor, b.currency)} />
            <Stat label="Spent this week" value={formatMinor(b.spent_minor, b.currency)} />
            <Stat label="Reserved this week" value={formatMinor(b.reserved_minor, b.currency)} />
            <Stat label="Available this week" value={formatMinor(b.available_minor, b.currency)} />
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Week starts {new Date(b.week_start).toLocaleDateString("en-CA", { timeZone: b.timezone })} ({b.timezone}) · {b.currency} · rules version {b.policy_version}. Limits are changed under Spending rules.
          </p>
          <Panel title="Reserved purchases" className="mt-6">
            <p className="text-sm">
              {b.reserved_minor > 0 ? `${formatMinor(b.reserved_minor, b.currency)} is set aside for checkout this week.` : "No budget is set aside for checkout this week."}{" "}
              <Link to="/reserved" search={{ from: "/budget" }} className="font-medium text-brand-bright underline">View reserved purchases</Link>
            </p>
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
