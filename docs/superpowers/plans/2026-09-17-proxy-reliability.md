# Proxy reliability implementation plan

**Goal:** Keep Chrome proxy settings, stored selection and authentication consistent during overlapping commands.

**Architecture:** Preserve current exported APIs. Serialize settings/list mutations and cancel or invalidate superseded network checks. Never send credentials unless the challenger and effective owned configuration match the selected proxy.

**Tech stack:** Browser ES modules, Chrome MV3 APIs, node:test. No new runtime dependencies.

**Requirements:** User requested correction of logic and general problems throughout the extension. This is the independent proxy task; root handles other subsystems. No Git repository exists; original files are backed up at `C:/Users/Evaks/AppData/Local/Temp/temp-relay-audit-fd06922913eb41c2943ddcc4f5db017e`.

## Task 1: Proxy lifecycle, authentication and import validation

Files: `src/background/proxy.js`, `src/shared/proxy.js`, `tests/proxy.test.mjs`, new `tests/proxy-flow.test.mjs` if needed. Keep existing exported function signatures compatible. Do not edit shared/state.js, popup.js or background.js; request coordination if unavoidable.

- [x] Write failing behavioral tests with a fake Chrome settings/storage boundary and deferred fetch. Reproduce connect then disconnect while fetch waits; connect A then B; startup resume then disconnect; concurrent list additions.
- [x] Serialize mutations and prevent old network completions from storing or clearing newer selections. Disconnect must not wait for an obsolete health check. Reconcile migration/startup through the same mechanism.
- [x] Verify effective `levelOfControl` and selected host/port/scheme after applying configuration before declaring success. Test successful set with unchanged effective settings.
- [x] Verify challenger host and port, effective owned configuration, and bounded attempts before returning auth credentials. Test mismatched/missing challenger, non-proxy auth, valid challenge, and repeated failed challenge.
- [x] Reject authenticated SOCKS4/SOCKS5 input with a useful Azerbaijani error. Retain authenticated HTTP/HTTPS and unauthenticated SOCKS. Reject explicit unknown JSON protocol values instead of defaulting them to HTTP.
- [x] Run the focused tests, self-review, and report exact commands/results and changed files. Do not change real browser/network settings or write README.

## Review

- [x] Independent review against the backup, then address substantiated findings and run affected tests.
- [x] Integrate into root's full `npm run verify`.

