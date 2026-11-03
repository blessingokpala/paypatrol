// Scripted (fake) Gemini responses — no real model is called here.
import { afterEach, describe, expect, it, vi } from "vitest";
import { pingGemini } from "./gemini.server";

const ok = () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"status":"ready"}' }] } }] }), { status: 200 });
const busy = () => new Response("high demand", { status: 503 });

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("Gemini retries", () => {
  it("retries a busy model and returns exactly one answer", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-only");
    const fetchMock = vi.fn().mockResolvedValueOnce(busy()).mockResolvedValueOnce(busy()).mockResolvedValueOnce(ok());
    vi.stubGlobal("fetch", fetchMock);
    const r = await pingGemini();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(r).toEqual({ ok: true, model: "gemini-3.1-flash-lite", data: { status: "ready" } });
  }, 20_000);

  it("gives up after three busy answers with an honest error, never a guess", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-only");
    const fetchMock = vi.fn().mockImplementation(async () => busy());
    vi.stubGlobal("fetch", fetchMock);
    const r = await pingGemini();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("unavailable");
  }, 20_000);

  it("does not retry a refused key", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-only");
    const fetchMock = vi.fn().mockImplementation(async () => new Response("bad key", { status: 400 }));
    vi.stubGlobal("fetch", fetchMock);
    const r = await pingGemini();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(r.ok).toBe(false);
  });
});
