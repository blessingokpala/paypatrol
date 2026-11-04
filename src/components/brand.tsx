import { cn } from "@/lib/utils";
import type { Tone } from "@/lib/status";
import { STATUS_META, type PurchaseStatus } from "@/lib/status";
import { AlertTriangle, Ban, CheckCircle2, Circle, Info } from "lucide-react";
import type { ReactNode } from "react";

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2 font-extrabold tracking-tight", className)}>
      <svg viewBox="0 0 24 24" aria-hidden className="h-7 w-7">
        <path d="M12 2 4 5v6c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V5l-8-3Z" fill="var(--brand-deep)" />
        <path d="m8.2 12.3 2.6 2.6 5-5.2" fill="none" stroke="var(--primary-foreground)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span>
        <span className="text-brand-deep">Pay</span>
        <span className="text-brand-bright">Patrol</span>
      </span>
    </span>
  );
}

const toneClass: Record<Tone, string> = {
  warning: "bg-warning-soft text-warning border-warning/30",
  blocked: "bg-blocked-soft text-blocked border-blocked/30",
  success: "bg-success-soft text-success border-success/30",
  info: "bg-selected text-brand-deep border-brand-bright/30",
  neutral: "bg-muted text-muted-foreground border-border",
};
const toneIcon: Record<Tone, typeof Info> = {
  warning: AlertTriangle,
  blocked: Ban,
  success: CheckCircle2,
  info: Info,
  neutral: Circle,
};

export function ToneBadge({ tone, children }: { tone: Tone; children: ReactNode }) {
  const Icon = toneIcon[tone];
  return (
    <span className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-md border px-2 py-0.5 text-xs font-semibold", toneClass[tone])}>
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {children}
    </span>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const meta = STATUS_META[status as PurchaseStatus] ?? { label: status, tone: "neutral" as Tone };
  return <ToneBadge tone={meta.tone}>{meta.label}</ToneBadge>;
}

export function SandboxBanner() {
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-warning/40 bg-warning-soft px-2.5 py-1 text-xs font-bold uppercase tracking-wide text-warning">
      <span className="h-2 w-2 rounded-full bg-warning" aria-hidden />
      Sandbox<span className="hidden sm:inline"> test mode</span>
    </span>
  );
}

/** Compact persistent Sandbox indicator for the sidebar footer. */
export function SandboxPill() {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-warning/40 bg-warning-soft px-2 py-0.5 text-[11px] font-semibold text-warning">
      <span className="h-1.5 w-1.5 rounded-full bg-warning" aria-hidden />
      Sandbox · Test money
    </span>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Panel({ title, children, className, actions }: { title?: string; children: ReactNode; className?: string; actions?: ReactNode }) {
  return (
    <section className={cn("rounded-lg border bg-card p-5", className)}>
      {(title || actions) && (
        <div className="mb-4 flex items-center justify-between gap-2">
          {title && <h2 className="text-base font-semibold">{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function FixtureTag({ label }: { label?: string | null }) {
  return (
    <span className="inline-flex items-center rounded border border-dashed border-muted-foreground/50 px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
      {label ? `Test fixture · ${label}` : "Test fixture"}
    </span>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">{children}</div>;
}

/** Red asterisk marking a genuinely mandatory field. Pair with RequiredNote once per form. */
export function Req() {
  return (
    <span className="text-destructive" aria-hidden>
      {" *"}
    </span>
  );
}

export function RequiredNote() {
  return (
    <p className="text-xs text-muted-foreground">
      <span className="text-destructive" aria-hidden>*</span> Required
    </p>
  );
}
