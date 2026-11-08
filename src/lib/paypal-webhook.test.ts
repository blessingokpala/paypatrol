import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ token: vi.fn(), request: vi.fn(), reconcile: vi.fn(), rpc: vi.fn(), single: vi.fn(), maybeSingle: vi.fn() }));
vi.mock("@tanstack/react-router", () => ({ createFileRoute: () => (options: unknown) => options }));
vi.mock("@/lib/paypal.server", () => ({ sandboxToken: mocks.token, sandboxRequest: mocks.request, reconcileSandboxOrder: mocks.reconcile }));
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: {
  rpc: mocks.rpc,
  from: () => ({ select: () => ({ eq: () => ({ maybeSingle: mocks.maybeSingle, eq: () => ({ single: mocks.single }) }) }) }),
} }));
import { Route } from "@/routes/api/public/paypal/webhook";

const handler = (Route as unknown as { server: { handlers: { POST: (input: { request: Request }) => Promise<Response> } } }).server.handlers.POST;
const event = { id: "WH-SCRIPTED", event_type: "PAYMENT.CAPTURE.COMPLETED", resource: { id: "CAPTURE-SCRIPTED", supplementary_data: { related_ids: { order_id: "ORDER-SCRIPTED" } } } };
function request(signed = true) {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (signed) for (const name of ["paypal-auth-algo", "paypal-cert-url", "paypal-transmission-id", "paypal-transmission-sig", "paypal-transmission-time"]) headers.set(name, "scripted-signature-fixture");
  return new Request("https://example.test/api/public/paypal/webhook", { method: "POST", headers, body: JSON.stringify(event) });
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("PAYPAL_CLIENT_ID", "scripted-client");
  vi.stubEnv("PAYPAL_CLIENT_SECRET", "scripted-secret");
  vi.stubEnv("PAYPAL_WEBHOOK_ID", "scripted-webhook");
  mocks.token.mockResolvedValue("scripted-token");
  mocks.request.mockResolvedValue({ verification_status: "SUCCESS" });
  mocks.maybeSingle.mockResolvedValue({ data: { payment_attempt_id: "attempt-scripted", org_id: "org-scripted" } });
  mocks.single.mockResolvedValue({ data: { id: "attempt-scripted" } });
  mocks.rpc.mockResolvedValue({ data: true, error: null });
});
afterEach(() => vi.unstubAllEnvs());
describe("signed webhook boundary (scripted provider, not genuine delivery)", () => {
  it("refuses missing signatures before any provider or record operation", async () => {
    expect((await handler({ request: request(false) })).status).toBe(401);
    expect(mocks.token).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("refuses a forged signature without attesting an event or consuming budget", async () => {
    mocks.request.mockResolvedValue({ verification_status: "FAILURE" });
    expect((await handler({ request: request() })).status).toBe(401);
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.reconcile).not.toHaveBeenCalled();
  });
  it("binds the matching verified event to exact order and capture before authoritative reconciliation", async () => {
    expect((await handler({ request: request() })).status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("record_verified_sandbox_event", { _event: "WH-SCRIPTED", _type: "PAYMENT.CAPTURE.COMPLETED", _order: "ORDER-SCRIPTED", _capture: "CAPTURE-SCRIPTED" });
    expect(mocks.reconcile).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenLastCalledWith("finish_sandbox_event", { _event: "WH-SCRIPTED" });
  });
  it("a processed duplicate cannot trigger another reconciliation or completion", async () => {
    mocks.rpc.mockResolvedValue({ data: false, error: null });
    expect(await (await handler({ request: request() })).text()).toBe("Already processed");
    expect(mocks.reconcile).not.toHaveBeenCalled();
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
  it("an unknown order cannot attest a verified event", async () => {
    mocks.maybeSingle.mockResolvedValue({ data: null });
    expect((await handler({ request: request() })).status).toBe(404);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});