import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export function usePurchases(orgId: string) {
  return useQuery({
    queryKey: ["purchases", orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("purchases")
        .select("*, suppliers(name)")
        .eq("org_id", orgId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useBudget(orgId: string) {
  return useQuery({
    queryKey: ["budget", orgId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("org_budget_summary", { _org: orgId });
      if (error) throw error;
      return data as null | {
        weekly_limit_minor: number;
        reserved_minor: number;
        spent_minor: number;
        available_minor: number;
        currency: string;
        timezone: string;
        week_start: string;
        policy_version: number;
      };
    },
  });
}

export function useActivePolicy(orgId: string) {
  return useQuery({
    queryKey: ["policy", orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("spending_policies")
        .select("*")
        .eq("org_id", orgId)
        .order("version", { ascending: false });
      if (error) throw error;
      return { active: (data ?? []).find((p) => p.is_active) ?? null, history: data ?? [] };
    },
  });
}

export function useSuppliers(orgId: string) {
  return useQuery({
    queryKey: ["suppliers", orgId],
    queryFn: async () => {
      const [s, v] = await Promise.all([
        supabase.from("suppliers").select("*").eq("org_id", orgId).order("created_at"),
        supabase.from("supplier_versions").select("*").eq("org_id", orgId).order("version", { ascending: false }),
      ]);
      if (s.error) throw s.error;
      if (v.error) throw v.error;
      return (s.data ?? []).map((sup) => ({
        ...sup,
        current: (v.data ?? []).find((x) => x.id === sup.current_version_id) ?? null,
        versions: (v.data ?? []).filter((x) => x.supplier_id === sup.id),
      }));
    },
  });
}

export function useListings(orgId: string) {
  return useQuery({
    queryKey: ["listings", orgId],
    queryFn: async () => {
      const { data, error } = await supabase.from("listings").select("*, suppliers(name)").eq("org_id", orgId).eq("is_active", true).order("name");
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useRefreshAll() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries();
}
