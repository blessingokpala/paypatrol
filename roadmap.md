# PayPatrol roadmap

## Current: usability pass (13 items from brief)
1. Fix AI proposal submit → 404 (navigate with returned id, keep form on error, prevent duplicates)
2. Shared accessible dropdown component (supplier, listing, org, role) — palette, keyboard, alignment
3. Auto-start invoice extraction after upload; populate form; keep extracted vs approved distinct; don't overwrite manual edits
4. Extraction states (Uploading / Reading / Ready / Could not read); reuse saved extraction on detail page; bounded retries
5. "Recipient on this request" wording; specific missing-value messages; never auto-fill from baseline
6. Overview drill-downs: cards link to budget breakdown, reserved, verification, approvals, blocked; Needs action entries link to own request; compact integrations
7. Consistent form/layout spacing; plain-language findings (codes internal only)
8. Lighter placeholders; red asterisk on mandatory fields; inline errors + focus first invalid
9. Back navigation on forms/detail pages; warn on unsaved changes
10. Password show/hide toggles on auth + recent-sign-in
11. Purchases table selection: header checkbox, count, clear, export selected summaries (no batch approval/payment)
12. Evidence history: readable summaries instead of raw JSON; structured detail panel; keep audit records unchanged
13. Verify workflows end-to-end; screenshots; report tested vs unfinished

## Outstanding from earlier phases
- Partner (Change approver) review of PP-CHECKOUT-20261103 supplier change — waiting on user; CA$75 request stays on hold
- Real PayPal sandbox checkout + genuine signed webhook — after partner review
- Cross-org invoice isolation re-test
- [x] Replace raw JSON/codes/nulls app-wide with readable summaries (proposal content, evidence, findings, errors); hide invoice-only fields on proposals
- [x] Overview drill-downs verified; Reserved purchases page; shared back navigation
- [ ] CA$75 Sandbox checkout — blocked on partner's independent review
