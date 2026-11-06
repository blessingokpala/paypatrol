// Pure mapping from an AI reading to invoice form fields. The payee NAME and the
// PayPal merchant ID are kept apart, and a category is only filled in when the
// document's own category is one the spending rules permit — never substituted.
import type { Extraction } from "./schemas";

/** A PayPal merchant ID is a single alphanumeric code, never a name with spaces. */
export function looksLikeMerchantId(value: string): boolean {
  return /^[A-Z0-9]{8,20}$/i.test(value.trim());
}

export type MappedInvoice = {
  recipient: string;
  recipientName: string;
  category: string;
  categoryStated: string;
  categoryPermitted: boolean;
};

export function mapExtraction(ex: Extraction, allowedCategories: string[]): MappedInvoice {
  const legacy = ex.requested_payment_recipient.trim();
  const merchant = ex.paypal_merchant_id.trim();
  const recipient = looksLikeMerchantId(merchant) ? merchant : looksLikeMerchantId(legacy) ? legacy : "";
  const recipientName = ex.payment_recipient_name.trim() || (legacy && !looksLikeMerchantId(legacy) ? legacy : "") || (merchant && !looksLikeMerchantId(merchant) ? merchant : "");
  const categoryStated = ex.category_stated.trim();
  const match = allowedCategories.find((c) => c.toLowerCase() === categoryStated.toLowerCase());
  return { recipient, recipientName, category: match ?? "", categoryStated, categoryPermitted: Boolean(match) };
}
