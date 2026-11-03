import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useOrg } from "@/lib/org";
import { useListings, useRefreshAll } from "@/lib/queries";
import { formatMinor } from "@/lib/money";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, Panel } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/purchases/new-proposal")({
  head: () => ({ meta: [{ title: "Create AI purchase request — PayPatrol" }, { name: "description", content: "Create a purchase proposal from approved listings." }] }),
  component: NewProposal,
});

function NewProposal() {
  const { orgId, has } = useOrg();
  const listings = useListings(orgId);
  const navigate = useNavigate();
  const refresh = useRefreshAll();
  const [listing, setListing] = useState("");
  const [qty, setQty] = useState("1");
  const [busy, setBusy] = useState(false);
  const sel = (listings.data ?? []).find((l) => l.id === listing);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { data, error } = await supabase.rpc("submit_ai_proposal", { _org: orgId, _listing: listing, _quantity: Number(qty) });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    refresh();
    navigate({ to: "/purchases/$id", params: { id: data as string } });
  }

  if (!has("preparer", "owner")) return <p className="text-sm">Only request preparers or owners can create purchase requests.</p>;

  return (
    <>
      <PageHeader title="Create AI purchase request" description="AI not connected. Until the assistant is connected, choose the listing and quantity it would propose. The server sets the price, total, currency and recipient from approved records." />
      <form onSubmit={submit} className="grid gap-6 lg:grid-cols-2">
        <Panel title="Proposal">
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="listing">Approved listing</Label>
              <select id="listing" required value={listing} onChange={(e) => setListing(e.target.value)} className="h-9 w-full rounded-md border border-input bg-card px-3 text-sm">
                <option value="">Choose a listing</option>
                {(listings.data ?? []).map((l) => <option key={l.id} value={l.id}>{l.name} — {formatMinor(l.unit_price_minor, l.currency)} ({(l.suppliers as { name: string } | null)?.name})</option>)}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="qty">Quantity</Label>
              <Input id="qty" type="number" min={1} step={1} max={sel?.max_quantity} required value={qty} onChange={(e) => setQty(e.target.value)} />
              {sel && <p className="text-xs text-muted-foreground">Up to {sel.max_quantity} per order. Estimated total {formatMinor(sel.unit_price_minor * (Number(qty) || 0), sel.currency)} — final total is calculated on the server.</p>}
            </div>
            <Button type="submit" disabled={busy || !listing} className="w-full">{busy ? "Checking…" : "Submit and run checks"}</Button>
          </div>
        </Panel>
        {sel && (
          <Panel title="Listing content (untrusted)">
            <p className="text-sm text-muted-foreground">Source: {sel.source ?? "—"}</p>
            <blockquote className="mt-3 rounded-md border-l-4 border-warning bg-warning-soft p-3 text-sm">{sel.untrusted_description ?? "No description"}</blockquote>
            <p className="mt-3 text-xs text-muted-foreground">Listing text is shown as data. Instructions inside it have no authority over recipients, totals or rules.</p>
          </Panel>
        )}
      </form>
    </>
  );
}
