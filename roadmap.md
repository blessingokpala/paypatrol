# PayPatrol roadmap

## Current: full readiness review (8 areas from brief)
1. Account & business setup — registration, sign-in, password recovery, org create/join, roles, sign-out; partner onboarding path; business isolation
2. Invoice workflow — upload → extraction → editable form → confirmation → checks → detail; missing/uncertain info, supplier matching, recipient preservation, duplicates, extraction failures
3. AI proposal workflow — genuine Gemini only; manipulated listings; overspend enforced server-side
4. Supplier-change protection — holds block reserve/order/capture; no self-approval or baseline-replace bypass; approval + rejection paths; Sandbox account check labelled
5. Spending rules & budget — which rules editable vs enforced; versioning; simultaneous reservations, cancellation, expiry, uncertain-payment recovery
6. PayPal Sandbox workflow — verify all pre-partner items; list exact remaining human steps; refund/reversal limitations documented
7. Usability — search/filters/sort, drill-downs, back nav, dropdowns, toggles, evidence, proposal summaries, notifications, raw-JSON cleanup, mobile, keyboard
8. Evidence-based completion report — table in JUDGES_REPORT.md + accessible copy; readiness answer + partner test guide

## Outstanding from earlier phases
- Partner (Change approver) review of PP-CHECKOUT-20261103 supplier change — waiting on user; CA$75 request stays on hold
- Real PayPal sandbox checkout + genuine signed webhook — after partner review
- Cross-org invoice isolation re-test
- [x] Replace raw JSON/codes/nulls app-wide with readable summaries
- [x] Overview drill-downs verified; Reserved purchases page; shared back navigation
- [x] Purchases search/filter/sort; header redesign; notifications; account menu
- [ ] CA$75 Sandbox checkout — blocked on partner's independent review
