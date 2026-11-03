const SANDBOX_API = "https://api-m.sandbox.paypal.com";

// No tokens are persisted or returned to the browser. A successful OAuth check
// proves credential acceptance, not merchant ownership or CAD capability.
export async function authenticateSandbox(clientId: string, clientSecret: string) {
  try {
    const response = await fetch(`${SANDBOX_API}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) return { connected: false as const, reason: "PayPal Sandbox authentication was refused. Check the Sandbox app credentials." };
    const body: unknown = await response.json();
    if (!body || typeof body !== "object" || !("access_token" in body) || typeof body.access_token !== "string" || !body.access_token) {
      return { connected: false as const, reason: "PayPal did not confirm Sandbox authentication." };
    }
    return { connected: true as const, checkedAt: new Date().toISOString() };
  } catch {
    return { connected: false as const, reason: "PayPal Sandbox could not be reached. Try again." };
  }
}