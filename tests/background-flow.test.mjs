import assert from "node:assert/strict";
import { afterEach, beforeEach, it } from "node:test";
import { handleCommand } from "../src/background/orchestrator.js";
import { acquireAddress } from "../src/background/address.js";
import { stopWatching, watchInbox } from "../src/background/inbox.js";
import { Message } from "../src/shared/messages.js";
import { readSession, writeSession } from "../src/shared/state.js";

const deferred = () => {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
};
const turn = () => new Promise((resolve) => setImmediate(resolve));
async function until(check) {
  for (let i = 0; i < 100; i++) { if (check()) return; await turn(); }
  assert.fail("operation did not reach its expected boundary");
}
let store, calls, originalFetch;
beforeEach(() => {
  store = {};
  calls = { fetch: [], copies: [], scripts: [], badges: [], notifications: [] };
  originalFetch = globalThis.fetch;
  globalThis.chrome = {
    storage: { session: {
      get: async (key) => ({ [key]: structuredClone(store[key]) }),
      set: async (patch) => { Object.assign(store, structuredClone(patch)); },
      remove: async (key) => { delete store[key]; },
    } },
    action: {
      setBadgeText: async (value) => { calls.badges.push(value.text); },
      setBadgeBackgroundColor: async () => {}, setTitle: async () => {},
    },
    runtime: {
      getPlatformInfo: async () => ({}), getURL: (path) => path,
      sendMessage: async (message) => { calls.copies.push(message.text); return { ok: true }; },
    },
    offscreen: { hasDocument: async () => true },
    notifications: { create: async (value) => { calls.notifications.push(value); } },
    tabs: { get: async (id) => ({ id, windowId: 1, url: "https://example.com/signup", status: "complete" }) },
    scripting: { executeScript: async (args) => { calls.scripts.push(args); return [{ result: { already: true } }]; } },
  };
  globalThis.fetch = async (...args) => { calls.fetch.push(args); throw new Error("unexpected network request"); };
});
afterEach(async () => {
  await handleCommand(Message.stop());
  await turn();
  globalThis.fetch = originalFetch;
});
const liveSession = (extra = {}) => ({
  id: "session-1", started: 100, relayId: "active-tab", relaySite: "https://example.com",
  relayTabId: 7, windowId: 1, tempId: "temp.tf", address: "new@gmail.com", ...extra,
});

it("Dayandır tabın oxunuşunu gözləyən Başlat-ı ləğv edir", async () => {
  const tab = deferred();
  let reading = false;
  chrome.tabs.get = () => { reading = true; return tab.promise; };
  await handleCommand(Message.start("temp.tf", "active-tab", undefined, 7));
  await until(() => reading);
  await handleCommand(Message.stop());
  tab.resolve({ id: 7, windowId: 1, url: "https://example.com/signup" });
  await turn(); await turn();
  assert.equal(await readSession(), null);
  assert.equal(calls.fetch.length, 0);
});

it("köhnə sessiyanın gec poçt cavabı yeni sessiyanın koduna çevrilmir", async () => {
  const response = deferred();
  const session = liveSession();
  await writeSession(session);
  globalThis.fetch = (...args) => { calls.fetch.push(args); return response.promise; };
  const watching = watchInbox(session, session.address);
  await until(() => calls.fetch.length > 0);
  await writeSession(liveSession({ id: "session-2", started: 200 }));
  response.resolve({ ok: true, json: async () => ({ data: [{
    id: "old-code", from: "verify@example.com", subject: "Verification code",
    body: "Your verification code is 123456", date: new Date().toISOString(),
  }] }) });
  await watching;
  assert.notEqual(store.inbox?.phase, "found");
  assert.deepEqual(calls.copies, []);
  assert.deepEqual(calls.notifications, []);
});

it("Dayandır tamamlandıqdan sonra başlayan köhnə izləmə inbox-u qaytarmır", async () => {
  const session = liveSession();
  await writeSession(session);
  await handleCommand(Message.stop());
  await watchInbox(session, session.address);
  assert.equal(store.inbox, undefined);
  assert.deepEqual(calls.fetch, []);
});

it("Dayandır ünvan sorğusunu dərhal abort edir", async () => {
  let signal;
  globalThis.fetch = (_url, options) => {
    signal = options.signal;
    return new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
    });
  };
  await handleCommand(Message.start("temp.tf", "active-tab", undefined, 7));
  await until(() => signal);
  await handleCommand(Message.stop());
  assert.equal(signal.aborted, true);
  await turn();
  assert.equal(await readSession(), null);
  assert.match(store.status.text, /Dayandırıldı/);
});

it("ünvan provayderi gecikəndə qeydiyyat formasının açılması onu gözləmir", async () => {
  const response = deferred();
  globalThis.fetch = (...args) => { calls.fetch.push(args); return response.promise; };
  await handleCommand(Message.start("temp.tf", "active-tab", undefined, 7));
  await until(() => calls.fetch.length > 0);
  for (let i = 0; i < 15; i++) await turn();
  const openedWhileWaiting = calls.scripts.some((call) => call.func.name === "openSignupInPage");
  await handleCommand(Message.stop());
  response.resolve({ ok: true, json: async () => ({ email: "qa@gmail.com" }) });
  await turn(); await turn();
  assert.equal(openedWhileWaiting, true, "müstəqil ünvan və forma axtarışı ardıcıl gözləməməlidir");
  assert.equal(calls.scripts.some((call) => call.func.name === "fillFormInPage"), false, "Dayandır-dan sonra doldurulmur");
});

