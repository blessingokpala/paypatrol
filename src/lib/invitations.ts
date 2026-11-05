import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ROLE_LABELS } from "@/lib/status";

export type Invitation = {
  id: string; org_id: string; org_name: string; email: string; roles: string[];
  inviter_name: string | null; status: string; expires_at: string; last_sent_at: string; send_count: number; created_at: string;
};

export function inviteLink(id: string) {
  return `${typeof window === "undefined" ? "" : window.location.origin}/invite/${id}`;
}

export function inviteState(i: Pick<Invitation, "status" | "expires_at">): "pending" | "expired" | "accepted" | "revoked" {
  if (i.status === "pending" && new Date(i.expires_at).getTime() <= Date.now()) return "expired";
  return i.status as "pending" | "accepted" | "revoked";
}

export function rolesText(roles: string[]) {
  return roles.map((r) => ROLE_LABELS[r] ?? r).join(", ");
}

/** Invitations addressed to the signed-in user's verified email (server-filtered). */
export function useMyInvitations(enabled = true) {
  return useQuery({
    queryKey: ["my-invitations"],
    enabled,
    queryFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      const email = u.user?.email?.toLowerCase();
      if (!email) return [];
      const { data, error } = await supabase.from("org_invitations").select("*").eq("email", email).eq("status", "pending").order("created_at", { ascending: false });
      if (error) throw error;
      return ((data ?? []) as Invitation[]).filter((i) => inviteState(i) === "pending");
    },
  });
}

export async function acceptInvitation(id: string) {
  const { data, error } = await supabase.rpc("accept_invitation", { _id: id });
  if (error) throw error;
  localStorage.setItem("paypatrol.org", data as string);
  return data as string;
}
