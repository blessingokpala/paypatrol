# PayPatrol — Judges' Build Report

Status as of 2026-11-04, 01:00 UTC. Sandbox test mode only. All supplier names, invoices and amounts are fictional.
This report is a self-contained account of the current state. Supporting detail is in the timestamped engineering log, [BUILD_LOG.md](BUILD_LOG.md), linked per section below. Where they differ, the newer entry wins. Earlier optimistic wording that was later corrected is flagged in section 5.

**Payment status, checked in the database when this report was written:** 0 PayPal orders, 0 captures, 0 verified PayPal notifications, 0 independent supplier verifications, 0 purchases marked Paid, 0 active budget reservations.

---

## 1. Features implemented

**Accounts, roles and organisations**
- Email/password, Google and Lovable sign-in. Each person uses their own account.
- Roles (owner, preparer, change approver, payer) are stored per organisation in a separate table, never on the profile.
- Sensitive changes need a sign-in from the last five minutes. This is checked from the signed authentication time, not from token refresh.

**Payment controls (all in protected database functions; the browser can only read)**
- Money is stored in whole cents. The server recomputes every total.
- One shared checker, `evaluate_purchase`, applies the same rules to invoices and AI proposals: weekly limit, per-order limit, approval threshold, allowed categories and suppliers, currency, duplicate invoice and recipient mismatch.
- An approval is tied to a fingerprint of the exact version, amount, currency, recipient, supplier record and rules. Any change cancels it.
- Budget reservations lock the organisation first, so two simultaneous requests cannot both pass the weekly limit.
- A change of supplier recipient opens a change request. The purchase stays held until a different authorised person verifies it. Nobody can clear their own change by replacing the supplier record.
- Reservations, payment attempts and capture are all refused on the server while a change request is open.
- Labelled Sandbox account check (test only): a different change approver records what they saw in PayPal Developer. It is recorded as "no real supplier was contacted".

**AI (Google Gemini `gemini-3.1-flash-lite`, server-side only)**
- **Invoice reading:** an uploaded invoice is read automatically. Values reach the form only after the user clicks "Use these values". Missing and uncertain fields are flagged.
- **Purchase proposals:** the AI may only choose from approved listings. The price, total and recipient come from approved records, never from the model.
- **Untrusted text:** instructions written inside invoices or listings are treated as information only and have no authority.

**PayPal Sandbox**
- Owner-only connection check, plus Sandbox supplier setup that requires a recent sign-in.
- Checkout validates the actual PayPal order (payee Merchant ID, CA$ amount, CAD, order ID, saved purchase snapshot) before capture. Only one capture can run at a time.
- Webhook at `https://paypatrol.lovable.app/api/public/paypal/webhook`. It verifies the signature with PayPal and re-reads the order before changing anything.
  - **Handled:** capture completed, pending, denied and declined.
  - **Explicitly unsupported:** refunded and reversed. They are acknowledged with no status or budget change.

**Usability (latest)**
- **Dropdowns and fields:** shared accessible dropdowns, Show/Hide password, required-field markers and inline amount errors.
- **Leaving a form:** a warning appears if the form has unsaved entries.
- **Purchases list:** search across request titles, invoice references and supplier names; the All / Invoices / AI proposals tabs; Status, Supplier and submission-date filters; sorting by submission date or amount (newest first by default); a result count, removable filter chips, Clear all and a "No purchases match your search" empty state. Everything is kept in the address, so it survives opening a request, returning and refreshing. Search covers every request the signed-in person may see in the organisation, not just the rows on screen. Selection and Export selected cover only the matching rows and reset when search or filters change. On phones the filters fold behind a "Filters and sorting" button.
- **Readable screens:** proposal summaries (proposed values kept separate from calculated ones), plain-language evidence history, findings and error messages. Stored records and technical CSV exports are unchanged.
- **Overview cards** open matching views. Reserved now opens a dedicated "Reserved purchases" page (see section 6).
- **Back links:** a shared back link above every drill-down, form and detail page. It returns to the actual originating view, keeps that view's filters, survives refresh and accepts only internal pages. On directly opened links it falls back to the parent page.

