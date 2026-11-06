// Pure mapping from an AI reading to invoice form fields. The payee NAME and the
// PayPal merchant ID are kept apart, and a category is only filled in when the
// document's own category is one the spending rules permit — never substituted.
import type { Extraction } from "./schemas";
import { OTHER, matchCategory } from "@/lib/categories";

/** A PayPal merchant ID is a single alphanumeric code, never a name with spaces. */
export function looksLikeMerchantId(value: string): boolean {
  return /^[A-Z0-9]{8,20}$/i.test(value.trim());
}

export type MappedInvoice = {
  recipient: string;
  recipientName: string;
  /** Dropdown choice: a category id, "other", or "" when the document states none. */
  category: string;
  /** Wording for "Specify category" when the choice is Other. */
  categoryOther: string;
  categoryStated: string;
  /** Whether the chosen category is one the spending rules permit (informational only). */
  categoryPermitted: boolean;
};

export function mapExtraction(ex: Extraction, allowedCategories: string[]): MappedInvoice {
  const legacy = ex.requested_payment_recipient.trim();
  const merchant = ex.paypal_merchant_id.trim();
  const recipient = looksLikeMerchantId(merchant) ? merchant : looksLikeMerchantId(legacy) ? legacy : "";
  const recipientName = ex.payment_recipient_name.trim() || (legacy && !looksLikeMerchantId(legacy) ? legacy : "") || (merchant && !looksLikeMerchantId(merchant) ? merchant : "");
  const categoryStated = ex.category_stated.trim();
  const match = matchCategory(categoryStated, allowedCategories);
  const category = match ?? (categoryStated ? OTHER : "");
  return {
    recipient, recipientName, category,
    categoryOther: match ? "" : categoryStated,
    categoryStated,
    categoryPermitted: Boolean(match && allowedCategories.some((c) => matchCategory(c) === match || c === match)),
  };
}
