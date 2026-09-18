// Modul qrafının testləri.
//
// Extension-ı brauzerdə açmadan yoxlamaq mümkün olmayan iki şeyi tutur:
//   1. hər bir nisbi import/`<script>`/`<link>` yolu həqiqətən mövcud fayla aparır
//      (səhv yol MV3-də səssiz uğursuzluqdur — worker ümumiyyətlə işə düşmür);
//   2. service worker-in giriş faylı bütün asılılıqları ilə node-da yüklənir, yəni
//      import anında heç bir modul `chrome`-a toxunmur (toxunsa worker-də də, node-da
//      da eyni yerdə sınardı).
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const walk: any = (dir: any, out: any = []) : any => {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
};
const sourceFiles: any = walk(path.join(root, "src"));
const rel = (p: any) => path.relative(root, p).split(path.sep).join("/");

// TS-dəki statik import/export ... from və HTML-dəki src/href istinadları
const importSpecifiers = (file: any) => {
  const source = readFileSync(file, "utf8");
  const found = [];
  if (file.endsWith(".ts") || file.endsWith(".js") || file.endsWith(".mjs")) {
    for (const m of source.matchAll(/(?:^|\n)\s*(?:import|export)\s[^;\n]*?from\s*["']([^"']+)["']/g)) found.push(m[1]);
    for (const m of source.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g)) found.push(m[1]);
  } else if (file.endsWith(".html")) {
    for (const m of source.matchAll(/(?:src|href)\s*=\s*"([^"]+)"/g)) found.push(m[1]);
  }
  return found;
};

describe("modul qrafı", () => {
  // TS importları uzantısızdır (`./foo`, `./dir`) — Vite/TS onları `./foo.ts`,
  // `./dir/index.ts` kimi həll edir; test də eyni məntiqi təkrarlayır.
  const resolvable = (target: string) =>
    existsSync(target)
    || existsSync(target + ".ts")
    || existsSync(target + ".js")
    || existsSync(path.join(target, "index.ts"));

  it("bütün nisbi import yolları mövcud fayla aparır", () => {
    const broken = [];
    for (const file of sourceFiles) {
      for (const specifier of importSpecifiers(file)) {
        if (!specifier.startsWith(".")) continue;   // xarici/url istinadları yoxlanılmır
        const target = path.resolve(path.dirname(file), specifier);
        if (!resolvable(target)) broken.push(`${rel(file)} → ${specifier}`);
      }
    }
    expect(broken).toStrictEqual([]);
  });

  it("heç bir import həll olunmamış (bare) specifier işlətmir — Chrome bunları tapa bilmir", () => {
    const bare = [];
    for (const file of sourceFiles) {
      if (!file.endsWith(".ts") && !file.endsWith(".js")) continue;
      for (const specifier of importSpecifiers(file)) {
        if (!specifier.startsWith(".") && !specifier.startsWith("chrome-extension://")) bare.push(`${rel(file)} → ${specifier}`);
      }
    }
    expect(bare).toStrictEqual([]);
  });

  it("manifest-dəki giriş nöqtələri və onların bütün istinadları mövcuddur", () => {
    const manifest = JSON.parse(readFileSync(path.join(root, "manifest.json"), "utf8"));
    const entries = [manifest.action.default_popup, manifest.background.service_worker];
    // Manifest build məhsuluna (dist) işarə edir — dist mənbə strukturunu güzgüləyir
    // (`dist/src/...`), ona görə mənbə ağacında `.js` → `.ts` uyğunluğu yoxlanılır.
    const toSource = (entry: string) => {
      const direct = path.join(root, entry);
      if (existsSync(direct)) return direct;
      const ts = direct.replace(/\.js$/, ".ts");
      return existsSync(ts) ? ts : direct;
    };
    for (const entry of entries) {
      const source = toSource(entry);
      expect(existsSync(source), `${entry} yoxdur`).toBeTruthy();
      // giriş faylının öz istinadları da (script/link) mövcud olmalıdır
      for (const specifier of importSpecifiers(source)) {
        if (!specifier.startsWith(".")) continue;
        const target = path.resolve(path.dirname(source), specifier);
        expect(resolvable(target), `${entry} → ${specifier} yoxdur`).toBeTruthy();
      }
    }
  });
});

describe("import skaneri", () => {
  it("nisbi istinadları həqiqətən tapır (regex korlanmayıb)", () => {
    const relative = sourceFiles.flatMap(importSpecifiers).filter((s: any) => s.startsWith("."));
    expect(relative.length >= 25, `yalnız ${relative.length} nisbi istinad tapıldı — skaner işləmir`).toBeTruthy();
  });
});

describe("service worker yüklənməsi", () => {
  it("background.ts bütün asılılıqları ilə import olunur (listener-lər qeydiyyatdan keçir)", async () => {
    const registered = { tabs: 0, messages: 0, permissions: 0 };
    const previous = (globalThis as any).chrome;
    (globalThis as any).chrome = {
      tabs: {
        onRemoved: { addListener: () => { registered.tabs++; } },
        onUpdated: { addListener: () => {}, removeListener: () => {} },
      },
      // Host icazəsi verildikdə yarımçıq qalmış silmə tamamlanır (orchestrator.onPermissionsGranted)
      permissions: { onAdded: { addListener: () => { registered.permissions++; } } },
      runtime: {
        onMessage: { addListener: () => { registered.messages++; } },
        getURL: (p: any) => `chrome-extension://test/${p}`,
        getPlatformInfo: async () : Promise<any> => ({}),   // poçt izləməsinin nəbzi bunu çağırır
      },
      // background.ts yüklənəndə resumeWatching saxlancı oxuyur (boş saxlanc → izləmə yoxdur)
      storage: {
        session: { get: async () : Promise<any> => ({}), set: async () => {}, remove: async () => {} },
        onChanged: { addListener: () => {}, removeListener: () => {} },
      },
    };
    try {
      await import("../src/background/background");
      // background.ts resumeWatching-i .catch(console.error) ilə udur: xəta worker console-nda
      // görünür, amma import uğurlu sayılır (brauzerdəki ReferenceError belə keçdi). Eyni
      // funksiyanı burada BİRBAŞA gözləyirik — xəta varsa test batır.
      const { resumeWatching } = await import("../src/background/inbox");
      await resumeWatching();
    } finally {
      if (previous === undefined) delete (globalThis as any).chrome; else (globalThis as any).chrome = previous;
    }
    expect(registered.tabs, "chrome.tabs.onRemoved dinləyicisi qeydiyyatdan keçmədi").toBe(1);
    expect(registered.messages, "chrome.runtime.onMessage dinləyicisi qeydiyyatdan keçmədi").toBe(1);
    expect(registered.permissions, "chrome.permissions.onAdded dinləyicisi qeydiyyatdan keçmədi").toBe(1);
  });
});
