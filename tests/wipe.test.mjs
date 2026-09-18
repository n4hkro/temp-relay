// Tək kliklə silmənin ikinci mərhələsi: istifadəçi host icazəsini verəndə silmə TAM
// şəkildə təkrarlanır (partitioned cookie + sessionStorage).
//
// Niyə vacibdir: icazə pəncərəsi popup-ı bağlayır, ona görə bu işi worker tamamlayır
// (background.js → chrome.permissions.onAdded → orchestrator.onPermissionsGranted).
// Səhv şərt ya silməni buraxardı, ya da istifadəçinin gözləmədiyi sayta toxunardı.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { onPermissionsGranted } from "../src/background/orchestrator.js";
import { clearPageStorage } from "../src/background/cleanup.js";
import { originPattern } from "../src/shared/permissions.js";

// chrome stub-ı: saxlanc həqiqi obyektdə saxlanılır, qalan API-lər çağırışları yazır
function withChrome({ pending, tabUrl = "https://example.com/page", granted = true } = {}) {
  const previous = globalThis.chrome;
  const store = pending === undefined ? {} : { pendingWipe: pending };
  const calls = { browsingData: [], removedCookies: [], reloads: [], scripts: [] };
  globalThis.chrome = {
    storage: {
      session: {
        get: async (key) => (key in store ? { [key]: store[key] } : {}),
        set: async (patch) => { Object.assign(store, patch); },
        remove: async (key) => { delete store[key]; },
      },
    },
    permissions: { contains: async () => granted },
    cookies: {
      getAll: async (filter) => (filter.domain ? [{ domain: filter.domain, name: "a", path: "/", storeId: "0", secure: true }] : []),
      remove: async (details) => { calls.removedCookies.push(details.name); return true; },
    },
    browsingData: { remove: async (options, types) => { calls.browsingData.push({ options, types }); } },
    tabs: {
      get: async () => {
        if (tabUrl === null) throw new Error("No tab with id");
        return { id: 7, url: tabUrl };
      },
      reload: async (tabId) => { calls.reloads.push(tabId); },
    },
    scripting: { executeScript: async () => { calls.scripts.push(1); return [{ result: 2 }]; } },
  };
  const restore = () => { if (previous === undefined) delete globalThis.chrome; else globalThis.chrome = previous; };
  return { calls, store, restore };
}

const granted = (domain) => ({ origins: [originPattern(domain)] });

it("geniş icazə olsa da əlaqəsiz iframe-in saxlancı silinmir", async () => {
  const env = withChrome();
  const prior = { location: globalThis.location, sessionStorage: globalThis.sessionStorage, localStorage: globalThis.localStorage };
  let cleared = 0;
  globalThis.location = { origin: "https://unrelated.example" };
  globalThis.sessionStorage = globalThis.localStorage = { length: 2, clear: () => { cleared++; } };
  chrome.scripting.executeScript = async ({ func, args = [] }) => [{ result: func(...args) }];
  try {
    await clearPageStorage(7, ["https://example.com"]);
    assert.equal(cleared, 0);
    globalThis.location.origin = "https://example.com";
    assert.equal(await clearPageStorage(7, ["https://example.com"]), 4);
    assert.equal(cleared, 2);
  } finally {
    for (const [key, value] of Object.entries(prior)) {
      if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
    }
    env.restore();
  }
});

