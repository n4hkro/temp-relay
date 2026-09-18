// Host icazə şablonlarının testləri. Eyni funksiyanı popup (icazə varmı?) və
// tools/check.mjs (manifest-də yazılıbmı?) işlədir, ona görə nəticə deterministik olmalıdır.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { hasOriginAccess, originPattern, requestOriginAccess, requiredOrigins } from "../src/shared/permissions.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const temp = { id: "t", hosts: ["mail.example"] };
const relay = { id: "r", hosts: ["relay.example", "challenges.cloudflare.com"] };

describe("originPattern", () => {
  it("IP və localhost dəqiq host icazəsi alır", () => {
    assert.equal(originPattern("[::1]"), "*://[::1]/*");
    assert.equal(originPattern("127.0.0.1"), "*://127.0.0.1/*");
    assert.equal(originPattern("localhost"), "*://localhost/*");
  });
  it("hostu MV3 şablonuna çevirir", () => {
    assert.equal(originPattern("mail.example"), "*://*.mail.example/*");
  });
});

describe("requiredOrigins", () => {
  it("bütün provider-lərin hostlarını birləşdirir", () => {
    assert.deepEqual(requiredOrigins(temp, relay), [
      "*://*.challenges.cloudflare.com/*",
      "*://*.mail.example/*",
      "*://*.relay.example/*",
    ]);
  });

  it("təkrarlanan hostları birləşdirir və nəticəni çeşidləyir", () => {
    assert.deepEqual(requiredOrigins(temp, { id: "r2", hosts: ["mail.example", "a.example"] }), [
      "*://*.a.example/*",
      "*://*.mail.example/*",
    ]);
  });

  it("hosts sahəsi olmayan və ya null provider-ləri nəzərə almır", () => {
    assert.deepEqual(requiredOrigins(null, undefined, { id: "x" }), []);
  });
});


// "Bu saytın məlumatını sil" düyməsi üçün host icazəsi. browsingData icazəsiz də işləyir,
// amma partitioned (CHIPS) cookie-lər yalnız chrome.cookies ilə, sessionStorage isə yalnız
// səhifədə silinə bilir — ikisi də host icazəsi tələb edir.
describe("hasOriginAccess / requestOriginAccess", () => {
  const withPermissions = async (fn) => {
    const previous = globalThis.chrome;
    const calls = { contains: [], request: [] };
    globalThis.chrome = {
      permissions: {
        contains: async (options) => { calls.contains.push(options); return true; },
        request: async (options) => { calls.request.push(options); return true; },
      },
    };
    try { return await fn(calls); } finally {
      if (previous === undefined) delete globalThis.chrome; else globalThis.chrome = previous;
    }
  };

  it("şablon originPattern ilə eynidir (alt-domenlər və apex daxil)", () =>
    withPermissions(async (calls) => {
      assert.equal(await hasOriginAccess("example.com"), true);
      assert.deepEqual(calls.contains, [{ origins: ["*://*.example.com/*"] }]);
      assert.deepEqual(calls.contains[0].origins, [originPattern("example.com")]);
    }));

  it("icazə eyni şablonla istənilir", () =>
    withPermissions(async (calls) => {
      assert.equal(await requestOriginAccess("relaysite.example"), true);
      assert.deepEqual(calls.request, [{ origins: ["*://*.relaysite.example/*"] }]);
    }));

  it("manifest optional_host_permissions bu şablonları əhatə edir", () => {
    const manifest = JSON.parse(readFileSync(path.join(root, "manifest.json"), "utf8"));
    assert.ok((manifest.optional_host_permissions ?? []).includes("*://*/*"));
  });
});
