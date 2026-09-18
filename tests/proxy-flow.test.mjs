import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { proxyKey } from "../src/shared/proxy.js";
import * as proxy from "../src/background/proxy.js";

const A = { scheme: "http", host: "198.51.100.10", port: 8080, username: "alice", password: "a-secret" };
const B = { scheme: "https", host: "203.0.113.20", port: 8443, username: "bob", password: "b-secret" };

const previous = { chrome: globalThis.chrome, fetch: globalThis.fetch };

afterEach(() => {
  if (previous.chrome === undefined) delete globalThis.chrome;
  else globalThis.chrome = previous.chrome;
  if (previous.fetch === undefined) delete globalThis.fetch;
  else globalThis.fetch = previous.fetch;
});

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

async function eventually(predicate, message) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) return;
    await tick();
  }
  assert.fail(message);
}

function effectiveDetails(applied, level = "controlled_by_this_extension") {
  return {
    value: applied ?? { mode: "system" },
    levelOfControl: applied ? level : "controllable_by_this_extension",
  };
}

function installChrome({ proxies = [A, B], active = null, applied = null,
  setMode = "apply", setLevel = "controlled_by_this_extension" } = {}) {
  const local = { proxies: { list: structuredClone(proxies), updated: 1 } };
  if (active) local.activeProxy = structuredClone(active);
  const calls = { set: [], clear: 0, status: [], fetch: [] };
  let browserValue = applied ? structuredClone(applied) : null;

  globalThis.chrome = {
    storage: {
      local: {
        get: async (key) => ({ [key]: structuredClone(local[key]) }),
        set: async (patch) => Object.assign(local, structuredClone(patch)),
        remove: async (key) => { delete local[key]; },
      },
      session: {
        get: async () => ({}),
        set: async (patch) => { if (patch.status) calls.status.push(structuredClone(patch.status)); },
        remove: async () => {},
      },
    },
    proxy: {
      settings: {
        set: async (options) => {
          calls.set.push(structuredClone(options));
          if (setMode === "apply") browserValue = structuredClone(options.value);
        },
        clear: async () => { calls.clear += 1; browserValue = null; },
        get: async () => effectiveDetails(browserValue, setLevel),
      },
    },
  };

  globalThis.fetch = (_url, options) => {
    const pending = deferred();
    calls.fetch.push({ ...pending, options });
    return pending.promise;
  };

  return { calls, local, browser: () => structuredClone(browserValue) };
}

const response = (ip) => ({ ok: true, text: async () => ip });
const failedResponse = (status = 502) => ({ ok: false, status, text: async () => "" });

async function auth(details) {
  return new Promise((resolve) => proxy.answerProxyAuth(details, resolve));
}

