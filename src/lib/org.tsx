import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type Role = "owner" | "preparer" | "change_approver" | "payer";

type OrgCtx = {
  userId: string;
  email: string | null;
  orgId: string;
  orgName: string;
  roles: Role[];
  has: (...r: Role[]) => boolean;
  orgs: { id: string; name: string }[];
  setOrgId: (id: string) => void;
};

const Ctx = createContext<OrgCtx | null>(null);

export function useOrg() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useOrg must be used within OrgProvider");
  return v;
}

export function useMemberships() {
  return useQuery({
    queryKey: ["memberships"],
    queryFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error("Not signed in");
      const { data, error } = await supabase
        .from("memberships")
        .select("org_id, role, organizations(id, name, is_test_workspace)")
        .eq("user_id", u.user.id);
      if (error) throw error;
      return { user: u.user, rows: data ?? [] };
    },
  });
}

export function OrgProvider({ data, children }: { data: NonNullable<ReturnType<typeof useMemberships>["data"]>; children: ReactNode }) {
  const orgs = useMemo(() => {
    const m = new Map<string, string>();
    // Server (RLS) already limits rows to the user's own memberships; test workspaces are
    // excluded by their explicit classification, never by name.
    for (const r of data.rows) {
      const o = r.organizations as { name: string; is_test_workspace: boolean } | null;
      if (o && !o.is_test_workspace) m.set(r.org_id, o.name);
    }
    return [...m].map(([id, name]) => ({ id, name }));
  }, [data]);
  const [orgId, setOrgIdState] = useState(orgs[0]?.id ?? "");
  useEffect(() => {
    const saved = localStorage.getItem("paypatrol.org");
    if (saved && orgs.some((o) => o.id === saved)) setOrgIdState(saved);
  }, [orgs]);
  const setOrgId = (id: string) => {
    localStorage.setItem("paypatrol.org", id);
    setOrgIdState(id);
  };
  const roles = data.rows.filter((r) => r.org_id === orgId).map((r) => r.role as Role);
  const value: OrgCtx = {
    userId: data.user.id,
    email: data.user.email ?? null,
    orgId,
    orgName: orgs.find((o) => o.id === orgId)?.name ?? "",
    roles,
    has: (...r) => r.some((x) => roles.includes(x)),
    orgs,
    setOrgId,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useProfiles(orgId: string) {
  return useQuery({
    queryKey: ["profiles", orgId],
    queryFn: async () => {
      const { data, error } = await supabase.from("profiles").select("id, email, display_name");
      if (error) throw error;
      const map: Record<string, string> = {};
      for (const p of data ?? []) map[p.id] = p.display_name || p.email || p.id.slice(0, 8);
      return map;
    },
  });
}

export function errMsg(e: unknown): string {
  if (e && typeof e === "object" && "message" in e) return String((e as { message: string }).message);
  return "Something went wrong";
}