for (const slow of ["clipboard", "notification"]) {
  it(`${slow} cavabı geciksə də hazır forma dərhal doldurulur`, async () => {
    const delayed = deferred();
    let reached = false;
    if (slow === "clipboard") chrome.runtime.sendMessage = async () => { reached = true; return delayed.promise; };
    else chrome.notifications.create = async () => { reached = true; return delayed.promise; };
    chrome.scripting.executeScript = async (args) => {
      calls.scripts.push(args);
      return [{ result: args.func.name === "fillFormInPage"
        ? { done: true, filled: ["email", "password"] } : { already: true } }];
    };
    globalThis.fetch = async (_url, { signal }) => String(_url).includes("/check")
      ? new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true }))
      : { ok: true, json: async () => ({ email: "qa@gmail.com" }) };
    await handleCommand(Message.start("temp.tf", "active-tab", undefined, 7));
    await until(() => reached);
    for (let i = 0; i < 30; i++) await turn();
    const filledBeforeReply = calls.scripts.some((call) => call.func.name === "fillFormInPage");
    await handleCommand(Message.stop());
    delayed.resolve({ ok: true });
    await turn(); await turn();
    assert.equal(filledBeforeReply, true, `${slow} doldurmanın ilkin şərti olmamalıdır`);
  });
}

it("poçtu yenidən yoxlama ünvan və parolu dəyişdirmədən mövcud qutunu oxuyur", async () => {
  const session = liveSession({ password: "keep-this-password", username: "keep-user" });
  await writeSession(session);
  let signal;
  globalThis.fetch = (url, options) => {
    calls.fetch.push([url, options]);
    signal = options.signal;
    return new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
    });
  };
  await handleCommand({ type: "retryInbox" });
  await until(() => signal);
  assert.deepEqual(await readSession(), session);
  assert.equal(calls.fetch.length, 1);
  assert.match(String(calls.fetch[0][0]), /check/);
  assert.equal(store.inbox.address, session.address);
  await handleCommand(Message.stop());
  assert.equal(signal.aborted, true);
});

it("poçtu yenidən yoxlama aktiv ünvan tələb edir", async () => {
  await assert.rejects(handleCommand({ type: "retryInbox" }), /aktiv.*ünvan/);
  await writeSession(liveSession({ address: null }));
  await assert.rejects(handleCommand({ type: "retryInbox" }), /aktiv.*ünvan/);
  assert.deepEqual(calls.fetch, []);
});

it("clipboard bağlı olsa belə yaradılmış ünvan itmir", async () => {
  const session = liveSession({ windowId: null });
  await writeSession(session);
  chrome.offscreen.hasDocument = async () => { throw new Error("clipboard unavailable"); };
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ email: "kept@gmail.com" }) });
  assert.equal(await acquireAddress(session), "kept@gmail.com");
});

it("yararsız email cavabı formaya ötürülmür", async () => {
  const session = liveSession();
  await writeSession(session);
  for (const email of ["@", "a@@b.com", "user name@example.com", "a@b.com\nBcc:other@example.com"]) {
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ email }) });
    await assert.rejects(acquireAddress(session), /etibarlı ünvan/);
  }
  assert.deepEqual(calls.copies, []);
});

it("eyni məktubun gec gələn gövdəsi növbəti yoxlamada oxunur", async () => {
  const session = liveSession();
  await writeSession(session);
  let polls = 0;
  globalThis.fetch = (_url, { signal }) => {
    polls++;
    if (polls > 2) return new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
    });
    return Promise.resolve({ ok: true, json: async () => ({ data: [{ id: "same-id", from: "verify@example.com",
      subject: "Verification", body: polls === 1 ? "Your message is loading" : "Your verification code: 483920" }] }) });
  };
  const watching = watchInbox(session, session.address);
  await until(() => store.inbox?.phase === "found" || polls > 2);
  const code = store.inbox?.code;
  await handleCommand(Message.stop());
  await watching;
  assert.equal(code, "483920");
});

it("ünvan yaradılmamışdan əvvəlki kod yeni qeydiyyata yazılmır", async () => {
  const session = liveSession({ addressSince: Date.now() });
  await writeSession(session);
  let polls = 0;
  globalThis.fetch = (_url, { signal }) => {
    if (++polls > 1) return new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
    });
    return Promise.resolve({ ok: true, json: async () => ({ data: [{ id: "expired", from: "verify@example.com",
      date: new Date(session.addressSince - 3600000).toISOString(), subject: "Verification code", body: "Your code: 483920" }] }) });
  };
  const watching = watchInbox(session, session.address);
  await until(() => store.inbox?.phase === "found" || polls > 1);
  const phase = store.inbox?.phase;
  await handleCommand(Message.stop());
  await watching;
  assert.notEqual(phase, "found");
  assert.deepEqual(calls.copies, []);
});
