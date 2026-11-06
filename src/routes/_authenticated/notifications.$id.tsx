import { useEffect } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/lib/org";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/notifications/$id")({
  head: () => ({ meta: [
    { title: "Review notification — PayPatrol" },
    { name: "description", content: "Open your authorised PayPatrol review task in its business." },
    { property: "og:title", content: "Review notification — PayPatrol" },
    { property: "og:description", content: "Private review notifications and recorded outcomes." },
    { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" },
  ] }),
  component: OpenNotification,
});

function OpenNotification() {
  const { id } = Route.useParams();
  const org = useOrg();
  const navigate = useNavigate();
  const notification = useQuery({
    queryKey: ["open-notification", org.userId, id],
    queryFn: async () => {
      const { data, error } = await supabase.from("review_notifications").select("*").eq("id", id).single();
      if (error) throw error;
      const read = await supabase.rpc("mark_review_notification_read", { _id: id });
      if (read.error) throw read.error;
      return data;
    },
    retry: false,
  });
  useEffect(() => {
    const n = notification.data;
    if (!n || !org.orgs.some(o => o.id === n.org_id)) return;
    if (org.orgId !== n.org_id) { org.setOrgId(n.org_id); return; }
    if (n.purchase_id) navigate({ to: "/purchases/$id", params: { id: n.purchase_id }, search: { from: "/approvals" }, replace: true });
    else navigate({ to: "/suppliers", search: { from: "/approvals" }, replace: true });
  }, [notification.data, org.orgId, org.orgs, navigate]);
  if (notification.isError || (notification.data && !org.orgs.some(o => o.id === notification.data.org_id))) return <div role="alert" className="space-y-3"><h1 className="text-xl font-semibold">Notification unavailable</h1><p>Your review permission or business membership may have changed. No request or decision was changed.</p><Button onClick={() => navigate({ to: "/overview" })}>Back to overview</Button></div>;
  return <p role="status" className="text-muted-foreground">Opening the current request in its business…</p>;
}