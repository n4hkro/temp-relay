import { expect, it } from "vitest";
import { openSignup, openSignupInPage } from "../src/background/forms";
import { waitForDocument } from "../src/background/tabs";

// Chrome's complete event includes unrelated iframes/images. A new interactive
// document can already contain a working registration form while those are pending.
async function pageTransition(run: any, { navigate = false }: any = {}) {
  const previous = (globalThis as any).chrome;
  const listeners = new Set<any>();
  const session = { id: "latency", relayTabId: 7, relaySite: "https://example.com" };
  let state = { documentId: "old", readyState: "complete", url: "https://example.com/" };
  let opens = 0;
  let release;
  const suspended = new Promise((resolve) => { release = resolve; });
  const emit = (info: any, id = 7) => { for (const fn of listeners) fn(id, info); };
  const commit = (readyState = "interactive") => {
    state = { documentId: "new", readyState, url: "https://example.com/register" };
    emit({ status: "loading", url: state.url });
  };
  (globalThis as any).chrome = {
    storage: { session: { get: async () : Promise<any> => ({ session }) } },
    runtime: { getPlatformInfo: async () : Promise<any> => ({}) },
    tabs: {
      get: async () : Promise<any> => ({ id: 7, url: state.url, status: state.documentId === "old" ? "complete" : "loading" }),
      update: async () : Promise<any> => { commit(); return { id: 7, url: state.url, status: "loading" }; },
      onUpdated: { addListener: (fn: any) => listeners.add(fn), removeListener: (fn: any) => listeners.delete(fn) },
    },
    scripting: { executeScript: async ({ func, injectImmediately }: any) => {
      if (func === openSignupInPage) {
        opens++;
        if (opens === 1 && navigate) return [{ documentId: "old", result: { navigate: "https://example.com/register" } }];
        if (opens === 1) return suspended;
        return [{ documentId: state.documentId, result: { already: true } }];
      }
      expect(injectImmediately, "readiness probe must not wait for load").toBe(true);
      return [{ documentId: state.documentId, frameId: 0, result: { url: state.url, readyState: state.readyState } }];
    } },
  };
  try { await run({ session, commit, emit, state: () => state, listeners, opens: () => opens }); }
  finally {
    emit({ status: "complete" });
    release!([{ documentId: state.documentId, result: { already: true } }]);
    await new Promise(setImmediate);
    (globalThis as any).chrome = previous;
  }
}

const within = async (promise: any, ms = 700) => {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("hazır forma bütün səhifənin complete hadisəsini gözləyir")), ms);
    })]);
  } finally { clearTimeout(timer); }
};

it("yeni DOM hazırdırsa yavaş iframe doldurmaya keçidi saxlamır", () => pageTransition(async ({ session, commit, opens, listeners }: any) => {
  const running = openSignup(session, { timeoutMs: 1000, graceMs: 20 });
  while (!opens()) await new Promise(setImmediate);
  commit();
  const result = await within(running);
  expect(result.navigated).toBe(true);
  expect(listeners.size).toBe(0);
}));

it("birbaşa signup naviqasiyası da interactive DOM-la davam edir", () => pageTransition(async ({ session }: any) => {
  const result = await within(openSignup(session));
  expect(result.navigatedTo).toBe("https://example.com/register");
  expect(result.ready).toBe(true);
}, { navigate: true }));

it("köhnə sənəd və yad tab hadisəsi yeni DOM kimi qəbul edilmir", () => pageTransition(async ({ session, commit, emit, opens }: any) => {
  let finished = false;
  const running = openSignup(session, { timeoutMs: 1000, graceMs: 20 }).then((value: any) => { finished = true; return value; });
  while (!opens()) await new Promise(setImmediate);
  emit({ status: "loading" }, 99);
  emit({ status: "complete" }, 99);
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(finished).toBe(false);
  commit("loading");
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(finished, "yeni sənəd hələ parse olunur").toBe(false);
  commit("interactive");
  expect((await within(running)).navigated).toBe(true);
}));

it("ləğv edilən DOM gözləməsi dinləyicini və təkrar yoxlamaları dayandırır", () => pageTransition(async ({ session, listeners, commit }: any) => {
  const controller = new AbortController();
  const waiting = waitForDocument(session.relayTabId, { previousDocumentId: "old", signal: controller.signal });
  controller.abort();
  expect(await waiting).toBe(null);
  expect(listeners.size).toBe(0);
  commit();
  expect(listeners.size, "gec hadisə izləməni qaytarmır").toBe(0);
}));

it("document probe cavab verməsə də gözləmə vaxtı məhduddur", () => pageTransition(async ({ session, listeners }: any) => {
  (globalThis as any).chrome.scripting.executeScript = () => new Promise(() => {});
  const result = await within(waitForDocument(session.relayTabId, { previousDocumentId: "old", timeoutMs: 30 }));
  expect(result).toBe(null);
  expect(listeners.size).toBe(0);
}));
