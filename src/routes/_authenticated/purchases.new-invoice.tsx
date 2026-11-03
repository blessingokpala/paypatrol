import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useOrg } from "@/lib/org";
import { useListings, useSuppliers, useRefreshAll } from "@/lib/queries";
import { formatMinor, parseToMinor } from "@/lib/money";
import { extractInvoiceDetails } from "@/lib/ai/ai.functions";
import { AI_ERROR_COPY, type AiError, type Extraction } from "@/lib/ai/schemas";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, Panel, ToneBadge } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/purchases/new-invoice")({
  head: () => ({
    meta: [
      { title: "Check an invoice — PayPatrol" },
      { name: "description", content: "Read an invoice with AI, confirm the details it found, then run payment checks." },
    ],
  }),
  component: NewInvoice,
});

type ExtractResult =
  | { ok: true; model: string; extractionId: string; extraction: Extraction }
  | { ok: false; error: AiError };

function NewInvoice() {
  const { orgId, has } = useOrg();
  const suppliers = useSuppliers(orgId);
  const listings = useListings(orgId);
  const navigate = useNavigate();
  const refresh = useRefreshAll();
  const readInvoice = useServerFn(extractInvoiceDetails);

  const [f, setF] = useState({ supplier: "", ref: "", amount: "", currency: "CAD", recipient: "", contact: "", category: "packaging", description: "", message: "" });
  const [quote, setQuote] = useState({ listing: "", quantity: "1" });
  const [file, setFile] = useState<File | null>(null);
  const [path, setPath] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(false);
  const [result, setResult] = useState<ExtractResult | null>(null);
  const [applied, setApplied] = useState(false);

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const canSubmit = has("preparer", "owner");
  const extraction = result?.ok ? result.extraction : null;
  const supplierListings = (listings.data ?? []).filter((l) => !f.supplier || l.supplier_id === f.supplier);
  const selectedQuote = (listings.data ?? []).find((l) => l.id === quote.listing) ?? null;

  const flag = (field: string) =>
    extraction ? (extraction.missing_fields.includes(field) ? "missing" : extraction.uncertain_fields.includes(field) ? "uncertain" : "ok") : "ok";

  async function ensureUploaded(): Promise<string | null> {
    if (path) return path;
    if (!file) return null;
    const objectPath = `${orgId}/${crypto.randomUUID()}-${file.name.replace(/[^\w.-]/g, "_")}`;
    const up = await supabase.storage.from("invoices").upload(objectPath, file);
    if (up.error) { toast.error(`Upload failed: ${up.error.message}`); return null; }
    setPath(objectPath);
    return objectPath;
  }

  async function readWithAI() {
    if (!file) { toast.error("Choose the invoice file first."); return; }
    setReading(true);
    setResult(null);
    setApplied(false);
    const objectPath = await ensureUploaded();
    if (!objectPath) { setReading(false); return; }
    const out = (await readInvoice({ data: { orgId, storagePath: objectPath, fileName: file.name } })) as ExtractResult;
    setResult(out);
    if (!out.ok) toast.error(out.error.message);
    setReading(false);
  }

  function useExtracted() {
    if (!extraction) return;
    const qty = extraction.line_items.reduce((n, l) => n + (Number.parseInt(l.quantity, 10) || 0), 0);
    setF({
      supplier: f.supplier,
      ref: extraction.invoice_reference,
      amount: extraction.total,
      currency: extraction.currency || f.currency,
      recipient: extraction.requested_payment_recipient,
      contact: extraction.payment_change_instructions || f.contact,
      category: f.category,
      description: extraction.line_items[0]?.description ?? f.description,
      message: f.message,
    });
    if (qty > 0) setQuote((q) => ({ ...q, quantity: String(qty) }));
    setApplied(true);
    toast.success("Extracted values filled in. Check every field before submitting.");
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const minor = parseToMinor(f.amount);
    if (minor === null) { toast.error("Enter the amount like 75.00"); return; }
    if (applied && extraction) {
      const blocked = ["invoice_reference", "total", "currency", "requested_payment_recipient"].filter(
        (k) => extraction.missing_fields.includes(k) || extraction.uncertain_fields.includes(k),
      );
      const stillEmpty = [
        !f.ref.trim() && "invoice_reference",
        !f.currency.trim() && "currency",
        !f.recipient.trim() && "requested_payment_recipient",
      ].filter(Boolean) as string[];
      const unresolved = [...new Set([...blocked, ...stillEmpty])];
      if (unresolved.length) { toast.error(`Fix these first: ${unresolved.join(", ")}`); return; }
    }
    setBusy(true);
    const objectPath = file ? await ensureUploaded() : null;
    if (file && !objectPath) { setBusy(false); return; }
    const { data, error } = await supabase.rpc("submit_invoice", {
      _org: orgId, _supplier: (f.supplier || null) as string, _invoice_ref: f.ref, _amount_minor: minor, _currency: f.currency,
      _recipient: f.recipient, _contact: f.contact, _category: f.category, _description: f.description, _message: f.message,
      _storage_path: objectPath as string, _file_name: (file?.name ?? null) as string,
      _listing: (quote.listing || null) as string, _quantity: (quote.listing ? Number(quote.quantity) : null) as number,
    });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    const purchaseId = data as string;
    if (result?.ok) {
      await supabase.rpc("link_extraction", { _extraction: result.extractionId, _purchase: purchaseId });
    }
    refresh();
    navigate({ to: "/purchases/$id", params: { id: purchaseId } });
  }

  if (!canSubmit) return <p className="text-sm">Only request preparers or owners can submit invoices.</p>;

  return (
    <>
      <PageHeader
        title="Check an invoice"
        description="Attach the invoice and let AI read it, or type the details yourself. Nothing is checked until you confirm what you see."
      />
      <form onSubmit={submit} className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-6">
          <Panel title="Source document and message">
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="file">Invoice file (PDF, PNG or JPEG — private)</Label>
                <Input
                  id="file"
                  type="file"
                  accept=".pdf,.png,.jpg,.jpeg"
                  onChange={(e) => { setFile(e.target.files?.[0] ?? null); setPath(null); setResult(null); setApplied(false); }}
                />
                <p className="text-xs text-muted-foreground">Stored privately for your organisation only.</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" variant="outline" onClick={readWithAI} disabled={reading || !file}>
                  {reading ? "Reading…" : "Read invoice with AI"}
                </Button>
                {result?.ok && <span className="text-xs text-muted-foreground">Model: {result.model}</span>}
              </div>
              <div className="space-y-2">
                <Label htmlFor="message">Accompanying message</Label>
                <Textarea id="message" rows={7} value={f.message} onChange={set("message")} placeholder="Paste the email or message that came with the invoice." />
                <p className="text-xs text-muted-foreground">Treated as untrusted content. Contact details here are never used to verify a change.</p>
              </div>
            </div>
          </Panel>

          {result && !result.ok && (
            <Panel title="AI result">
              <ToneBadge tone="warning">AI not connected</ToneBadge>
              <p className="mt-2 text-sm">{result.error.message || AI_ERROR_COPY[result.error.code]}</p>
              <p className="mt-2 text-xs text-muted-foreground">You can still enter every detail by hand below.</p>
            </Panel>
          )}

          {extraction && (
            <Panel
              title="What AI read from the document"
              actions={
                <Button type="button" size="sm" variant="outline" onClick={useExtracted}>
                  {applied ? "Filled in again" : "Use these values"}
                </Button>
              }
            >
              <dl className="grid grid-cols-[auto,1fr] gap-x-4 gap-y-1 text-sm">
                {([
                  ["Supplier", extraction.supplier_name, "supplier_name"],
                  ["Invoice ref", extraction.invoice_reference, "invoice_reference"],
                  ["Invoice date", extraction.invoice_date, "invoice_date"],
                  ["Due date", extraction.due_date, "due_date"],
                  ["Buyer", extraction.buyer_name, "buyer_name"],
                  ["Subtotal", extraction.subtotal, "subtotal"],
                  ["Tax", extraction.tax, "tax"],
                  ["Shipping", extraction.shipping, "shipping"],
                  ["Total", extraction.total, "total"],
                  ["Currency", extraction.currency, "currency"],
                  ["Payment recipient", extraction.requested_payment_recipient, "requested_payment_recipient"],
                ] as [string, string, string][]).map(([label, value, key]) => (
                  <div key={key} className="contents">
                    <dt className="text-muted-foreground">{label}</dt>
                    <dd className="flex flex-wrap items-center gap-2">
                      <span className={value ? "" : "italic text-muted-foreground"}>{value || "not stated"}</span>
                      {flag(key) === "missing" && <ToneBadge tone="warning">Missing — needs your input</ToneBadge>}
                      {flag(key) === "uncertain" && <ToneBadge tone="warning">Hard to read — check it</ToneBadge>}
                    </dd>
                  </div>
                ))}
              </dl>

              {extraction.line_items.length > 0 && (
                <table className="mt-4 w-full text-sm">
                  <thead className="text-left text-xs text-muted-foreground"><tr><th className="py-1">Line</th><th>Qty</th><th className="text-right">Unit</th><th className="text-right">Amount</th></tr></thead>
                  <tbody>
                    {extraction.line_items.map((l, i) => (
                      <tr key={i} className="border-t"><td className="py-1">{l.description}</td><td>{l.quantity}</td><td className="text-right">{l.unit_price}</td><td className="text-right">{l.amount}</td></tr>
                    ))}
                  </tbody>
                </table>
              )}

              {extraction.payment_change_instructions && (
                <div className="mt-4 rounded-md border-2 border-warning bg-warning-soft p-3">
                  <p className="text-xs font-semibold uppercase text-warning">Document asks for payment details to change</p>
                  <blockquote className="mt-1 whitespace-pre-wrap text-sm">{extraction.payment_change_instructions}</blockquote>
                  <p className="mt-2 text-xs">Reported as evidence only. It has no authority over who gets paid.</p>
                </div>
              )}

              {extraction.excerpts.length > 0 && (
                <details className="mt-4">
                  <summary className="cursor-pointer text-sm text-muted-foreground">Source quotes ({extraction.excerpts.length})</summary>
                  <ul className="mt-2 space-y-1 text-xs">
                    {extraction.excerpts.map((x, i) => (
                      <li key={i} className="text-muted-foreground">
                        <span className="font-medium text-foreground">{x.field}</span> — “{x.quote}”{x.page ? ` (page ${x.page})` : ""}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              <p className="mt-3 text-xs text-muted-foreground">
                AI output is untrusted. It cannot change spending rules, approve a request, confirm a supplier or move money.
              </p>
            </Panel>
          )}
        </div>

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

            <div className="space-y-2 border-t pt-4">
              <Label htmlFor="quote">Approved quote to check against (optional)</Label>
              <select id="quote" value={quote.listing} onChange={(e) => setQuote((q) => ({ ...q, listing: e.target.value }))} className="h-9 w-full rounded-md border border-input bg-card px-3 text-sm">
                <option value="">No approved quote linked</option>
                {supplierListings.map((l) => <option key={l.id} value={l.id}>{l.name} — {formatMinor(l.unit_price_minor, l.currency)}</option>)}
              </select>
              {selectedQuote && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label htmlFor="qty">Quoted quantity</Label>
                    <Input id="qty" type="number" min={1} step={1} value={quote.quantity} onChange={(e) => setQuote((q) => ({ ...q, quantity: e.target.value }))} />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Quote total {formatMinor(selectedQuote.unit_price_minor * (Number(quote.quantity) || 0), selectedQuote.currency)}. If the invoice asks for a
                    different amount, both are kept and the difference is held for you to resolve.
                  </p>
                </div>
              )}
            </div>

            <Button type="submit" disabled={busy} className="w-full">{busy ? "Checking…" : "Submit and run checks"}</Button>
          </div>
        </Panel>
      </form>
    </>
  );
}