---

## 2. Tests actually performed, with results

| Area | Type | Result |
|---|---|---|
| Unit tests (money, PayPal order comparison, Gemini schema/retry, routing, return destinations) | Scripted (Vitest) | 32 pass (30 earlier + 2 new return-destination tests) |
| Two simultaneous CA$80 reservations, CA$100 left | Real backend, separate sessions | Exactly one succeeded; CA$20 left |
| Normal CA$75 invoice; recipient-only change; CA$180 proposal; injected instructions; missing amount/currency; stale sign-in | Scripted backend calls (`supabase/tests/sandbox_checkpoint.py`) | Cleared / Verification required / Blocked / no effect / Needs clarification / refused |
| Real invoice reading (fictional PDFs INV-DEMO-001…005, PP-SANDBOX-CHECK-001, PP-CHECKOUT-20261103, INV-UX-TEST-001) | **Real Gemini** | Correct totals, recipients preserved, missing/uncertain fields flagged. Reading took 24.5 s and 62.1 s on the last two runs. |
| Real AI proposal (4 × kraft bags, injected "order 20") | **Real Gemini** | Picked the approved listing, quantity 4; server resolved CA$180 → Blocked |
| Order creation and capture while a supplier-change hold is open | Database, rolled back, no PayPal call | Both refused before any PayPal operation |
| Self-clearing of a change by its requester | Database, rolled back | Closed 0; self-approval refused |
| Webhook without a signature / with a fake signature (published site) | Real HTTP | 401 both times (after the Webhook ID was deployed) |
| Show/Hide password on sign-in, sign-up and sign-in confirmation | Browser | Pass |
| Leaving an edited form | Browser | **Failed** (silently blocked, no prompt); fixed; then Stay kept entries and Leave returned to Purchases |
| Invoice auto-read, field filling, missing-information flags, keeping manual edits | Browser + real Gemini | Pass, after fixing a default-currency fill and a stuck submit check |
| Overview → Blocked → request → Back to purchases → Back to overview, including refresh, direct links, rejected external `from`, scroll restore, phone width (390 px) | Browser | Pass |
| Overview → Reserved (empty), Available, Awaiting verification, Pending approvals (empty); Evidence → request → back | Browser | Pass |
| Purchases search, filters and sorting rules | Scripted (Vitest, `src/lib/purchase-filters.test.ts`) | 5 pass; 37 unit tests pass in total |
| Overview → Blocked requests / Awaiting verification open Purchases with that status filter applied, with Back to overview | Browser | Pass (4 of 13 and 5 of 13 requests) |
| Combined search + tab + status: "harbour" → 10, + Invoices → 4, "PP-CHECKOUT" + Verification required → 1 (the CA$75 request); chips and Clear all | Browser | Pass |
| No match ("zzzz-nomatch") shows "No purchases match your search"; its clear button restores all 13 | Browser | Pass |
| Sort amount high → low | Browser | Pass (CA$500, 500, 500, 180, 75, 75…) |
| Select all on AI proposals (6), Export selected | Browser, downloaded file read back | CSV had exactly 6 rows, all AI proposals; switching to Invoices cleared the selection |
| Open a request from a searched, sorted list, refresh the request, Back to purchases, refresh again | Browser | Pass: search, tab and sort restored |
| Overview → Blocked → request → Back to purchases → Back to overview | Browser | Pass |
| Keyboard-only dropdowns (Status and Sort filters, invoice Supplier, proposal listing, organisation switcher): Enter/Space/Arrow opens, arrows move, typing jumps, Enter selects, Escape closes without changing, focus returns to the dropdown, Tab moves on | Browser | Pass |
| Phone layout at 390 px: Overview, Purchases, both creation forms, purchase details, Approvals, Suppliers, Spending rules, Evidence history, Team & integrations, Weekly budget, Reserved | Browser, page-width measurement + screenshots | **Failed first**: every page was 581 px wide because of the top bar, and Overview and Evidence history had extra overflow. Fixed; all now fit at 390 px. Wide tables scroll inside their own box. |

