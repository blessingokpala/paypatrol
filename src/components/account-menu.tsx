import { Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { LogOut, Settings, SlidersHorizontal } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/lib/org";
import { ROLE_LABELS } from "@/lib/status";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

function initials(email: string | null): string {
  if (!email) return "?";
  const name = email.split("@")[0] ?? "";
  const parts = name.split(/[._-]+/).filter(Boolean);
  const letters = parts.length >= 2 ? parts[0]![0]! + parts[1]![0]! : name.slice(0, 2);
  return letters.toUpperCase();
}

export function AccountMenu() {
  const org = useOrg();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const isOwner = org.has("owner");

  async function signOut() {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", search: {}, replace: true });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Account menu"
          className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground hover:opacity-90"
        >
          {initials(org.email)}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="font-normal">
          <p className="truncate text-sm font-semibold">{org.email ?? "Signed in"}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {org.roles.map((r) => ROLE_LABELS[r]).join(", ") || "No role"} · {org.orgName}
          </p>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {isOwner && (
          <>
            <DropdownMenuItem asChild>
              <Link to="/settings" className="flex items-center gap-2">
                <Settings className="h-4 w-4" aria-hidden /> Team & integrations
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link to="/rules" className="flex items-center gap-2">
                <SlidersHorizontal className="h-4 w-4" aria-hidden /> Spending rules
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuItem onSelect={signOut} className="flex items-center gap-2">
          <LogOut className="h-4 w-4" aria-hidden /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
