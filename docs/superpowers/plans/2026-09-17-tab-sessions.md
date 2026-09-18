# Tab Sessions and Clean Start Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development for the independent state, inbox and popup tasks; root integrates orchestration and verifies the complete flow.

**Goal:** Start cleans the selected site's data before acquiring an address/opening signup; different tabs run independent sessions and display only their own state.

**Architecture:** Persist session, inbox, status and pending wipe by relay tab ID in a `tabStates` map. Serialize only short storage mutations; long commands, address controllers and watchers are independent per tab. Start persists a cleaning/permission-wait phase, reuses the scoped family-aware cleanup, reloads and waits for a new interactive document, then starts the existing workflow.

**Tech Stack:** Chrome MV3, native ES modules, node:test, existing browser QA fixtures. No runtime dependencies.

**Spec:** User's current request: automatic Delete before Start, tab-local UI, parallel starts in different tabs.

## Constraints

- Preserve identity families, including every Microsoft/Google member.
- Delete is limited to the selected site's existing cleanup plan; never global browser deletion.
- Browser cookies remain shared for tabs on the same site/family; tab-local extension state does not create browser containers.
- No README edits, no Git commit (workspace has no Git repository).
- Require cleanup host permissions before continuing Start. Popup requests them in the original click gesture; a persisted permission-wait session lets the worker resume when the popup closes.
- Stop/renew/retry/close only affect their identified tab; missing/invalid command tab IDs never pick an arbitrary parallel session.

## Shared interfaces

`state.js` owns `StorageKey.tabStates = "tabStates"`, with records `{session,status,inbox,pendingWipe}` by tab ID.

- `readSessions()` returns all live stored session objects, including a legacy single session if not migrated.
- `readSession(tabId)`, `readInbox(tabId)`, `readStatus(tabId)`, `readPendingWipe(tabId)` use explicit tab context. Passing null returns no tab state. Omitted arguments retain legacy/single-record compatibility for old consumers/tests only; production tab flows pass IDs.
- `writeSession(session)` keys by `session.relayTabId`; `updateSession(session,patch)` preserves UUID checks and moves state if relayTabId changes. `clearSession(tabId)` removes only that session. `isLiveSession(session)` checks that session's own tab and UUID.
- `writeStatus(level,text,tabId)` and `writeInbox(inbox,guard,tabId)` write scoped records; `clearInbox(tabId)` removes only that inbox. Short mutations share a storage mutex to avoid lost map updates.
- `readPendingWipes()` returns pending objects; `writePendingWipe(pending)` keys by `pending.tabId`; `clearPendingWipe(tabId)` is scoped.
- `setBadge(kind,title,tabId)` / `clearBadge(tabId)` include the Chrome action tabId when valid.
- `stopWatching(tabId)` stops/clears only one tab. `watchInbox(session,address,resume)` derives tab from session. `resumeWatching()` dispatches all eligible stored watchers without serial waiting.
- `report(level,text,notification,tabId)` / `reportFailure(error,context,tabId)` scope status; global tools remain global.
- Messages: existing `start(tempId,relayId,options,tabId)`; `stop(tabId)`, `newAddress(options,tabId)`, `retryInbox(tabId)`, `clearTab(tabId)`.
- Permissions: `cleanupOrigins(plan)`, `hasCleanupAccess(plan)`, `requestCleanupAccess(plan)` use the existing cleanup plan's cookie domains.

## Task 1: Tab state and badges

Files: shared/state.js, shared/badge.js, tests/session.test.mjs, tests/badge.test.mjs.

- [ ] Reproduce two sessions overwriting each other, interleaved patches and scoped deletion.
- [ ] Implement the interfaces above, legacy migration/read compatibility and atomic map updates.
- [ ] Test per-tab status/inbox/pending wipe, UUID cancellation, rekeying and migration without leaking one tab's state into another.

## Task 2: Independent inbox watchers

Files: background/inbox.js, background/notify.js; new tests/tab-inbox.test.mjs.

- [ ] Test simultaneous watches, stopping one while the other completes, independent badges and restart recovery.
- [ ] Replace watcher/generation singletons with maps keyed by tab ID; scope every read/write/report/badge operation.
- [ ] Preserve stale-response/address guards, provider polling cancellation, OTP-before-submit checks and clipboard ordering.

## Task 3: Tab-local popup and commands

Files: popup/popup.js, shared/messages.js, shared/permissions.js; new tests/tab-popup.test.mjs.

- [ ] Test tab A live, tab B idle, state refresh after active tab change and IDs carried by all commands.
- [ ] Read and render current tab state only. Update tab context on activation/navigation, reject stale async renders, clear sensitive copy values on context change.
- [ ] Start sends its intent promptly and requests all cleanup origins in the click gesture before awaiting asynchronous work. Permission grant can outlive the popup; worker owns resumption. Stop never requests cleanup permissions.
- [ ] Do not expose another tab's account, inbox, status or run icon. Keep user choices and browser-wide proxy tools shared.

## Task 4: Clean Start and concurrent orchestration (root)

Files: background/orchestrator.js, background/background.js, background/cleanup.js, tests/background-flow.test.mjs, tests/wipe.test.mjs, new tests/tab-start.test.mjs.

- [ ] Reproduce clean-before-acquire/open, parallel blocked providers, scoped Stop/close/renew, cleanup failure and permission resumption.
- [ ] Replace global queue/generation/controller with per-tab contexts. Reserve session immediately, check current generation at every async boundary, and keep Stop immediate.
- [ ] Start persists `phase: cleaning` or `awaiting-permission`, performs existing family-aware delete, reloads, waits for the new interactive document, then enters renew. Cleanup errors must prevent acquisition/filling.
- [ ] Pending manual wipes are scoped and cannot replay onto a newer live start. Resume permitted waiting starts from permissions.onAdded and worker startup.
- [ ] Route errors/status to the command tab. Closing one tab clears only its records/watchers and cannot cancel another flow.

## Task 5: Integration and evidence

- [ ] Run relevant unit/integration tests, fix old fixtures to model new scoped contracts and required cleanup Chrome APIs.
- [ ] Browser QA with two localhost origins verifies the popup and actual page storage clearing; no third-party accounts created.
- [ ] Independent review of cancellation, cleanup ordering and per-tab isolation; resolve material findings.
- [ ] Run npm run verify; bump synchronized manifest/package to 1.30.0; document results and same-site cookie constraint.
