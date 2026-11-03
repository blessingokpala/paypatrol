import { createFileRoute, Link } from "@tanstack/react-router";
import { useOrg } from "@/lib/org";
import { useBudget, usePurchases } from "@/lib/queries";
import { formatMinor } from "@/lib/money";
import { EmptyState, FixtureTag, PageHeader, Panel, StatusBadge } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { FileText, Sparkles } from "lucide-react";

export const Route = createFileRoute("/_authenticated/overview")({
  head: () => ({ meta: [{ title: "Overview — PayPatrol" }, { name: "description", content: "Budget, holds and approvals at a glance." }] }),
  component: Overview,
});

function Overview() {
  const { orgId } = useOrg();
  const budget = useBudget(orgId);
  const purchases = usePurchases(orgId);
  const list = purchases.data ?? [];
  const verif = list.filter((p) => p.status === "verification_required");
  const approvals = list.filter((p) => p.status === "approval_required");
  const blocked = list.filter((p) => p.status === "blocked");
  const b = budget.data;

  return (
    <>
      <PageHeader
        title="Overview"
        description="What needs attention before any money moves."
        actions={
          <>
            <Button asChild><Link to="/purchases/new-invoice"><FileText className="mr-1 h-4 w-4" /> Check an invoice</Link></Button>
            <Button asChild variant="outline"><Link to="/purchases/new-proposal"><Sparkles className="mr-1 h-4 w-4" /> Create AI purchase request</Link></Button>
          </>
        }
      />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Available this week" value={b ? formatMinor(b.available_minor, b.currency) : "—"} sub={b ? `of ${formatMinor(b.weekly_limit_minor, b.currency)} weekly limit` : undefined} />
        <Stat label="Reserved" value={b ? formatMinor(b.reserved_minor, b.currency) : "—"} sub={b ? `Spent ${formatMinor(b.spent_minor, b.currency)} · week starts ${new Date(b.week_start).toLocaleDateString("en-CA", { timeZone: b.timezone })} (${b.timezone})` : undefined} />
        <Stat label="Awaiting verification" value={String(verif.length)} sub="Changed payment details" tone="warning" />
        <Stat label="Pending approvals" value={String(approvals.length)} sub={`${blocked.length} blocked`} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Panel title="Needs action">
          {[...verif, ...approvals, ...blocked].length === 0 ? (
            <EmptyState>Nothing waiting.</EmptyState>
          ) : (
            <ul className="divide-y">
              {[...verif, ...approvals, ...blocked].slice(0, 8).map((p) => (
                <li key={p.id} className="py-3">
                  <Link to="/purchases/$id" params={{ id: p.id }} className="flex flex-wrap items-center justify-between gap-2 rounded hover:underline">
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{p.title}</span>
                      <span className="text-xs text-muted-foreground">{(p.suppliers as { name: string } | null)?.name ?? "Unmatched supplier"} · {formatMinor(p.total_minor, p.currency)}</span>
                    </span>
                    <StatusBadge status={p.status} />
                  </Link>
                  {p.is_test_fixture && <div className="mt-1"><FixtureTag label={p.fixture_label} /></div>}
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title="Integrations">
          <ul className="space-y-3 text-sm">
            <li className="flex justify-between gap-2"><span>AI extraction and proposals</span><span className="font-semibold text-warning">AI not connected</span></li>
            <li className="flex justify-between gap-2"><span>PayPal checkout</span><span className="font-semibold text-warning">PayPal not connected</span></li>
          </ul>
          <p className="mt-4 text-xs text-muted-foreground">
            Invoice details are entered manually and AI proposals shown are scripted test fixtures. No PayPal orders are created and no payment is shown as completed.
          </p>
        </Panel>
      </div>
    </>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string | undefined; tone?: "warning" }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className={tone === "warning" ? "mt-1 text-2xl font-bold text-warning" : "mt-1 text-2xl font-bold"}>{value}</p>
      {sub && <p className="mt-1 text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}
