import { Link, useRouter } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";

/**
 * Labelled back navigation for forms and detail pages. Returns to the previous
 * in-app page (preserving its filters) when one exists, otherwise falls back to
 * the given parent page so directly opened links still work.
 */
export function BackLink({ to, label }: { to: string; label: string }) {
  const router = useRouter();
  return (
    <div className="mb-2 text-sm">
      <Link
        to={to as "/purchases"}
        className="inline-flex items-center gap-1 text-brand-bright underline-offset-2 hover:underline"
        onClick={(e) => {
          if (window.history.state?.idx > 0) {
            e.preventDefault();
            router.history.back();
          }
        }}
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        {label}
      </Link>
    </div>
  );
}
