// Presentation helpers: turn stored codes and raw backend errors into plain language.
// Stored records and exports are unchanged.

const TECHNICAL = /violates|constraint|permission denied|row-level security|duplicate key|syntax|null value|JWT|PGRST|uuid|relation "|function .*does not exist|42[0-9A-Z]{3}|23[0-9]{3}|fetch failed|Failed to fetch|NetworkError/i;

export function friendlyError(raw: unknown, action = "That action"): string {
  const msg = raw && typeof raw === "object" && "message" in raw ? String((raw as { message: unknown }).message) : typeof raw === "string" ? raw : "";
  if (!msg) return `${action} did not complete. Try again.`;
  if (/recent sign-in|reauth|authentication.*recent/i.test(msg)) return `${action} needs a recent sign-in. Confirm your password, then try again.`;
  if (/permission denied|row-level security|not (an? )?(member|authori[sz]ed)|forbidden/i.test(msg)) return `${action} is not allowed for your role in this organisation.`;
  if (/Failed to fetch|NetworkError|fetch failed/i.test(msg)) return `${action} could not reach PayPatrol. Check your connection and try again.`;
  if (/duplicate key/i.test(msg)) return `${action} was already recorded. Refresh to see the latest state.`;
  if (TECHNICAL.test(msg)) return `${action} did not complete because a check refused it. Refresh the page and try again; your history is unchanged.`;
  return msg;
}

/** "pending_verification" → "Pending verification". */
export function humanize(code: string | null | undefined, empty = "Not recorded"): string {
  if (!code) return empty;
  const w = code.replace(/[._]+/g, " ").trim();
  return w.charAt(0).toUpperCase() + w.slice(1);
}
