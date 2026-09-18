import assert from "node:assert/strict";
import { it } from "node:test";
import { openSignup, openSignupInPage } from "../src/background/forms.js";
import { waitForDocument } from "../src/background/tabs.js";

// Chrome's complete event includes unrelated iframes/images. A new interactive
// document can already contain a working registration form while those are pending.
async function pageTransition(run, { navigate = false } = {}) {
  const previous = globalThis.chrome;
  const listeners = new Set();
  const session = { id: "latency", relayTabId: 7, relaySite: "https://example.com" };
  let state = { documentId: "old", readyState: "complete", url: "https://example.com/" };
  let opens = 0;
  let release;
  const suspended = new Promise((resolve) => { release = resolve; });
  const emit = (info, id = 7) => { for (const fn of listeners) fn(id, info); };
  const commit = (readyState = "interactive") => {
    state = { documentId: "new", readyState, url: "https://example.com/register" };
    emit({ status: "loading", url: state.url });
  };
  globalThis.chrome = {
    storage: { session: { get: async () => ({ session }) } },
    runtime: { getPlatformInfo: async () => ({}) },
    tabs: {
      get: async () => ({ id: 7, url: state.url, status: state.documentId === "old" ? "complete" : "loading" }),
      update: async () => { commit(); return { id: 7, url: state.url, status: "loading" }; },
      onUpdated: { addListener: (fn) => listeners.add(fn), removeListener: (fn) => listeners.delete(fn) },
    },
    scripting: { executeScript: async ({ func, injectImmediately }) => {
      if (func === openSignupInPage) {
        opens++;
        if (opens === 1 && navigate) return [{ documentId: "old", result: { navigate: "https://example.com/register" } }];
        if (opens === 1) return suspended;
        return [{ documentId: state.documentId, result: { already: true } }];
      }
      assert.equal(injectImmediately, true, "readiness probe must not wait for load");
      return [{ documentId: state.documentId, frameId: 0, result: { url: state.url, readyState: state.readyState } }];
    } },
  };
  try { await run({ session, commit, emit, state: () => state, listeners, opens: () => opens }); }
  finally {
    emit({ status: "complete" });
    release([{ documentId: state.documentId, result: { already: true } }]);
    await new Promise(setImmediate);
    globalThis.chrome = previous;
  }
}

const within = async (promise, ms = 700) => {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("hazır forma bütün səhifənin complete hadisəsini gözləyir")), ms);
    })]);
  } finally { clearTimeout(timer); }
};

it("yeni DOM hazırdırsa yavaş iframe doldurmaya keçidi saxlamır", () => pageTransition(async ({ session, commit, opens, listeners }) => {
  const running = openSignup(session, { timeoutMs: 1000, graceMs: 20 });
  while (!opens()) await new Promise(setImmediate);
  commit();
  const result = await within(running);
  assert.equal(result.navigated, true);
  assert.equal(listeners.size, 0);
}));

it("birbaşa signup naviqasiyası da interactive DOM-la davam edir", () => pageTransition(async ({ session }) => {
  const result = await within(openSignup(session));
  assert.equal(result.navigatedTo, "https://example.com/register");
  assert.equal(result.ready, true);
}, { navigate: true }));

it("köhnə sənəd və yad tab hadisəsi yeni DOM kimi qəbul edilmir", () => pageTransition(async ({ session, commit, emit, opens }) => {
  let finished = false;
  const running = openSignup(session, { timeoutMs: 1000, graceMs: 20 }).then((value) => { finished = true; return value; });
  while (!opens()) await new Promise(setImmediate);
  emit({ status: "loading" }, 99);
  emit({ status: "complete" }, 99);
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(finished, false);
  commit("loading");
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(finished, false, "yeni sənəd hələ parse olunur");
  commit("interactive");
  assert.equal((await within(running)).navigated, true);
}));

it("ləğv edilən DOM gözləməsi dinləyicini və təkrar yoxlamaları dayandırır", () => pageTransition(async ({ session, listeners, commit }) => {
  const controller = new AbortController();
  const waiting = waitForDocument(session.relayTabId, { previousDocumentId: "old", signal: controller.signal });
  controller.abort();
  assert.equal(await waiting, null);
  assert.equal(listeners.size, 0);
  commit();
  assert.equal(listeners.size, 0, "gec hadisə izləməni qaytarmır");
}));

it("document probe cavab verməsə də gözləmə vaxtı məhduddur", () => pageTransition(async ({ session, listeners }) => {
  chrome.scripting.executeScript = () => new Promise(() => {});
  const result = await within(waitForDocument(session.relayTabId, { previousDocumentId: "old", timeoutMs: 30 }));
  assert.equal(result, null);
  assert.equal(listeners.size, 0);
}));
