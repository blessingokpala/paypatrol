import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Wordmark, ToneBadge } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { acceptInvitation, inviteState, rolesText, type Invitation } from "@/lib/invitations";
import { friendlyError } from "@/lib/friendly";
import { toast } from "sonner";

export const Route = createFileRoute("/invite/$id")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Business invitation — PayPatrol" },
      { name: "description", content: "Accept an invitation to join a PayPatrol business team." },
      { property: "og:title", content: "Business invitation — PayPatrol" },
      { property: "og:description", content: "Join a PayPatrol business with the roles the owner assigned." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: InvitePage,
});

function InvitePage() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const here = `/invite/${id}`;
  const q = useQuery({
    queryKey: ["invite", id],
    queryFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return { user: null, invite: null };
      const { data } = await supabase.from("org_invitations").select("*").eq("id", id).maybeSingle();
      return { user: u.user, invite: data as Invitation | null };
    },
  });

  async function accept() {
    setBusy(true);
    try {
      await acceptInvitation(id);
      const inv = q.data?.invite;
      toast.success(`You joined ${inv?.org_name} as ${rolesText(inv?.roles ?? [])}`);
      await qc.invalidateQueries();
      navigate({ to: "/overview" });
    } catch (e) {
      toast.error(friendlyError(e));
      void q.refetch();
    } finally { setBusy(false); }
  }

  async function switchAccount() {
    await supabase.auth.signOut();
    navigate({ to: "/auth", search: { redirect: here } });
  }

  let body: React.ReactNode = <p className="text-sm text-muted-foreground">Checking invitation…</p>;
  if (q.data && !q.data.user) {
    body = (
      <>
        <h1 className="text-xl font-bold">You have been invited to a PayPatrol business</h1>
        <p className="text-sm text-muted-foreground">Sign in, or create an account with the email address the invitation was sent to. You will come back here afterwards. You do not need to create a business.</p>
        <Button asChild className="w-full"><Link to="/auth" search={{ redirect: here }}>Sign in or create an account</Link></Button>
        <p className="text-xs text-muted-foreground">New accounts must confirm their email first. The confirmation link returns you to this invitation.</p>
      </>
    );
  } else if (q.data?.user && !q.data.invite) {
    body = (
      <>
        <h1 className="text-xl font-bold">This invitation isn't available to this account</h1>
        <p className="text-sm text-muted-foreground">You are signed in as <span className="font-semibold text-foreground">{q.data.user.email}</span>. Invitations can only be opened by the exact email address they were sent to, after that email is confirmed.</p>
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          <li>If the invitation went to another address, sign in with that account.</li>
          <li>If you haven't confirmed your email yet, use the link in the confirmation email, then reopen this page.</li>
          <li>Otherwise ask the business owner to send a new invitation.</li>
        </ul>
        <div className="flex flex-wrap gap-2">
          <Button onClick={switchAccount}>Sign in with a different account</Button>
          <Button variant="outline" asChild><Link to="/overview">Go to my workspace</Link></Button>
        </div>
      </>
    );
  } else if (q.data?.invite) {
    const inv = q.data.invite;
    const state = inviteState(inv);
    body = (
      <>
        <h1 className="text-xl font-bold">Join {inv.org_name}</h1>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-muted-foreground">Invited by</dt><dd className="font-medium">{inv.inviter_name ?? "Business owner"}</dd>
          <dt className="text-muted-foreground">Your roles</dt><dd className="font-medium">{rolesText(inv.roles)}</dd>
          <dt className="text-muted-foreground">Sent to</dt><dd className="font-medium">{inv.email}</dd>
          <dt className="text-muted-foreground">Expires</dt><dd className="font-medium">{new Date(inv.expires_at).toLocaleString("en-CA")}</dd>
        </dl>
        {state === "pending" && (
          <>
            <p className="text-sm text-muted-foreground">Accepting adds only these roles in {inv.org_name}. Any business you already own stays separate and unchanged.</p>
            <Button className="w-full" disabled={busy} onClick={accept}>{busy ? "Accepting…" : "Accept invitation"}</Button>
          </>
        )}
        {state === "accepted" && <><ToneBadge tone="success">Already accepted</ToneBadge><Button asChild className="w-full"><Link to="/overview" onClick={() => localStorage.setItem("paypatrol.org", inv.org_id)}>Open {inv.org_name}</Link></Button></>}
        {state === "revoked" && <><ToneBadge tone="blocked">Revoked</ToneBadge><p className="text-sm text-muted-foreground">The owner withdrew this invitation. Ask them to send a new one.</p></>}
        {state === "expired" && <><ToneBadge tone="warning">Expired</ToneBadge><p className="text-sm text-muted-foreground">This invitation has expired. Ask the owner to press Resend in Team & integrations, then reopen this link.</p></>}
      </>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-md space-y-4 rounded-lg border bg-card p-6">
        <Wordmark className="text-2xl" />
        {body}
      </div>
    </div>
  );
}
