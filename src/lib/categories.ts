// Shared purchase categories. Predefined options use stable lowercase identifiers
// so capitalisation never creates duplicates. "office" keeps its existing id so
// spending rules that already permit it keep working. Category choice is only a
// label: permission is still decided by the spending rules on the server.

export const OTHER = "other";

export const PREDEFINED_CATEGORIES: { id: string; label: string; aliases?: string[] }[] = [
  { id: "packaging", label: "Packaging" },
  { id: "office", label: "Office supplies", aliases: ["office supplies", "stationery"] },
  { id: "cleaning", label: "Cleaning", aliases: ["cleaning supplies"] },
  { id: "retail_supplies", label: "Retail supplies" },
  { id: "inventory_stock", label: "Inventory and stock", aliases: ["inventory", "stock", "inventory & stock"] },
  { id: "equipment", label: "Equipment" },
  { id: "software_subscriptions", label: "Software and subscriptions", aliases: ["software", "subscriptions", "software & subscriptions"] },
  { id: "professional_services", label: "Professional services" },
  { id: "marketing_advertising", label: "Marketing and advertising", aliases: ["marketing", "advertising"] },
  { id: "shipping_delivery", label: "Shipping and delivery", aliases: ["shipping", "delivery"] },
  { id: "utilities", label: "Utilities" },
  { id: "maintenance_repairs", label: "Maintenance and repairs", aliases: ["maintenance", "repairs"] },
  { id: "travel_transport", label: "Travel and transport", aliases: ["travel", "transport"] },
];

const key = (s: string) => s.trim().toLowerCase().replace(/&/g, "and").replace(/[\s_-]+/g, " ");

/** Options = predefined plus any existing business categories (e.g. from spending rules), deduplicated. */
export function categoryOptions(existing: string[] = []): { id: string; label: string }[] {
  const out = PREDEFINED_CATEGORIES.map(({ id, label }) => ({ id, label }));
  for (const e of existing) {
    if (!e.trim() || matchCategory(e)) continue;
    if (!out.some((o) => key(o.id) === key(e))) out.push({ id: e.trim(), label: e.trim() });
  }
  return out;
}

/** Returns the predefined id for a wording (any capitalisation, or a known alias), or null. */
export function matchCategory(text: string, existing: string[] = []): string | null {
  const k = key(text);
  if (!k) return null;
  for (const c of PREDEFINED_CATEGORIES) {
    if (key(c.id) === k || key(c.label) === k || c.aliases?.some((a) => key(a) === k)) return c.id;
  }
  const e = existing.find((x) => key(x) === k);
  return e ? e.trim() : null;
}

export type CategoryValue = { choice: string; other: string };

/** Turn a stored category into the dropdown state; unknown custom values reopen as Other. */
export function fromStored(stored: string | null | undefined, existing: string[] = []): CategoryValue {
  if (!stored?.trim()) return { choice: "", other: "" };
  const m = matchCategory(stored, existing);
  return m ? { choice: m, other: "" } : { choice: OTHER, other: stored.trim() };
}

/** Value to save, or null if incomplete (nothing chosen, or Other without wording). */
export function toStored(v: CategoryValue): string | null {
  if (!v.choice) return null;
  if (v.choice === OTHER) return v.other.trim() || null;
  return v.choice;
}

export function categoryLabel(stored: string | null | undefined): string {
  if (!stored) return "";
  const c = PREDEFINED_CATEGORIES.find((x) => x.id === matchCategory(stored));
  return c ? c.label : stored;
}
