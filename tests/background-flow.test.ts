import { afterEach, beforeEach, expect, it } from "vitest";
import { handleCommand } from "../src/background/orchestrator";
import { acquireAddress } from "../src/background/address";
import { stopWatching, watchInbox } from "../src/background/inbox";
import { Message } from "../src/shared/messages";
import { readSession, writeSession } from "../src/shared/state";

const deferred = () : any => {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
};
const turn = () => new Promise((resolve) => setImmediate(resolve));
async function until(check: any) {
  for (let i = 0; i < 100; i++) { if (check()) return; await turn(); }
  throw new Error("operation did not reach its expected boundary");
}
let store: any, calls: any, originalFetch: any;
beforeEach(() => {
  store = {};
  calls = { fetch: [], copies: [], scripts: [], badges: [], notifications: [] };
  originalFetch = (globalThis as any).fetch;
  (globalThis as any).chrome = {
    storage: { session: {
      get: async (key: any) : Promise<any> => ({ [key]: structuredClone(store[key]) }),
      set: async (patch: any) => { Object.assign(store, structuredClone(patch)); },
      remove: async (key: any) => { delete store[key]; },
    } },
    action: {
      setBadgeText: async (value: any) => { calls.badges.push(value.text); },
      setBadgeBackgroundColor: async () => {}, setTitle: async () => {},
    },
    runtime: {
      getPlatformInfo: async () : Promise<any> => ({}), getURL: (path: any) => path,
      sendMessage: async (message: any) : Promise<any> => { calls.copies.push(message.text); return { ok: true }; },
    },
    offscreen: { hasDocument: async () => true },
    notifications: { create: async (value: any) => { calls.notifications.push(value); } },
    tabs: { get: async (id: any) : Promise<any> => ({ id, windowId: 1, url: "https://example.com/signup", status: "complete" }) },
    scripting: { executeScript: async (args: any) => { calls.scripts.push(args); return [{ result: { already: true } }]; } },
  };
  (globalThis as any).fetch = async (...args: any[]) : Promise<any> => { calls.fetch.push(args); throw new Error("unexpected network request"); };
});
afterEach(async () => {
  await handleCommand(Message.stop());
  await turn();
  (globalThis as any).fetch = originalFetch;
});
const liveSession = (extra = {}) : any => ({
  id: "session-1", started: 100, relayId: "active-tab", relaySite: "https://example.com",
  relayTabId: 7, windowId: 1, tempId: "temp.tf", address: "new@gmail.com", ...extra,
});

it("Dayandır tabın oxunuşunu gözləyən Başlat-ı ləğv edir", async () => {
  const tab = deferred();
  let reading = false;
  (globalThis as any).chrome.tabs.get = () => { reading = true; return tab.promise; };
  await handleCommand(Message.start("temp.tf", "active-tab", undefined, 7));
  await until(() => reading);
  await handleCommand(Message.stop());
  tab.resolve!({ id: 7, windowId: 1, url: "https://example.com/signup" });
  await turn(); await turn();
  expect(await readSession()).toBe(null);
  expect(calls.fetch.length).toBe(0);
});

it("köhnə sessiyanın gec poçt cavabı yeni sessiyanın koduna çevrilmir", async () => {
  const response = deferred();
  const session = liveSession();
  await writeSession(session);
  (globalThis as any).fetch = (...args: any[]) => { calls.fetch.push(args); return response.promise; };
  const watching = watchInbox(session, session.address);
  await until(() => calls.fetch.length > 0);
  await writeSession(liveSession({ id: "session-2", started: 200 }));
  response.resolve!({ ok: true, json: async () : Promise<any> => ({ data: [{
    id: "old-code", from: "verify@example.com", subject: "Verification code",
    body: "Your verification code is 123456", date: new Date().toISOString(),
  }] }) });
  await watching;
  expect(store.inbox?.phase).not.toBe("found");
  expect(calls.copies).toStrictEqual([]);
  expect(calls.notifications).toStrictEqual([]);
});

it("Dayandır tamamlandıqdan sonra başlayan köhnə izləmə inbox-u qaytarmır", async () => {
  const session = liveSession();
  await writeSession(session);
  await handleCommand(Message.stop());
  await watchInbox(session, session.address);
  expect(store.inbox).toBe(undefined);
  expect(calls.fetch).toStrictEqual([]);
});

it("Dayandır ünvan sorğusunu dərhal abort edir", async () => {
  let signal: any;
  (globalThis as any).fetch = (_url: any, options: any) => {
    signal = options.signal;
    return new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
    });
  };
  await handleCommand(Message.start("temp.tf", "active-tab", undefined, 7));
  await until(() => signal);
  await handleCommand(Message.stop());
  expect(signal.aborted).toBe(true);
  await turn();
  expect(await readSession()).toBe(null);
  expect(store.status.text).toMatch(/Dayandırıldı/);
});

it("ünvan provayderi gecikəndə qeydiyyat formasının açılması onu gözləmir", async () => {
  const response = deferred();
  (globalThis as any).fetch = (...args: any[]) => { calls.fetch.push(args); return response.promise; };
  await handleCommand(Message.start("temp.tf", "active-tab", undefined, 7));
  await until(() => calls.fetch.length > 0);
  for (let i = 0; i < 15; i++) await turn();
  const openedWhileWaiting = calls.scripts.some((call: any) => call.func.name === "openSignupInPage");
  await handleCommand(Message.stop());
  response.resolve!({ ok: true, json: async () : Promise<any> => ({ email: "qa@gmail.com" }) });
  await turn(); await turn();
  expect(openedWhileWaiting, "müstəqil ünvan və forma axtarışı ardıcıl gözləməməlidir").toBe(true);
  expect(calls.scripts.some((call: any) => call.func.name === "fillFormInPage"), "Dayandır-dan sonra doldurulmur").toBe(false);
});

