import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { SandboxBanner, Wordmark, Req } from "@/components/brand";
import { PasswordInput } from "@/components/password-input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { friendlyError } from "@/lib/friendly";
import { toast } from "sonner";

export const Route = createFileRoute("/reset-password")({
  head: () => ({
    meta: [
      { title: "Choose a new password — PayPatrol" },
      { name: "description", content: "Set a new password for your PayPatrol account." },
      { property: "og:title", content: "Choose a new password — PayPatrol" },
      { property: "og:description", content: "Set a new password for your PayPatrol account." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const navigate = useNavigate();
  // null = still checking the link; false = link invalid/expired; true = recovery session active
  const [ready, setReady] = useState<boolean | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let settled = false;
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY" && session) {
        settled = true;
        setReady(true);
      }
    });
    // If the recovery token in the URL was already exchanged into a session, allow the form.
    supabase.auth.getSession().then(({ data: s }) => {
      if (!settled) setReady(!!s.session);
    });
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        setReady((r) => (r === null ? false : r));
      }
    }, 6000);
    return () => {
      settled = true;
      clearTimeout(timer);
      data.subscription.unsubscribe();
    };
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) {
      toast.error("The two passwords do not match.");
      return;
    }
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) {
      toast.error(friendlyError(error));
      return;
    }
    setDone(true);
    toast.success("Password updated");
    setTimeout(() => navigate({ to: "/overview" }), 1200);
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-6 rounded-lg border bg-card p-6">
        <div className="flex items-center justify-between">
          <Wordmark className="text-2xl" />
          <SandboxBanner />
        </div>
        <div>
          <h1 className="text-xl font-bold">Choose a new password</h1>
          <p className="mt-1 text-sm text-muted-foreground">Use at least 8 characters. You stay signed in on this device afterwards.</p>
        </div>
        {ready === null ? (
          <p className="text-sm text-muted-foreground">Checking your reset link…</p>
        ) : ready === false ? (
          <div className="space-y-3">
            <p className="rounded-md bg-warning-soft p-4 text-sm">
              This reset link is invalid or has expired. Request a new one from the sign-in page.
            </p>
            <Button asChild variant="outline" className="w-full">
              <Link to="/auth">Back to sign in</Link>
            </Button>
          </div>
        ) : done ? (
          <p className="rounded-md bg-selected p-4 text-sm">Your password is updated. Taking you to your workspace…</p>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="new-password">New password<Req /></Label>
              <PasswordInput id="new-password" minLength={8} autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm-password">Repeat new password<Req /></Label>
              <PasswordInput id="confirm-password" minLength={8} autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            </div>
            <Button type="submit" className="w-full" disabled={busy}>{busy ? "Saving…" : "Save new password"}</Button>
          </form>
        )}
      </div>
    </div>
  );
}