describe("proxy əmr sırası", { concurrency: false }, () => {
  it("startup saxlancı oxuyarkən gələn qoşulma startup tərəfindən ləğv edilmir", async () => {
    const { calls, local } = installChrome({ active: { ...A, checked: 1 } });
    const resuming = proxy.resumeProxy();
    const connecting = proxy.connectProxy(proxyKey(B));
    await eventually(() => calls.fetch.length > 0, "istifadəçinin yoxlaması başlamadı");
    for (const call of calls.fetch) call.resolve(response("192.0.2.45"));
    await Promise.all([resuming, connecting]);
    assert.equal(proxyKey(local.activeProxy), proxyKey(B));
  });
  it("qoşulma yoxlanarkən ayrılma dərhal tamamlanır və köhnə nəticə proxy-ni diriltmir", async () => {
    const { calls, local, browser } = installChrome();
    const connecting = proxy.connectProxy(proxyKey(A));
    await eventually(() => calls.fetch.length === 1, "qoşulma yoxlaması başlamadı");

    const disconnecting = proxy.disconnectProxy();
    const outcome = await Promise.race([
      disconnecting.then(() => "disconnected"),
      new Promise((resolve) => setTimeout(() => resolve("blocked"), 100)),
    ]);
    assert.equal(outcome, "disconnected", "ayrılma köhnə şəbəkə yoxlamasını gözləməməlidir");
    assert.equal(local.activeProxy, undefined);
    assert.equal(browser(), null);

    calls.fetch[0].resolve(response("192.0.2.1"));
    await connecting;
    assert.equal(local.activeProxy, undefined, "köhnə nəticə aktiv seçimi geri yazmamalıdır");
    assert.equal(browser(), null, "köhnə nəticə brauzer parametrini geri qurmamalıdır");
  });

  it("A-dan sonra B qoşulanda A-nın gecikmiş xətası B-ni silmir", async () => {
    const { calls, local, browser } = installChrome();
    const first = proxy.connectProxy(proxyKey(A));
    await eventually(() => calls.fetch.length === 1, "A yoxlaması başlamadı");
    const second = proxy.connectProxy(proxyKey(B));
    await eventually(() => calls.fetch.length === 2, "B yoxlaması başlamadı");

    calls.fetch[1].resolve(response("192.0.2.22"));
    await second;
    calls.fetch[0].resolve(failedResponse());
    await first;

    assert.equal(proxyKey(local.activeProxy), proxyKey(B));
    assert.deepEqual(browser().rules.singleProxy, { scheme: B.scheme, host: B.host, port: B.port });
    assert.equal(local.proxies.list.find((item) => proxyKey(item) === proxyKey(A)).dead, undefined,
      "ləğv edilmiş A yoxlaması siyahını dəyişməməlidir");
  });

  it("startup bərpası yoxlanarkən ayrılma köhnə bərpa nəticəsini ləğv edir", async () => {
    const stale = { ...A, checked: 1 };
    const { calls, local, browser } = installChrome({ active: stale, proxies: [stale] });
    const resuming = proxy.resumeProxy();
    await eventually(() => calls.fetch.length === 1, "startup yoxlaması başlamadı");

    await proxy.disconnectProxy();
    calls.fetch[0].resolve(response("192.0.2.33"));
    await resuming;

    assert.equal(local.activeProxy, undefined);
    assert.equal(browser(), null);
  });

  it("paralel siyahı əlavələri bir-birinin qeydini itirmir", async () => {
    const { local } = installChrome({ proxies: [] });
    await Promise.all([
      proxy.addProxies("10.0.0.1:8001"),
      proxy.addProxies("10.0.0.2:8002"),
    ]);
    assert.deepEqual(new Set(local.proxies.list.map(proxyKey)), new Set([
      "http://10.0.0.1:8001",
      "http://10.0.0.2:8002",
    ]));
  });
});

describe("effektiv Chrome parametri", { concurrency: false }, () => {
  it("yoxlama zamanı bizim parametr dəyişibsə yanlış proxy brauzerdə saxlanmır", async () => {
    const { calls, local, browser } = installChrome();
    const connecting = proxy.connectProxy(proxyKey(A));
    await eventually(() => calls.fetch.length === 1, "yoxlama başlamadı");
    await chrome.proxy.settings.set({ value: { mode: "fixed_servers", rules: { singleProxy: { scheme: B.scheme, host: B.host, port: B.port } } }, scope: "regular" });
    calls.fetch[0].resolve(response("192.0.2.45"));
    const result = await connecting;
    assert.equal(result.exit.ok, false);
    assert.equal(local.activeProxy, undefined);
    assert.equal(browser(), null);
  });
  it("IP yoxlamasında HTML və ya təsadüfi mətn uğur sayılmır", async () => {
    installChrome();
    globalThis.fetch = async () => response("<html>Sign in to network</html>");
    assert.equal((await proxy.checkExit()).ok, false);
  });

  it("ləğv sorğunun gövdəsini gözləyərkən də işləyir", async () => {
    installChrome();
    const body = deferred();
    const started = deferred();
    globalThis.fetch = async () => ({ ok: true, text: () => { started.resolve(); return body.promise; } });
    const controller = new AbortController();
    const checking = proxy.checkExit(controller.signal);
    await started.promise;
    controller.abort();
    const result = await Promise.race([checking, new Promise((resolve) => setTimeout(() => resolve("blocked"), 100))]);
    body.resolve("192.0.2.9");
    await checking;
    assert.equal(result.cancelled, true);
  });
  it("set dəyişiklik etməsə də əvvəlcədən eyni effektiv parametr qoşulmanı davam etdirir", async () => {
    const applied = { mode: "fixed_servers", rules: { singleProxy: { scheme: A.scheme, host: A.host, port: A.port } } };
    const { calls, local } = installChrome({ applied, setMode: "unchanged" });
    const connecting = proxy.connectProxy(proxyKey(A));
    await eventually(() => calls.fetch.length === 1, "eyni effektiv parametr qəbul edilmədi");
    calls.fetch[0].resolve(response("192.0.2.44"));
    await connecting;
    assert.equal(proxyKey(local.activeProxy), proxyKey(A));
  });

  it("Chrome başqa parametr saxlayırsa qoşulma uğurlu elan edilmir", async () => {
    const wrong = { mode: "fixed_servers", rules: { singleProxy: { scheme: B.scheme, host: B.host, port: B.port } } };
    const { calls, local } = installChrome({ applied: wrong, setMode: "unchanged" });
    await assert.rejects(() => proxy.connectProxy(proxyKey(A)), /Chrome|parametr|idarə/i);
    assert.equal(calls.fetch.length, 0, "yanlış effektiv parametr üzərindən şəbəkə yoxlanmamalıdır");
    assert.equal(local.activeProxy, undefined);
  });

  it("parametr başqa extension tərəfindən idarə olunursa qoşulma rədd olunur", async () => {
    const applied = { mode: "fixed_servers", rules: { singleProxy: { scheme: A.scheme, host: A.host, port: A.port } } };
    const { calls } = installChrome({ applied, setMode: "unchanged", setLevel: "controlled_by_other_extensions" });
    await assert.rejects(() => proxy.connectProxy(proxyKey(A)), /Chrome|idarə/i);
    assert.equal(calls.fetch.length, 0);
  });
});

