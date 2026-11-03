import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useOrg } from "@/lib/org";
import { useSuppliers, useRefreshAll } from "@/lib/queries";
import { parseToMinor } from "@/lib/money";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, Panel } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/purchases/new-invoice")({
  head: () => ({ meta: [{ title: "Check an invoice — PayPatrol" }, { name: "description", content: "Enter invoice details and run payment checks." }] }),
  component: NewInvoice,
});

function NewInvoice() {
  const { orgId, has } = useOrg();
  const suppliers = useSuppliers(orgId);
  const navigate = useNavigate();
  const refresh = useRefreshAll();
  const [f, setF] = useState({ supplier: "", ref: "", amount: "", currency: "CAD", recipient: "", contact: "", category: "packaging", description: "", message: "" });
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });

  const canSubmit = has("preparer", "owner");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const minor = parseToMinor(f.amount);
    if (minor === null) return toast.error("Enter the amount like 75.00");
    setBusy(true);
    let path: string | null = null;
    if (file) {
      path = `${orgId}/${crypto.randomUUID()}-${file.name.replace(/[^\w.-]/g, "_")}`;
      const up = await supabase.storage.from("invoices").upload(path, file);
      if (up.error) { setBusy(false); return toast.error(`Upload failed: ${up.error.message}`); }
    }
    const { data, error } = await supabase.rpc("submit_invoice", {
      _org: orgId, _supplier: (f.supplier || null) as string, _invoice_ref: f.ref, _amount_minor: minor, _currency: f.currency,
      _recipient: f.recipient, _contact: f.contact, _category: f.category, _description: f.description, _message: f.message,
      _storage_path: path as string, _file_name: (file?.name ?? null) as string,
    });
    setBusy(false);
    if (error) return toast.error(error.message);
    refresh();
    navigate({ to: "/purchases/$id", params: { id: data as string } });
  }

  if (!canSubmit) return <p className="text-sm">Only request preparers or owners can submit invoices.</p>;

  return (
    <>
      <PageHeader title="Check an invoice" description="Enter the details exactly as they appear on the invoice. AI extraction is not connected yet, so nothing is filled in automatically." />
      <form onSubmit={submit} className="grid gap-6 lg:grid-cols-2">
        <Panel title="Source document and message">
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="file">Invoice file (optional, private)</Label>
              <Input id="file" type="file" accept=".pdf,.png,.jpg,.jpeg" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
              <p className="text-xs text-muted-foreground">Stored privately for your organisation only.</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="message">Accompanying message</Label>
              <Textarea id="message" rows={10} value={f.message} onChange={set("message")} placeholder="Paste the email or message that came with the invoice." />
              <p className="text-xs text-muted-foreground">Treated as untrusted content. Contact details here are never used to verify a change.</p>
            </div>
          </div>
        </Panel>
        <Panel title="Invoice details">
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="supplier">Supplier</Label>
              <select id="supplier" value={f.supplier} onChange={set("supplier")} className="h-9 w-full rounded-md border border-input bg-card px-3 text-sm">
                <option value="">Not matched to an approved supplier</option>
                {(suppliers.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}{s.status !== "active" ? ` (${s.status.replace("_", " ")})` : ""}</option>)}
              </select>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2"><Label htmlFor="ref">Invoice reference</Label><Input id="ref" value={f.ref} onChange={set("ref")} /></div>
              <div className="space-y-2"><Label htmlFor="cat">Category</Label><Input id="cat" value={f.category} onChange={set("category")} /></div>
              <div className="space-y-2"><Label htmlFor="amt">Amount</Label><Input id="amt" inputMode="decimal" required value={f.amount} onChange={set("amount")} placeholder="75.00" /></div>
              <div className="space-y-2"><Label htmlFor="cur">Currency</Label><Input id="cur" required maxLength={3} value={f.currency} onChange={set("currency")} /></div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="rec">Payment recipient on the invoice (PayPal merchant ID)</Label>
              <Input id="rec" value={f.recipient} onChange={set("recipient")} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="contact">Contact details given in the invoice or message</Label>
              <Input id="contact" value={f.contact} onChange={set("contact")} />
            </div>
            <div className="space-y-2"><Label htmlFor="desc">Short description</Label><Input id="desc" value={f.description} onChange={set("description")} /></div>
            <Button type="submit" disabled={busy} className="w-full">{busy ? "Checking…" : "Submit and run checks"}</Button>
          </div>
        </Panel>
      </form>
    </>
  );
}
