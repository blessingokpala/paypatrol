<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## Architecture rules
- All payment-control writes go through SECURITY DEFINER SQL functions (RPC); app tables grant only SELECT to signed-in users. Why: browser writes must never mark Paid, approve changes, or edit trusted records.
- Money is stored and compared as integer minor units; the server recomputes totals. Why: avoids float errors and client tampering.
- `evaluate_purchase` is the single deterministic checker for invoices and AI proposals. Why: both entry points must pass identical controls.
- Approvals bind to a purchase digest (version, amount, currency, recipient, supplier and policy version); any change invalidates them. Why: approvals must apply only to what was seen.
- Budget reservations lock the organisation row before checking the weekly limit. Why: concurrent requests must not both pass.
- PayPal and Gemini calls will live in protected `createServerFn` handlers using server-side secrets. Why: AI and browser code must never move money.
- PayPal credential authentication uses a server-only helper and is independent of merchant enrolment and checkout availability. Why: accepted credentials do not prove recipient identity, currency capability or completed payment.
- Payment-control tests live in `supabase/tests/payment_controls.sql` (run via the backend SQL runner; they roll back).
