import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/lib/org";
import { useListings, useRefreshAll } from "@/lib/queries";
import { formatMinor } from "@/lib/money";
import { proposePurchase } from "@/lib/ai/ai.functions";
import { AI_ERROR_COPY, type AiError } from "@/lib/ai/schemas";
import { PageHeader, Panel, ToneBadge } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/purchases/new-proposal")({
  head: () => ({
    meta: [
      { title: "Create a purchase request — PayPatrol" },
      { name: "description", content: "Ask the assistant for what you need, or pick an approved listing yourself. Both run the same checks." },
      { property: "og:title", content: "Create a purchase request — PayPatrol" },
      { property: "og:description", content: "Create PayPatrol requests from approved listings with shared payment checks." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: NewProposal,
});

type AssistantResult =
  | { ok: true; model: string; purchaseId: string; claims: { listingName: string; quantity: number; reasoning: string; claimedRecipient: string; claimedTotal: string } }
  | { ok: false; error: AiError };

function NewProposal() {
  const { orgId, has } = useOrg();
  const listings = useListings(orgId);
  const navigate = useNavigate();
  const refresh = useRefreshAll();
  const ask = useServerFn(proposePurchase);

  const [request, setRequest] = useState("");
  const [asking, setAsking] = useState(false);
  const [outcome, setOutcome] = useState<AssistantResult | null>(null);

  const [f, setF] = useState({ listing: "", quantity: "1", message: "" });
  const [busy, setBusy] = useState(false);
  const selected = (listings.data ?? []).find((l) => l.id === f.listing);
  const canSubmit = has("preparer", "owner");

  async function askAssistant(e: React.FormEvent) {
    e.preventDefault();
    setAsking(true);
    setOutcome(null);
    const out = (await ask({ data: { orgId, request } })) as AssistantResult;
    setOutcome(out);
    setAsking(false);
    if (!out.ok) { toast.error(out.error.message || AI_ERROR_COPY[out.error.code]); return; }
    refresh();
    navigate({ to: "/purchases/$id", params: { id: out.purchaseId } });
  }

  async function submitManual(e: React.FormEvent) {
    e.preventDefault();
    if (!selected) { toast.error("Choose an approved listing."); return; }
    setBusy(true);
    const { data, error } = await supabase.rpc("submit_ai_proposal", {
      _org: orgId,
      _listing: f.listing,
      _quantity: Number(f.quantity),
      _claimed_recipient: null as unknown as string,
      _claimed_total_minor: null as unknown as number,
    });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    refresh();
    navigate({ to: "/purchases/$id", params: { id: data as string } });
  }

  if (!canSubmit) return <p className="text-sm">Only request preparers or owners can create purchase requests.</p>;

  return (
    <>
      <PageHeader
        title="Create a purchase request"
        description="Ask the assistant in plain words, or pick an approved listing yourself. Either way the request is checked against approved records before anything is paid."
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Ask the assistant">
          <form onSubmit={askAssistant} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="req">What do you need?</Label>
              <Textarea
                id="req"
                rows={4}
                required
                value={request}
                onChange={(e) => setRequest(e.target.value)}
                placeholder="e.g. We are out of copy paper — 3 packs for the front desk."
              />
              <p className="text-xs text-muted-foreground">
                The assistant may only choose from your approved listings and stay inside their quantity limit. Prices, totals, currency and the payment
                recipient come from approved records, never from the assistant.
              </p>
            </div>
            <Button type="submit" disabled={asking || request.trim().length < 3}>{asking ? "Asking…" : "Ask and create request"}</Button>
          </form>

          {outcome && !outcome.ok && (
            <div className="mt-4 rounded-md border-2 border-warning bg-warning-soft p-3">
              <ToneBadge tone="warning">AI not connected</ToneBadge>
              <p className="mt-2 text-sm">{outcome.error.message || AI_ERROR_COPY[outcome.error.code]}</p>
              <p className="mt-2 text-xs text-muted-foreground">You can still choose an approved listing on the right.</p>
            </div>
          )}
        </Panel>

        <Panel title="Or choose an approved listing yourself">
          <form onSubmit={submitManual} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="listing">Approved listing</Label>
              <select id="listing" value={f.listing} onChange={(e) => setF({ ...f, listing: e.target.value })} className="h-9 w-full rounded-md border border-input bg-card px-3 text-sm">
                <option value="">Choose a listing</option>
                {(listings.data ?? []).map((l) => (
                  <option key={l.id} value={l.id}>{l.name} — {formatMinor(l.unit_price_minor, l.currency)} (limit {l.max_quantity})</option>
                ))}
              </select>
            </div>
            {selected && (
              <div className="space-y-2">
                <Label htmlFor="qty">Quantity (limit {selected.max_quantity})</Label>
                <Input id="qty" type="number" min={1} max={selected.max_quantity} step={1} value={f.quantity} onChange={(e) => setF({ ...f, quantity: e.target.value })} />
                <p className="text-xs text-muted-foreground">
                  Total {formatMinor(selected.unit_price_minor * (Number(f.quantity) || 0), selected.currency)} · recipient {selected.suppliers?.name ?? "supplier on record"}
                </p>
              </div>
            )}
            <Button type="submit" disabled={busy || !selected} className="w-full">{busy ? "Creating…" : "Create request and run checks"}</Button>
          </form>
          <p className="mt-4 text-xs text-muted-foreground">
            Nothing is paid here. PayPal is not connected, so no order is created and no payment is shown as completed.
          </p>
        </Panel>
      </div>
    </>
  );
}