for (const slow of ["clipboard", "notification"]) {
  it(`${slow} cavabı geciksə də hazır forma dərhal doldurulur`, async () => {
    const delayed = deferred();
    let reached = false;
    if (slow === "clipboard") (globalThis as any).chrome.runtime.sendMessage = async () => { reached = true; return delayed.promise; };
    else (globalThis as any).chrome.notifications.create = async () => { reached = true; return delayed.promise; };
    (globalThis as any).chrome.scripting.executeScript = async (args: any) => {
      calls.scripts.push(args);
      return [{ result: args.func.name === "fillFormInPage"
        ? { done: true, filled: ["email", "password"] } : { already: true } }];
    };
    (globalThis as any).fetch = async (_url: any, { signal }: any) => String(_url).includes("/check")
      ? new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true }))
      : { ok: true, json: async () : Promise<any> => ({ email: "qa@gmail.com" }) };
    await handleCommand(Message.start("temp.tf", "active-tab", undefined, 7));
    await until(() => reached);
    for (let i = 0; i < 30; i++) await turn();
    const filledBeforeReply = calls.scripts.some((call: any) => call.func.name === "fillFormInPage");
    await handleCommand(Message.stop());
    delayed.resolve!({ ok: true });
    await turn(); await turn();
    expect(filledBeforeReply, `${slow} doldurmanın ilkin şərti olmamalıdır`).toBe(true);
  });
}

it("poçtu yenidən yoxlama ünvan və parolu dəyişdirmədən mövcud qutunu oxuyur", async () => {
  const session = liveSession({ password: "keep-this-password", username: "keep-user" });
  await writeSession(session);
  let signal: any;
  (globalThis as any).fetch = (url: any, options: any) => {
    calls.fetch.push([url, options]);
    signal = options.signal;
    return new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
    });
  };
  await handleCommand({ type: "retryInbox" });
  await until(() => signal);
  expect(await readSession()).toStrictEqual(session);
  expect(calls.fetch.length).toBe(1);
  expect(String(calls.fetch[0][0])).toMatch(/check/);
  expect(store.inbox.address).toBe(session.address);
  await handleCommand(Message.stop());
  expect(signal.aborted).toBe(true);
});

it("poçtu yenidən yoxlama aktiv ünvan tələb edir", async () => {
  await expect(handleCommand({ type: "retryInbox" })).rejects.toThrow(/aktiv.*ünvan/);
  await writeSession(liveSession({ address: null }));
  await expect(handleCommand({ type: "retryInbox" })).rejects.toThrow(/aktiv.*ünvan/);
  expect(calls.fetch).toStrictEqual([]);
});

it("clipboard bağlı olsa belə yaradılmış ünvan itmir", async () => {
  const session = liveSession({ windowId: null });
  await writeSession(session);
  (globalThis as any).chrome.offscreen.hasDocument = async () : Promise<any> => { throw new Error("clipboard unavailable"); };
  (globalThis as any).fetch = async () : Promise<any> => ({ ok: true, json: async () : Promise<any> => ({ email: "kept@gmail.com" }) });
  expect(await acquireAddress(session)).toBe("kept@gmail.com");
});

it("yararsız email cavabı formaya ötürülmür", async () => {
  const session = liveSession();
  await writeSession(session);
  for (const email of ["@", "a@@b.com", "user name@example.com", "a@b.com\nBcc:other@example.com"]) {
    (globalThis as any).fetch = async () : Promise<any> => ({ ok: true, json: async () : Promise<any> => ({ email }) });
    await expect(acquireAddress(session)).rejects.toThrow(/etibarlı ünvan/);
  }
  expect(calls.copies).toStrictEqual([]);
});

it("eyni məktubun gec gələn gövdəsi növbəti yoxlamada oxunur", async () => {
  const session = liveSession();
  await writeSession(session);
  let polls = 0;
  (globalThis as any).fetch = (_url: any, { signal }: any) => {
    polls++;
    if (polls > 2) return new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
    });
    return Promise.resolve({ ok: true, json: async () : Promise<any> => ({ data: [{ id: "same-id", from: "verify@example.com",
      subject: "Verification", body: polls === 1 ? "Your message is loading" : "Your verification code: 483920" }] }) });
  };
  const watching = watchInbox(session, session.address);
  await until(() => store.inbox?.phase === "found" || polls > 2);
  const code = store.inbox?.code;
  await handleCommand(Message.stop());
  await watching;
  expect(code).toBe("483920");
});

it("ünvan yaradılmamışdan əvvəlki kod yeni qeydiyyata yazılmır", async () => {
  const session = liveSession({ addressSince: Date.now() });
  await writeSession(session);
  let polls = 0;
  (globalThis as any).fetch = (_url: any, { signal }: any) => {
    if (++polls > 1) return new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
    });
    return Promise.resolve({ ok: true, json: async () : Promise<any> => ({ data: [{ id: "expired", from: "verify@example.com",
      date: new Date(session.addressSince - 3600000).toISOString(), subject: "Verification code", body: "Your code: 483920" }] }) });
  };
  const watching = watchInbox(session, session.address);
  await until(() => store.inbox?.phase === "found" || polls > 1);
  const phase = store.inbox?.phase;
  await handleCommand(Message.stop());
  await watching;
  expect(phase).not.toBe("found");
  expect(calls.copies).toStrictEqual([]);
});
