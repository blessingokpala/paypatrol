import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { AlertOctagon, AlertTriangle, Bell, Info } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/lib/org";
import { usePurchases } from "@/lib/queries";
import { deriveNotifications, unreadCount, PRIORITY_META, type AppNotification, type NotificationPriority } from "@/lib/notifications";
import { useHere } from "@/components/back-link";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const priorityIcon: Record<NotificationPriority, typeof Info> = {
  urgent: AlertOctagon,
  action: AlertTriangle,
  update: Info,
};
const priorityClass: Record<NotificationPriority, string> = {
  urgent: "text-blocked",
  action: "text-warning",
  update: "text-brand-bright",
};

function timeAgo(isoDate: string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(isoDate).getTime()) / 60000));
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days} d ago`;
  return new Date(isoDate).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function NotificationBell() {
  const org = useOrg();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const here = useHere();

  // Items fading out of the panel after being opened.
  const [leaving, setLeaving] = useState<Set<string>>(new Set());
  const purchases = usePurchases(org.orgId);
  const inbox = useQuery({
    queryKey: ["review-notifications", org.userId],
    refetchInterval: 15000,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const { data, error } = await supabase.from("review_notifications")
        .select("*, organizations(name), purchases(status, version), supplier_change_requests(status)")
        .eq("user_id", org.userId).order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
  const reads = useQuery({
    queryKey: ["notification-reads", org.orgId],
    queryFn: async () => {
      const { data, error } = await supabase.from("notification_reads").select("notification_key").eq("org_id", org.orgId);
      if (error) throw error;
      return new Set((data ?? []).map((r) => r.notification_key));
    },
  });

  const notifications = useMemo(() => {
    const legacy = deriveNotifications({
      purchases: (purchases.data ?? []).filter(p => p.requested_by === org.userId && !["approval_required", "verification_required"].includes(p.status)),
      changeRequests: [],
    });
    const delivered: AppNotification[] = (inbox.data ?? []).map(n => ({
      key: `inbox:${n.id}`,
      priority: n.kind === "outcome" ? "update" : "action",
      title: n.title,
      detail: `${n.organizations?.name ?? "Business"} · ${n.detail} ${n.purchase_version ? `Notification concerns v${n.purchase_version}. ` : ""}${n.purchases ? `Current request: ${n.purchases.status.replaceAll("_", " ")}, v${n.purchases.version}.` : ""}${n.supplier_change_requests ? ` Supplier review: ${n.supplier_change_requests.status.replaceAll("_", " ")}.` : ""}`,
      at: n.created_at,
      link: { kind: "notification", id: n.id },
    }));
    return [...delivered, ...legacy];
  }, [purchases.data, inbox.data, org.userId]);
  const readKeys = new Set([...(reads.data ?? []), ...(inbox.data ?? []).filter(n => n.read_at).map(n => `inbox:${n.id}`)]);
  const visible = notifications.filter((n) => !readKeys.has(n.key));
  const unread = unreadCount(notifications, new Set([...readKeys, ...leaving]));


  const markRead = useMutation({
    mutationFn: async (keys: string[]) => {
      if (!keys.length) return;
      const durable = keys.filter(k => k.startsWith("inbox:"));
      for (const key of durable) {
        const { error } = await supabase.rpc("mark_review_notification_read", { _id: key.slice(6) });
        if (error) throw error;
      }
      const legacy = keys.filter(k => !k.startsWith("inbox:"));
      if (!legacy.length) return;
      const { error } = await supabase.from("notification_reads").upsert(
        legacy.map((k) => ({ user_id: org.userId, org_id: org.orgId, notification_key: k })),
        { onConflict: "user_id,org_id,notification_key", ignoreDuplicates: true },
      );
      if (error) throw error;
    },
    onMutate: (keys: string[]) => {
      qc.setQueryData<Set<string>>(["notification-reads", org.orgId], (prev) => new Set([...(prev ?? []), ...keys]));
    },
    onError: () => toast.error("Could not save read status. Please try again."),
    onSettled: () => { qc.invalidateQueries({ queryKey: ["notification-reads", org.orgId] }); qc.invalidateQueries({ queryKey: ["review-notifications", org.userId] }); },
  });

  function open(n: AppNotification) {
    setLeaving((prev) => new Set(prev).add(n.key));
    window.setTimeout(() => {
      markRead.mutate([n.key]);
      setLeaving((prev) => {
        const next = new Set(prev);
        next.delete(n.key);
        return next;
      });
    }, 300);
    if (n.link.kind === "notification") {
      navigate({ to: "/notifications/$id", params: { id: n.link.id } });
    } else if (n.link.kind === "purchase") {
      navigate({ to: "/purchases/$id", params: { id: n.link.id }, search: { from: here } });
    } else {
      navigate({ to: "/suppliers", search: { from: here } });
    }
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          type="button"
          aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
          className="relative rounded-md p-2 text-foreground hover:bg-selected"
        >
          <Bell className="h-5 w-5" aria-hidden />
          {unread > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-blocked px-1 text-[10px] font-bold text-primary-foreground" aria-hidden>
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 max-w-[calc(100vw-2rem)] p-0 sm:w-96">
        <div className="flex items-center justify-between border-b px-4 py-2.5">
          <h2 className="text-sm font-semibold">Notifications</h2>
          {unread > 0 && (
            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => markRead.mutate(visible.map((n) => n.key))}>
              Mark all as read
            </Button>
          )}
        </div>
        <div className="max-h-96 overflow-y-auto">
          {inbox.isError ? <p role="alert" className="p-4 text-sm text-blocked">Notifications could not load. <Button variant="link" onClick={() => inbox.refetch()}>Try again</Button></p> : inbox.isLoading ? <p role="status" className="p-4 text-sm text-muted-foreground">Loading notifications…</p> : visible.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">
              No unread notifications. Review tasks and decisions from your businesses appear here. In-app notifications only; no email or browser push is sent.
            </p>
          ) : (
            <ul>
              {visible.map((n) => {
                const Icon = priorityIcon[n.priority];
                const isLeaving = leaving.has(n.key);
                return (
                  <li key={n.key} className={cn("grid transition-all duration-300 ease-out motion-reduce:transition-none", isLeaving ? "grid-rows-[0fr] opacity-0 -translate-x-4" : "grid-rows-[1fr] opacity-100")}>
                    <div className="overflow-hidden">
                    <button
                      type="button"
                      onClick={() => !isLeaving && open(n)}
                      className={cn("flex w-full items-start gap-3 border-b px-4 py-3 text-left last:border-b-0 hover:bg-selected", "bg-secondary/50")}
                    >
                      <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", priorityClass[n.priority])} aria-hidden />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className={cn("truncate text-sm", "font-semibold")}>{n.title}</span>
                          {<span className="h-2 w-2 shrink-0 rounded-full bg-brand-bright" aria-label="Unread" />}
                        </span>
                        <span className="mt-0.5 block text-xs text-muted-foreground">{n.detail}</span>
                        <span className="mt-1 block text-[11px] text-muted-foreground">
                          {PRIORITY_META[n.priority].label} · {timeAgo(n.at)}
                        </span>
                      </span>
                    </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
