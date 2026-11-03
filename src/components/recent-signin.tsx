import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/lib/org";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

export function RecentSignin() {
  const { email, userId } = useOrg();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  async function verify() {
    if (!email) return;
    setBusy(true);
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      setPassword("");
      if (error || data.user?.id !== userId) {
        toast.error("Sign-in could not be verified. Use your PayPatrol account password.");
        return;
      }
      toast.success("Recent sign-in verified. You can now save the protected change.");
    } finally { setBusy(false); }
  }
  return <div className="space-y-2 border-t pt-3">
    <Label htmlFor="recent-password">Confirm your PayPatrol password</Label>
    <div className="flex flex-wrap gap-2">
      <Input id="recent-password" type="password" autoComplete="current-password" className="w-full sm:w-64" value={password} onChange={e => setPassword(e.target.value)} />
      <Button type="button" variant="outline" disabled={!password || busy || !email} onClick={verify}>{busy ? "Verifying…" : "Confirm sign-in"}</Button>
    </div>
    <p className="text-xs text-muted-foreground">Google or Lovable accounts without a password must sign out and sign in again. Confirmation expires after five minutes.</p>
  </div>;
}