## 3. Scripted tests vs genuine PayPal Sandbox transactions

- **Scripted:** every PayPal order, capture, webhook and timeout scenario so far, using fake PayPal responses in unit tests and rolled-back database checks.
- **Genuine PayPal Sandbox:**
  - OAuth with the Sandbox credentials (HTTP 200).
  - Signature-verification calls that refused fake signatures.
  - **No genuine Sandbox order, buyer approval, capture or signed notification has happened yet.**

## 4. Untested behaviour, known limitations, unfinished work

- **CA$75 Sandbox checkout (PP-CHECKOUT-20261103): not performed.** It is held under "Verification required" until the partner, using their own Change approver account, records the Sandbox account check and decides. No independent review has happened yet.
- **PayPal behaviour not yet seen live:** a real order's payee match, the buyer approving with the Personal Sandbox account, a completed CAD capture, receipt of a genuine signed webhook, duplicate or delayed real deliveries.
- **Scheduled job:** the hourly maintenance job (reservation expiry and recovery) has not been confirmed to run on schedule.
- **Untested end-to-end:** blocking another organisation from the uploaded invoice was checked only in an earlier database test that was later found unreliable (see section 5). The Sandbox account-check form has not yet been used by a second real person.
- **Refunds and reversals:** unsupported and must be reconciled manually.
- **AI invoice reading:**
  - Itemised invoice lines are not carried into the saved request; it stores a summary total. The lines stay in the AI evidence.
  - The recipient can come back with its label (e.g. "PayPal merchant ID: …"). It is kept exactly as read, and the reviewer must trim it.
- **CA$25 test proposal:** Reserve and Pay are hidden in the interface **and refused on the server** ("Demonstration requests cannot be reserved or paid") since 4 Nov 2026.
- **Phones:** checked at one width (390 px) in an automated browser, not on a physical phone or with a screen reader. On phones the organisation switcher shows a shortened name.
- **Purchases list:** no pagination; all of the organisation's requests load at once, which suits demo volumes but not thousands of rows. The date filter uses the browser's local date.
- **Readable screens:** the raw-data cleanup is complete in the standard interface, including Proposal content. Deliberate exceptions: the Evidence history CSV export (an authorised technical export) keeps original details, and a pasted invoice message is shown exactly as submitted.
- **Audit log:** cannot prove the whole log was not rewritten, because no separately stored checkpoints exist.
- **AI cost:** no per-request cost metering. The Gemini billing tier was not verified.

## Supporting build-log entries

