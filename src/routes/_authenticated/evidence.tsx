import { fromSearch } from "@/lib/return-to";
import { humanize } from "@/lib/friendly";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrg, useProfiles } from "@/lib/org";
import { formatMinor } from "@/lib/money";
import { STATUS_META, type PurchaseStatus } from "@/lib/status";
import { PageHeader } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronRight } from "lucide-react";

export const Route = createFileRoute("/_authenticated/evidence")({
  validateSearch: fromSearch,
  head: () => ({ meta: [{ title: "Evidence history — PayPatrol" }, { name: "description", content: "Who requested, reviewed, changed or approved, and when." }, { property: "og:title", content: "Evidence history — PayPatrol" }, { property: "og:description", content: "PayPatrol request, review and control-change evidence." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  component: Evidence,
});

type AuditRow = {
  id: number;
  created_at: string;
  actor_kind: string;
  actor_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  entity_version: number | null;
  details: Record<string, unknown> | null;
  hash: string | null;
};

function statusLabel(s: unknown): string {
  return typeof s === "string" ? (STATUS_META[s as PurchaseStatus]?.label ?? s.replaceAll("_", " ")) : "Not recorded";
}

function money(minor: unknown, currency: unknown): string {
  return typeof minor === "number" && typeof currency === "string" ? formatMinor(minor, currency) : "";
}

/** Plain-language summary of an audit event. The underlying record is unchanged. */
function summarize(r: AuditRow): string {
  const d = (r.details ?? {}) as Record<string, unknown>;
  switch (r.action) {
    case "purchase_submitted": {
      const amt = money(d["amount_minor"], d["currency"]);
      return `Request submitted${amt ? ` for ${amt}` : ""}${typeof d["recipient"] === "string" && d["recipient"] ? ` with recipient ${d["recipient"]}` : ""}.`;
    }
    case "status_changed":
      return `Status changed from ${statusLabel(d["from"])} to ${statusLabel(d["to"])}.`;
    case "supplier_change_detected":
      return "Requested payment recipient differs from the approved supplier record.";
    case "supplier_change_superseded":
      return "Supplier change request closed automatically — a later approved supplier record already lists the proposed recipient. Not an approval.";
    case "supplier_change_reopened":
      return `Supplier change request reopened${typeof d["reason"] === "string" ? `: ${d["reason"]}` : "."}`;
    case "supplier_change_decided":
      return d["approved"] === true ? "Supplier change approved after recorded verification." : "Supplier change rejected; original supplier record retained.";
    case "verification_recorded":
      return `Independent verification recorded: ${typeof d["outcome"] === "string" ? d["outcome"] : "outcome noted"}.`;
    case "sandbox_account_check_recorded":
      return "Sandbox account check recorded (test only — no real supplier was contacted).";
    case "ai_extraction_recorded":
      return `Invoice read by ${typeof d["model"] === "string" ? d["model"] : "the AI model"}.`;
    case "ai_extraction_attached":
      return "Saved AI reading linked to the request.";
    case "reservation_created":
      return `Budget reserved${money(d["amount_minor"], d["currency"]) ? ` (${money(d["amount_minor"], d["currency"])})` : ""} for checkout.`;
    case "reservation_released":
      return "Budget reservation released.";
    case "approval_granted":
      return `Request approved${money(d["amount_minor"], d["currency"]) ? ` for ${money(d["amount_minor"], d["currency"])}` : ""}.`;
    case "approval_invalidated":
      return `Earlier approval no longer applies${typeof d["reason"] === "string" ? `: ${d["reason"]}` : "."}`;
    case "purchase_edited":
      return "Request details corrected; saved as a new version.";
    case "purchase_cancelled":
      return `Request cancelled${typeof d["reason"] === "string" ? `: ${d["reason"]}` : "."}`;
    case "policy_updated":
      return "Spending rules saved as a new version.";
    case "supplier_created":
      return "Supplier proposed; awaiting a second person's approval.";
    case "supplier_approved":
      return "Supplier baseline approved.";
    case "sandbox_merchant_configured":
      return "Sandbox supplier configured against the connected PayPal app (Sandbox baseline, labelled fictional).";
    case "payment_order_created":
      return "PayPal Sandbox order created. Not a completed payment.";
    case "payment_capture_completed":
      return "PayPal Sandbox capture completed.";
    case "payment_capture_declined":
      return "PayPal Sandbox capture declined or denied. Budget stays reserved for review.";
    case "budget_reserved":
      return `Budget reserved${money(d["amount_minor"], d["currency"]) ? ` (${money(d["amount_minor"], d["currency"])})` : ""} for checkout.`;
    case "organization_created":
      return "Organisation created.";
    case "policy_created":
      return "Spending rules created (first version).";
    case "supplier_baseline_seeded":
      return "Fictional demonstration supplier record added.";
    case "purchase.labelled_test_data":
      return "Request labelled as test data. Status unchanged; not to be reserved or paid.";
    default: {
      const words = r.action.replace(/[._]+/g, " ").trim();
      return `Recorded event: ${words.charAt(0).toUpperCase()}${words.slice(1)}. Full details are in the CSV export.`;
    }
  }
}

/** Before/after pairs worth showing in the detail panel. */
function beforeAfter(r: AuditRow): [string, string, string][] {
  const d = (r.details ?? {}) as Record<string, unknown>;
  const rows: [string, string, string][] = [];
  if (r.action === "status_changed") rows.push(["Status", statusLabel(d["from"]), statusLabel(d["to"])]);
  if (typeof d["approved_recipient"] === "string" || typeof d["requested_recipient"] === "string") {
    rows.push(["Payment recipient (approved record → requested)", String(d["approved_recipient"] ?? "Not provided"), String(d["requested_recipient"] ?? "Not provided")]);
  }
  return rows;
}

function reasonOf(r: AuditRow): string | null {
  const d = (r.details ?? {}) as Record<string, unknown>;
  for (const k of ["reason", "decision_note", "note", "evidence", "label"]) {
    if (typeof d[k] === "string" && d[k]) return d[k] as string;
  }
  return null;
}

function Evidence() {
  const org = useOrg();
  const names = useProfiles(org.orgId).data ?? {};
  const [open, setOpen] = useState<Set<number>>(new Set());
  const q = useQuery({
    queryKey: ["audit", org.orgId],
    queryFn: async () => {
      const { data, error } = await supabase.from("audit_events").select("*").eq("org_id", org.orgId).order("id", { ascending: false }).limit(500);
      if (error) throw error;
      return (data ?? []) as AuditRow[];
    },
  });
  const rows = q.data ?? [];
  const actor = (r: AuditRow) => (r.actor_kind === "system" ? "PayPatrol checks" : r.actor_kind === "ai_fixture" ? "AI test fixture" : names[r.actor_id ?? ""] ?? "Team member");

  function toggle(id: number) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function exportCsv() {
    const lines = [["time", "actor", "action", "entity", "entity_id", "version", "details", "hash"].join(",")];
    for (const r of rows) lines.push([r.created_at, actor(r), r.action, r.entity_type, r.entity_id ?? "", r.entity_version ?? "", JSON.stringify(r.details).replaceAll('"', '""'), r.hash ?? ""].map((v) => `"${v}"`).join(","));
    const url = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv" }));
    const a = document.createElement("a"); a.href = url; a.download = "paypatrol-evidence.csv"; a.click(); URL.revokeObjectURL(url);
  }

  return (
    <>
      <PageHeader
        title="Evidence history"
        description="Append-only record of requests, checks, reviews, changes and approvals. Payment identifiers will appear here once PayPal is connected."
        actions={<Button variant="outline" onClick={exportCsv}>Export CSV</Button>}
      />
      <details className="mb-4">
        <summary className="cursor-pointer text-xs text-muted-foreground">About this log and its limits</summary>
        <p className="mt-2 max-w-2xl text-xs text-muted-foreground">
          Each entry is chained to the previous one by a fingerprint. Limitation: without separately stored checkpoints, the chain cannot prove that the whole log was not rewritten or that the latest entries were not removed. The CSV export keeps the full technical record, including fingerprints, for authorised review.
        </p>
      </details>
      <div className="relative overflow-x-auto rounded-lg border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted text-left text-xs uppercase text-muted-foreground"><tr><th className="px-3 py-2">When</th><th className="px-3 py-2">Who</th><th className="px-3 py-2">What</th><th className="px-3 py-2">Record</th><th className="px-3 py-2"><span className="sr-only">Details</span></th></tr></thead>
          <tbody className="divide-y">
            {rows.map((r) => {
              const isOpen = open.has(r.id);
              const pairs = beforeAfter(r);
              const reason = reasonOf(r);
              return (
                <FragmentRow
                  key={r.id}
                  r={r}
                  isOpen={isOpen}
                  toggle={toggle}
                  actor={actor(r)}
                  pairs={pairs}
                  reason={reason}
                />
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

function FragmentRow({ r, isOpen, toggle, actor, pairs, reason }: { r: AuditRow; isOpen: boolean; toggle: (id: number) => void; actor: string; pairs: [string, string, string][]; reason: string | null }) {
  return (
    <>
      <tr className="align-top">
        <td className="whitespace-nowrap px-3 py-2">{new Date(r.created_at).toLocaleString("en-CA")}</td>
        <td className="px-3 py-2">{actor}</td>
        <td className="px-3 py-2">{summarize(r)}</td>
        <td className="px-3 py-2">
          {r.entity_type === "purchase" && r.entity_id ? <Link to="/purchases/$id" params={{ id: r.entity_id }} search={{ from: "/evidence" }} className="text-brand-bright underline">Request</Link> : humanize(r.entity_type)}
          {r.entity_version ? ` v${r.entity_version}` : ""}
        </td>
        <td className="px-3 py-2">
          <Button variant="ghost" size="sm" aria-expanded={isOpen} aria-label={isOpen ? "Hide details" : "View details"} onClick={() => toggle(r.id)}>
            {isOpen ? <ChevronDown className="h-4 w-4" aria-hidden /> : <ChevronRight className="h-4 w-4" aria-hidden />}
          </Button>
        </td>
      </tr>
      {isOpen && (
        <tr>
          <td colSpan={5} className="bg-muted/40 px-3 py-3">
            <dl className="grid gap-2 text-sm sm:grid-cols-2">
              <div><dt className="text-xs text-muted-foreground">Actor</dt><dd>{actor}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Time</dt><dd>{new Date(r.created_at).toLocaleString("en-CA")}</dd></div>
              <div>
                <dt className="text-xs text-muted-foreground">Linked record</dt>
                <dd>
                  {r.entity_type === "purchase" && r.entity_id ? <Link to="/purchases/$id" params={{ id: r.entity_id }} search={{ from: "/evidence" }} className="text-brand-bright underline">Open request</Link> : humanize(r.entity_type)}
                  {r.entity_version ? ` v${r.entity_version}` : ""}
                </dd>
              </div>
              {pairs.length > 0 && (
                <div>
                  <dt className="text-xs text-muted-foreground">Before → after</dt>
                  <dd>
                    <ul className="space-y-1">
                      {pairs.map(([label, from, to]) => (
                        <li key={label}>{label}: <span className="text-muted-foreground">{from}</span> → <span className="font-medium">{to}</span></li>
                      ))}
                    </ul>
                  </dd>
                </div>
              )}
              {reason && <div className="sm:col-span-2"><dt className="text-xs text-muted-foreground">Recorded reason</dt><dd>{reason}</dd></div>}
            </dl>
          </td>
        </tr>
      )}
    </>
  );
}
