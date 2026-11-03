import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getCheckoutState, createSandboxOrder, captureSandboxOrder, reconcileSandboxPayment, cancelSandboxCheckout } from "@/lib/paypal.functions";
import { Button } from "@/components/ui/button";
import { ToneBadge } from "@/components/brand";
import { toast } from "sonner";

type Session = { start: (options: { presentationMode: string }, order: Promise<{ orderId: string }>) => Promise<void> };
type PayPalSdk = { createInstance: (config: { clientId: string; components: string[] }) => Promise<{ createPayPalOneTimePaymentSession: (options: { onApprove: () => Promise<void>; onCancel: () => void; onError: () => void }) => Session }> };
declare global { interface Window { paypal?: PayPalSdk } }

export function SandboxCheckout({ purchaseId, onDone }: { purchaseId: string; onDone: () => void }) {
  const stateFn = useServerFn(getCheckoutState), createFn = useServerFn(createSandboxOrder), captureFn = useServerFn(captureSandboxOrder), reconcileFn = useServerFn(reconcileSandboxPayment);
  const cancelFn = useServerFn(cancelSandboxCheckout);
  const state = useQuery({ queryKey: ["checkout", purchaseId], queryFn: () => stateFn({ data: { purchaseId } }), refetchInterval: 15000 });
  const [ready, setReady] = useState(false), [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const paymentSession = useRef<Session | null>(null);
  const guard = useRef(false);
  useEffect(() => {
    const clientId = state.data?.clientId;
    if (!clientId || !state.data?.configured) return;
    let disposed = false;
    async function init() {
      if (!window.paypal) await new Promise<void>((resolve, reject) => {
        const existing = document.querySelector<HTMLScriptElement>('script[data-paypatrol-paypal]');
        if (existing) { existing.addEventListener("load", () => resolve(), { once: true }); existing.addEventListener("error", reject, { once: true }); return; }
        const script = document.createElement("script"); script.src = "https://www.sandbox.paypal.com/web-sdk/v6/core"; script.dataset["paypatrolPaypal"] = "true";
        script.onload = () => resolve(); script.onerror = () => reject(new Error("PayPal could not load")); document.head.appendChild(script);
      });
      if (!window.paypal || !clientId || disposed) return;
      const sdk = await window.paypal.createInstance({ clientId, components: ["paypal-payments"] });
      paymentSession.current = sdk.createPayPalOneTimePaymentSession({
        onApprove: async () => {
          const result = await captureFn({ data: { purchaseId } });
          setMessage(result.status === "paid" ? "Sandbox payment completed" : "Payment confirmation pending");
          onDone(); void state.refetch();
        },
        onCancel: () => { setMessage("Buyer cancelled checkout. No payment confirmation received; the existing order is retained."); guard.current = false; setBusy(false); },
        onError: () => { setMessage("Payment confirmation pending. Check the existing payment before retrying."); guard.current = false; setBusy(false); },
      });
      if (!disposed) setReady(true);
    }
    void init().catch(() => setMessage("PayPal checkout could not load. No payment has been confirmed."));
    return () => { disposed = true; };
  }, [state.data?.clientId, state.data?.configured, purchaseId]);

  async function checkout() {
    if (guard.current || !paymentSession.current) return;
    guard.current = true; setBusy(true); setMessage("");
    try {
      await paymentSession.current.start({ presentationMode: "auto" }, createFn({ data: { purchaseId } }));
    } catch { setMessage("Checkout was not confirmed. Check the existing payment before retrying."); }
    finally { guard.current = false; setBusy(false); onDone(); void state.refetch(); }
  }
  async function check() {
    setBusy(true);
    try {
      const result = await reconcileFn({ data: { purchaseId } });
      setMessage(result.status === "paid" ? "Sandbox payment completed" : "Payment confirmation pending");
      onDone(); void state.refetch();
    } catch { toast.error("PayPal confirmation is unavailable. Budget remains reserved."); }
    finally { setBusy(false); }
  }
  if (state.isLoading) return <p className="text-sm text-muted-foreground">Checking Sandbox checkout…</p>;
  if (state.error) return <p className="text-sm text-warning">Checkout is unavailable for this account.</p>;
  if (!state.data?.configured) return <p className="text-sm text-warning">Checkout locked: requested recipient must match the configured Sandbox supplier.</p>;
  const pending = state.data.attempt && ["capturing", "confirmation_pending"].includes(state.data.attempt.status);
  return <div className="w-full space-y-3 border-t pt-4">
    <ToneBadge tone={state.data.purchaseStatus === "paid" ? "success" : "info"}>{state.data.purchaseStatus === "paid" ? "Sandbox payment completed" : "PayPal Sandbox checkout"}</ToneBadge>
    <p className="text-sm text-muted-foreground">Approve with the separate Sandbox Personal buyer account. Internal approval is not PayPal buyer approval.</p>
    <div className="flex flex-wrap gap-2">
      {!["paid", "failed", "cancelled"].includes(state.data.purchaseStatus) && !pending && <Button disabled={!ready || busy} onClick={checkout}>{busy ? "Opening PayPal…" : "Pay with PayPal Sandbox"}</Button>}
      {state.data.attempt && <Button variant="outline" disabled={busy} onClick={check}>Check payment confirmation</Button>}
      {state.data.attempt?.status === "ordered" && <Button variant="outline" disabled={busy} onClick={async () => {
        setBusy(true);
        try { await cancelFn({ data: { purchaseId } }); setMessage("Checkout cancelled without a capture."); onDone(); void state.refetch(); }
        catch { toast.error("Cancellation was not confirmed. Check the existing payment; budget remains reserved."); }
        finally { setBusy(false); }
      }}>Cancel uncaptured checkout</Button>}
    </div>
    {state.data.orderId && <p className="break-all font-mono text-xs text-muted-foreground">Sandbox order: {state.data.orderId}</p>}
    {message && <p className="text-sm">{message}</p>}
  </div>;
}