describe("onPermissionsGranted", () => {
  it("gözləyən silmə yoxdursa heç nə silinmir", async () => {
    const env = withChrome({ pending: undefined });
    try {
      await onPermissionsGranted(granted("example.com"));
      assert.deepEqual(env.calls.browsingData, []);
    } finally { env.restore(); }
  });

  it("icazə BAŞQA sayta verilibsə gözləyən silmə toxunulmur", async () => {
    const env = withChrome({ pending: { domain: "example.com", tabId: 7 } });
    try {
      await onPermissionsGranted(granted("other.com"));
      assert.deepEqual(env.calls.browsingData, []);
      assert.ok(env.store.pendingWipe, "gözləmə silinməməli idi");
    } finally { env.restore(); }
  });

  it("origins boş və ya yoxdursa heç nə edilmir", async () => {
    for (const permissions of [{}, { origins: [] }, null]) {
      const env = withChrome({ pending: { domain: "example.com", tabId: 7 } });
      try {
        await onPermissionsGranted(permissions);
        assert.deepEqual(env.calls.browsingData, []);
      } finally { env.restore(); }
    }
  });

  it("uyğun icazədən sonra silmə təkrarlanır və gözləmə silinir", async () => {
    const env = withChrome({ pending: { domain: "example.com", tabId: 7 } });
    try {
      await onPermissionsGranted(granted("example.com"));
      assert.equal(env.calls.browsingData.length, 1);
      assert.deepEqual(env.calls.browsingData[0].options.origins, ["https://example.com", "https://www.example.com"]);
      assert.equal(env.calls.browsingData[0].types.cookies, true);
      assert.equal(env.store.pendingWipe, undefined, "gözləmə silinməli idi");
    } finally { env.restore(); }
  });

  it("icazə verildiyi üçün cookie-lər sadalanır və səhifə saxlancı da təmizlənir", async () => {
    const env = withChrome({ pending: { domain: "example.com", tabId: 7 } });
    try {
      await onPermissionsGranted(granted("example.com"));
      assert.deepEqual(env.calls.removedCookies, ["a"]);
      assert.equal(env.calls.scripts.length, 1, "sessionStorage səhifədə təmizlənməli idi");
      assert.deepEqual(env.calls.reloads, [7]);
    } finally { env.restore(); }
  });

  it("tab bağlanıbsa silmə yenə aparılır (tab olmadan, yenilənmə yoxdur)", async () => {
    const env = withChrome({ pending: { domain: "example.com", tabId: 7 }, tabUrl: null });
    try {
      await onPermissionsGranted(granted("example.com"));
      assert.equal(env.calls.browsingData.length, 1);
      assert.deepEqual(env.calls.reloads, []);
      assert.deepEqual(env.calls.scripts, []);
    } finally { env.restore(); }
  });

  it("tab bu arada başqa sayta gedibsə onun məlumatına toxunulmur (yalnız domen üzrə silinir)", async () => {
    const env = withChrome({ pending: { domain: "example.com", tabId: 7 }, tabUrl: "https://other.com/" });
    try {
      await onPermissionsGranted(granted("example.com"));
      assert.deepEqual(env.calls.browsingData[0].options.origins, ["https://example.com", "https://www.example.com"]);
      assert.deepEqual(env.calls.reloads, [], "başqa sayta getmiş tab yenilənməməlidir");
    } finally { env.restore(); }
  });

  it("status yazılır — istifadəçi nəyin silindiyini görür", async () => {
    const env = withChrome({ pending: { domain: "example.com", tabId: 7 } });
    try {
      await onPermissionsGranted(granted("example.com"));
      assert.match(env.store.status?.text ?? "", /example\.com: 1 əlçatan cookie \(partitioned daxil\)/);    } finally { env.restore(); }
  });

  // Microsoft hesabı bir neçə AYRI domendə saxlanılır: yalnız tabın domenini silmək
  // kifayət etmirdi (Foundry qeydiyyatı hər dəfə köhnə hesaba qayıdırdı).
  it("Microsoft silinəndə ailənin login domenləri də browsingData-ya gedir", async () => {
    const env = withChrome({ pending: { domain: "microsoftonline.com", tabId: 7 }, tabUrl: "https://login.microsoftonline.com/" });
    try {
      await onPermissionsGranted(granted("microsoftonline.com"));
      const origins = env.calls.browsingData[0].options.origins;
      for (const origin of ["https://login.microsoftonline.com", "https://login.live.com",
        "https://live.com", "https://account.microsoft.com"]) {
        assert.ok(origins.includes(origin), origin);
      }
      // cookie-lər ailənin hər domeni üzrə də sadalanır
      assert.ok(env.calls.removedCookies.length > 1, "yalnız bir domen silinib");
      assert.match(env.store.status?.text ?? "", /Microsoft hesabı: \d+ əlaqəli domen/);
    } finally { env.restore(); }
  });
});
