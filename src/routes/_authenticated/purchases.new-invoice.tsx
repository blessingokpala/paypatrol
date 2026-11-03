import { createFileRoute, useNavigate, useBlocker } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useOrg } from "@/lib/org";
import { useListings, useSuppliers, useRefreshAll } from "@/lib/queries";
import { formatMinor, parseToMinor } from "@/lib/money";
import { extractInvoiceDetails } from "@/lib/ai/ai.functions";
import { AI_ERROR_COPY, type AiError, type Extraction } from "@/lib/ai/schemas";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, Panel, Req, RequiredNote, ToneBadge } from "@/components/brand";
import { BackLink } from "@/components/back-link";
import { FieldSelect } from "@/components/field-select";
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
      { property: "og:title", content: "Check an invoice — PayPatrol" },
      { property: "og:description", content: "Review Gemini invoice readings before submitting a PayPatrol request." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: NewInvoice,
});

type ExtractResult =
  | { ok: true; model: string; extractionId: string; extraction: Extraction }
  | { ok: false; error: AiError };

type Phase = "idle" | "uploading" | "reading" | "ready" | "failed";

const PHASE_TEXT: Record<Phase, string | null> = {
  idle: null,
  uploading: "Uploading invoice…",
  reading: "Reading invoice…",
  ready: "Ready to review — check every field before submitting.",
  failed: "Could not read invoice. You can enter every detail by hand.",
};

