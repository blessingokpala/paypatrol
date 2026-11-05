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
- PayPal and Gemini calls live in protected `createServerFn` handlers using server-side secrets. Why: AI and browser code must never move money.
- PayPal credential authentication uses a server-only helper and is independent of merchant enrolment and checkout availability. Why: accepted credentials do not prove recipient identity, currency capability or completed payment.
- Sensitive control changes require a recent signed JWT authentication-method timestamp, never token issue time; the shared recent-sign-in control refreshes password authentication. Why: token refresh alone must not authorise trusted changes.
- Reservation cleanup skips every nonterminal payment attempt and purchase/control mutation guards preserve unresolved execution. Why: uncertain provider outcomes must never free committed budget or permit changing payment authorisation.
- Sandbox payment operations bind persisted attempts to immutable purchase snapshots and use distinct UUID request keys for create and capture; SQL claims a single capture executor. Why: provider retries and simultaneous callbacks must not execute another logical payment.
- Sandbox webhook processing verifies with PayPal before scoped event recording, then reads the canonical order and applies only service-role payment RPCs. Why: notifications and browser callbacks cannot themselves establish payment truth.
- Merchant configuration replaces only fictional supplier baselines through owner reauthentication; requested invoice recipients remain unchanged. Why: enrolment must not erase discrepancies or bypass independent real-recipient verification.
- Payment-control tests live in `supabase/tests/payment_controls.sql` (run via the backend SQL runner; they roll back).
- Automated test scripts must call `mark_test_workspace` right after creating a workspace; the switcher hides workspaces by the `is_test_workspace` flag, never by name. Why: test fixtures must not appear as real businesses.
- Team membership is granted only by `accept_invitation`, which requires the signed-in confirmed email to match a pending, unexpired invitation; owners manage invitations via create/resend/revoke RPCs. Why: access must never be granted by name matching or silent database edits, and accepting must not touch other businesses.
