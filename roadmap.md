# PayPatrol roadmap

## Done this turn (preview only, not yet published)
- Batch decisions verified end-to-end: self/stale/blocked approvals refused server-side; mixed selection shows eligible/excluded; real 3-request batch rejection persisted after refresh
- Fixed two defects: rejection now requires a reason server-side and refuses repeat cancellations (migration 0025); cancelling an uncaptured checkout returns the request to checkout instead of cancelling it (migration 0026)
- Genuine Sandbox orders created twice (06Y50592YD2069013, 4BA55974F2783102M — CA$25 CAD, correct merchant); budget reserved once per checkout, released on cancel, no double-counting
- Webhook endpoint re-verified on the published URL: 401 unsigned, 400 malformed, 401 fake signature
- 45/45 unit tests, all 4 payment_controls.sql blocks, typecheck, build OK; BUILD_LOG.md and JUDGES_REPORT.md updated

## Open — need a human
- [ ] Buyer approval in the PayPal popup needs the owner's Sandbox Personal login → then capture, Paid state, and genuine signed webhook can be verified (CA$25 request PP-PAYMENT-TEST-001 is ready at cleared_for_checkout)
- [ ] Independent approval: partner (Payer role) approves labelled CA$135 Kraft bags test request (a7ec5854…) — approval unverified until then
- [ ] Owner completes CA$25 checkout on PP-PAYMENT-TEST-001, then verify capture/Paid/budget/webhook/evidence
- [ ] Next brief (uploaded): centred Next-action modal, decision-first request page, limit explanations, revise quantity, provenance labels
- [x] Published this round

## Standing constraints
- Payment-control writes only via SECURITY DEFINER RPCs; minor units; server recomputes totals
- Never fabricate extraction/payment results; Sandbox only; no credentials in chat/logs
- CA$80 PP-CHECKOUT-20261103 stays on independent-verification hold; no payment on it
