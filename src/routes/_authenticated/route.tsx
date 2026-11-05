import { friendlyError, humanize } from "@/lib/friendly";
import { createFileRoute, redirect, Outlet, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { OrgProvider, useMemberships, useOrg, errMsg } from "@/lib/org";
import { SandboxPill, Wordmark } from "@/components/brand";
import { NotificationBell } from "@/components/notifications";
import { AccountMenu } from "@/components/account-menu";
import { FieldSelect } from "@/components/field-select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { ROLE_LABELS } from "@/lib/status";
import { toast } from "sonner";
import {
  LayoutDashboard, ShoppingCart, Building2, CheckSquare, SlidersHorizontal, History, Settings, Menu, Store, X,
} from "lucide-react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async ({ location }) => {
    const { data } = await supabase.auth.getUser();
    if (!data.user) throw redirect({ to: "/auth", search: { redirect: location.pathname } });
  },
  component: AuthedLayout,
});

function AuthedLayout() {
  const q = useMemberships();
  if (q.isLoading) return <div className="p-10 text-sm text-muted-foreground">Loading workspace…</div>;
  if (q.error || !q.data) return <div className="p-10 text-sm text-blocked">Could not load your workspace: {errMsg(q.error)}</div>;
  if (!q.data.rows.some((r) => r.organizations && !(r.organizations as { is_test_workspace: boolean }).is_test_workspace)) return <Onboarding email={q.data.user.email ?? ""} />;
  return (
    <OrgProvider data={q.data}>
      <Shell />
    </OrgProvider>
  );
}

const NAV = [
  { to: "/overview", label: "Overview", icon: LayoutDashboard },
  { to: "/purchases", label: "Purchases", icon: ShoppingCart },
  { to: "/approvals", label: "Approvals", icon: CheckSquare },
  { to: "/suppliers", label: "Suppliers", icon: Building2 },
  { to: "/rules", label: "Spending rules", icon: SlidersHorizontal },
  { to: "/evidence", label: "Evidence history", icon: History },
  { to: "/settings", label: "Team & integrations", icon: Settings },
] as const;

function Shell() {
  const org = useOrg();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);

  const business = (width: string) => (
    <div className="flex min-w-0 items-center gap-2 rounded-md border bg-secondary px-2 py-1 sm:px-2.5" title={`Selected business: ${org.orgName}`}>
      <Store className="h-4 w-4 shrink-0 text-brand-deep" aria-hidden />
      {org.orgs.length > 1 ? (
        <div className={cn("min-w-0", width)}>
          <FieldSelect
            ariaLabel={`Selected business: ${org.orgName}`}
            value={org.orgId}
            onChange={(v) => {
              if (v === org.orgId) return;
              // Drop the previous workspace's cached data, filters and selections.
              qc.removeQueries({ predicate: (q) => q.queryKey[0] !== "memberships" });
              org.setOrgId(v);
              navigate({ to: "/overview" });
            }}
            options={org.orgs.map((o) => ({ value: o.id, label: o.name }))}
          />
        </div>
      ) : (
        <span className="min-w-0 truncate text-sm font-semibold text-brand-deep sm:max-w-56">{org.orgName}</span>
      )}
    </div>
  );

  const nav = (
    <nav aria-label="Main" className="flex flex-col gap-1">
      {NAV.map((n) => (
        <Link
          key={n.to}
          to={n.to}
          onClick={() => setOpen(false)}
          className="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-foreground hover:bg-selected"
          activeProps={{ className: "bg-selected text-brand-deep font-semibold" }}
        >
          <n.icon className="h-4 w-4" aria-hidden />
          {n.label}
        </Link>
      ))}
    </nav>
  );

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-gradient-to-b from-secondary/70 to-card px-3 sm:gap-3 sm:px-4">
        <button className="rounded p-1 lg:hidden" onClick={() => setOpen(!open)} aria-label={open ? "Close menu" : "Open menu"}>
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
        <Link className="shrink-0" to="/overview" aria-label="PayPatrol overview">
          <Wordmark className="text-lg" />
        </Link>
        <span className="inline-flex shrink-0 items-center gap-1 rounded border border-warning/40 bg-warning-soft px-1.5 py-0.5 text-[10px] font-semibold text-warning sm:hidden">
          <span className="h-1.5 w-1.5 rounded-full bg-warning" aria-hidden />Sandbox
        </span>
        <div className="ml-auto flex min-w-0 items-center gap-1.5 sm:gap-2">
          <div className="hidden min-w-0 sm:block">{business("w-44")}</div>
          <NotificationBell />
          <AccountMenu />
        </div>
      </header>
      <div className="flex items-center gap-2 border-b bg-card px-3 py-2 sm:hidden">
        <span className="shrink-0 text-xs font-semibold text-muted-foreground">Business</span>
        <div className="min-w-0 flex-1">{business("flex-1")}</div>
      </div>
      <div className="flex">
        <aside className={cn("fixed inset-y-14 left-0 z-20 flex w-60 flex-col border-r bg-card p-3 lg:sticky lg:top-14 lg:flex lg:h-[calc(100vh-3.5rem)]", open ? "flex" : "hidden")}>
          <div className="min-h-0 flex-1 overflow-y-auto">{nav}</div>
          <div className="mt-3 shrink-0 border-t pt-4 text-xs text-muted-foreground">
            <p className="font-semibold text-foreground">Your roles</p>
            <p className="mt-1">{org.roles.map((r) => ROLE_LABELS[r]).join(", ") || "None"}</p>
            <p className="mt-3"><SandboxPill /></p>
          </div>
        </aside>
        <main className="min-w-0 flex-1 p-4 sm:p-6 lg:p-8">
          <div className="mx-auto max-w-6xl" key={org.orgId}>
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}

function Onboarding({ email }: { email: string }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [demo, setDemo] = useState(true);
  const [busy, setBusy] = useState(false);
  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.rpc("create_organization", { _name: name, _with_demo: demo });
    setBusy(false);
    if (error) { toast.error(friendlyError(error)); return; }
    toast.success("Organisation created");
    qc.invalidateQueries({ queryKey: ["memberships"] });
  }
  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <form onSubmit={create} className="w-full max-w-md space-y-5 rounded-lg border bg-card p-6">
        <Wordmark className="text-2xl" />
        <div>
          <h1 className="text-xl font-bold">Set up your organisation</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Signed in as {email}. You will be the business owner. If a colleague should add you to their organisation instead, ask them to add {email} under Team & integrations, then reload.
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="org">Organisation name</Label>
          <Input id="org" required value={name} onChange={(e) => setName(e.target.value)} placeholder="Ada's Grocery" />
        </div>
        <label className="flex items-start gap-2 text-sm">
          <Checkbox checked={demo} onCheckedChange={(v) => setDemo(v === true)} className="mt-0.5" />
          <span>
            Load fictional demonstration data: CAD, America/Halifax, CA$300 weekly limit, CA$150 per-order limit, approval above CA$100, one fictional supplier and the two demo scenarios.
          </span>
        </label>
        <Button type="submit" disabled={busy} className="w-full">{busy ? "Creating…" : "Create organisation"}</Button>
      </form>
    </div>
  );
}
