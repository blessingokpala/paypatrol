// Shared "return to" handling for drill-downs, forms and detail pages.
// The originating view travels in the URL as `?from=/path?query`, so it survives
// refresh and never depends on browser history. Only internal app pages are accepted.

const ALLOWED = [
  ["/overview", "Back to overview"],
  ["/purchases", "Back to purchases"],
  ["/approvals", "Back to approvals"],
  ["/suppliers", "Back to suppliers"],
  ["/evidence", "Back to evidence history"],
  ["/budget", "Back to weekly budget"],
  ["/reserved", "Back to reserved purchases"],
  ["/rules", "Back to spending rules"],
  ["/settings", "Back to team & integrations"],
] as const;

function pathOf(href: string): string {
  return href.split(/[?#]/)[0] ?? "";
}

/** Returns the value only if it is an internal PayPatrol page we know how to label. */
export function safeReturn(v: unknown): string | undefined {
  if (typeof v !== "string" || v.length > 500) return undefined;
  if (!v.startsWith("/") || v.startsWith("//") || v.includes("\\") || /[\u0000-\u001f]/.test(v)) return undefined;
  const p = pathOf(v);
  // A purchase detail page may be the origin (e.g. a form opened from it).
  if (/^\/purchases\/[0-9a-f-]{36}$/i.test(p)) return v;
  if (p === "/purchases/new-invoice" || p === "/purchases/new-proposal") return undefined;
  return ALLOWED.some(([a]) => p === a) ? v : undefined;
}

export function returnLabel(href: string): string {
  const p = pathOf(href);
  if (/^\/purchases\/[0-9a-f-]{36}$/i.test(p)) return "Back to request";
  return ALLOWED.find(([a]) => a === p)?.[1] ?? "Back";
}

/** For validateSearch: keeps only a safe `from`. */
export function fromSearch(s: Record<string, unknown>): { from?: string } {
  const f = safeReturn(s["from"]);
  return f ? { from: f } : {};
}

const SCROLL_KEY = "paypatrol:scroll:";
export function rememberScroll(href: string) {
  try { sessionStorage.setItem(SCROLL_KEY + href, String(window.scrollY)); } catch { /* storage unavailable */ }
}
export function takeScroll(href: string): number | null {
  try {
    const v = sessionStorage.getItem(SCROLL_KEY + href);
    if (v === null) return null;
    sessionStorage.removeItem(SCROLL_KEY + href);
    return Number(v) || 0;
  } catch { return null; }
}
