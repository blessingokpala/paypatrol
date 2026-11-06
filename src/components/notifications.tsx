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

  const purchases = usePurchases(org.orgId);
  const changes = useQuery({
    queryKey: ["change-requests", org.orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("supplier_change_requests")
        .select("id, status, created_at, suppliers(name)")
        .eq("org_id", org.orgId)
        .in("status", ["pending_verification", "verified_pending_decision"]);
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

  const notifications = useMemo(
    () =>
      deriveNotifications({
        purchases: purchases.data ?? [],
        changeRequests: (changes.data ?? []).map((c) => ({
          id: c.id,
          status: c.status,
          created_at: c.created_at,
          supplierName: (c.suppliers as { name: string } | null)?.name ?? null,
        })),
      }),
    [purchases.data, changes.data],
  );
  const readKeys = reads.data ?? new Set<string>();
  const unread = unreadCount(notifications, readKeys);

  // Keys that were unread when the panel opened, so they stay highlighted while it is open.
  const [freshKeys, setFreshKeys] = useState<Set<string>>(new Set());

  const markRead = useMutation({
    mutationFn: async (keys: string[]) => {
      if (!keys.length) return;
      const { error } = await supabase.from("notification_reads").upsert(
        keys.map((k) => ({ user_id: org.userId, org_id: org.orgId, notification_key: k })),
        { onConflict: "user_id,org_id,notification_key", ignoreDuplicates: true },
      );
      if (error) throw error;
    },
    onMutate: (keys: string[]) => {
      qc.setQueryData<Set<string>>(["notification-reads", org.orgId], (prev) => new Set([...(prev ?? []), ...keys]));
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["notification-reads", org.orgId] }),
  });

  function open(n: AppNotification) {
    markRead.mutate([n.key]);
    if (n.link.kind === "purchase") {
      navigate({ to: "/purchases/$id", params: { id: n.link.id }, search: { from: here } });
    } else {
      navigate({ to: "/suppliers", search: { from: here } });
    }
  }

  return (
    <Popover
      onOpenChange={(isOpen) => {
        if (isOpen) {
          const unreadKeys = notifications.filter((n) => !readKeys.has(n.key)).map((n) => n.key);
          setFreshKeys(new Set(unreadKeys));
          if (unreadKeys.length) markRead.mutate(unreadKeys);
        } else {
          setFreshKeys(new Set());
        }
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
          className="relative rounded-md p-2 text-foreground hover:bg-selected"
        >
          <Bell className="h-5 w-5" aria-hidden />
          {unread > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-blocked px-1 text-[10px] font-bold text-white" aria-hidden>
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0 sm:w-96">
        <div className="flex items-center justify-between border-b px-4 py-2.5">
          <h2 className="text-sm font-semibold">Notifications</h2>
          {false && (
            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => markRead.mutate(notifications.map((n) => n.key))}>
              Mark all as read
            </Button>
          )}
        </div>
        <div className="max-h-96 overflow-y-auto">
          {notifications.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">
              No notifications. New requests, supplier changes, approvals and payment outcomes for this business will appear here.
            </p>
          ) : (
            <ul>
              {notifications.map((n) => {
                const Icon = priorityIcon[n.priority];
                const isUnread = freshKeys.has(n.key) || !readKeys.has(n.key);
                return (
                  <li key={n.key}>
                    <button
                      type="button"
                      onClick={() => open(n)}
                      className={cn("flex w-full items-start gap-3 border-b px-4 py-3 text-left last:border-b-0 hover:bg-selected", isUnread && "bg-secondary/50")}
                    >
                      <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", priorityClass[n.priority])} aria-hidden />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className={cn("truncate text-sm", isUnread ? "font-semibold" : "font-medium")}>{n.title}</span>
                          {isUnread && <span className="h-2 w-2 shrink-0 rounded-full bg-brand-bright" aria-label="Unread" />}
                        </span>
                        <span className="mt-0.5 block text-xs text-muted-foreground">{n.detail}</span>
                        <span className="mt-1 block text-[11px] text-muted-foreground">
                          {PRIORITY_META[n.priority].label} · {timeAgo(n.at)}
                        </span>
                      </span>
                    </button>
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
