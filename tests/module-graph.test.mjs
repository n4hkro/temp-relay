// Modul qrafının testləri.
//
// Extension-ı brauzerdə açmadan yoxlamaq mümkün olmayan iki şeyi tutur:
//   1. hər bir nisbi import/`<script>`/`<link>` yolu həqiqətən mövcud fayla aparır
//      (səhv yol MV3-də səssiz uğursuzluqdur — worker ümumiyyətlə işə düşmür);
//   2. service worker-in giriş faylı bütün asılılıqları ilə node-da yüklənir, yəni
//      import anında heç bir modul `chrome`-a toxunmur (toxunsa worker-də də, node-da
//      da eyni yerdə sınardı).
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const walk = (dir, out = []) => {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
};
const sourceFiles = walk(path.join(root, "src"));
const rel = (p) => path.relative(root, p).split(path.sep).join("/");

// JS-dəki statik import/export ... from və HTML-dəki src/href istinadları
const importSpecifiers = (file) => {
  const source = readFileSync(file, "utf8");
  const found = [];
  if (file.endsWith(".js") || file.endsWith(".mjs")) {
    for (const m of source.matchAll(/(?:^|\n)\s*(?:import|export)\s[^;\n]*?from\s*["']([^"']+)["']/g)) found.push(m[1]);
    for (const m of source.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g)) found.push(m[1]);
  } else if (file.endsWith(".html")) {
    for (const m of source.matchAll(/(?:src|href)\s*=\s*"([^"]+)"/g)) found.push(m[1]);
  }
  return found;
};

describe("modul qrafı", () => {
  it("bütün nisbi import yolları mövcud fayla aparır", () => {
    const broken = [];
    for (const file of sourceFiles) {
      for (const specifier of importSpecifiers(file)) {
        if (!specifier.startsWith(".")) continue;   // xarici/url istinadları yoxlanılmır
        const target = path.resolve(path.dirname(file), specifier);
        if (!existsSync(target)) broken.push(`${rel(file)} → ${specifier}`);
      }
    }
    assert.deepEqual(broken, []);
  });

  it("heç bir import həll olunmamış (bare) specifier işlətmir — Chrome bunları tapa bilmir", () => {
    const bare = [];
    for (const file of sourceFiles) {
      if (!file.endsWith(".js")) continue;
      for (const specifier of importSpecifiers(file)) {
        if (!specifier.startsWith(".") && !specifier.startsWith("chrome-extension://")) bare.push(`${rel(file)} → ${specifier}`);
      }
    }
    assert.deepEqual(bare, []);
  });

  it("manifest-dəki giriş nöqtələri və onların bütün istinadları mövcuddur", () => {
    const manifest = JSON.parse(readFileSync(path.join(root, "manifest.json"), "utf8"));
    const entries = [manifest.action.default_popup, manifest.background.service_worker];
    for (const entry of entries) {
      assert.ok(existsSync(path.join(root, entry)), `${entry} yoxdur`);
      // giriş faylının öz istinadları da (script/link) mövcud olmalıdır
      for (const specifier of importSpecifiers(path.join(root, entry))) {
        if (!specifier.startsWith(".")) continue;
        assert.ok(existsSync(path.resolve(path.dirname(path.join(root, entry)), specifier)), `${entry} → ${specifier} yoxdur`);
      }
    }
  });
});

describe("import skaneri", () => {
  it("nisbi istinadları həqiqətən tapır (regex korlanmayıb)", () => {
    const relative = sourceFiles.flatMap(importSpecifiers).filter((s) => s.startsWith("."));
    assert.ok(relative.length >= 25, `yalnız ${relative.length} nisbi istinad tapıldı — skaner işləmir`);
  });
});

describe("service worker yüklənməsi", () => {
  it("background.js bütün asılılıqları ilə import olunur (listener-lər qeydiyyatdan keçir)", async () => {
    const registered = { tabs: 0, messages: 0, permissions: 0 };
    const previous = globalThis.chrome;
    globalThis.chrome = {
      tabs: {
        onRemoved: { addListener: () => { registered.tabs++; } },
        onUpdated: { addListener: () => {}, removeListener: () => {} },
      },
      // Host icazəsi verildikdə yarımçıq qalmış silmə tamamlanır (orchestrator.onPermissionsGranted)
      permissions: { onAdded: { addListener: () => { registered.permissions++; } } },
      runtime: {
        onMessage: { addListener: () => { registered.messages++; } },
        getURL: (p) => `chrome-extension://test/${p}`,
        getPlatformInfo: async () => ({}),   // poçt izləməsinin nəbzi bunu çağırır
      },
      // background.js yüklənəndə resumeWatching saxlancı oxuyur (boş saxlanc → izləmə yoxdur)
      storage: {
        session: { get: async () => ({}), set: async () => {}, remove: async () => {} },
        onChanged: { addListener: () => {}, removeListener: () => {} },
      },
    };
    try {
      await import("../src/background/background.js");
      // background.js resumeWatching-i .catch(console.error) ilə udur: xəta worker console-nda
      // görünür, amma import uğurlu sayılır (brauzerdəki ReferenceError belə keçdi). Eyni
      // funksiyanı burada BİRBAŞA gözləyirik — xəta varsa test batır.
      const { resumeWatching } = await import("../src/background/inbox.js");
      await resumeWatching();
    } finally {
      if (previous === undefined) delete globalThis.chrome; else globalThis.chrome = previous;
    }
    assert.equal(registered.tabs, 1, "chrome.tabs.onRemoved dinləyicisi qeydiyyatdan keçmədi");
    assert.equal(registered.messages, 1, "chrome.runtime.onMessage dinləyicisi qeydiyyatdan keçmədi");
    assert.equal(registered.permissions, 1, "chrome.permissions.onAdded dinləyicisi qeydiyyatdan keçmədi");
  });
});
