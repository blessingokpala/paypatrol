import { createFileRoute, Link } from "@tanstack/react-router";
import { SandboxBanner, Wordmark } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Ban, PauseCircle, ShieldCheck } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "PayPatrol — check invoices and AI purchases before you pay" },
      {
        name: "description",
        content:
          "PayPatrol pauses payments when supplier details change and blocks purchases that break your spending rules, for invoices and AI purchase proposals alike.",
      },
      { property: "og:title", content: "PayPatrol — check before you pay" },
      { property: "og:description", content: "Payment verification for small businesses using PayPal." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

function Index() {
  const points = [
    { icon: PauseCircle, title: "Changed payment details pause", text: "A new recipient waits until a different reviewer confirms it through a contact you already trust." },
    { icon: Ban, title: "Rule-breaking purchases stop", text: "Order limits, weekly limits, suppliers and categories are checked on the server. Approval cannot override a hard limit." },
    { icon: ShieldCheck, title: "People and AI, same checks", text: "Invoices from a person and proposals from an assistant go through one set of controls with a full evidence history." },
  ];
  return (
    <div className="min-h-screen">
      <header className="flex items-center justify-between border-b bg-card px-6 py-4">
        <Wordmark className="text-xl" />
        <div className="flex items-center gap-3">
          <SandboxBanner />
          <Button asChild size="sm"><Link to="/auth">Sign in</Link></Button>
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-6 py-14">
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Check every invoice and purchase request before money moves.</h1>
        <p className="mt-4 max-w-2xl text-lg text-muted-foreground">
          PayPatrol checks invoices and purchase requests from people or AI, pauses payments when a supplier's payment details change until independently confirmed, and blocks purchases that break your spending rules before anything is sent through PayPal.
        </p>
        <div className="mt-8 flex gap-3">
          <Button asChild><Link to="/auth">Open workspace</Link></Button>
        </div>
        <ul className="mt-12 grid gap-4 sm:grid-cols-3">
          {points.map((p) => (
            <li key={p.title} className="rounded-lg border bg-card p-5">
              <p.icon className="h-5 w-5 text-brand-bright" aria-hidden />
              <h2 className="mt-3 font-semibold">{p.title}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{p.text}</p>
            </li>
          ))}
        </ul>
        <p className="mt-10 text-xs text-muted-foreground">Sandbox test mode. Check invoices without PayPal setup. Payment demonstrations are limited to the configured Harbourside Sandbox merchant and require all payment checks to pass. Demonstration data is fictional.</p>
      </main>
    </div>
  );
}
