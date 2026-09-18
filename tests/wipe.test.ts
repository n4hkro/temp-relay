// Tək kliklə silmənin ikinci mərhələsi: istifadəçi host icazəsini verəndə silmə TAM
// şəkildə təkrarlanır (partitioned cookie + sessionStorage).
//
// Niyə vacibdir: icazə pəncərəsi popup-ı bağlayır, ona görə bu işi worker tamamlayır
// (background.ts → chrome.permissions.onAdded → orchestrator.onPermissionsGranted).
// Səhv şərt ya silməni buraxardı, ya da istifadəçinin gözləmədiyi sayta toxunardı.
import { describe, expect, it } from "vitest";

import { onPermissionsGranted } from "../src/background/orchestrator";
import { clearPageStorage } from "../src/background/cleanup";
import { originPattern } from "../src/shared/permissions";

// chrome stub-ı: saxlanc həqiqi obyektdə saxlanılır, qalan API-lər çağırışları yazır
function withChrome({ pending, tabUrl = "https://example.com/page", granted = true }: any = {}) : any {
  const previous = (globalThis as any).chrome;
  const store: Record<string, unknown> = pending === undefined ? {} : { pendingWipe: pending };
  const calls: any = { browsingData: [], removedCookies: [], reloads: [], scripts: [] };
  (globalThis as any).chrome = {
    storage: {
      session: {
        get: async (key: string) => (key in store ? { [key]: store[key] } : {}),
        set: async (patch: Record<string, unknown>) => { Object.assign(store, patch); },
        remove: async (key: string) => { delete store[key]; },
      },
    },
    permissions: { contains: async () => granted },
    cookies: {
      getAll: async (filter: any) => (filter.domain ? [{ domain: filter.domain, name: "a", path: "/", storeId: "0", secure: true }] : []),
      remove: async (details: any) => { calls.removedCookies.push(details.name); return true; },
    },
    browsingData: { remove: async (options: any, types: any) => { calls.browsingData.push({ options, types }); } },
    tabs: {
      get: async () : Promise<any> => {
        if (tabUrl === null) throw new Error("No tab with id");
        return { id: 7, url: tabUrl };
      },
      reload: async (tabId: any) => { calls.reloads.push(tabId); },
    },
    scripting: { executeScript: async () => { calls.scripts.push(1); return [{ result: 2 }]; } },
  };
  const restore = () => { if (previous === undefined) delete (globalThis as any).chrome; else (globalThis as any).chrome = previous; };
  return { calls, store, restore };
}

const granted = (domain: any) : any => ({ origins: [originPattern(domain)] });

it("geniş icazə olsa da əlaqəsiz iframe-in saxlancı silinmir", async () => {
  const env: any = withChrome();
  const prior = { location: (globalThis as any).location, sessionStorage: (globalThis as any).sessionStorage, localStorage: (globalThis as any).localStorage };
  let cleared = 0;
  (globalThis as any).location = { origin: "https://unrelated.example" };
  (globalThis as any).sessionStorage = (globalThis as any).localStorage = { length: 2, clear: () => { cleared++; } };
  (globalThis as any).chrome.scripting.executeScript = async ({ func, args = [] }: any) => [{ result: func(...args) }];
  try {
    await clearPageStorage(7, ["https://example.com"]);
    expect(cleared).toBe(0);
    (globalThis as any).location.origin = "https://example.com";
    expect(await clearPageStorage(7, ["https://example.com"])).toBe(4);
    expect(cleared).toBe(2);
  } finally {
    for (const [key, value] of Object.entries(prior)) {
      if (value === undefined) delete (globalThis as any)[key]; else (globalThis as any)[key] = value;
    }
    env.restore();
  }
});

