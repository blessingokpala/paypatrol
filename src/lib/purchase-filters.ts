// Pure search / filter / sort logic for the Purchases list (kept separate so it is unit-tested).
export type PurchaseSort = "newest" | "oldest" | "amount_desc" | "amount_asc";
export const SORTS: { value: PurchaseSort; label: string }[] = [
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
  { value: "amount_desc", label: "Amount: high to low" },
  { value: "amount_asc", label: "Amount: low to high" },
];

export type PurchaseFilters = {
  q?: string | undefined;
  source?: "invoice" | "ai_proposal" | undefined;
  status?: string | undefined;
  supplier?: string | undefined; // supplier id, or "unmatched"
  dfrom?: string | undefined; // YYYY-MM-DD, submission date (local)
  dto?: string | undefined;
  sort?: PurchaseSort | undefined;
};

export type FilterableRow = {
  title: string;
  invoice_reference: string | null;
  supplier_id: string | null;
  suppliers: { name: string } | null;
  source: string;
  status: string;
  created_at: string;
  total_minor: number;
  fixture_label?: string | null;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const isDate = (v: unknown): v is string => typeof v === "string" && DATE_RE.test(v);

function localDay(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function applyPurchaseFilters<T extends FilterableRow>(rows: T[], f: PurchaseFilters): T[] {
  const q = (f.q ?? "").trim().toLowerCase();
  const out = rows.filter((p) => {
    if (f.source && p.source !== f.source) return false;
    if (f.status && p.status !== f.status) return false;
    if (f.supplier) {
      if (f.supplier === "unmatched" ? p.supplier_id !== null : p.supplier_id !== f.supplier) return false;
    }
    if (f.dfrom || f.dto) {
      const day = localDay(p.created_at);
      if (f.dfrom && day < f.dfrom) return false;
      if (f.dto && day > f.dto) return false;
    }
    if (q) {
      const hay = [p.title, p.invoice_reference ?? "", p.suppliers?.name ?? "", p.fixture_label ?? ""].join("\n").toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  const sort = f.sort ?? "newest";
  const t = (p: T) => new Date(p.created_at).getTime();
  out.sort((a, b) =>
    sort === "oldest" ? t(a) - t(b)
    : sort === "amount_desc" ? b.total_minor - a.total_minor || t(b) - t(a)
    : sort === "amount_asc" ? a.total_minor - b.total_minor || t(b) - t(a)
    : t(b) - t(a),
  );
  return out;
}
