import { Link, useLocation, useRouter, useSearch } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { returnLabel, safeReturn } from "@/lib/return-to";

/**
 * Shared back navigation, placed above every page heading. Returns to the
 * originating view carried in `?from=` (validated as an internal page, kept on
 * refresh). Without one — e.g. a directly opened link — it goes to `to`.
 */
export function BackLink({ to, label, optional = false }: { to: string; label: string; optional?: boolean }) {
  const router = useRouter();
  const search = useSearch({ strict: false }) as { from?: unknown };
  const from = safeReturn(search.from);
  if (!from && optional) return null;
  const cls = "inline-flex items-center gap-1 text-brand-bright underline-offset-2 hover:underline";
  const inner = (text: string) => (<><ArrowLeft className="h-4 w-4" aria-hidden />{text}</>);
  return (
    <div className="mb-2 text-sm">
      {from ? (
        <a href={from} className={cls} onClick={(e) => { e.preventDefault(); router.history.push(from); }}>
          {inner(returnLabel(from))}
        </a>
      ) : (
        <Link to={to as "/purchases"} className={cls}>{inner(label)}</Link>
      )}
    </div>
  );
}

/** Current in-app address (path + query) to pass as `from` on outgoing links. */
export function useHere(): string {
  const l = useLocation();
  return `${l.pathname}${l.searchStr ?? ""}`;
}