describe("proxy autentifikasiya sərhədi", { concurrency: false }, () => {
  const challenge = (overrides = {}) => ({
    isProxy: true,
    requestId: "request-1",
    challenger: { host: A.host, port: A.port },
    ...overrides,
  });

  it("sayt autentifikasiyasına və çatışmayan/mismatched challenger-ə giriş məlumatı vermir", async () => {
    installChrome({ active: A, applied: { mode: "fixed_servers", rules: { singleProxy: { scheme: A.scheme, host: A.host, port: A.port } } } });
    assert.deepEqual(await auth({ isProxy: false, requestId: "site" }), {});
    assert.deepEqual(await auth({ isProxy: true, requestId: "missing" }), {});
    assert.deepEqual(await auth(challenge({ requestId: "wrong-host", challenger: { host: B.host, port: A.port } })), {});
    assert.deepEqual(await auth(challenge({ requestId: "wrong-port", challenger: { host: A.host, port: 9999 } })), {});
  });

  it("effektiv parametr seçilmiş proxy deyil və ya bizə aid deyilirsə giriş məlumatı vermir", async () => {
    const wrong = { mode: "fixed_servers", rules: { singleProxy: { scheme: B.scheme, host: B.host, port: B.port } } };
    installChrome({ active: A, applied: wrong });
    assert.deepEqual(await auth(challenge({ requestId: "wrong-effective" })), {});

    installChrome({ active: A, applied: { mode: "fixed_servers", rules: { singleProxy: { scheme: A.scheme, host: A.host, port: A.port } } },
      setLevel: "controlled_by_other_extensions" });
    assert.deepEqual(await auth(challenge({ requestId: "not-ours" })), {});
  });

  it("uyğun proxy challenge üçün seçilmiş HTTP giriş məlumatını qaytarır", async () => {
    installChrome({ active: A, applied: { mode: "fixed_servers", rules: { singleProxy: { scheme: A.scheme, host: A.host, port: A.port } } } });
    assert.deepEqual(await auth(challenge({ requestId: "valid" })), {
      authCredentials: { username: A.username, password: A.password },
    });
  });

  it("eyni uğursuz challenge üçün cəhd sayı məhduddur", async () => {
    installChrome({ active: A, applied: { mode: "fixed_servers", rules: { singleProxy: { scheme: A.scheme, host: A.host, port: A.port } } } });
    assert.ok((await auth(challenge({ requestId: "loop" }))).authCredentials);
    assert.ok((await auth(challenge({ requestId: "loop" }))).authCredentials);
    assert.deepEqual(await auth(challenge({ requestId: "loop" })), {});
  });
});
