# Proxy reliability result

Implemented serialized list/settings mutations, cancellable health checks, lifecycle invalidation, effective-settings verification, bounded credential responses scoped to challenger and owned endpoint, authenticated SOCKS rejection, and explicit unknown protocol rejection.

Root integration also added URL credential decoding/encoding, startup ordering guards, full-response cancellation, IP response validation and cleanup of mismatched owned settings. The popup can expand beyond 120 rows and recover a button after command failure.

Behavior tests cover connect→disconnect, connect A→B, startup→disconnect, startup→connect, simultaneous add, unchanged/foreign/mismatched effective settings, unknown/mismatched/repeated auth requests, and abort while reading the body. Original tools test fixtures now use HTTP for authenticated proxy cases.

No real browser proxy settings were changed. No Git repository was present, so no commit was made. Run `node --test tests/proxy.test.mjs tests/proxy-flow.test.mjs tests/tools.test.mjs` or the complete `npm run verify`.
