import { afterEach, describe, expect, it, vi } from "vitest";
import { authenticateSandbox } from "./paypal.server";

afterEach(() => vi.unstubAllGlobals());
describe("Sandbox authentication", () => {
  it("connects only after a successful token response and never returns the token", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ access_token: "scripted-test-token" }));
    vi.stubGlobal("fetch", fetcher);
    const result = await authenticateSandbox("fixture-client", "fixture-secret");
    expect(result.connected).toBe(true);
    expect(result).not.toHaveProperty("access_token");
    expect(fetcher.mock.calls[0]?.[0]).toBe("https://api-m.sandbox.paypal.com/v1/oauth2/token");
  });
  it("does not connect on refused credentials", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 401 })));
    expect((await authenticateSandbox("fixture-client", "fixture-secret")).connected).toBe(false);
  });
  it("does not connect without an access token", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({})));
    expect((await authenticateSandbox("fixture-client", "fixture-secret")).connected).toBe(false);
  });
});