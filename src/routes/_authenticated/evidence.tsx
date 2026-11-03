import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrg, useProfiles } from "@/lib/org";
import { PageHeader } from "@/components/brand";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/evidence")({
  head: () => ({ meta: [{ title: "Evidence history — PayPatrol" }, { name: "description", content: "Who requested, reviewed, changed or approved, and when." }, { property: "og:title", content: "Evidence history — PayPatrol" }, { property: "og:description", content: "PayPatrol request, review and control-change evidence." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  component: Evidence,
});

function Evidence() {
  const org = useOrg();
  const names = useProfiles(org.orgId).data ?? {};
  const q = useQuery({
    queryKey: ["audit", org.orgId],
    queryFn: async () => {
      const { data, error } = await supabase.from("audit_events").select("*").eq("org_id", org.orgId).order("id", { ascending: false }).limit(500);
      if (error) throw error;
      return data ?? [];
    },
  });
  const rows = q.data ?? [];
  const actor = (r: (typeof rows)[number]) => (r.actor_kind === "system" ? "PayPatrol checks" : r.actor_kind === "ai_fixture" ? "AI test fixture" : names[r.actor_id ?? ""] ?? "Team member");

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
      <p className="mb-4 text-xs text-muted-foreground">
        Each entry is chained to the previous one by a fingerprint. Limitation: without separately stored checkpoints, the chain cannot prove that the whole log was not rewritten or that the latest entries were not removed.
      </p>
      <div className="overflow-x-auto rounded-lg border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted text-left text-xs uppercase text-muted-foreground"><tr><th className="px-3 py-2">When</th><th className="px-3 py-2">Who</th><th className="px-3 py-2">What</th><th className="px-3 py-2">Record</th><th className="px-3 py-2">Details</th></tr></thead>
          <tbody className="divide-y">
            {rows.map((r) => (
              <tr key={r.id} className="align-top">
                <td className="whitespace-nowrap px-3 py-2">{new Date(r.created_at).toLocaleString("en-CA")}</td>
                <td className="px-3 py-2">{actor(r)}</td>
                <td className="px-3 py-2 font-medium">{r.action.replaceAll("_", " ")}</td>
                <td className="px-3 py-2">
                  {r.entity_type === "purchase" && r.entity_id ? <Link to="/purchases/$id" params={{ id: r.entity_id }} className="text-brand-bright underline">purchase</Link> : r.entity_type.replaceAll("_", " ")}
                  {r.entity_version ? ` v${r.entity_version}` : ""}
                </td>
                <td className="max-w-md px-3 py-2"><code className="break-all text-xs text-muted-foreground">{JSON.stringify(r.details)}</code></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
