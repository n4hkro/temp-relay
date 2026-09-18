import { afterEach, describe, expect, it } from "vitest";

import { proxyKey } from "../src/shared/proxy";
import type { ProxyEntry } from "../src/shared/proxy";
import * as proxy from "../src/background/proxy";

const A: ProxyEntry = { scheme: "http", host: "198.51.100.10", port: 8080, username: "alice", password: "a-secret" };
const B: ProxyEntry = { scheme: "https", host: "203.0.113.20", port: 8443, username: "bob", password: "b-secret" };

const previous = { chrome: (globalThis as any).chrome, fetch: (globalThis as any).fetch };

afterEach(() => {
  if (previous.chrome === undefined) delete (globalThis as any).chrome;
  else (globalThis as any).chrome = previous.chrome;
  if (previous.fetch === undefined) delete (globalThis as any).fetch;
  else (globalThis as any).fetch = previous.fetch;
});

function deferred() : any {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

async function eventually(predicate: any, message: any) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) return;
    await tick();
  }
  throw new Error(message);
}

function effectiveDetails(applied: any, level = "controlled_by_this_extension") : any {
  return {
    value: applied ?? { mode: "system" },
    levelOfControl: applied ? level : "controllable_by_this_extension",
  };
}

function installChrome({ proxies = [A, B], active = null, applied = null,
  setMode = "apply", setLevel = "controlled_by_this_extension" }: any = {}) : any {
  const local: any = { proxies: { list: structuredClone(proxies), updated: 1 } };
  if (active) local.activeProxy = structuredClone(active);
  const calls: any = { set: [], clear: 0, status: [], fetch: [] };
  let browserValue = applied ? structuredClone(applied) : null;

  (globalThis as any).chrome = {
    storage: {
      local: {
        get: async (key: any) : Promise<any> => ({ [key]: structuredClone(local[key]) }),
        set: async (patch: any) => Object.assign(local, structuredClone(patch)),
        remove: async (key: any) => { delete local[key]; },
      },
      session: {
        get: async () : Promise<any> => ({}),
        set: async (patch: any) => { if (patch.status) calls.status.push(structuredClone(patch.status)); },
        remove: async () => {},
      },
    },
    proxy: {
      settings: {
        set: async (options: any) => {
          calls.set.push(structuredClone(options));
          if (setMode === "apply") browserValue = structuredClone(options.value);
        },
        clear: async () => { calls.clear += 1; browserValue = null; },
        get: async () => effectiveDetails(browserValue, setLevel),
      },
    },
  };

  (globalThis as any).fetch = (_url: any, options: any) => {
    const pending = deferred();
    calls.fetch.push({ ...pending, options });
    return pending.promise;
  };

  return { calls, local, browser: () => structuredClone(browserValue) };
}

const response = (ip: any) : any => ({ ok: true, text: async () => ip });
const failedResponse = (status = 502) : any => ({ ok: false, status, text: async () => "" });

async function auth(details: any) {
  return new Promise((resolve) => proxy.answerProxyAuth(details, resolve));
}