- [Phase 2 verification checkpoint](BUILD_LOG.md#phase-2-verification-checkpoint-2026-11-03)
- [PayPal Sandbox phase — partial checkpoint](BUILD_LOG.md#paypal-sandbox-phase--partial-checkpoint-2026-11-03)
- [Invoice PP-CHECKOUT-20261103 consistency review](BUILD_LOG.md#checkpoint--invoice-pp-checkout-20261103-consistency-review-2026-11-03-1755-utc)
- [No self-clearing of supplier changes](BUILD_LOG.md#follow-up--no-self-clearing-of-supplier-changes-2026-11-03-1802-utc)
- [Usability verification checkpoint](BUILD_LOG.md#usability-verification-checkpoint--2026-11-03-21402200-utc)
- [Navigation and overview drill-downs](BUILD_LOG.md#navigation-and-overview-drill-downs-2026-11-03-2215-utc)
- [Purchases search, keyboard and phone checks](BUILD_LOG.md#purchases-search-keyboard-and-phone-checks-2026-11-03-2250-utc)

## 5. Corrections to earlier claims

- A phase-two SQL test block was first reported as passing. Its runner actually failed with a permission error. The outcomes were re-tested later through authenticated calls.
- A stale supplier change was briefly closed automatically by the same person who set up the supplier record. That closure was reversed through an audited reopening, and self-clearing is now blocked.
- "Leave form" protection was listed as implemented before it was tested. Testing showed it blocked silently; it is now fixed and verified.

## 6. Overview cards: data source and calculation

| Card | Source | Calculation | Scope | Destination (same records) |
|---|---|---|---|---|
| Available this week | `org_budget_summary` | weekly limit − active reservations − consumed reservations | Organisation, active rules' currency, current policy week | Weekly budget |
| Reserved | `org_budget_summary` | Sum of reservations with status active and the current week's start | Organisation, current week | Reserved purchases (same conditions; flags any mismatch) |
| Requests awaiting verification | `purchases` table | Count of purchase **requests** with status Verification required, one row each | Organisation, **all outstanding**, not just this week | Purchases filtered to Verification required |
| Pending approvals | `purchases` table | Count of requests with status Approval required | Organisation, all outstanding | Approvals |
| Blocked requests | `purchases` table | Count of requests with status Blocked | Organisation, all outstanding | Purchases filtered to Blocked |

All reads go through the signed-in user's permissions. Nothing is hardcoded, and no demonstration reservations were created.

## Workspace switcher correction (3 Nov 2026)
- Cause: `supabase/tests/concurrent_budget.py` (3 runs) and `sandbox_checkpoint.py` (2 runs) created isolated workspaces with the owner account (the only account), so the owner became their owner/preparer. They persisted (16:07–16:26 UTC).
- Correction: migration 0018 adds explicit `is_test_workspace` classification; the five workspaces were classified by ID with an audit event each. Nothing was deleted or merged; their 36 purchases and 127 audit events remain. Scripts now classify their workspace immediately.
- Switcher shows only non-test workspaces from the user's own memberships (server-enforced by access rules); with one workspace it shows the name only. Switching clears cached data and returns to Overview.
- Verified: header showed "Ada's Grocery" with no dropdown even with a stale saved test workspace; Ada's Grocery still has 13 purchases, policy v1 (CA$300/week), merchant L8SVBX42QHT3U, and the CA$75 request PP-CHECKOUT-20261103 still `verification_required` with its change request pending.
- Not tested: switching between two legitimate workspaces in the browser (no second real workspace exists).

## Header redesign and in-app notifications (4 Nov 2026)

**Implemented**
- Logo: white checkmark inside the shield, ~15% larger, proportions kept.
- Sandbox badge removed from the header; a compact "Sandbox · Test money" pill now sits in the sidebar footer, with a small "Sandbox" pill in the header on phone widths. Explicit Sandbox wording at checkout is unchanged.
- Business identity: dedicated header container (shop icon, border, pale blue background) showing the selected business name prominently. A dropdown arrow appears only when the user belongs to more than one legitimate business; automated test workspaces stay excluded. The business is not labelled as the account owner.
- Account menu: the exposed email and standalone Sign out are replaced by an avatar button. Its panel shows the signed-in email, the person's roles in the selected business, and — for owners only — Team & integrations and Spending rules links, plus Sign out. No decorative items.
- Notification bell with unread count and a panel of concise, timestamped notifications derived from real records: requests awaiting verification, supplier payment-detail changes, approvals required, requests blocked by spending rules, and outgoing payments pending/completed/failed. Each opens its exact purchase or supplier record with a return path. Read status is stored per user in the new `notification_reads` table (server-enforced: users read and mark only their own rows, and only in businesses they belong to). Repeated events deduplicate by a stable key; informational events stop appearing after 7 days while actionable ones persist until resolved. No sample alerts are generated.
- Priority: Urgent (failed outgoing payment), Action required (verification, approval, correction), Update (completion and informational). Derived from explicit event rules, paired with text and icons, separate from payment status.
- Labels are factual ("Payment details need verification", "Blocked by spending rules", "Information missing", "Payment confirmation pending"); no "Fake/Real/Safe/Fraud" verdicts anywhere. Notifications use no AI calls.
- Styling: restrained pale blue gradient across the canvas extending into the header; forms, panels and tables stay on readable surfaces; Libre Franklin kept.

**Verified (browser, owner account)**
- Notification panel listed 22 real events with priorities and timestamps; clicking one opened its exact purchase with "Back to overview"; Mark all as read cleared the badge and stayed cleared after reload (persistence).
- Account menu showed email, roles, business and owner-only links; Sign out present.
- Keyboard: Tab reaches the bell and avatar, Enter opens, arrow keys move through items, Escape closes and returns focus to the trigger.
- Phone width 390 px: header fits with no overflow; logo, Sandbox pill, business name, bell and avatar all usable; sidebar footer pill visible in the opened menu.

**Unsupported / not done**
- Incoming-payment notifications: not implemented — PayPatrol manages outgoing payments to suppliers and has no verified receiving workflow.
- AI explanation summaries inside notifications: not added; notifications are rule-derived only.
- Business switching between two legitimate businesses remains untested in the browser (only one real workspace exists).
- No payment was created, captured or marked Paid. The CA$75 request remains Verification required pending the partner's independent review.

## 7. Readiness review (4 Nov 2026, 01:00 UTC)

Full 8-area review before partner testing. Statuses: **Implemented and verified** / **Implemented but unverified** / **Partially implemented** / **Not implemented**. Supporting detail: [Readiness review build-log entry](BUILD_LOG.md#readiness-review--2026-11-04-0100-utc).

| Requirement | Status | How tested | Actual result | Remaining work | Blocks partner testing? |
|---|---|---|---|---|---|
| Registration, sign-in, sign-out | Implemented and verified | Browser | Sign-out returns to sign-in; protected pages redirect to sign-in; sign-up sends a confirmation email | Real email delivery not observed | No |
| Password recovery | Implemented and verified | Browser | Reset link requested from sign-in; reset page validates the link and sets a new password; expired links handled | Added this review; full email round-trip not performed | No |
| Business creation and joining | Partially implemented | Browser + backend | Owner created Ada's Grocery; adding an unregistered email fails cleanly ("Ask them to sign up first") | Partner must register their own account, then the owner adds their email as Change approver | No — steps ready |
| Role assignment and payment authorisation | Implemented and verified | Browser + code | Roles per business in a separate table; only owner/payer see Reserve/Pay; non-payers now see "Only an owner or payer can reserve budget and pay"; approver cannot approve their own request | — | No |
| Business isolation | Implemented and verified | Live data API | A probe workspace owned by a fake user was invisible to the signed-in owner; anonymous access is denied; probe data deleted | Two-user test once the partner joins | No |
| Invoice workflow (upload → AI reading → review → checks) | Implemented and verified | Browser + real Gemini | Auto-read 24.5 s / 62.1 s; correct totals; missing fields flagged; manual edits preserved; values apply only after "Use these values" | Itemised lines stay in AI evidence (saved request holds a summary total — labelled) | No |
| Duplicate and failed extractions | Implemented and verified | Backend | Duplicate invoice reference for the same supplier blocks; unreadable/missing amount or currency requires clarification | — | No |
| AI purchase requests | Implemented and verified | Real Gemini + backend | Model may only pick approved listings; price/total/recipient come from approved records; injected listing instructions had no effect; CA$180 and CA$500 proposals blocked by limits | — | No |
| Supplier-change protection | Implemented and verified | Backend + browser | Changed recipient opens a hold; reservation, order creation and capture all refused while open; self-approval and baseline-replacement bypass blocked; Sandbox account check form labelled "test only" | Partner performs the actual independent review | **Yes — this is the partner's task** |
| Spending rules and budget | Implemented and verified | Backend + browser | Per-order, weekly, approval threshold, category and supplier rules enforced server-side and versioned; two simultaneous CA$80 reservations with CA$100 left: exactly one succeeded; rule changes re-check open requests | Hourly expiry/reconciliation job is registered and active but a scheduled firing has not been observed | No |
| PayPal Sandbox pre-checkout | Implemented and verified | Backend + live HTTP | Credentials authenticated; merchant L8SVBX42QHT3U with CAD confirmed; webhook endpoint live, verifies signatures (fake signatures refused 401); capture requires payee/amount/currency/order match; duplicate capture prevented | Buyer approval, capture and signed webhook — all require the checkout below | No |
| Genuine Sandbox order + cancel recovery (PP-PAYMENT-TEST-001, CA$25) | Partially verified | Real browser + real PayPal Sandbox | Two genuine orders created (`06Y50592YD2069013`, `4BA55974F2783102M`, both PAYER_ACTION_REQUIRED, CA$25.00 CAD, correct merchant); budget reserved exactly once per checkout and released on cancel; fixed defect: cancel no longer cancels the request — it returns to checkout; batch rejection now requires a reason server-side and refuses repeat cancellations (both defects found and fixed this round) | Buyer approval in the PayPal popup needs the owner's Sandbox Personal login; capture, Paid state and genuine signed webhook still unperformed | **Yes — owner's buyer login** |
| Batch approval and rejection | Rejection verified; approval **unverified** | Backend + real interface | Self-approval, stale-version and blocked-request approvals refused server-side; mixed selection showed "Approve eligible (0)" — this demonstrates **exclusion**, not a successful approval; reason required for rejection; real 3-request batch rejection persisted after refresh. Prepared labelled test request "3 × Kraft paper bags" (CA$135, test data, status Approval required) for an independent approver | A successful approval has **not happened yet**; it needs a different person with Payer or Business owner role to approve the CA$135 test request | **Yes — partner's account** |
| CA$75 Sandbox checkout (PP-CHECKOUT-20261103) | Not implemented (held) | — | Request remains Verification required; no order, capture or Paid state exists | 1) Partner's independent Sandbox account check; 2) any required approval; 3) budget reservation; 4) Personal Sandbox buyer approval; 5) server-confirmed capture; 6) genuine signed webhook reconciliation | **Yes — by design** |
| Refunds and reversals | Partially implemented | Code review | Webhook acknowledges them without changing status or budget; manual reconciliation required | Documented limitation; no automated handling planned for the demo | No |
| Usability (search, filters, drill-downs, back nav, dropdowns, toggles, readable evidence, notifications, raw-JSON cleanup) | Implemented and verified | Browser + 45 unit tests | All verified in earlier checkpoints; notification read state persists per user; keyboard and 390 px phone layouts pass | No pagination; one phone width only; no screen-reader test | No |

**Changes in this review:** password recovery, the server-side test-fixture payment guard and the payer-authorisation note are in the current preview and were published with this review. Everything else was already published.

### Is PayPatrol ready for partner testing?

**Yes — for the core workflows, with one intentional hold.** The partner's first task is the independent review that currently holds the CA$75 request; that hold is the product working as designed, not a defect. Production payments are outside this Sandbox assessment.

**Partner test guide (Change approver role)**
1. Register your own account at https://paypatrol.lovable.app/auth (email/password or Google), then tell the owner your email.
2. The owner adds you under Team & integrations → Members and roles as **Change approver**.
3. Sign in and open the notification "Payment details need verification" (or Purchases → invoice PP-CHECKOUT-20261103).
4. In the supplier-change section, open the **Sandbox account check (test only)** form. In PayPal Developer, compare the connected Business Sandbox account and Merchant ID `L8SVBX42QHT3U` against what the request shows, then record what you saw (merchant ID, account email, result, notes). This is a Sandbox check — no real supplier is contacted.
5. Approve or reject the change. Expected: your decision is recorded with evidence; the request leaves Verification required only after approval; the owner can then reserve budget and run the Sandbox checkout with the Personal Sandbox buyer account.
6. Also try: signing out and back in, the notification bell, and searching/filtering Purchases. You should not see Reserve or Pay buttons — only owners and payers can pay.
