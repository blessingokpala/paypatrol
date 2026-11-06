import { friendlyError, humanize } from "@/lib/friendly";
import { createFileRoute, useNavigate, useBlocker } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useOrg } from "@/lib/org";
import { useActivePolicy, useListings, useSuppliers, useRefreshAll } from "@/lib/queries";
import { mapExtraction } from "@/lib/ai/invoice-mapping";
import { CategoryField } from "@/components/category-field";
import { toStored } from "@/lib/categories";
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
  validateSearch: (s: Record<string, unknown>) => ({ ...fromSearch(s), ...(typeof s["supplier"] === "string" && /^[0-9a-f-]{36}$/.test(s["supplier"]) ? { supplier: s["supplier"] } : {}) }),
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

  const initialSupplier = (Route.useSearch() as { supplier?: string }).supplier ?? "";
  const [f, setF] = useState({ supplier: initialSupplier, ref: "", amount: "", currency: "CAD", recipient: "", recipientName: "", contact: "", category: "", categoryOther: "", description: "", message: "" });
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
  const [newSupplierId, setNewSupplierId] = useState<string | null>(null);
  useEffect(() => {
    if (newSupplierId && (suppliers.data ?? []).some((x) => x.id === newSupplierId)) {
      setF((prev) => ({ ...prev, supplier: newSupplierId }));
      markEdited("supplier");
      setNewSupplierId(null);
    }
  }, [newSupplierId, suppliers.data]);
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
      categoryOther: mapped.categoryOther,
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
    const categoryToSave = toStored({ choice: f.category, other: f.categoryOther });
    if (!categoryToSave) {
      setCategoryError(f.category === "other" ? "Specify the category." : "Select a category.");
      document.getElementById(f.category === "other" ? "cat-other" : "cat")?.focus();
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
      ].filter(Boolean) as string[];
      const unresolved = [...new Set([...blocked, ...stillEmpty])];
      if (unresolved.length) { toast.error(`Fix these first: ${unresolved.join(", ")}`); return; }
    }
    setBusy(true);
    const objectPath = file ? await upload() : null;
    if (file && !objectPath) { setBusy(false); return; }
    const { data, error } = await supabase.rpc("submit_invoice", {
      _org: orgId, _supplier: (f.supplier || null) as string, _invoice_ref: f.ref, _amount_minor: minor, _currency: f.currency,
      _recipient: f.recipient, _contact: f.contact, _category: categoryToSave, _description: f.description, _message: f.message,
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
      <form onSubmit={submit} className="grid grid-cols-1 gap-6 lg:grid-cols-2 [&>*]:min-w-0">
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
                      {flag(key) === "missing" && <ToneBadge tone="warning">{["total", "currency", "invoice_reference"].includes(key) ? "Required before proceeding" : "Optional — not found in document"}</ToneBadge>}
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
                      ...(suppliers.data ?? []).filter((s) => s.status === "active").map((s) => ({ value: s.id, label: `Approved: ${s.name}${s.is_test_supplier ? " [test supplier]" : ""}` })),
                      ...(suppliers.data ?? []).filter((s) => s.status !== "active").map((s) => ({ value: s.id, label: `Unverified: ${s.name}${s.is_test_supplier ? " [test supplier]" : ""} — ${s.status === "draft" ? "draft, not payable" : "pending verification, not payable"}` })),
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
                  <p className="font-semibold">{matchedSupplier.status === "draft" ? "Draft supplier — unverified and not payable." : "Pending supplier — not approved and not payable."}</p>
                  {matchedSupplier.status === "draft" && <p>Next: a Business owner completes the missing verification details on the Suppliers page and submits it for approval.</p>}
                  <p>Next step: a <span className="font-medium">different</span> team member with the Business owner or Change approver role reviews it on the Suppliers page. The person who proposed it cannot approve it.</p>
                  <p>Approval alone does not make it payable: its PayPal merchant ID must also complete enrolment. An uploaded invoice never approves a supplier or its payment details.</p>
                </div>
              )}
              {addSupplier && (
                (
                  <AddSupplierInline
                    canSubmit={has("owner")}
                    orgId={orgId}
                    suggestion={{ name: mapped?.recipientName || extraction?.supplier_name || "", merchant: f.recipient || mapped?.recipient || "" }}
                    onCreated={async (id) => { setNewSupplierId(id); setAddSupplier(false); await suppliers.refetch(); }}
                  />
                )
              )}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2"><Label htmlFor="ref">Invoice reference</Label><Input id="ref" value={f.ref} onChange={set("ref")} /></div>
              <div className="space-y-1">
                <CategoryField
                  id="cat"
                  value={{ choice: f.category, other: f.categoryOther }}
                  onChange={(v) => { setF((prev) => ({ ...prev, category: v.choice, categoryOther: v.other })); markEdited("category"); markEdited("categoryOther"); setCategoryError(null); }}
                  existing={allowedCategories}
                  error={categoryError}
                />
                {categoryStated && (
                  <p className="text-xs text-muted-foreground">
                    Document says: <span className="font-medium text-foreground">{categoryStated}</span> (kept in the AI reading).
                    {f.category && !mapped?.categoryPermitted ? " This category isn't in your spending rules, so the request will be held for review." : ""}
                  </p>
                )}
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
                <Label htmlFor="rec">PayPal merchant ID on the invoice (optional)</Label>
                <Input id="rec" className="font-mono" value={f.recipient} onChange={set("recipient")} />
              </div>
              <p className="text-xs text-muted-foreground sm:col-span-2">Leave the merchant ID empty if the invoice has none — the invoice is still checked, but payment stays unavailable. Kept exactly as the invoice states them. Never replaced by the approved supplier record or the connected Sandbox account.</p>
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

