import { friendlyError, humanize } from "@/lib/friendly";
import { createFileRoute, useNavigate, useBlocker } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useOrg } from "@/lib/org";
import { useActivePolicy, useListings, useSuppliers, useRefreshAll } from "@/lib/queries";
import { mapExtraction } from "@/lib/ai/invoice-mapping";
import { formatMinor, parseToMinor } from "@/lib/money";
import { extractInvoiceDetails } from "@/lib/ai/ai.functions";
import { AI_ERROR_COPY, type AiError, type Extraction } from "@/lib/ai/schemas";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, Panel, Req, RequiredNote, ToneBadge } from "@/components/brand";
import { BackLink } from "@/components/back-link";
import { fromSearch } from "@/lib/return-to";
import { FieldSelect } from "@/components/field-select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/purchases/new-invoice")({
  validateSearch: fromSearch,
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
  const policy = useActivePolicy(orgId);
  const allowedCategories = policy.data?.active?.allowed_categories ?? [];
  const [categoryError, setCategoryError] = useState<string | null>(null);
  const navigate = useNavigate();
  const refresh = useRefreshAll();
  const readInvoice = useServerFn(extractInvoiceDetails);

  const [f, setF] = useState({ supplier: "", ref: "", amount: "", currency: "CAD", recipient: "", recipientName: "", contact: "", category: "", description: "", message: "" });
  const [edited, setEdited] = useState<Set<keyof typeof f>>(new Set());
  const editedRef = useRef<Set<keyof typeof f>>(new Set());
  const markEdited = (k: keyof typeof f) => { editedRef.current = new Set(editedRef.current).add(k); setEdited(new Set(editedRef.current)); };
  const [quote, setQuote] = useState({ listing: "", quantity: "1" });
  const [file, setFile] = useState<File | null>(null);
  const [path, setPath] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [result, setResult] = useState<ExtractResult | null>(null);
  const [applied, setApplied] = useState(false);
  const [addSupplier, setAddSupplier] = useState(false);
  const [amountError, setAmountError] = useState<string | null>(null);
  const amountRef = useRef<HTMLInputElement>(null);
  const readSeq = useRef(0);

  const dirty = edited.size > 0 || file !== null;
  useBlocker({
    shouldBlockFn: () => dirty && !busy && !window.confirm("Leave this form? Your unsaved entries will be lost."),
    enableBeforeUnload: dirty && !busy,
  });

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setF({ ...f, [k]: e.target.value });
    markEdited(k);
    if (k === "amount") setAmountError(null);
  };
  const canSubmit = has("preparer", "owner");
  const extraction = result?.ok ? result.extraction : null;
  const supplierListings = (listings.data ?? []).filter((l) => !f.supplier || l.supplier_id === f.supplier);
  const selectedQuote = (listings.data ?? []).find((l) => l.id === quote.listing) ?? null;
  const matchedSupplier = (suppliers.data ?? []).find((s) => s.id === f.supplier) ?? null;
  const mapped = extraction ? mapExtraction(extraction, allowedCategories) : null;
  const categoryStated = mapped?.categoryStated ?? "";

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
    if (out.ok) applyExtracted(true, out.extraction);
    else toast.error(out.error.message);
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

  // auto=true fills only fields the user has not touched; auto=false (the button) asks before replacing manual edits.
  function applyExtracted(auto: boolean, ex: Extraction) {
    const mapped = mapExtraction(ex, allowedCategories);
    const incoming = {
      ref: ex.invoice_reference,
      amount: ex.total,
      currency: ex.currency,
      recipient: mapped.recipient,
      recipientName: mapped.recipientName,
      category: mapped.category,
      contact: ex.payment_change_instructions,
      description: ex.line_items[0]?.description ?? "",
    };
    const keys = (Object.keys(incoming) as (keyof typeof incoming)[]).filter((k) => Boolean(incoming[k]));
    const conflicts = keys.filter((k) => editedRef.current.has(k) && f[k] !== incoming[k]);
    if (!auto && conflicts.length > 0 && !window.confirm(`You edited ${conflicts.join(", ")} after the reading. Replace your edits with the values AI read?`)) {
      return;
    }
    const applyKeys = auto ? keys.filter((k) => !editedRef.current.has(k)) : keys;
    if (applyKeys.length === 0) return;
    setF((prev) => {
      const next = { ...prev };
      for (const k of applyKeys) next[k] = incoming[k] as string;
      return next;
    });
    editedRef.current = new Set([...editedRef.current].filter((k) => !applyKeys.includes(k as keyof typeof incoming)));
    setEdited(new Set(editedRef.current));
    const qty = ex.line_items.reduce((n, l) => n + (Number.parseInt(l.quantity, 10) || 0), 0);
    if (qty > 0) setQuote((q) => ({ ...q, quantity: String(qty) }));
    setApplied(true);
    toast.success(auto ? "Extracted values filled into the empty fields. Check every field before submitting." : "Extracted values filled in. Check every field before submitting.");
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const minor = parseToMinor(f.amount);
    if (minor === null) {
      setAmountError("Enter the amount like 75.00");
      amountRef.current?.focus();
      return;
    }
    if (!f.category) {
      setCategoryError(categoryStated && !mapped?.categoryPermitted
        ? `The document says “${categoryStated}”, which your spending rules do not permit. Choose a permitted category.`
        : "Choose a permitted category.");
      document.getElementById("cat")?.focus();
      return;
    }
    if (applied && extraction) {
      const fieldOf: Record<string, keyof typeof f> = { invoice_reference: "ref", total: "amount", currency: "currency", requested_payment_recipient: "recipient", paypal_merchant_id: "recipient", payment_recipient_name: "recipientName" };
      // Uncertain values must be re-entered or confirmed by editing; missing ones must be filled in.
      const blocked = Object.keys(fieldOf).filter(
        (k) => extraction.uncertain_fields.includes(k) && !edited.has(fieldOf[k]!),
      );
      const stillEmpty = [
        !f.ref.trim() && "invoice_reference",
        !f.currency.trim() && "currency",
        !f.recipient.trim() && "PayPal merchant ID",
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
      _recipient_name: (f.recipientName.trim() || null) as string,
    });
    if (error) {
      setBusy(false);
      toast.error(`Could not save: ${friendlyError(error, "Saving")} Your entries are still here — try again.`);
      return;
    }
    const purchaseId = data as string;
    if (result?.ok) {
      await supabase.rpc("link_extraction", { _extraction: result.extractionId, _purchase: purchaseId });
    }
    refresh();
    navigate({ to: "/purchases/$id", params: { id: purchaseId }, search: { from: "/purchases" } });
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
                <Button type="button" size="sm" variant="outline" onClick={() => extraction && applyExtracted(false, extraction)}>
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
                  ["Category stated", extraction.category_stated, "category_stated"],
                  ["Payee name", extraction.payment_recipient_name, "payment_recipient_name"],
                  ["PayPal merchant ID", extraction.paypal_merchant_id, "paypal_merchant_id"],
                  ...(extraction.requested_payment_recipient ? [["Payment recipient (earlier reading)", extraction.requested_payment_recipient, "requested_payment_recipient"]] : []),
                ] as [string, string, string][]).map(([label, value, key]) => (
                  <div key={key} className="contents">
                    <dt className="text-muted-foreground">{label}</dt>
                    <dd className="flex flex-wrap items-center gap-2">
                      <span className={value ? "" : "italic text-muted-foreground"}>{value || "Not found in document"}</span>
                      {flag(key) === "missing" && <ToneBadge tone="warning">{["total", "currency", "requested_payment_recipient", "paypal_merchant_id", "invoice_reference"].includes(key) ? "Required before proceeding" : "Optional — not found in document"}</ToneBadge>}
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
              <Label htmlFor="supplier">Supplier record</Label>
              <div className="flex gap-2">
                <div className="min-w-0 flex-1">
                  <FieldSelect
                    id="supplier"
                    value={f.supplier}
                    onChange={(v) => { setF({ ...f, supplier: v }); markEdited("supplier"); }}
                    placeholder="Not matched to a supplier"
                    options={[
                      { value: "", label: "Not matched to a supplier" },
                      ...(suppliers.data ?? []).map((s) => ({ value: s.id, label: s.status === "active" ? `${s.name} — Approved` : `${s.name} — Pending verification (not approved)` })),
                    ]}
                  />
                </div>
                <Button type="button" variant="outline" aria-expanded={addSupplier} aria-controls="add-supplier" onClick={() => setAddSupplier((v) => !v)}>
                  {addSupplier ? "Close" : "Add supplier"}
                </Button>
              </div>
              {extraction?.supplier_name && (
                <p className="text-xs text-muted-foreground">
                  Supplier named on the invoice: <span className="font-medium text-foreground">{extraction.supplier_name}</span>
                  {matchedSupplier ? ` — you matched it to “${matchedSupplier.name}”.` : " — not matched. AI never matches a supplier for you; if it isn't listed, add it as a pending supplier."}
                </p>
              )}
              {matchedSupplier && matchedSupplier.status !== "active" && (
                <div className="rounded-md border border-warning/40 bg-warning-soft p-3 text-xs space-y-1">
                  <p className="font-semibold">Pending supplier — not approved and not payable.</p>
                  <p>Next step: a <span className="font-medium">different</span> team member with the Business owner or Change approver role reviews it on the Suppliers page. The person who proposed it cannot approve it.</p>
                  <p>Approval alone does not make it payable: its PayPal merchant ID must also complete enrolment. An uploaded invoice never approves a supplier or its payment details.</p>
                </div>
              )}
              {addSupplier && (
                has("owner") ? (
                  <AddSupplierInline
                    orgId={orgId}
                    suggestion={{ name: mapped?.recipientName || extraction?.supplier_name || "", merchant: f.recipient || mapped?.recipient || "" }}
                    onCreated={(id) => { refresh(); setF((prev) => ({ ...prev, supplier: id })); markEdited("supplier"); setAddSupplier(false); }}
                  />
                ) : (
                  <p id="add-supplier" className="rounded-md border p-3 text-sm">Only a Business owner can propose a new supplier. Ask an owner to add it; your invoice entries stay here.</p>
                )
              )}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2"><Label htmlFor="ref">Invoice reference</Label><Input id="ref" value={f.ref} onChange={set("ref")} /></div>
              <div className="space-y-2">
                <Label htmlFor="cat">Category<Req /></Label>
                <FieldSelect
                  id="cat"
                  value={f.category}
                  onChange={(v) => { setF({ ...f, category: v }); markEdited("category"); setCategoryError(null); }}
                  placeholder="Choose a permitted category"
                  options={[{ value: "", label: "Choose a permitted category" }, ...allowedCategories.map((c) => ({ value: c, label: humanize(c) }))]}
                />
                {categoryStated && (
                  <p className="text-xs text-muted-foreground">
                    Document says: <span className="font-medium text-foreground">{categoryStated}</span>
                    {mapped?.categoryPermitted ? "" : " — not one of your permitted categories, so nothing was filled in. Choose one yourself."}
                  </p>
                )}
                {categoryError && <p id="cat-error" role="alert" className="text-xs text-blocked">{categoryError}</p>}
              </div>
              <div className="space-y-2">
                <Label htmlFor="amt">Amount<Req /></Label>
                <Input id="amt" ref={amountRef} inputMode="decimal" required value={f.amount} onChange={set("amount")} placeholder="75.00" aria-invalid={Boolean(amountError)} aria-describedby={amountError ? "amt-error" : undefined} />
                {amountError && <p id="amt-error" className="text-xs text-blocked">{amountError}</p>}
              </div>
              <div className="space-y-2"><Label htmlFor="cur">Currency<Req /></Label><Input id="cur" required maxLength={3} value={f.currency} onChange={set("currency")} /></div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="recname">Payment recipient name</Label>
                <Input id="recname" value={f.recipientName} onChange={set("recipientName")} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="rec">PayPal merchant ID on the invoice</Label>
                <Input id="rec" className="font-mono" value={f.recipient} onChange={set("recipient")} />
              </div>
              <p className="text-xs text-muted-foreground sm:col-span-2">Kept exactly as the invoice states them. Never replaced by the approved supplier record or the connected Sandbox account.</p>
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

/** Inline pending-supplier creation that keeps the invoice draft on screen. */
function AddSupplierInline({ orgId, suggestion, onCreated }: { orgId: string; suggestion: { name: string; merchant: string }; onCreated: (id: string) => void }) {
  const [s, setS] = useState({ name: suggestion.name, merchant: suggestion.merchant, email: "", channel: "phone", channelValue: "", evidence: "" });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function create() {
    setErr(null);
    const missing = [!s.name.trim() && "supplier name", !s.merchant.trim() && "PayPal Merchant ID", !s.channelValue.trim() && "trusted contact value", !s.evidence.trim() && "how you know the contact is genuine"].filter(Boolean);
    if (missing.length) { setErr(`Complete: ${missing.join(", ")}.`); return; }
    setBusy(true);
    const { data, error } = await supabase.rpc("create_supplier", {
      _org: orgId, _name: s.name, _merchant: s.merchant, _email: s.email,
      _channel: s.channel, _channel_value: s.channelValue, _evidence: s.evidence,
    });
    setBusy(false);
    if (error) { setErr(friendlyError(error, "Adding the supplier")); return; }
    toast.success("Supplier added as pending. It must pass independent verification before it can be approved or paid.");
    onCreated(data as string);
  }
  const fld = (k: keyof typeof s, label: string, required = true) => (
    <div className="space-y-1">
      <Label htmlFor={`as-${k}`}>{label}{required ? <Req /> : null}</Label>
      <Input id={`as-${k}`} aria-required={required} value={s[k]} onChange={(e) => setS({ ...s, [k]: e.target.value })} />
    </div>
  );
  return (
    <div id="add-supplier" role="group" aria-label="Add a pending supplier" className="mt-2 space-y-3 rounded-md border border-dashed p-3">
      <RequiredNote />
      <p className="text-xs text-muted-foreground">
        Values read from the invoice are only suggestions — edit them. A new supplier starts unverified: an uploaded invoice or a
        matching Merchant ID never approves it. Sandbox limitation: only the supplier enrolled with the connected Sandbox Business
        account can actually receive a Sandbox payment; any other supplier stays unpayable until enrolment.
      </p>
      <p className="text-xs">Approval step: a different Business owner or Change approver must review this supplier on the Suppliers page. Merchant IDs starting with TESTONLY are fictional and can never be enrolled for payment.</p>
      {fld("name", "Supplier legal name")}
      {fld("merchant", "PayPal Merchant ID")}
      {fld("email", "Supplier email", false)}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="as-channel">Trusted contact channel<Req /></Label>
          <FieldSelect
            id="as-channel"
            value={s.channel}
            onChange={(v) => setS({ ...s, channel: v })}
            options={[{ value: "phone", label: "Phone" }, { value: "email", label: "Email" }]}
          />
        </div>
        {fld("channelValue", "Trusted contact value")}
      </div>
      <div className="space-y-1">
        <Label htmlFor="as-evidence">How do you know this contact is genuine?<Req /></Label>
        <Textarea id="as-evidence" aria-required value={s.evidence} onChange={(e) => setS({ ...s, evidence: e.target.value })} placeholder="e.g. confirmed by phone on a number from a signed contract" />
      </div>
      {err && <p role="alert" className="rounded-md border border-warning/40 bg-warning-soft p-3 text-sm">{err}</p>}
      <Button type="button" size="sm" disabled={busy} onClick={() => void create()}>{busy ? "Adding…" : "Add as pending supplier"}</Button>
    </div>
  );
}
