# PayPatrol roadmap

## Done this turn (preview only, not yet published)
- Restored compilation of the purchase detail page; correction form calls the deployed 13-arg `edit_purchase` (schema-cache error fixed at the cause)
- Full correction workflow: all invoice fields, required reason, inline errors preserving entries, "Provided by user" / "Not found in document" / "Required before proceeding" wording, discrepancy note, correction history
- Reviewer requirement: exact warning copy, eligible reviewers from real memberships, owner link to Team & integrations; demo suppliers show only the Sandbox account check
- Two supplier-change records labelled current-version vs earlier history; holds still enforced
- Extraction auto-fills untouched fields on new invoices; manual edits protected by confirmation; "Add supplier" inline pending-supplier flow with Sandbox limitation note
- Purchases list: Next-action side panel (status, holds, amounts, role-aware actions, mobile full-width) and controlled batch Review/Export/Approve-eligible/Reject-eligible
- Verified in browser with real backend + real Gemini reading; 45/45 tests, typecheck clean, build OK; BUILD_LOG.md updated

## Open
- [ ] Publish this round (user decision)
- [ ] Batch approve/reject execution itself untested (no eligible rows existed); eligibility display verified
- [ ] CA$80 request (PP-CHECKOUT-20261103) stays on independent-verification hold until partner's Sandbox account check; no payment created

## Standing constraints
- Payment-control writes only via SECURITY DEFINER RPCs; minor units; server recomputes totals
- Never fabricate extraction/payment results; Sandbox only
