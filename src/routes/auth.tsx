import { friendlyError, humanize } from "@/lib/friendly";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import "@lovable.dev/cloud-auth-js/styles.css";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SandboxBanner, Wordmark, Req } from "@/components/brand";
import { PasswordInput } from "@/components/password-input";
import { toast } from "sonner";

export const Route = createFileRoute("/auth")({
  validateSearch: (s: Record<string, unknown>): { redirect?: string } => (typeof s["redirect"] === "string" ? { redirect: s["redirect"] } : {}),
  head: () => ({
    meta: [
      { title: "Sign in — PayPatrol" },
      { name: "description", content: "Sign in to your PayPatrol payment-verification workspace." },
      { property: "og:title", content: "Sign in — PayPatrol" },
      { property: "og:description", content: "Sign in to your PayPatrol workspace." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AuthPage,
});

function safePath(p?: string) {
  return p && p.startsWith("/") && !p.startsWith("//") ? p : "/overview";
}

function AuthPage() {
  const { redirect } = Route.useSearch();
  const navigate = useNavigate();
  const [mode, setMode] = useState<"signin" | "signup" | "forgot">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [resetSent, setResetSent] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) navigate({ to: safePath(redirect) as "/overview" });
    });
    const { data } = supabase.auth.onAuthStateChange((e, s) => {
      if (e === "SIGNED_IN" && s) navigate({ to: safePath(redirect) as "/overview" });
    });
    return () => data.subscription.unsubscribe();
  }, [navigate, redirect]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    if (mode === "signin") {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) toast.error(friendlyError(error));
    } else if (mode === "forgot") {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin + "/reset-password",
      });
      if (error) toast.error(friendlyError(error));
      else setResetSent(true);
    } else {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: window.location.origin + (redirect ? `/auth?redirect=${encodeURIComponent(safePath(redirect))}` : "/overview"), data: { display_name: name } },
      });
      if (error) toast.error(friendlyError(error));
      else setSent(true);
    }
    setBusy(false);
  }

  async function oauth(provider: "google" | "lovable") {
    const r = await lovable.auth.signInWithOAuth(provider, { redirect_uri: window.location.origin + "/auth" });
    if (r.error) toast.error(r.error.message ?? "Sign-in failed");
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-6 rounded-lg border bg-card p-6">
        <div className="flex items-center justify-between">
          <Wordmark className="text-2xl" />
          <SandboxBanner />
        </div>
        <div>
          <h1 className="text-xl font-bold">{mode === "signin" ? "Sign in" : mode === "signup" ? "Create your account" : "Reset your password"}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {mode === "forgot" ? "Enter your account email and we will send you a reset link." : "Each person needs their own account. Independent approval depends on it."}
          </p>
        </div>
        {sent ? (
          <p className="rounded-md bg-selected p-4 text-sm">Check {email} for a confirmation link, then come back to sign in.</p>
        ) : resetSent ? (
          <p className="rounded-md bg-selected p-4 text-sm">If an account exists for {email}, a reset link is on its way. Open it on this device to choose a new password.</p>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            {mode === "signup" && (
              <div className="space-y-2">
                <Label htmlFor="name">Your name</Label>
                <Input id="name" required value={name} onChange={(e) => setName(e.target.value)} />
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            {mode !== "forgot" && (
              <div className="space-y-2">
                <Label htmlFor="password">Password<Req /></Label>
                <PasswordInput id="password" minLength={8} autoComplete={mode === "signin" ? "current-password" : "new-password"} required value={password} onChange={(e) => setPassword(e.target.value)} />
              </div>
            )}
            <Button type="submit" className="w-full" disabled={busy}>{busy ? "Please wait…" : mode === "signin" ? "Sign in" : mode === "signup" ? "Create account" : "Send reset link"}</Button>
            {mode === "signin" && (
              <p className="text-right text-sm">
                <button type="button" className="font-semibold text-brand-bright underline" onClick={() => { setMode("forgot"); setResetSent(false); }}>
                  Forgot password?
                </button>
              </p>
            )}
          </form>
        )}
        {mode !== "forgot" && (
          <div className="space-y-2">
            <Button type="button" variant="outline" className="w-full" onClick={() => oauth("google")}>Continue with Google</Button>
            <button type="button" className="lovable-auth-button w-full" onClick={() => oauth("lovable")}>Continue with Lovable</button>
          </div>
        )}
        <p className="text-center text-sm">
          {mode === "signin" ? "New to PayPatrol?" : "Already have an account?"}{" "}
          <button className="font-semibold text-brand-bright underline" onClick={() => { setMode(mode === "signin" ? "signup" : "signin"); setSent(false); setResetSent(false); }}>
            {mode === "signin" ? "Create an account" : "Sign in"}
          </button>
        </p>
      </div>
    </div>
  );
}
