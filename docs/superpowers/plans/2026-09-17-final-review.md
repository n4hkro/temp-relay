# Final review record

Review compared root edits to the original filesystem backup (no Git repository).

Independent reviewer confirmed that every original Microsoft, Google, Apple and Meta domain and origin remains present. Three concrete regressions were reported and reproduced with failing tests before correction:

1. A narrow email/button container excluded a sibling password input inside the same dialog. Explicit dialog roots now preserve the whole auth scope; ancestors adding auth fields are retained.
2. A four-digit OTP at the end of the subject joined its repetition at the start of the body. A non-whitespace boundary prevents cross-field grouped-code matches.
3. Same-site auth iframes were rejected by the top-frame origin guard. Read-only frame discovery now verifies each frame's site/family with PSL and binds subsequent filling/submission to document IDs.

Root independently inspected proxy changes, reproduced/fixed startup superseding a user's newer connect, cancellation while reading an IP response body, and an owned mismatched proxy remaining configured. Older tools tests were updated to supply the now-required matching HTTP proxy/challenger evidence; authenticated SOCKS expectations were replaced by supported HTTP cases.

Full verification results are recorded in docs/AUDIT-2026-09-17.md. Browser fixtures exercise actual DOM behavior and mocked Chrome boundaries. Live providers and real proxy connectivity remain outside the tested environment.

Follow-up from the user's Webshare screenshot was reproduced against the public registration page with signup clicks intercepted before the site's handlers. Root fixed the conflicting current-password hint, sibling consent scope, opener clicking submit controls, and missing live-field validation before submission. Regression coverage includes disabled registration controls, submit descendants, changed/rejected values and required unknown fields. Live guarded verification confirmed filling and consent, with zero clicks while invalid and one click when ready; no account was created.

The user's latency report led to removing the ready-form settle delay, reacting to completed navigation instead of a lost injection's timeout, immediate script injection and opening the form concurrently with address acquisition. Worker tests verify these boundaries and cleanup; the final full run passed 857 tests. The live ready-page probe measured 2 ms detection and 130 ms fill; provider and navigation time are excluded.

Further latency investigation reproduced 12.2 seconds waiting for an unrelated iframe in real Chrome extension APIs. Navigation now observes a new interactive document ID rather than the full page load; copying/notification no longer precedes filling. The same fixture took 261 ms, and a real orchestrator run with a deliberately pending clipboard filled in 571 ms. See the dedicated latency report for conditions.

The latest signup-discovery follow-up reproduced premature step timeout and equal-rank stage waits. The generic opener now waits for late initial controls and newly available stages within one deadline, caches word matching, filters text before layout, deduplicates overlapping scopes and clicked descendants, and searches ordinary controls on pages exceeding 6000 elements. Six additional opener regressions pass. Live guarded CMC opening/filling took 2555 ms. A 6521-node generic SPA with a 2200 ms delayed modal, ordinary div tab and email-method step took 2367 ms including fields/consent; no form was submitted. Full verification passed 870 tests across 153 suites.

An independent latency review found that spending the whole deadline on the first ineffective candidate prevented trying an existing equal-ranked alternative. A failing regression confirmed it. The fix reserves an adaptive slice when a distinct eligible alternative is already present; a single path retains the full wait. The reviewer reran the original reproduction successfully (both candidates clicked, ready:true), confirmed all six opener regressions, and reported no remaining material findings. Navigation/background focused tests also passed (18/18).
