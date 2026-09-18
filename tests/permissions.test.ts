// Host icazə şablonlarının testləri. Eyni funksiyanı popup (icazə varmı?) və
// tools/check.mjs (manifest-də yazılıbmı?) işlədir, ona görə nəticə deterministik olmalıdır.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";

import { hasOriginAccess, originPattern, requestOriginAccess, requiredOrigins } from "../src/shared/permissions";
import type { HostsProvider } from "../src/shared/permissions";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const temp = { id: "t", hosts: ["mail.example"] };
// Literal həddindən artıq açar yoxlamasına düşməsin deyə dəyişəndə saxlanılır
const r2Provider = { id: "r2", hosts: ["mail.example", "a.example"] };
// hosts-suz provider: yalnız HostsProvider-in tanıdığı forma yazılır
const xProvider: HostsProvider = { hosts: undefined };
const relay = { id: "r", hosts: ["relay.example", "challenges.cloudflare.com"] };

describe("originPattern", () => {
  it("IP və localhost dəqiq host icazəsi alır", () => {
    expect(originPattern("[::1]")).toBe("*://[::1]/*");
    expect(originPattern("127.0.0.1")).toBe("*://127.0.0.1/*");
    expect(originPattern("localhost")).toBe("*://localhost/*");
  });
  it("hostu MV3 şablonuna çevirir", () => {
    expect(originPattern("mail.example")).toBe("*://*.mail.example/*");
  });
});

describe("requiredOrigins", () => {
  it("bütün provider-lərin hostlarını birləşdirir", () => {
    expect(requiredOrigins(temp, relay)).toStrictEqual([
      "*://*.challenges.cloudflare.com/*",
      "*://*.mail.example/*",
      "*://*.relay.example/*",
    ]);
  });

  it("təkrarlanan hostları birləşdirir və nəticəni çeşidləyir", () => {
    expect(requiredOrigins(temp, r2Provider)).toStrictEqual([
      "*://*.a.example/*",
      "*://*.mail.example/*",
    ]);
  });

  it("hosts sahəsi olmayan və ya null provider-ləri nəzərə almır", () => {
    expect(requiredOrigins(null, undefined, xProvider)).toStrictEqual([]);
  });
});


// "Bu saytın məlumatını sil" düyməsi üçün host icazəsi. browsingData icazəsiz də işləyir,
// amma partitioned (CHIPS) cookie-lər yalnız chrome.cookies ilə, sessionStorage isə yalnız
// səhifədə silinə bilir — ikisi də host icazəsi tələb edir.
describe("hasOriginAccess / requestOriginAccess", () => {
  const withPermissions = async (fn: any) => {
    const previous = (globalThis as any).chrome;
    const calls: any = { contains: [], request: [] };
    (globalThis as any).chrome = {
      permissions: {
        contains: async (options: any) => { calls.contains.push(options); return true; },
        request: async (options: any) => { calls.request.push(options); return true; },
      },
    };
    try { return await fn(calls); } finally {
      if (previous === undefined) delete (globalThis as any).chrome; else (globalThis as any).chrome = previous;
    }
  };

  it("şablon originPattern ilə eynidir (alt-domenlər və apex daxil)", () =>
    withPermissions(async (calls: any) => {
      expect(await hasOriginAccess("example.com")).toBe(true);
      expect(calls.contains).toStrictEqual([{ origins: ["*://*.example.com/*"] }]);
      expect(calls.contains[0].origins).toStrictEqual([originPattern("example.com")]);
    }));

  it("icazə eyni şablonla istənilir", () =>
    withPermissions(async (calls: any) => {
      expect(await requestOriginAccess("relaysite.example")).toBe(true);
      expect(calls.request).toStrictEqual([{ origins: ["*://*.relaysite.example/*"] }]);
    }));

  it("manifest optional_host_permissions bu şablonları əhatə edir", () => {
    const manifest = JSON.parse(readFileSync(path.join(root, "manifest.json"), "utf8"));
    expect((manifest.optional_host_permissions ?? []).includes("*://*/*")).toBeTruthy();
  });
});