describe("onPermissionsGranted", () => {
  it("gözləyən silmə yoxdursa heç nə silinmir", async () => {
    const env: any = withChrome({ pending: undefined });
    try {
      await onPermissionsGranted(granted("example.com"));
      expect(env.calls.browsingData).toStrictEqual([]);
    } finally { env.restore(); }
  });

  it("icazə BAŞQA sayta verilibsə gözləyən silmə toxunulmur", async () => {
    const env: any = withChrome({ pending: { domain: "example.com", tabId: 7 } });
    try {
      await onPermissionsGranted(granted("other.com"));
      expect(env.calls.browsingData).toStrictEqual([]);
      expect(env.store.pendingWipe, "gözləmə silinməməli idi").toBeTruthy();
    } finally { env.restore(); }
  });

  it("origins boş və ya yoxdursa heç nə edilmir", async () => {
    for (const permissions of [{}, { origins: [] }, null]) {
      const env: any = withChrome({ pending: { domain: "example.com", tabId: 7 } });
      try {
        await onPermissionsGranted(permissions);
        expect(env.calls.browsingData).toStrictEqual([]);
      } finally { env.restore(); }
    }
  });

  it("uyğun icazədən sonra silmə təkrarlanır və gözləmə silinir", async () => {
    const env: any = withChrome({ pending: { domain: "example.com", tabId: 7 } });
    try {
      await onPermissionsGranted(granted("example.com"));
      expect(env.calls.browsingData.length).toBe(1);
      expect(env.calls.browsingData[0].options.origins).toStrictEqual(["https://example.com", "https://www.example.com"]);
      expect(env.calls.browsingData[0].types.cookies).toBe(true);
      expect(env.store.pendingWipe, "gözləmə silinməli idi").toBe(undefined);
    } finally { env.restore(); }
  });

  it("icazə verildiyi üçün cookie-lər sadalanır və səhifə saxlancı da təmizlənir", async () => {
    const env: any = withChrome({ pending: { domain: "example.com", tabId: 7 } });
    try {
      await onPermissionsGranted(granted("example.com"));
      expect(env.calls.removedCookies).toStrictEqual(["a"]);
      expect(env.calls.scripts.length, "sessionStorage səhifədə təmizlənməli idi").toBe(1);
      expect(env.calls.reloads).toStrictEqual([7]);
    } finally { env.restore(); }
  });

  it("tab bağlanıbsa silmə yenə aparılır (tab olmadan, yenilənmə yoxdur)", async () => {
    const env: any = withChrome({ pending: { domain: "example.com", tabId: 7 }, tabUrl: null });
    try {
      await onPermissionsGranted(granted("example.com"));
      expect(env.calls.browsingData.length).toBe(1);
      expect(env.calls.reloads).toStrictEqual([]);
      expect(env.calls.scripts).toStrictEqual([]);
    } finally { env.restore(); }
  });

  it("tab bu arada başqa sayta gedibsə onun məlumatına toxunulmur (yalnız domen üzrə silinir)", async () => {
    const env: any = withChrome({ pending: { domain: "example.com", tabId: 7 }, tabUrl: "https://other.com/" });
    try {
      await onPermissionsGranted(granted("example.com"));
      expect(env.calls.browsingData[0].options.origins).toStrictEqual(["https://example.com", "https://www.example.com"]);
      expect(env.calls.reloads, "başqa sayta getmiş tab yenilənməməlidir").toStrictEqual([]);
    } finally { env.restore(); }
  });

  it("status yazılır — istifadəçi nəyin silindiyini görür", async () => {
    const env: any = withChrome({ pending: { domain: "example.com", tabId: 7 } });
    try {
      await onPermissionsGranted(granted("example.com"));
      expect(env.store.status?.text ?? "").toMatch(/example\.com: 1 əlçatan cookie \(partitioned daxil\)/);    } finally { env.restore(); }
  });

  // Microsoft hesabı bir neçə AYRI domendə saxlanılır: yalnız tabın domenini silmək
  // kifayət etmirdi (Foundry qeydiyyatı hər dəfə köhnə hesaba qayıdırdı).
  it("Microsoft silinəndə ailənin login domenləri də browsingData-ya gedir", async () => {
    const env: any = withChrome({ pending: { domain: "microsoftonline.com", tabId: 7 }, tabUrl: "https://login.microsoftonline.com/" });
    try {
      await onPermissionsGranted(granted("microsoftonline.com"));
      const origins = env.calls.browsingData[0].options.origins;
      for (const origin of ["https://login.microsoftonline.com", "https://login.live.com",
        "https://live.com", "https://account.microsoft.com"]) {
        expect(origins.includes(origin), origin).toBeTruthy();
      }
      // cookie-lər ailənin hər domeni üzrə də sadalanır
      expect(env.calls.removedCookies.length > 1, "yalnız bir domen silinib").toBeTruthy();
      expect(env.store.status?.text ?? "").toMatch(/Microsoft hesabı: \d+ əlaqəli domen/);
    } finally { env.restore(); }
  });
});
