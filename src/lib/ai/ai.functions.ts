// Protected server functions for phase two. The browser never holds the Gemini
// key and never decides a payment: the model's answer is validated here, then the
// existing controlled database functions do the deciding.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { parseToMinor } from "@/lib/money";
import { AI_ERROR_COPY, type AiError, type Extraction } from "./schemas";
import { GEMINI_MODEL, extractInvoiceFromFile, pingGemini, proposeFromListings } from "./gemini.server";

const MAX_BYTES = 8 * 1024 * 1024;

const fail = (code: AiError["code"], message?: string) => ({ ok: false as const, error: { code, message: message ?? AI_ERROR_COPY[code] } });

async function isPreparerOrOwner(supabase: { rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown }> }, orgId: string) {
  const { data: preparer } = await supabase.rpc("has_org_role", { _org: orgId, _role: "preparer" });
  if (preparer) return true;
  const { data: owner } = await supabase.rpc("has_org_role", { _org: orgId, _role: "owner" });
  return Boolean(owner);
}

// PDF / PNG / JPEG are accepted by magic bytes, not by the name someone typed.
function sniffMime(bytes: Uint8Array): string | null {
  const b = bytes;
  if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return "application/pdf";
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  return null;
}

// Workspace status. "Connected" only after a real model request has been recorded.
export const getAiStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { orgId: string }) => z.object({ orgId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const member = await isPreparerOrOwner(context.supabase, data.orgId);
    if (!member) throw new Error("Not a member of this organisation");
    const { data: last } = await context.supabase
      .from("ai_extractions")
      .select("created_at, model")
      .eq("org_id", data.orgId)
      .order("created_at", { ascending: false })
      .limit(1);
    return {
      configured: Boolean(process.env["GEMINI_API_KEY"]),
      model: GEMINI_MODEL,
      lastRequestAt: (last?.[0]?.created_at as string | undefined) ?? null,
      lastModel: (last?.[0]?.model as string | undefined) ?? null,
    };
  });

// Owner-only: makes one real model request and records that it succeeded.
export const testAiConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { orgId: string }) => z.object({ orgId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: isOwner } = await context.supabase.rpc("has_org_role", { _org: data.orgId, _role: "owner" });
    if (!isOwner) throw new Error("Only owners can test integrations");
    const result = await pingGemini();
    if (!result.ok) return result;
    const at = new Date().toISOString();
    await context.supabase.rpc("record_extraction", {
      _org: data.orgId,
      _storage_path: null,
      _file_name: "connection test",
      _model: result.model,
      _extracted: { probe: result.data.status, checked_at: at },
      _excerpts: [],
      _uncertain: [],
      _missing: [],
    });
    return { ok: true as const, model: result.model, data: { at } };
  });

// Read a private invoice document and return what it says. Nothing is applied
// automatically: the caller confirms or corrects each field.
export const extractInvoiceDetails = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { orgId: string; storagePath: string; fileName?: string }) =>
    z
      .object({
        orgId: z.string().uuid(),
        storagePath: z.string().min(1).max(600),
        fileName: z.string().max(300).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    if (!(await isPreparerOrOwner(supabase, data.orgId))) return fail("forbidden");
    // The object must live inside this organisation's own folder.
    if (data.storagePath.split("/")[0] !== data.orgId) return fail("forbidden", "That document does not belong to this organisation.");

    const { data: file, error: downloadError } = await supabase.storage.from("invoices").download(data.storagePath);
    if (downloadError || !file) return fail("unreadable");
    if (file.size > MAX_BYTES) return fail("too_large");

    const bytes = new Uint8Array(await file.arrayBuffer());
    const mime = sniffMime(bytes);
    if (!mime) return fail("bad_type");

    const base64 = Buffer.from(bytes).toString("base64");
    const result = await extractInvoiceFromFile(base64, mime);
    if (!result.ok) return result;

    // Evidence is written by the server, straight from the model's answer.
    const { data: extractionId, error: recordError } = await supabase.rpc("record_extraction", {
      _org: data.orgId,
      _storage_path: data.storagePath,
      _file_name: data.fileName ?? null,
      _model: result.model,
      _extracted: result.data,
      _excerpts: result.data.excerpts,
      _uncertain: result.data.uncertain_fields,
      _missing: result.data.missing_fields,
    });
    if (recordError || !extractionId) return fail("unavailable", "The result could not be saved as evidence.");

    return { ok: true as const, model: result.model, extractionId: extractionId as string, extraction: result.data as Extraction };
  });

// The assistant may only point at an approved listing and a quantity. Prices,
// totals, currency and the recipient are resolved by the database, not the model.
export const proposePurchase = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { orgId: string; request: string }) =>
    z.object({ orgId: z.string().uuid(), request: z.string().min(3).max(2000) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    if (!(await isPreparerOrOwner(supabase, data.orgId))) return fail("forbidden");

    const { data: listings, error } = await supabase
      .from("listings")
      .select("id, name, category, unit_price_minor, currency, max_quantity, untrusted_description")
      .eq("org_id", data.orgId)
      .eq("is_active", true);
    if (error) return fail("unavailable", error.message);
    const catalog = listings ?? [];
    if (catalog.length === 0) return fail("no_listing");

    const result = await proposeFromListings(data.request, catalog);
    if (!result.ok) return result;

    const chosen = catalog.find((l) => l.id === result.data.listing_id);
    if (!chosen) return fail("no_listing");
    const quantity = result.data.quantity;
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > chosen.max_quantity)
      return fail("no_listing", `The assistant asked for ${quantity}, which is outside the limit of ${chosen.max_quantity} for that listing.`);

    const claimedMinor = result.data.claimed_total.trim() ? parseToMinor(result.data.claimed_total) : null;
    const { data: purchaseId, error: submitError } = await supabase.rpc("submit_ai_proposal", {
      _org: data.orgId,
      _listing: chosen.id,
      _quantity: quantity,
      _claimed_recipient: result.data.claimed_recipient.trim() || null,
      _claimed_total_minor: claimedMinor,
    });
    if (submitError || !purchaseId) return fail("unavailable", submitError?.message ?? "The request could not be created.");

    return {
      ok: true as const,
      model: result.model,
      purchaseId: purchaseId as string,
      claims: {
        listingName: chosen.name,
        quantity,
        reasoning: result.data.reasoning,
        claimedRecipient: result.data.claimed_recipient,
        claimedTotal: result.data.claimed_total,
      },
    };
  });
