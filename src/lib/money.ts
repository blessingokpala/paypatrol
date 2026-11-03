// Money is always handled as integer minor units (cents). The server recomputes
// totals; these helpers only parse user input and format display values.

export function parseToMinor(input: string): number | null {
  const s = input.trim().replace(/[,\s]/g, "").replace(/^CA\$|^\$/i, "");
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const [whole, frac = ""] = s.split(".");
  const minor = Number(whole) * 100 + Number((frac + "00").slice(0, 2));
  return Number.isSafeInteger(minor) ? minor : null;
}

export function formatMinor(minor: number | null | undefined, currency = "CAD"): string {
  if (minor === null || minor === undefined) return "—";
  const prefix = currency === "CAD" ? "CA$" : `${currency} `;
  const sign = minor < 0 ? "-" : "";
  const abs = Math.abs(minor);
  const whole = Math.floor(abs / 100).toLocaleString("en-CA");
  const cents = String(abs % 100).padStart(2, "0");
  return `${sign}${prefix}${whole}.${cents}`;
}

export function minorToInput(minor: number): string {
  return `${Math.floor(minor / 100)}.${String(minor % 100).padStart(2, "0")}`;
}
