# PayPatrol final verification roadmap — 6 November 2026

## Judge evaluation guide — 7 November 2026
- [ ] Verify published public entry, authorised evidence, desktop/mobile invoice upload, save and reopen without merchant ID.
- [ ] Reconcile current review decisions, batch methods, notification delivery and completed payment accounting.
- [ ] Deliver dated quick-start, guided steps, evidence table and confidential-data-free sample invoice.
- [ ] Identify human-only access/reviewer checks and remaining limitations without changing working decisions or payments.

## Completed
- [x] Two existing CA$135 requests identified; partner-authorised 390px mobile selection enables Approve eligible (2), without submitting a decision.
- [x] Five historical approvals retained with invalidation reason; current rules v2 unchanged; Maple Lane remains draft/unverified.
- [x] Published no-merchant invoice genuinely extracted (4.8s), saved once and reopened; zero reservations or payments.
- [x] Legitimate supplier-change test feasibility checked; no supported positive change under current merchant configuration, no baseline alteration.
- [x] Basic and deep security reviews run; both spreadsheet-export findings fixed, tested and marked fixed.
- [x] 59 regression tests pass; purchase/evidence downloads checked; report replaced with dated verified/pending/limitations assessment.
- [x] Export fixes submitted for publication.

## Pending with explicit blockers
- [x] Clear individual/batch spending decisions published; 68 tests pass; published desktop/mobile read-only fixture checks confirm paired buttons, reason error and sticky layout. No decisions/reservations/payments created.
- [ ] Genuine eligible reviewer save/refresh/Evidence verification for new decision controls: Ada's Grocery currently has no awaiting spending approvals; requires a future submission and reviewer's own action, not impersonation.
- [x] Trace missed notifications; durable eligible-reviewer delivery/outcomes, business-aware links/read persistence/deduplication implemented; 14 eligible pending partner records backfilled once.
- [x] Published notification core verified using owner-labelled PP-NOTIFY-20261106-001; exactly one unread partner record, zero reservations/payments; report updated. No partner session used.
- [ ] Partner confirms her bell, opens assigned notification and reports outcome; recipient-side end-to-end check cannot be performed without her action.
- [ ] Final small publication (long status wrapping, exact unread number and direct-link count refresh) scheduled; final live version not rechecked because user chose to wrap up for credits.
- [ ] Partner: perform one genuine two-request batch approval; then verify saved batch methods, refresh persistence, zero reservations/payments.
- [ ] Positive supplier-change verification: requires an isolated scenario with genuine independently evidenced replacement account and supported merchant/onboarding verification; do not assign unsupported TEST approval.
- [ ] Disposition of disputed Critical scan finding: authenticated authoritative PayPal API confirmation is mistaken for a browser-only Paid assertion; retained for owner/independent review, not ignored automatically.
- [ ] Confirm published export fixes serve live.

## Standing constraints
- No spending-rule changes during final testing unless fixing a defect.
- Preserve PP-CHECKOUT-20261103 (now CA$78 after owner correction), rejected TEST supplier-change history and blocked payment state.
- No new payments or reservations; no impersonated independent decisions; no fictional contacts used as verification evidence.