/** Inline supplier draft creation that keeps the invoice draft on screen. */
function AddSupplierInline({ orgId, canSubmit, suggestion, onCreated }: { orgId: string; canSubmit: boolean; suggestion: { name: string; merchant: string }; onCreated: (id: string) => void | Promise<void> }) {
  const [s, setS] = useState({ name: suggestion.name, merchant: suggestion.merchant, email: "", channel: "phone", channelValue: "", evidence: "", isTest: false });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const missing = [!s.merchant.trim() && "PayPal merchant ID", !s.channelValue.trim() && "trusted contact", !s.evidence.trim() && "independent verification evidence"].filter(Boolean) as string[];
  async function save(submit: boolean) {
    setErr(null);
    if (!s.name.trim()) { setErr("Enter the supplier name to save a draft."); return; }
    if (submit && missing.length) { setErr(`To request approval, complete: ${missing.join(", ")}. You can save a draft instead.`); return; }
    setBusy(true);
    const { data, error } = await supabase.rpc("save_supplier_draft", {
      _org: orgId, _name: s.name, _merchant: s.merchant, _email: s.email,
      _channel: s.channel, _channel_value: s.channelValue, _evidence: s.evidence, _is_test: s.isTest,
    });
    if (error) { setBusy(false); setErr(`${friendlyError(error, "Saving the supplier")} Your invoice entries are still here.`); return; }
    if (submit) {
      const sub = await supabase.rpc("submit_supplier_draft", { _supplier: data as string, _merchant: s.merchant, _channel: s.channel, _channel_value: s.channelValue, _evidence: s.evidence });
      if (sub.error) { setBusy(false); setErr(`Saved as a draft, but approval could not be requested: ${friendlyError(sub.error)}`); onCreated(data as string); return; }
    }
    setBusy(false);
    toast.success(submit ? "Supplier submitted for approval. A different owner or change approver must approve it; it stays unpayable until then." : "Supplier saved as a draft. It is unverified and cannot be paid.");
    onCreated(data as string);
  }
  const hint = (t: string) => <p className="text-xs text-muted-foreground">{t}</p>;
  return (
    <div id="add-supplier" role="group" aria-label="Add a supplier" className="mt-2 space-y-3 rounded-md border border-dashed p-3">
      <p className="text-xs"><span className="text-blocked">*</span> Required to save a draft. Other fields can stay empty; a draft is unverified and can never be paid.</p>
      <p className="text-xs text-muted-foreground">
        Saving a supplier is not approving it. Before payment, a Business owner adds independent verification details and requests approval; a different Business owner or Change approver then approves it, and its PayPal merchant ID must complete enrolment.
      </p>
      <div className="space-y-1">
        <Label htmlFor="as-name">Supplier name<Req /></Label>
        <Input id="as-name" aria-required value={s.name} onChange={(e) => setS({ ...s, name: e.target.value })} />
        {hint("From the invoice. A name on an invoice does not prove who the supplier is.")}
      </div>
      <div className="space-y-1">
        <Label htmlFor="as-email">Supplier email</Label>
        <Input id="as-email" type="email" value={s.email} onChange={(e) => setS({ ...s, email: e.target.value })} />
        {hint("Billing email for reference only. Never used to verify payment details.")}
      </div>
      <details className="rounded-md border bg-muted/30 p-3">
        <summary className="cursor-pointer text-sm font-semibold">Set up this supplier for payment</summary>
        <p className="mt-1 text-xs text-muted-foreground">Optional for invoice checking. Required before this supplier can receive payment.</p>
        <div className="mt-3 space-y-3">
      <div className="space-y-1">
        <Label htmlFor="as-merchant">PayPal merchant ID <span className="ml-1 text-xs font-normal text-muted-foreground">(Required for payment setup)</span></Label>
        <Input id="as-merchant" className="font-mono" value={s.merchant} onChange={(e) => setS({ ...s, merchant: e.target.value })} />
        {hint("From the invoice if printed. Unverified until confirmed with the supplier through a trusted channel. IDs starting with TESTONLY are fictional and can never be paid.")}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="as-channel">Trusted contact channel</Label>
          <FieldSelect id="as-channel" value={s.channel} onChange={(v) => setS({ ...s, channel: v })} options={[{ value: "phone", label: "Phone" }, { value: "email", label: "Email" }]} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="as-channelValue">Trusted contact <span className="ml-1 text-xs font-normal text-muted-foreground">(Required for payment setup)</span></Label>
          <Input id="as-channelValue" value={s.channelValue} onChange={(e) => setS({ ...s, channelValue: e.target.value })} />
        </div>
      </div>
      {hint("Must come from a source you already trust (signed contract, earlier verified records) — not from this invoice or its message.")}
      <div className="space-y-1">
        <Label htmlFor="as-evidence">Independent verification evidence <span className="ml-1 text-xs font-normal text-muted-foreground">(Required for payment setup)</span></Label>
        <Textarea id="as-evidence" value={s.evidence} onChange={(e) => setS({ ...s, evidence: e.target.value })} placeholder="Leave empty if no independent check has happened yet." />
        {hint("Only describe a check that actually happened. Invoice details, dummy merchant IDs and fictional contacts are not evidence.")}
      </div>
        </div>
      </details>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={s.isTest} onChange={(e) => setS({ ...s, isTest: e.target.checked })} />
        Fictional test supplier (label it as test data)
      </label>
      {missing.length > 0 && <p className="text-xs">Payment setup not complete (optional for invoice checking): {missing.join(", ")} missing.</p>}
      {err && <p role="alert" className="rounded-md border border-warning/40 bg-warning-soft p-3 text-sm">{err}</p>}
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" disabled={busy} onClick={() => void save(false)}>{busy ? "Saving…" : "Save as draft"}</Button>
        {canSubmit && <Button type="button" size="sm" variant="outline" disabled={busy || missing.length > 0} onClick={() => void save(true)}>Save and request approval</Button>}
      </div>
      {canSubmit && missing.length > 0 && <p className="text-xs text-muted-foreground">“Save and request approval” is available once the merchant ID, trusted contact and verification evidence are filled in.</p>}
    </div>
  );
}
