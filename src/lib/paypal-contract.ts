import { z } from "zod";

export const merchantIdSchema = z.string().regex(/^[2-9A-HJ-NP-Z]{13}$/);
const moneySchema = z.object({ currency_code: z.literal("CAD"), value: z.string().regex(/^\d+\.\d{2}$/) });
export const orderSchema = z.object({
  id: z.string().min(1), status: z.string(), intent: z.literal("CAPTURE"),
  purchase_units: z.array(z.object({
    reference_id: z.string(), custom_id: z.string(), invoice_id: z.string(),
    payee: z.object({ merchant_id: merchantIdSchema }), amount: moneySchema,
    payments: z.object({ captures: z.array(z.object({ id: z.string(), status: z.string(), amount: moneySchema, final_capture: z.boolean().optional() })).optional() }).optional(),
  })).length(1),
});
export type PaymentSnapshot = { id: string; purchase_id: string; purchase_version: number; amount_minor: number; currency: string; merchant_id: string; digest: string; idempotency_key: string; status: string; created_at: string };
export function validateOrder(raw: unknown, attempt: PaymentSnapshot, expectedOrderId?: string) {
  const order = orderSchema.parse(raw);
  if (expectedOrderId && order.id !== expectedOrderId) throw new Error("PayPal returned a different order");
  const unit = order.purchase_units[0];
  if (!unit) throw new Error("PayPal order is incomplete");
  const value = `${Math.floor(attempt.amount_minor / 100)}.${String(attempt.amount_minor % 100).padStart(2, "0")}`;
  if (unit.payee.merchant_id !== attempt.merchant_id || unit.amount.value !== value || unit.amount.currency_code !== attempt.currency || unit.reference_id !== attempt.id || unit.custom_id !== attempt.digest || unit.invoice_id !== `${attempt.purchase_id}-v${attempt.purchase_version}`) throw new Error("PayPal order does not match the authorised purchase");
  const captures = unit.payments?.captures ?? [];
  if (captures.length > 1 || captures.some(c => c.amount.value !== value || c.amount.currency_code !== attempt.currency)) throw new Error("PayPal capture amount differs from the authorised purchase");
  return order;
}
// Webhook events that trigger an authoritative order re-read. Everything else
// (including REFUNDED and REVERSED) is acknowledged and ignored for this demo.
export const HANDLED_WEBHOOK_EVENTS = ["PAYMENT.CAPTURE.COMPLETED", "PAYMENT.CAPTURE.PENDING", "PAYMENT.CAPTURE.DENIED", "PAYMENT.CAPTURE.DECLINED"] as const;
export function isHandledWebhookEvent(type: string) { return (HANDLED_WEBHOOK_EVENTS as readonly string[]).includes(type); }