function NewInvoice() {
  const { orgId, has } = useOrg();
  const suppliers = useSuppliers(orgId);
  const listings = useListings(orgId);
  const navigate = useNavigate();
  const refresh = useRefreshAll();
  const readInvoice = useServerFn(extractInvoiceDetails);

  const [f, setF] = useState({ supplier: "", ref: "", amount: "", currency: "CAD", recipient: "", contact: "", category: "packaging", description: "", message: "" });
  const [edited, setEdited] = useState<Set<keyof typeof f>>(new Set());
  const [quote, setQuote] = useState({ listing: "", quantity: "1" });
  const [file, setFile] = useState<File | null>(null);
  const [path, setPath] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [result, setResult] = useState<ExtractResult | null>(null);
  const [applied, setApplied] = useState(false);
  const [amountError, setAmountError] = useState<string | null>(null);
  const amountRef = useRef<HTMLInputElement>(null);
  const readSeq = useRef(0);

  const dirty = edited.size > 0 || file !== null;
  useBlocker({
    shouldBlockFn: () => dirty && !busy,
    enableBeforeUnload: dirty && !busy,
  });

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setF({ ...f, [k]: e.target.value });
    setEdited((prev) => new Set(prev).add(k));
    if (k === "amount") setAmountError(null);
  };
  const canSubmit = has("preparer", "owner");
  const extraction = result?.ok ? result.extraction : null;
  const supplierListings = (listings.data ?? []).filter((l) => !f.supplier || l.supplier_id === f.supplier);
  const selectedQuote = (listings.data ?? []).find((l) => l.id === quote.listing) ?? null;
  const matchedSupplier = (suppliers.data ?? []).find((s) => s.id === f.supplier) ?? null;

  const flag = (field: string) =>
    extraction ? (extraction.missing_fields.includes(field) ? "missing" : extraction.uncertain_fields.includes(field) ? "uncertain" : "ok") : "ok";

  async function upload(): Promise<string | null> {
    if (path) return path;
    if (!file) return null;
    const objectPath = `${orgId}/${crypto.randomUUID()}-${file.name.replace(/[^\w.-]/g, "_")}`;
    const up = await supabase.storage.from("invoices").upload(objectPath, file);
    if (up.error) { toast.error(`Upload failed: ${up.error.message}`); return null; }
    setPath(objectPath);
    return objectPath;
  }

  async function startRead(chosen: File) {
    const seq = ++readSeq.current;
    setPhase("uploading");
    setResult(null);
    setApplied(false);
    const objectPath = `${orgId}/${crypto.randomUUID()}-${chosen.name.replace(/[^\w.-]/g, "_")}`;
    const up = await supabase.storage.from("invoices").upload(objectPath, chosen);
    if (seq !== readSeq.current) return; // a newer file replaced this one
    if (up.error) {
      setPhase("failed");
      toast.error(`Upload failed: ${up.error.message}`);
      return;
    }
    setPath(objectPath);
    setPhase("reading");
    const out = (await readInvoice({ data: { orgId, storagePath: objectPath, fileName: chosen.name } })) as ExtractResult;
    if (seq !== readSeq.current) return;
    setResult(out);
    setPhase(out.ok ? "ready" : "failed");
    if (!out.ok) toast.error(out.error.message);
  }

  function onFileChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const chosen = e.target.files?.[0] ?? null;
    setFile(chosen);
    setPath(null);
    setResult(null);
    setApplied(false);
    setPhase("idle");
    if (chosen) void startRead(chosen);
  }

  function useExtracted() {
    if (!extraction) return;
    const incoming = {
      ref: extraction.invoice_reference,
      amount: extraction.total,
      currency: extraction.currency || f.currency,
      recipient: extraction.requested_payment_recipient,
      contact: extraction.payment_change_instructions || f.contact,
      description: extraction.line_items[0]?.description ?? f.description,
    };
    const conflicts = (Object.keys(incoming) as (keyof typeof incoming)[]).filter(
      (k) => edited.has(k) && f[k] !== incoming[k] && incoming[k],
    );
    if (conflicts.length > 0 && !window.confirm(`You edited ${conflicts.join(", ")} after the reading. Replace your edits with the values AI read?`)) {
      return;
    }
    const qty = extraction.line_items.reduce((n, l) => n + (Number.parseInt(l.quantity, 10) || 0), 0);
    setF({ ...f, ...incoming });
    setEdited((prev) => {
      const next = new Set(prev);
      (Object.keys(incoming) as (keyof typeof incoming)[]).forEach((k) => next.delete(k));
      return next;
    });
    if (qty > 0) setQuote((q) => ({ ...q, quantity: String(qty) }));
    setApplied(true);
    toast.success("Extracted values filled in. Check every field before submitting.");
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const minor = parseToMinor(f.amount);
    if (minor === null) {
      setAmountError("Enter the amount like 75.00");
      amountRef.current?.focus();
      return;
    }
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
    const objectPath = file ? await upload() : null;
    if (file && !objectPath) { setBusy(false); return; }
    const { data, error } = await supabase.rpc("submit_invoice", {
      _org: orgId, _supplier: (f.supplier || null) as string, _invoice_ref: f.ref, _amount_minor: minor, _currency: f.currency,
      _recipient: f.recipient, _contact: f.contact, _category: f.category, _description: f.description, _message: f.message,
      _storage_path: objectPath as string, _file_name: (file?.name ?? null) as string,
      _listing: (quote.listing || null) as string, _quantity: (quote.listing ? Number(quote.quantity) : null) as number,
    });
    if (error) {
      setBusy(false);
      toast.error(`Could not save: ${error.message}. Your entries are still here — try again.`);
      return;
    }
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
      <BackLink to="/purchases" label="Back to purchases" />
      <PageHeader
        title="Check an invoice"
        description="Attach the invoice and AI starts reading it straight away, or type the details yourself. Nothing is checked until you confirm what you see."
      />
      <form onSubmit={submit} className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-6">
          <Panel title="Source document and message">
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="file">Invoice file (PDF, PNG or JPEG — private)</Label>
                <Input id="file" type="file" accept=".pdf,.png,.jpg,.jpeg" onChange={onFileChosen} />
                <p className="text-xs text-muted-foreground">Stored privately for your organisation only.</p>
              </div>
              <div className="flex flex-wrap items-center gap-2" aria-live="polite">
                {phase !== "idle" && (
                  <ToneBadge tone={phase === "ready" ? "success" : phase === "failed" ? "warning" : "info"}>
                    {PHASE_TEXT[phase]}
                  </ToneBadge>
                )}
                {file && (phase === "failed" || phase === "ready") && (
                  <Button type="button" variant="outline" size="sm" onClick={() => void startRead(file)}>
                    Read again
                  </Button>
                )}
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
            <RequiredNote />
            <div className="space-y-2">
              <Label htmlFor="supplier">Approved supplier match</Label>
              <FieldSelect
                id="supplier"
                value={f.supplier}
                onChange={(v) => { setF({ ...f, supplier: v }); setEdited((prev) => new Set(prev).add("supplier")); }}
                placeholder="Not matched to an approved supplier"
                options={[
                  { value: "", label: "Not matched to an approved supplier" },
                  ...(suppliers.data ?? []).map((s) => ({ value: s.id, label: `${s.name}${s.status !== "active" ? ` (${s.status.replace("_", " ")})` : ""}` })),
                ]}
              />
              {extraction?.supplier_name && (
                <p className="text-xs text-muted-foreground">
                  Supplier named on the invoice: <span className="font-medium text-foreground">{extraction.supplier_name}</span>
                  {matchedSupplier ? ` — you matched it to the approved record “${matchedSupplier.name}”.` : " — choose the matching approved supplier yourself; AI never matches it for you."}
                </p>
              )}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2"><Label htmlFor="ref">Invoice reference</Label><Input id="ref" value={f.ref} onChange={set("ref")} /></div>
              <div className="space-y-2"><Label htmlFor="cat">Category</Label><Input id="cat" value={f.category} onChange={set("category")} /></div>
              <div className="space-y-2">
                <Label htmlFor="amt">Amount<Req /></Label>
                <Input id="amt" ref={amountRef} inputMode="decimal" required value={f.amount} onChange={set("amount")} placeholder="75.00" aria-invalid={Boolean(amountError)} aria-describedby={amountError ? "amt-error" : undefined} />
                {amountError && <p id="amt-error" className="text-xs text-blocked">{amountError}</p>}
              </div>
              <div className="space-y-2"><Label htmlFor="cur">Currency<Req /></Label><Input id="cur" required maxLength={3} value={f.currency} onChange={set("currency")} /></div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="rec">Payment recipient on the invoice (PayPal merchant ID)</Label>
              <Input id="rec" value={f.recipient} onChange={set("recipient")} />
              <p className="text-xs text-muted-foreground">Kept exactly as the invoice states it. It is never replaced by the approved supplier record.</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="contact">Contact details given in the invoice or message</Label>
              <Input id="contact" value={f.contact} onChange={set("contact")} />
            </div>
            <div className="space-y-2"><Label htmlFor="desc">Short description</Label><Input id="desc" value={f.description} onChange={set("description")} /></div>

            <div className="space-y-2 border-t pt-4">
              <Label htmlFor="quote">Approved quote to check against (optional)</Label>
              <FieldSelect
                id="quote"
                value={quote.listing}
                onChange={(v) => setQuote((q) => ({ ...q, listing: v }))}
                placeholder="No approved quote linked"
                options={[
                  { value: "", label: "No approved quote linked" },
                  ...supplierListings.map((l) => ({ value: l.id, label: `${l.name} — ${formatMinor(l.unit_price_minor, l.currency)}` })),
                ]}
              />
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
