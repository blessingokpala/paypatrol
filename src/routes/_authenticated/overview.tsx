import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useOrg } from "@/lib/org";
import { useBudget, usePurchases } from "@/lib/queries";
import { formatMinor } from "@/lib/money";
import { getAiStatus } from "@/lib/ai/ai.functions";
import { getIntegrationStatus } from "@/lib/integrations.functions";
import { EmptyState, FixtureTag, PageHeader, Panel, StatusBadge, ToneBadge } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { FileText, Sparkles } from "lucide-react";

export const Route = createFileRoute("/_authenticated/overview")({
  head: () => ({ meta: [{ title: "Overview — PayPatrol" }, { name: "description", content: "Budget, holds and approvals at a glance." }, { property: "og:title", content: "Overview — PayPatrol" }, { property: "og:description", content: "PayPatrol budget, holds and approvals at a glance." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  component: Overview,
});

function Overview() {
  const { orgId, has } = useOrg();
  const budget = useBudget(orgId);
  const purchases = usePurchases(orgId);
  const list = purchases.data ?? [];
  const verif = list.filter((p) => p.status === "verification_required");
  const approvals = list.filter((p) => p.status === "approval_required");
  const blocked = list.filter((p) => p.status === "blocked");
  const b = budget.data;
  const aiFn = useServerFn(getAiStatus);
  const ai = useQuery({ queryKey: ["ai-status", orgId], enabled: Boolean(orgId), queryFn: () => aiFn({ data: { orgId } }) });
  const aiConnected = Boolean(ai.data?.configured && ai.data?.lastRequestAt);
  const intFn = useServerFn(getIntegrationStatus);
  const int = useQuery({ queryKey: ["integrations", orgId], enabled: has("owner"), queryFn: () => intFn({ data: { orgId } }) });

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
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Stat to="/budget" label="Available this week" value={b ? formatMinor(b.available_minor, b.currency) : "—"} sub={b ? `of ${formatMinor(b.weekly_limit_minor, b.currency)} weekly limit` : undefined} />
        <Stat to="/budget" label="Reserved" value={b ? formatMinor(b.reserved_minor, b.currency) : "—"} sub={b ? `Spent ${formatMinor(b.spent_minor, b.currency)} this week` : undefined} />
        <Stat to="/purchases" search={{ status: "verification_required" }} label="Awaiting verification" value={String(verif.length)} sub="Changed payment details" tone="warning" />
        <Stat to="/approvals" label="Pending approvals" value={String(approvals.length)} sub="Requests awaiting spending approval" />
        <Stat to="/purchases" search={{ status: "blocked" }} label="Blocked requests" value={String(blocked.length)} sub="Failed a spending rule" tone={blocked.length ? "blocked" : undefined} />
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
        <Panel title="Integrations" actions={<Link to="/settings" className="text-sm text-brand-bright underline-offset-2 hover:underline">Team & integrations</Link>}>
          <ul className="space-y-3 text-sm">
            <li className="flex items-center justify-between gap-2">
              <span>AI extraction and proposals</span>
              {aiConnected ? <ToneBadge tone="success">AI connected · {ai.data?.model}</ToneBadge> : <ToneBadge tone="warning">AI not connected</ToneBadge>}
            </li>
            <li className="flex items-center justify-between gap-2">
              <span>PayPal checkout</span>
              {!has("owner") ? (
                <span className="text-xs text-muted-foreground">Visible to owners</span>
              ) : int.isFetching ? (
                <ToneBadge tone="info">Checking…</ToneBadge>
              ) : int.data?.checkoutEnabled ? (
                <ToneBadge tone="success">Sandbox supplier configured</ToneBadge>
              ) : int.data?.paypal ? (
                <ToneBadge tone="warning">Connected · supplier not configured</ToneBadge>
              ) : (
                <ToneBadge tone="warning">PayPal not connected</ToneBadge>
              )}
            </li>
          </ul>
          <p className="mt-4 text-xs text-muted-foreground">
            AI output and PayPal connections never approve, verify or pay by themselves. Details and checks live under Team & integrations.
          </p>
        </Panel>
      </div>
    </>
  );
}

function Stat({ label, value, sub, tone, to, search }: { label: string; value: string; sub?: string | undefined; tone?: "warning" | "blocked"; to: string; search?: Record<string, string> }) {
  return (
    <Link
      to={to as "/budget"}
      search={search}
      className="block rounded-lg border bg-card p-4 transition-colors hover:border-brand-bright hover:bg-selected/40 focus-visible:outline-none"
      aria-label={`${label}: ${value}. Open details.`}
    >
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className={tone === "warning" ? "mt-1 text-2xl font-bold text-warning" : tone === "blocked" ? "mt-1 text-2xl font-bold text-blocked" : "mt-1 text-2xl font-bold"}>{value}</p>
      {sub && <p className="mt-1 text-xs text-muted-foreground">{sub}</p>}
    </Link>
  );
}
