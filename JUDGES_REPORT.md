# PayPatrol — Judges’ Verification Report

**Review date: 6 November 2026 (UTC).** Live invoice verification: 16:43 UTC. Final security/export checks: approximately 20:31 UTC. Sandbox test money only; no production payments. This report supersedes the earlier November 4 status table. Historical engineering evidence remains in BUILD_LOG.md.

## Completion assessment

Verified for invoice checking and the demonstrated payment controls, but **not fully closed**: the partner’s genuine batch approval, a legitimate positive supplier-change verification path, and disposition of one disputed deep-security finding remain outstanding. No new payment, reservation, supplier decision or spending-rule change was performed in this review.

## Verified workflows

| Workflow | Evidence and actual outcome |
|---|---|
| Published unfamiliar invoice without merchant ID: upload → review → check → save → reopen | A new explicitly fictional PDF, `MLO-FINAL-20261106-1644`, was uploaded to the published app. Genuine Gemini `gemini-3.1-flash-lite` completed in 4.8 seconds; reference, CAD 40.00 and Office supplies were correct; merchant ID stayed empty. Submitted once and refreshed the detail page. Saved amount/category/reference and original extraction persisted. “Invoice checked. Payment is unavailable…” and “Cannot check: payment recipient or approved supplier record missing” were visible. No spending rule failed. No Reserve or Pay action; database has zero reservations and zero attempts. [Open saved test request](https://paypatrol.lovable.app/purchases/69dfa696-3ec6-4839-95df-4d3aca207626). |
| Supplier drafts without payment setup | Previously live-checked: optional collapsed payment setup, incomplete/unverified drafts, and Check an invoice. Maple Lane remains a draft/unverified supplier. Its inclusion in policy v2 is spending permission only, not recipient verification or activation. |
| Historical spending approval and invalidation | Five independent individual decisions remain stored and visible in Completed. All have `is_valid=false`, reason “Spending rules changed to version 2.” Rule v2 was saved at 16:08:43 UTC on Nov 6. Live partner-account mobile Completed view contained all five “No longer valid” explanations; approval-required status now applies to their current requests. No rules were changed in this review. |
| Batch preparation, not execution | Existing `ac8d1478-4a5a-4204-9bb6-db064af60ddd` and `7d392866-0d7b-4283-a136-1c7885bb38d5`, each CA$135 CAD/v1, are approval_required. Exact visible fixture references are “Batch approval check 1 — test data” and “Batch approval check 2 — test data”; these AI requests have no invoice_reference. Under the partner’s authorised session at 390×844, selecting both enabled “Approve eligible (2)”; no sideways overflow. No approve/reject/capture action was submitted. Each has zero reservation/payment-attempt records. |
| Partner spending rejections and supplier rejection | Earlier recorded evidence: three spending rejections with reasons; supplier change for PP-CHECKOUT-20261103 v2 recipient TEST was rejected, not cancelled. The supplier decision was not altered or repeated. Current purchase has since been corrected by the owner to CA$78, remains blocked, and still requests TEST. It is inaccurate to call its current amount CA$80; the rejection concerned the earlier CA$80 version. |
| Genuine CA$25 Sandbox payment | Records reconfirmed: PP-PAYMENT-TEST-001 is Paid; order `6PP262896T830104W`, capture `2X730686B0899582N`, COMPLETED. Earlier verification established one consumed CA$25 reservation and genuine signed PENDING and COMPLETED notifications. This review did not repeat checkout or claim new webhook receipt. |
| Automated regression checks | 59 tests passed across 11 test files after export fixes, including 18 PayPal contract/event tests and 3 new CSV security tests. Preview build log reports build OK. |
| Spreadsheet exports | Deep review found formula-injection risks in Purchases and Evidence CSV. Shared quoting/formula-neutralization now covers every cell; stored data and audit history unchanged. Tests cover `=`, `+`, `-`, `@`, leading whitespace/control characters and quotes. Browser downloaded Purchases CSV: exactly two selected rows. Evidence CSV: 187 rows, eight columns per row, details decoded as JSON. Fixes published; live export-version confirmation pending. |

## Exact remaining human action

1. Partner signs in, selects **Ada’s Grocery**, and opens [the two batch tests](https://paypatrol.lovable.app/purchases?q=Batch%20approval%20check&status=approval_required). Tick both references above, choose **Approve eligible (2)**, optionally enter “Final batch approval verification”, then confirm **Approve 2 requests** once. Do not Reserve or Pay. Expected: two successful decisions and Completed entries labelled Batch approval. Tell the owner when finished; reconciliation must check both `_via=batch` records, persistence after refresh, and zero reservations/payment attempts. No successful batch operation is claimed until those records exist.

[First request directly](https://paypatrol.lovable.app/purchases/ac8d1478-4a5a-4204-9bb6-db064af60ddd) · [Second request directly](https://paypatrol.lovable.app/purchases/7d392866-0d7b-4283-a136-1c7885bb38d5)

## Supplier-change test: limitation and valid proposal, not assigned

The app currently binds one configured merchant to one supplier in Ada’s Grocery. Harbourside’s approved recipient already equals that configured merchant. The labelled Sandbox confirmation function requires the Merchant ID independently read from PayPal Developer to equal **both** the proposed recipient and the configured merchant, and rejects self-checks/setup-owner checks. A true change away from Harbourside’s current recipient cannot satisfy those conditions under this configuration. TEST is unsupported and must not be approved. Merely changing a request back to the already-approved ID tests correction/rechecking, not a new verified recipient change.

No approved baseline was altered and no new misleading passing scenario was created. Valid future approach: use a separate isolated, explicitly classified Sandbox test workspace and a supplier with an independently evidenced previous account and a genuinely evidenced replacement account; extend and test that workspace’s merchant/onboarding verification support before assigning the partner. Evidence must come from PayPal Developer’s actual Business account and connected-app records, not invoice text, invented contacts, or dummy IDs. Retain an independent checker, audit transitions, and block payment until integration/enrolment supports the replacement. This needs additional setup/integration work and a real supported account; no new credentials/accounts are requested for the current batch task. A rolled-back scripted fixture can exercise the approve branch but cannot be reported as a genuine independent positive verification.

## Security review

- Basic checks completed twice: no issues reported.
- Deeper review completed Nov 6: two material CSV export warnings fixed, tested, and marked fixed.
- **One Critical finding remains active/disputed:** “Any payer can mark purchases paid outside signed notifications.” The scanner identified the protected capture API path, not an unauthenticated client status write. Code review shows server authentication, Payer/owner checks via the capture-preparation RPC, persisted immutable snapshot/order binding, authenticated HTTPS PayPal capture/order responses, exact payee/amount/currency/digest/version checks, and service-only recording. A browser return or supplied capture payload cannot establish Paid. Genuine PayPal API confirmation can establish payment truth independently of webhook delivery; signed webhook receipt is separately tracked. Existing contract tests pass. We did not weaken this working control to force webhook-only completion, did not dismiss the Critical finding automatically, and do not claim the security review is clean. Owner disposition of the documented false-positive assessment or further independent review is pending.

## Known limitations and unverified paths

- Genuine positive supplier-change verification and genuine batch approval remain unverified, as above.
- Published export fixes have been requested; serving the updated version is not yet independently confirmed.
- Invoice saves retain a summary total, not full itemisation. Extracted invoice date/buyer/subtotal remain in original AI evidence until user corrections provide them; this review did not claim automatic saving of all extracted optional fields.
- Additional independently onboarded merchant routing is not supported by the current one-merchant demo. No merchant ID alone makes an unfamiliar supplier payable. TESTONLY IDs remain non-payment data.
- Refunded/reversed notifications remain explicitly unsupported and do not restore budget or change status automatically.
- Physical-phone/screen-reader checks, high-volume pagination, observed scheduled-maintenance firing, and duplicate/delayed genuine PayPal delivery cases remain outside this completed evidence.
- Signup confirmation/password-recovery email round trips and invitation delivery via a configured sender domain are not newly verified here. Existing partner membership is confirmed; no further invite is needed.

## Report location and access

Project document: `JUDGES_REPORT.md`; not an app page or public route. The revised downloadable report is provided through Files as `PayPatrol_Judges_Report_v2.md`. Request links require normal sign-in and authorised workspace membership. Uploaded invoices remain private; no permanent public document URL is supplied.