describe("proxy əmr sırası", () => {
  it("startup saxlancı oxuyarkən gələn qoşulma startup tərəfindən ləğv edilmir", async () => {
    const { calls, local } = installChrome({ active: { ...A, checked: 1 } });
    const resuming = proxy.resumeProxy();
    const connecting = proxy.connectProxy(proxyKey(B));
    await eventually(() => calls.fetch.length > 0, "istifadəçinin yoxlaması başlamadı");
    for (const call of calls.fetch) call.resolve(response("192.0.2.45"));
    await Promise.all([resuming, connecting]);
    expect(proxyKey(local.activeProxy)).toBe(proxyKey(B));
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
    expect(outcome, "ayrılma köhnə şəbəkə yoxlamasını gözləməməlidir").toBe("disconnected");
    expect(local.activeProxy).toBe(undefined);
    expect(browser()).toBe(null);

    calls.fetch[0].resolve(response("192.0.2.1"));
    await connecting;
    expect(local.activeProxy, "köhnə nəticə aktiv seçimi geri yazmamalıdır").toBe(undefined);
    expect(browser(), "köhnə nəticə brauzer parametrini geri qurmamalıdır").toBe(null);
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

    expect(proxyKey(local.activeProxy)).toBe(proxyKey(B));
    expect(browser().rules.singleProxy).toStrictEqual({ scheme: B.scheme, host: B.host, port: B.port });
    expect(local.proxies.list.find((item: any) => proxyKey(item) === proxyKey(A)).dead, "ləğv edilmiş A yoxlaması siyahını dəyişməməlidir").toBe(undefined);
  });

  it("startup bərpası yoxlanarkən ayrılma köhnə bərpa nəticəsini ləğv edir", async () => {
    const stale = { ...A, checked: 1 };
    const { calls, local, browser } = installChrome({ active: stale, proxies: [stale] });
    const resuming = proxy.resumeProxy();
    await eventually(() => calls.fetch.length === 1, "startup yoxlaması başlamadı");

    await proxy.disconnectProxy();
    calls.fetch[0].resolve(response("192.0.2.33"));
    await resuming;

    expect(local.activeProxy).toBe(undefined);
    expect(browser()).toBe(null);
  });

  it("paralel siyahı əlavələri bir-birinin qeydini itirmir", async () => {
    const { local } = installChrome({ proxies: [] });
    await Promise.all([
      proxy.addProxies("10.0.0.1:8001"),
      proxy.addProxies("10.0.0.2:8002"),
    ]);
    expect(new Set(local.proxies.list.map(proxyKey))).toStrictEqual(new Set([
      "http://10.0.0.1:8001",
      "http://10.0.0.2:8002",
    ]));
  });
});

describe("effektiv Chrome parametri", () => {
  it("yoxlama zamanı bizim parametr dəyişibsə yanlış proxy brauzerdə saxlanmır", async () => {
    const { calls, local, browser } = installChrome();
    const connecting = proxy.connectProxy(proxyKey(A));
    await eventually(() => calls.fetch.length === 1, "yoxlama başlamadı");
    await (globalThis as any).chrome.proxy.settings.set({ value: { mode: "fixed_servers", rules: { singleProxy: { scheme: B.scheme, host: B.host, port: B.port } } }, scope: "regular" });
    calls.fetch[0].resolve(response("192.0.2.45"));
    const result = await connecting;
    expect(result.exit.ok).toBe(false);
    expect(local.activeProxy).toBe(undefined);
    expect(browser()).toBe(null);
  });
  it("IP yoxlamasında HTML və ya təsadüfi mətn uğur sayılmır", async () => {
    installChrome();
    (globalThis as any).fetch = async () => response("<html>Sign in to network</html>");
    expect((await proxy.checkExit()).ok).toBe(false);
  });

  it("ləğv sorğunun gövdəsini gözləyərkən də işləyir", async () => {
    installChrome();
    const body = deferred();
    const started = deferred();
    (globalThis as any).fetch = async () : Promise<any> => ({ ok: true, text: () => { started.resolve!(); return body.promise; } });
    const controller = new AbortController();
    const checking = proxy.checkExit(controller.signal);
    await started.promise;
    controller.abort();
    const result: any = await Promise.race([checking, new Promise((resolve) => setTimeout(() => resolve("blocked"), 100))]);
    body.resolve!("192.0.2.9");
    await checking;
    expect(result.cancelled).toBe(true);
  });
  it("set dəyişiklik etməsə də əvvəlcədən eyni effektiv parametr qoşulmanı davam etdirir", async () => {
    const applied = { mode: "fixed_servers", rules: { singleProxy: { scheme: A.scheme, host: A.host, port: A.port } } };
    const { calls, local } = installChrome({ applied, setMode: "unchanged" });
    const connecting = proxy.connectProxy(proxyKey(A));
    await eventually(() => calls.fetch.length === 1, "eyni effektiv parametr qəbul edilmədi");
    calls.fetch[0].resolve(response("192.0.2.44"));
    await connecting;
    expect(proxyKey(local.activeProxy)).toBe(proxyKey(A));
  });

  it("Chrome başqa parametr saxlayırsa qoşulma uğurlu elan edilmir", async () => {
    const wrong = { mode: "fixed_servers", rules: { singleProxy: { scheme: B.scheme, host: B.host, port: B.port } } };
    const { calls, local } = installChrome({ applied: wrong, setMode: "unchanged" });
    await expect(() => proxy.connectProxy(proxyKey(A))).rejects.toThrow(/Chrome|parametr|idarə/i);
    expect(calls.fetch.length, "yanlış effektiv parametr üzərindən şəbəkə yoxlanmamalıdır").toBe(0);
    expect(local.activeProxy).toBe(undefined);
  });

  it("parametr başqa extension tərəfindən idarə olunursa qoşulma rədd olunur", async () => {
    const applied = { mode: "fixed_servers", rules: { singleProxy: { scheme: A.scheme, host: A.host, port: A.port } } };
    const { calls } = installChrome({ applied, setMode: "unchanged", setLevel: "controlled_by_other_extensions" });
    await expect(() => proxy.connectProxy(proxyKey(A))).rejects.toThrow(/Chrome|idarə/i);
    expect(calls.fetch.length).toBe(0);
  });
});

