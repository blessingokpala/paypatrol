# PayPatrol roadmap

## In progress (this turn)
- [ ] Restore compilation of `src/routes/_authenticated/purchases.$id.tsx` (unclosed div, exTotalMinor typing, EditForm calling dropped 6-arg `edit_purchase`)
- [ ] Finish correction workflow: full-field form + required reason, "Add missing details" action, "Provided by user" / "Not found in document" wording, extraction-vs-current discrepancy note
- [ ] Reviewer requirement: exact warning copy, eligible reviewers from memberships, owner route to Team & integrations
- [ ] Label the two supplier-change records (current version vs earlier history), keep holds enforced
- [ ] Fix "Save new version" schema-cache error end-to-end; readable inline errors preserving entered values
- [ ] Extraction → form auto-population for untouched fields; ask before replacing manual edits; investigate stale PP-CHECKOUT reference
- [ ] "Add supplier" action beside supplier selector on invoice workflow; pending supplier, independent verification, sandbox single-merchant limitation note
- [ ] Next action → descriptive links/buttons opening a side panel with status, blockers, failed rule, amounts, next permitted action; mobile full-width; restore filters on return
- [ ] Controlled batch review on Purchases: selection toolbar, Review/Export selected, Approve eligible (server-checked), Reject eligible unpaid with reason; no batch payment
- [ ] Browser verification with a labelled test request; preserve CA$80 hold; no payment/reservation
- [ ] Report: fixed / passed / incomplete / preview-vs-published

## Standing constraints
- CA$80 request `0300638e…` stays on independent-verification hold; no payment until partner review
- Payment-control writes only via SECURITY DEFINER RPCs; minor units; server recomputes totals
- Never fabricate extraction/payment results; Sandbox only
