import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/lib/org";
import { inviteLink, inviteState, rolesText, type Invitation } from "@/lib/invitations";
import { ROLE_LABELS } from "@/lib/status";
import { friendlyError } from "@/lib/friendly";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { ToneBadge, Req, RequiredNote } from "@/components/brand";
import { toast } from "sonner";

const ROLE_HELP: Record<string, string> = {
  payer: "Approves spending requests above the approval threshold and can reserve budget and pay.",
  change_approver: "Independently verifies supplier payment-detail changes (cannot approve spending).",
  preparer: "Submits invoices and purchase requests.",
  owner: "Full control, including team, rules and integrations.",
};
const ROLES = ["payer", "change_approver", "preparer", "owner"] as const;
const TONE = { pending: "info", expired: "warning", accepted: "success", revoked: "neutral" } as const;

export function InvitePanel() {
  const org = useOrg();
  const qc = useQueryClient();
  const [email, setEmail] = useState("");
  const [roles, setRoles] = useState<string[]>(["payer", "change_approver"]);
  const [busy, setBusy] = useState(false);
  const list = useQuery({
    queryKey: ["invitations", org.orgId],
    queryFn: async () => {
      const { data, error } = await supabase.from("org_invitations").select("*").eq("org_id", org.orgId).order("created_at", { ascending: false }).limit(30);
      if (error) throw error;
      return (data ?? []) as Invitation[];
    },
  });

  async function copy(id: string) {
    try { await navigator.clipboard.writeText(inviteLink(id)); toast.success("Invitation link copied"); }
    catch { toast.message(inviteLink(id)); }
  }
  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!roles.length) { toast.error("Choose at least one role"); return; }
    setBusy(true);
    const { data, error } = await supabase.rpc("create_invitation", { _org: org.orgId, _email: email, _roles: roles as ("owner" | "preparer" | "change_approver" | "payer")[] });
    setBusy(false);
    if (error) { toast.error(friendlyError(error)); return; }
    setEmail("");
    await list.refetch();
    void copy(data as string);
  }
  async function act(fn: "resend_invitation" | "revoke_invitation", id: string) {
    const { error } = await supabase.rpc(fn, { _id: id });
    if (error) { toast.error(friendlyError(error)); return; }
    toast.success(fn === "resend_invitation" ? "Invitation renewed for 7 days" : "Invitation revoked");
    if (fn === "resend_invitation") void copy(id);
    qc.invalidateQueries({ queryKey: ["invitations", org.orgId] });
  }

  return (
    <div className="mt-4 space-y-4 border-t pt-4">
      <form onSubmit={send} className="space-y-3">
        <p className="font-semibold">Invite member</p>
        <div className="space-y-1">
          <RequiredNote />
          <Label htmlFor="inv-email">Email address<Req /></Label>
          <Input id="inv-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" />
          <p className="text-xs text-muted-foreground">Works for new people and for people who already have their own PayPatrol business.</p>
        </div>
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Roles in {org.orgName}</legend>
          {ROLES.map((r) => (
            <label key={r} className="flex items-start gap-2 text-sm">
              <Checkbox className="mt-0.5" checked={roles.includes(r)} onCheckedChange={(v) => setRoles(v === true ? [...roles, r] : roles.filter((x) => x !== r))} />
              <span><span className="font-medium">{ROLE_LABELS[r]}</span> — <span className="text-muted-foreground">{ROLE_HELP[r]}</span></span>
            </label>
          ))}
        </fieldset>
        <Button type="submit" disabled={busy}>{busy ? "Creating…" : "Create invitation"}</Button>
        <p className="text-xs text-muted-foreground">Invitation emails need a sender email domain, which isn't set up yet. The invitation link is copied for you — send it to them yourself. Only the invited email address can accept it.</p>
      </form>

      <div>
        <p className="font-semibold">Invitations</p>
        {list.data?.length ? (
          <ul className="mt-2 divide-y text-sm">
            {list.data.map((i) => {
              const st = inviteState(i);
              return (
                <li key={i.id} className="space-y-1 py-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="break-all font-medium">{i.email}</span>
                    <ToneBadge tone={TONE[st]}>{st[0]!.toUpperCase() + st.slice(1)}</ToneBadge>
                  </div>
                  <p className="text-xs text-muted-foreground">{rolesText(i.roles)} · {st === "pending" ? "expires" : st === "expired" ? "expired" : "sent"} {new Date(st === "pending" || st === "expired" ? i.expires_at : i.last_sent_at).toLocaleString("en-CA")}</p>
                  {(st === "pending" || st === "expired") && (
                    <div className="flex flex-wrap gap-2">
                      {st === "pending" && <Button size="sm" variant="outline" onClick={() => copy(i.id)}>Copy link</Button>}
                      <Button size="sm" variant="outline" onClick={() => act("resend_invitation", i.id)}>Resend</Button>
                      <Button size="sm" variant="ghost" onClick={() => { if (confirm(`Revoke the invitation for ${i.email}?`)) void act("revoke_invitation", i.id); }}>Revoke</Button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        ) : <p className="mt-1 text-sm text-muted-foreground">No invitations yet.</p>}
      </div>
    </div>
  );
}
