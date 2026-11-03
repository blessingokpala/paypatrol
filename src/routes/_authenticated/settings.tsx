import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrg, useProfiles } from "@/lib/org";
import { getIntegrationStatus } from "@/lib/integrations.functions";
import { ROLE_LABELS } from "@/lib/status";
import { PageHeader, Panel, ToneBadge } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({ meta: [{ title: "Team & integrations — PayPatrol" }, { name: "description", content: "Members, roles and integration status." }] }),
  component: Settings,
});

const ROLES = ["owner", "preparer", "change_approver", "payer"] as const;

function Settings() {
  const org = useOrg();
  const qc = useQueryClient();
  const names = useProfiles(org.orgId).data ?? {};
  const statusFn = useServerFn(getIntegrationStatus);
  const isOwner = org.has("owner");
  const members = useQuery({
    queryKey: ["members", org.orgId],
    queryFn: async () => {
      const { data, error } = await supabase.from("memberships").select("*").eq("org_id", org.orgId);
      if (error) throw error;
      return data ?? [];
    },
  });
  const status = useQuery({ queryKey: ["integrations", org.orgId], enabled: isOwner, queryFn: () => statusFn({ data: { orgId: org.orgId } }) });
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<(typeof ROLES)[number]>("change_approver");

  const byUser = new Map<string, string[]>();
  for (const m of members.data ?? []) byUser.set(m.user_id, [...(byUser.get(m.user_id) ?? []), m.role]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const { error } = await supabase.rpc("add_member_by_email", { _org: org.orgId, _email: email, _role: role });
    if (error) { toast.error(error.message); return; }
    toast.success("Role added");
    setEmail("");
    qc.invalidateQueries();
  }
  async function remove(user: string, r: (typeof ROLES)[number]) {
    const { error } = await supabase.rpc("remove_member_role", { _org: org.orgId, _user: user, _role: r });
    if (error) { toast.error(error.message); return; }
    qc.invalidateQueries();
  }

  return (
    <>
      <PageHeader title="Team & integrations" description="Each person signs in with their own account. Independent review only works with separate people." />
      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Members and roles">
          <ul className="divide-y text-sm">
            {[...byUser].map(([uid, roles]) => (
              <li key={uid} className="py-3">
                <p className="font-medium">{names[uid] ?? uid.slice(0, 8)}{uid === org.userId && " (you)"}</p>
                <div className="mt-1 flex flex-wrap gap-1">
                  {roles.map((r) => (
                    <span key={r} className="inline-flex items-center gap-1 rounded bg-selected px-2 py-0.5 text-xs">
                      {ROLE_LABELS[r]}
                      {isOwner && <button aria-label={`Remove ${ROLE_LABELS[r]}`} className="font-bold" onClick={() => remove(uid, r as (typeof ROLES)[number])}>×</button>}
                    </span>
                  ))}
                </div>
              </li>
            ))}
          </ul>
          {isOwner && (
            <form onSubmit={add} className="mt-4 space-y-3 border-t pt-4">
              <div className="space-y-1"><Label htmlFor="m-email">Email of an existing account</Label><Input id="m-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></div>
              <div className="space-y-1">
                <Label htmlFor="m-role">Role</Label>
                <select id="m-role" value={role} onChange={(e) => setRole(e.target.value as (typeof ROLES)[number])} className="h-9 w-full rounded-md border border-input bg-card px-3 text-sm">
                  {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                </select>
              </div>
              <Button type="submit">Add role</Button>
            </form>
          )}
        </Panel>
        <Panel title="Integrations (restricted)">
          {!isOwner ? <p className="text-sm text-muted-foreground">Only owners can view integration settings.</p> : (
            <ul className="space-y-4 text-sm">
              <li className="flex items-start justify-between gap-3">
                <div><p className="font-medium">Gemini (invoice extraction, proposals, explanations)</p><p className="text-xs text-muted-foreground">Server-side only. Cannot change rules, approve, verify suppliers or capture payments.</p></div>
                {status.data?.gemini ? <ToneBadge tone="success">Key present</ToneBadge> : <ToneBadge tone="warning">AI not connected</ToneBadge>}
              </li>
              <li className="flex items-start justify-between gap-3">
                <div><p className="font-medium">PayPal Sandbox (Orders v2, JS SDK v6)</p><p className="text-xs text-muted-foreground">Only protected server functions will create and capture orders. Paid is set only after a server-confirmed completed capture.</p></div>
                {status.data?.paypal ? <ToneBadge tone="success">Keys present</ToneBadge> : <ToneBadge tone="warning">PayPal not connected</ToneBadge>}
              </li>
              <li className="text-xs text-muted-foreground">Secret values are never shown here.</li>
            </ul>
          )}
        </Panel>
      </div>
    </>
  );
}