describe("proxy autentifikasiya sərhədi", () => {
  const challenge = (overrides = {}) : any => ({
    isProxy: true,
    requestId: "request-1",
    challenger: { host: A.host, port: A.port },
    ...overrides,
  });

  it("sayt autentifikasiyasına və çatışmayan/mismatched challenger-ə giriş məlumatı vermir", async () => {
    installChrome({ active: A, applied: { mode: "fixed_servers", rules: { singleProxy: { scheme: A.scheme, host: A.host, port: A.port } } } });
    expect(await auth({ isProxy: false, requestId: "site" })).toStrictEqual({});
    expect(await auth({ isProxy: true, requestId: "missing" })).toStrictEqual({});
    expect(await auth(challenge({ requestId: "wrong-host", challenger: { host: B.host, port: A.port } }))).toStrictEqual({});
    expect(await auth(challenge({ requestId: "wrong-port", challenger: { host: A.host, port: 9999 } }))).toStrictEqual({});
  });

  it("effektiv parametr seçilmiş proxy deyil və ya bizə aid deyilirsə giriş məlumatı vermir", async () => {
    const wrong = { mode: "fixed_servers", rules: { singleProxy: { scheme: B.scheme, host: B.host, port: B.port } } };
    installChrome({ active: A, applied: wrong });
    expect(await auth(challenge({ requestId: "wrong-effective" }))).toStrictEqual({});

    installChrome({ active: A, applied: { mode: "fixed_servers", rules: { singleProxy: { scheme: A.scheme, host: A.host, port: A.port } } },
      setLevel: "controlled_by_other_extensions" });
    expect(await auth(challenge({ requestId: "not-ours" }))).toStrictEqual({});
  });

  it("uyğun proxy challenge üçün seçilmiş HTTP giriş məlumatını qaytarır", async () => {
    installChrome({ active: A, applied: { mode: "fixed_servers", rules: { singleProxy: { scheme: A.scheme, host: A.host, port: A.port } } } });
    expect(await auth(challenge({ requestId: "valid" }))).toStrictEqual({
      authCredentials: { username: A.username, password: A.password },
    });
  });

  it("eyni uğursuz challenge üçün cəhd sayı məhduddur", async () => {
    installChrome({ active: A, applied: { mode: "fixed_servers", rules: { singleProxy: { scheme: A.scheme, host: A.host, port: A.port } } } });
    expect(((await auth(challenge({ requestId: "loop" }))) as any).authCredentials).toBeTruthy();
    expect(((await auth(challenge({ requestId: "loop" }))) as any).authCredentials).toBeTruthy();
    expect(await auth(challenge({ requestId: "loop" }))).toStrictEqual({});
  });
});
