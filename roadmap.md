# PayPatrol roadmap

## Done: full readiness review (8 areas) — 2026-11-04
- [x] Password recovery added (forgot-password + /reset-password) and browser-verified
- [x] Server-side test-fixture payment guard (migration 0020); CA$25 fixture reserve/pay refused server-side
- [x] Non-payers told who can pay on cleared requests
- [x] Sign-out, business isolation (probe workspace invisible), add-member error path, cron schedule, PayPal config state verified
- [x] JUDGES_REPORT.md readiness table + partner test guide; copied to Files; published

## Outstanding (waiting on people, not code)
- Partner registers own account → owner adds as Change approver → partner records Sandbox account check and decides the CA$75 request (PP-CHECKOUT-20261103) hold
- After approval: budget reservation → Personal Sandbox buyer approval → server-confirmed capture → genuine signed webhook reconciliation
- Real email round-trips (signup confirmation, password reset delivery) unobserved
- Two-user business-isolation test once the partner joins
- First observed firing of the hourly maintenance schedule
