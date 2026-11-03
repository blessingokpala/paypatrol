# PayPatrol — Build Log

## Phase 2: real Gemini invoice reading and purchase suggestions

### What is connected
- Provider: Google Gemini, called directly from protected server functions with the server-side
  `GEMINI_API_KEY` secret. No key, endpoint or token ever reaches the browser.
- Model in use: `gemini-3.1-flash-lite` (the only tested model that answered; other tested ids
  returned unavailable/retired errors).
- Request shape: structured JSON output enforced by a response schema, temperature 0, per-request
  timeout, and up to three attempts when the provider reports a temporary demand spike (500/502/503/504).
- Every model answer is re-validated against a Zod schema before it can touch the app. Anything that
  does not match is discarded and shown as a failure, never guessed around.

### What the model may and may not do
- It reads a private invoice file server-side (org-scoped storage path, PDF/PNG/JPEG magic-byte check,
  8 MB cap) and returns proposed values plus short verbatim source excerpts.
- It may only choose a purchase from the organisation's own approved listings, and the returned listing
  id is checked against that controlled list before anything is stored.
- Prices, currency, totals and the payment recipient are resolved by the server from approved records;
  a value the model claims is never trusted.
- Invoice text, listing descriptions and file contents are wrapped as untrusted data with explicit
  instructions that embedded directions have no authority.
- The model cannot change spending rules, approve, verify a supplier, or capture a payment.

### Evidence and honest status
- Each accepted extraction is recorded in `ai_extractions` with the model name, the values, the fields
  the model flagged as uncertain or missing, and the source excerpts. The request page shows this
  evidence next to the source document, with a "read from the document" action.
- The connection badge only turns green after a real model request succeeds; a key being present is
  never reported as a connection. Overview reports the same rule.
- Verified end to end with the fictional fixture `INV-DEMO-001.pdf`: the model read Harbour Office
  Supplies, 3 packs of copy paper, CA$75.00 CAD and the requested recipient; the reviewed values were
  applied and submitted with a CA$45 approved quote, and the review page held the recipient change and
  reported `AMOUNT_DIFFERS_FROM_QUOTE` while keeping both amounts visible.
- A real connection probe succeeded and was recorded (model `gemini-3.1-flash-lite`).
- During the most recent test run the provider returned "high demand" (HTTP 503) for every request, so
  the assistant-proposal path and a fresh connection probe could not be re-verified at that moment. The
  app reported "AI is busy right now. Try again in a moment." and offered the manual listing path —
  no fabricated suggestion was shown.

### Cost and access status
- Official Google pricing page (ai.google.dev/gemini-api/docs/pricing) lists `gemini-3.1-flash-lite`
  as free of charge on the free tier, and $0.25 per million input tokens / $1.50 per million output
  tokens on the paid tier.
- The account's actual tier and billing status were not independently verified, so no claim is made
  that this project's traffic is free. Free-tier requests may carry different data-use terms and rate
  limits.
- No usage meter is recorded per request yet; only the model name and timestamps are stored.

### Tests
- `src/lib/ai/schemas.test.ts` — 4 Vitest tests: untrusted instruction text is data, malformed model
  output is rejected, quantities must be whole, and every failure code has user-facing copy. All pass.
- `supabase/tests/payment_controls.sql` — quote-comparison and quantity-limit checks added to the
  existing control suite: a mismatched approved quote holds the request and keeps both amounts, a
  matching quote raises no finding, an over-limit quantity is flagged, and the quote link survives an
  edit. Run through the backend SQL runner; the suite rolls itself back.
- TypeScript check (`tsgo --noEmit -p tsconfig.json`) passes.

### Not done in this phase
- PayPal is not connected: no order creation, no capture, no webhook, and nothing is ever marked paid.
- Model answers are not used to auto-approve anything; a human still confirms every value.
- No per-request token/cost accounting beyond the stored model name and timestamp.
