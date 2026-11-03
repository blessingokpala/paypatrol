// Client-safe shapes for AI output. The model's answer is untrusted data: it is
// validated here before anything uses it, and it never decides a payment.

import { z } from "zod";

const str = z.string().nullish().transform((v) => v ?? "");
const int = z.number().int().nullish().transform((v) => v ?? undefined);

export const extractionLineSchema = z.object({
  description: str,
  quantity: str,
  unit_price: str,
  amount: str,
});

export const excerptSchema = z.object({
  field: str,
  quote: str,
  page: int,
});

export const extractionSchema = z.object({
  supplier_name: str,
  invoice_reference: str,
  invoice_date: str,
  due_date: str,
  buyer_name: str,
  line_items: z.array(extractionLineSchema).default([]),
  subtotal: str,
  tax: str,
  shipping: str,
  total: str,
  currency: str,
  requested_payment_recipient: str,
  payment_change_instructions: str,
  excerpts: z.array(excerptSchema).default([]),
  uncertain_fields: z.array(z.string()).default([]),
  missing_fields: z.array(z.string()).default([]),
});

export type Extraction = z.infer<typeof extractionSchema>;
export type ExtractionLine = z.infer<typeof extractionLineSchema>;
export type Excerpt = z.infer<typeof excerptSchema>;

export const proposalSchema = z.object({
  listing_id: str,
  quantity: z.number().int(),
  reasoning: str,
  claimed_recipient: str,
  claimed_total: str,
});

export type Proposal = z.infer<typeof proposalSchema>;

export type AiErrorCode =
  | "not_configured"
  | "model_unavailable"
  | "quota"
  | "unavailable"
  | "timeout"
  | "bad_output"
  | "forbidden"
  | "too_large"
  | "bad_type"
  | "unreadable"
  | "no_listing";

export type AiError = { code: AiErrorCode; message: string };

export type AiOutcome<T> = { ok: true; model: string; data: T } | { ok: false; error: AiError };

export const AI_ERROR_COPY: Record<AiErrorCode, string> = {
  not_configured: "AI is not connected: no Gemini key is configured on the server.",
  model_unavailable: "AI is not connected: the model this app asks for is no longer available.",
  quota: "AI quota is exhausted for now. Try again later — you can still enter details by hand.",
  unavailable: "AI is busy right now. Try again in a moment — you can still enter details by hand.",
  timeout: "AI took too long to answer. Try again — you can still enter details by hand.",
  bad_output: "AI returned something unreadable, so nothing was filled in. Enter the details by hand.",
  forbidden: "You do not have permission to read that document.",
  too_large: "That document is too large to read (limit 8 MB).",
  bad_type: "Only PDF, PNG or JPEG documents can be read.",
  unreadable: "The document could not be read from private storage.",
  no_listing: "The assistant did not pick an approved listing. Choose one yourself.",
};
