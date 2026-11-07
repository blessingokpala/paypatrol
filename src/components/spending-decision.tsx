import { useId, useState } from "react";
import { Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/lib/org";
import { friendlyError } from "@/lib/friendly";
import { rejectionReasonError, spendingReviewBlock } from "@/lib/spending-review";
import { formatMinor } from "@/lib/money";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Req, RequiredNote, ToneBadge } from "@/components/brand";
import { toast } from "sonner";

type Request = { id: string; version: number; status: string; requested_by: string; total_minor: number; currency: string };

export function SpendingDecision({ request, supplier, findings, onDone, sticky = false }: {
  request: Request; supplier: string; findings: { id: string; message: string }[]; onDone: () => void; sticky?: boolean;
}) {
  const org = useOrg();
  const fieldId = useId();
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<"approved" | "rejected" | null>(null);
  const block = spendingReviewBlock(request, org.userId, org.has("payer", "owner"));

  async function decide(approve: boolean) {
    if (block || busy) return;
    if (!approve) {
      const missing = rejectionReasonError(reason);
      if (missing) { setError(missing); return; }
    }
    setBusy(true);
    setError(null);
    try {
      const result = approve
        ? await supabase.rpc("approve_purchase", { _pid: request.id, _version: request.version, _note: "", _via: "individual" })
        : await supabase.rpc("reject_spending", { _pid: request.id, _version: request.version, _reason: reason.trim() });
      if (result.error) { setError(friendlyError(result.error)); return; }
      setSaved(approve ? "approved" : "rejected");
      setRejecting(false);
      toast.success(approve ? "Spending approved. Payment is a separate step." : "Spending rejected. Reason saved in Evidence history.");
      onDone();
    } catch (cause) { setError(friendlyError(cause)); }
    finally { setBusy(false); }
  }

  if (saved) return <div role="status" className="mt-4 space-y-2 border-t pt-4 text-sm">
    <ToneBadge tone={saved === "approved" ? "success" : "blocked"}>{saved === "approved" ? "Spending approved" : "Spending rejected"}</ToneBadge>
    <p>Saved for version {request.version}. Find the decision in <Link to="/approvals" search={{ tab: "completed", type: "spending", outcome: saved }} className="font-semibold text-primary underline">Approvals → Completed</Link> and Evidence history. No payment was created.</p>
  </div>;
  if (request.status !== "approval_required") return <p className="mt-4 text-sm text-muted-foreground">{block}</p>;
  return <>
    <section aria-label="Spending decision" className={sticky ? "my-4 rounded-md border bg-card p-4" : "mt-4 border-t pt-4"}>
      <ToneBadge tone="warning">Awaiting spending approval</ToneBadge>
      <div className="my-3 grid grid-cols-[minmax(0,1fr)_auto] gap-3 text-sm">
        <p className="min-w-0 break-words font-medium">{supplier}</p>
        <p className="shrink-0 text-right font-bold">{formatMinor(request.total_minor, request.currency)}<span className="block text-xs font-normal text-muted-foreground">{request.currency} · v{request.version}</span></p>
      </div>
      {findings.length > 0 && <ul className="mb-3 max-h-24 space-y-1 overflow-y-auto text-xs text-muted-foreground" aria-label="Spending policy findings">{findings.map((f) => <li key={f.id}>{f.message}</li>)}</ul>}
      {block ? <p className="text-sm text-muted-foreground">{block}</p> : <>
        <div className={sticky ? "sticky top-28 z-10 grid grid-cols-2 gap-3 bg-card py-2 lg:static" : "grid grid-cols-2 gap-3"}>
          <Button variant="outline" className="min-h-12 border-2 border-foreground bg-card text-foreground" disabled={busy} onClick={() => { setError(null); setRejecting(true); }}>Reject</Button>
          <Button className="min-h-12" disabled={busy} onClick={() => decide(true)}>{busy ? "Saving…" : "Approve"}</Button>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">Approving records your spending decision. Payment is a separate step.</p>
        {error && !rejecting && <p role="alert" className="mt-2 text-sm text-destructive">{error}</p>}
      </>}
    </section>
    <Dialog open={rejecting} onOpenChange={(open) => { if (!busy) setRejecting(open); }}>
      <DialogContent className="max-h-[90dvh] w-[calc(100%-2rem)] overflow-y-auto rounded-lg">
        <DialogTitle>Reject spending request</DialogTitle>
        <DialogDescription>Reject version {request.version} for {formatMinor(request.total_minor, request.currency)}. Your reason will be saved with the decision.</DialogDescription>
        <form noValidate onSubmit={(e) => { e.preventDefault(); void decide(false); }} className="space-y-3">
          <RequiredNote />
          <div className="space-y-1">
            <Label htmlFor={fieldId}>Reason<Req /></Label>
            <Textarea id={fieldId} required aria-required="true" aria-invalid={Boolean(error)} aria-describedby={`${fieldId}-help`} value={reason} onChange={(e) => { setReason(e.target.value); setError(null); }} autoFocus />
            <p id={`${fieldId}-help`} role={error ? "alert" : undefined} className={error ? "text-sm text-destructive" : "text-xs text-muted-foreground"}>{error ?? "Explain why this spending request should be rejected."}</p>
          </div>
          <Button type="submit" variant="destructive" className="min-h-12 w-full" disabled={busy}>{busy ? "Saving…" : "Confirm rejection"}</Button>
        </form>
      </DialogContent>
    </Dialog>
  </>;
}