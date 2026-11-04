# PayPatrol roadmap

## Done previously (preview only, not yet published)
- Correction workflow, reviewer requirement, supplier-change history labels, extraction auto-fill, Next-action panel, batch Review/Export/Approve-eligible/Reject-eligible
- 45/45 tests, typecheck clean, build OK

## Open — release blockers (this turn)
- [ ] 1. Verify batch approval/rejection end-to-end in the real interface (persist after refresh, reason required, mixed selections, blocked cannot bypass, unauthorised/self-approval refused, stale-version approvals rejected, no duplicate decisions, no auto budget reservation)
- [ ] 2. Genuine PayPal Sandbox payment: new labelled test request (NOT the CA$80 "TEST" request — preserve its hold), checks → approval → reserve once → real Sandbox order → buyer approval → validated capture → Paid only on authoritative confirmation → reservation consumed once → consistent after refresh
- [ ] 3. Webhook processing & recovery: genuine webhook signature verification, idempotency, redirect alone cannot mark Paid, cancelled-checkout recovery, declined/pending states, refresh safety, mismatch prevents capture
- [ ] 4. Evidence report: tested version (preview/published), batch results, order/capture IDs, final status/budget, webhook results, incomplete items; update BUILD_LOG.md and testing guide

## Blockers anticipated
- Sandbox buyer approval needs the user's separate Sandbox Personal account login (human action)
- Independent approval/Change approver may require the partner's account (human action)

## Standing constraints
- Payment-control writes only via SECURITY DEFINER RPCs; minor units; server recomputes totals
- Never fabricate extraction/payment results; Sandbox only; no credentials in chat/logs
- CA$80 PP-CHECKOUT-20261103 stays on independent-verification hold; no payment on it
