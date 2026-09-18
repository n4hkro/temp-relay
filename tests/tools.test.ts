// Alət qatı: izləyici qalxanı və proxy-nin worker tərəfi
// (background/trackers.ts, background/proxy.ts, background/tools.ts).
//
// Proxy siyahısı YALNIZ istifadəçinin əlavə etdiyi ünvanlardan ibarətdir: açıq (ictimai) proxy
// mənbələri, onların formatları və "canlılıq" metadatası ümumiyyətlə yoxdur.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { MessageType, Message } from "../src/shared/messages";
import { proxyConfig, proxyKey } from "../src/shared/proxy";
import type { ProxyEntry } from "../src/shared/proxy";
import { isToolCommand } from "../src/background/tools";
import { TRACKER_RULESET_ID } from "../src/background/trackers";
import { IP_CHECK_URL } from "../src/background/proxy";

// Qayda faylı mənbədə `public/rules/` altındadır (Vite dist kökünə köçürür).
const RULES = JSON.parse(readFileSync(new URL("../public/rules/trackers.json", import.meta.url), "utf8"));

describe("izləyici qalxanının qaydaları", () => {
  it("hər qayda üçüncü tərəf sorğusunu bloklayır", () => {
    for (const rule of RULES) {
      expect(rule.action.type, `qayda ${rule.id}`).toBe("block");
      expect(rule.condition.domainType, `qayda ${rule.id}`).toBe("thirdParty");
      expect(Array.isArray(rule.condition.requestDomains) && rule.condition.requestDomains.length).toBeTruthy();
    }
  });

  it("qayda id-ləri təkrarlanmır", () => {
    const ids = RULES.map((rule: any) => rule.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("tanınmış izləyicilər siyahıdadır", () => {
    const domains = new Set(RULES.flatMap((rule: any) => rule.condition.requestDomains));
    for (const domain of ["google-analytics.com", "doubleclick.net", "connect.facebook.net",
      "hotjar.com", "mc.yandex.ru", "clarity.ms", "appsflyer.com"]) {
      expect(domains.has(domain), domain).toBeTruthy();
    }
  });

  it("saytın öz müdafiəsi bloklanmır (fingerprint kitabxanaları siyahıda yoxdur)", () => {
    const text = JSON.stringify(RULES);
    for (const domain of ["fingerprintjs", "recaptcha", "hcaptcha", "challenges.cloudflare.com", "turnstile"]) {
      expect(text.includes(domain), domain).toBe(false);
    }
  });

  it("ruleset id-si kodla eynidir", () => {
    expect(TRACKER_RULESET_ID).toBe("trackers");
  });
});

describe("alət əmrləri", () => {
  it("mesaj qurucuları tip və dəyəri daşıyır", () => {
    expect(Message.setShield(true)).toStrictEqual({ type: MessageType.SET_SHIELD, on: true });
    expect(Message.setShield("bəli" as unknown as boolean), "yalnız true qəbul olunur").toStrictEqual({ type: MessageType.SET_SHIELD, on: false });
    expect(Message.proxyAdd(" 1.2.3.4:8080 ")).toStrictEqual({ type: MessageType.PROXY_ADD, text: " 1.2.3.4:8080 " });
    expect(Message.proxyAdd("1.2.3.4:8080\n5.6.7.8:1080"), "çoxsətirli mətn olduğu kimi ötürülür").toStrictEqual({ type: MessageType.PROXY_ADD, text: "1.2.3.4:8080\n5.6.7.8:1080" });
    expect(Message.proxyConnect("http://1.2.3.4:8080")).toStrictEqual({ type: MessageType.PROXY_CONNECT, key: "http://1.2.3.4:8080" });
    expect(Message.proxyRemove("k")).toStrictEqual({ type: MessageType.PROXY_REMOVE, keys: ["k"] });
    expect(Message.proxyRemove(["a", "b"]), "toplu silmə massiv göndərir").toStrictEqual({ type: MessageType.PROXY_REMOVE, keys: ["a", "b"] });
    expect(Message.proxyDisconnect()).toStrictEqual({ type: MessageType.PROXY_DISCONNECT });
  });

  it("idxal əmri ARTIQ YOXDUR (açıq mənbələr silindi)", () => {
    // Silinmiş API-nin qalıqları: tip sistemi tanımır, ona görə açar kimi oxunur
    expect((MessageType as unknown as Record<string, unknown>).PROXY_IMPORT).toBe(undefined);
    expect((Message as unknown as Record<string, unknown>).proxyImport).toBe(undefined);
    expect(isToolCommand({ type: "proxyImport" })).toBe(false);
  });

  it("router yalnız alət əmrlərini tanıyır", () => {
    for (const type of [MessageType.SET_SHIELD, MessageType.PROXY_ADD,
      MessageType.PROXY_REMOVE, MessageType.PROXY_CONNECT, MessageType.PROXY_DISCONNECT,
      MessageType.DESCRIBE_PAGE]) {
      expect(isToolCommand({ type }), type).toBe(true);
    }
    for (const type of [MessageType.START, MessageType.STOP, MessageType.NEW_ADDRESS,
      MessageType.CLEAR_TAB, MessageType.COPY, "toString", undefined]) {
      expect(isToolCommand({ type }), String(type)).toBe(false);
    }
    expect(isToolCommand(null)).toBe(false);
  });

  it("diaqnostika əmri yalnız tab id-si daşıyır (səhifəni worker özü oxuyur)", () => {
    expect(Message.describePage(7)).toStrictEqual({ type: MessageType.DESCRIBE_PAGE, tabId: 7 });
  });

  it("çıxış IP xidməti https-dir və yalnız IP qaytarır", () => {
    expect(IP_CHECK_URL).toMatch(/^https:\/\/api\.ipify\.org\//);
  });
});

// Worker tərəfi: chrome API-si saxtadır. Yoxlanılan: hansı konfiqurasiya qurulur, saxlanca nə
// yazılır, ölü proxy-də nə baş verir və giriş məlumatı necə cavablandırılır.
//
// BRAUZERİN PARAMETRİ ayrı vəziyyət kimi modelləşdirilir (`applied`), çünki real Chrome-da o,
// profil faylında qalır: extension söndürülüb-açılandan sonra da qüvvədədir. Məhz bu ayrılıq
// qüsurun kökü idi — saxlancda qeyd yoxdur, brauzer isə hələ proxy-dən keçir.
//   • stickyClear — `clear()` parametri buraxmır (buraxmanın "tutmadığı" hal);
//   • frozen      — nə `clear()`, nə `set()` işləyir (heç bir yolla buraxılmır).
async function withChrome({ proxies = [], active = null, ip = "203.0.113.7", ok = true,
  applied: initial = null, stickyClear = false, frozen = false }: any, fn: any) {
  const previous = { chrome: (globalThis as any).chrome, fetch: (globalThis as any).fetch };
  const local: Record<string, unknown> = { proxies: { list: proxies, updated: 1 }, ...(active ? { activeProxy: active } : {}) };
  const calls: any = { set: [], clear: 0, status: [], rulesets: [] };
  // Brauzerin cari parametri: null = extension yönləndirmir
  let applied = initial;
  (globalThis as any).chrome = {
    storage: {
      local: {
        get: async (key: unknown) => (typeof key === "string" ? { [key]: local[key] } : local),
        set: async (patch: any) => Object.assign(local, patch),
        remove: async (key: string) => { delete local[key]; },
      },
      session: {
        get: async () : Promise<any> => ({}),
        set: async (patch: any) => { if (patch.status) calls.status.push(patch.status); },
        remove: async () => {},
      },
    },
    proxy: {
      settings: {
        set: async (options: any) => { calls.set.push(options); if (!frozen) applied = options.value; },
        clear: async () => { calls.clear += 1; if (!frozen && !stickyClear) applied = null; },
        get: async () : Promise<any> => ({
          value: applied ?? { mode: "system" },
          levelOfControl: applied ? "controlled_by_this_extension" : "controllable_by_this_extension",
        }),
      },
    },
    declarativeNetRequest: {
      getEnabledRulesets: async () : Promise<any> => [],
      updateEnabledRulesets: async (options: any) => calls.rulesets.push(options),
    },
  };
  (globalThis as any).fetch = async () => (ok
    ? { ok: true, text: async () => ip }
    : Promise.reject(Object.assign(new Error("timeout"), { name: "TimeoutError" })));

  const proxy = await import("../src/background/proxy");
  const trackers = await import("../src/background/trackers");
  try {
    return await fn({ proxy, trackers, calls, local, browser: () => applied });
  } finally {
    (globalThis as any).chrome = previous.chrome;
    (globalThis as any).fetch = previous.fetch;
    if (previous.chrome === undefined) delete (globalThis as any).chrome;
    if (previous.fetch === undefined) delete (globalThis as any).fetch;
  }
}

const P: ProxyEntry = { scheme: "socks5", host: "203.0.113.9", port: 1080 };
// Brauzerdə qalmış (extension-ın qurduğu) fixed_servers parametri
const ROUTED = { mode: "fixed_servers", rules: { singleProxy: { scheme: "http", host: "31.59.20.176", port: 6754 } } };

describe("worker: idxal funksiyası yoxdur", () => {
  it("background/proxy.ts açıq mənbələrdən çəkmə ixrac etmir", async () => {
    const module = await import("../src/background/proxy");
    // Silinmiş ixraclar: tip sistemi tanımır, ona görə açar kimi oxunur
    expect((module as unknown as Record<string, unknown>).importProxies).toBe(undefined);
    expect((module as unknown as Record<string, unknown>).verifyProxies).toBe(undefined);
    // ixrac olunanlar: toplu əlavə/sil/qoşul/ayır + yoxlama, brauzer parametrinin
    // oxunması/buraxılması, autentifikasiya və miqrasiya
    expect(Object.keys(module).sort()).toStrictEqual([
      "IP_CHECK_URL", "addProxies", "answerProxyAuth", "browserProxy", "checkExit", "connectProxy",
      "disconnectProxy", "migrateProxies", "releaseProxy", "removeProxy", "resumeProxy",
    ]);
  });
});

describe("connectProxy / disconnectProxy", () => {
  it("Chrome parametri qurulur və çıxış IP saxlanca yazılır", () =>
    withChrome({ proxies: [P] }, async ({ proxy, calls, local }: any) => {
      const result = await proxy.connectProxy(proxyKey(P));
      expect(result.exit.ok).toBe(true);
      expect(calls.set.length).toBe(1);
      expect(calls.set[0].scope).toBe("regular");
      expect(calls.set[0].value.rules.singleProxy).toStrictEqual({ scheme: "socks5", host: "203.0.113.9", port: 1080 });
      expect(local.activeProxy.exitIp).toBe("203.0.113.7");
      expect(calls.status.at(-1).text).toMatch(/çıxış IP 203\.0\.113\.7/);
    }));

  it("ölçülmüş gecikmə siyahıdaki qeydə də yazılır (popup onu göstərir)", () =>
    withChrome({ proxies: [P] }, async ({ proxy, local }: any) => {
      await proxy.connectProxy(proxyKey(P));
      expect(typeof local.proxies.list[0].ping).toBe("number");
      expect(local.proxies.list[0].dead).toBe(undefined);
    }));

  it("ölü proxy: bağlantı KƏSİLİR (brauzerdə qalsa bütün saytlar açılmazdı)", () =>
    withChrome({ proxies: [P], ok: false }, async ({ proxy, calls, local, browser }: any) => {
      const result = await proxy.connectProxy(proxyKey(P));
      expect(result.exit.ok).toBe(false);
      expect(local.activeProxy, "aktiv qeyd qalmamalıdır").toBe(undefined);
      expect(browser(), "brauzerin parametri buraxılmalıdır").toBe(null);
      expect(local.proxies.list[0].dead).toBe(true);
      expect(calls.status.at(-1).level).toBe("warn");
      expect(calls.status.at(-1).text).toMatch(/cavab vermir/);
      expect(calls.status.at(-1).text).toMatch(/Bağlantı kəsildi/);
    }));

  it("ölü proxy: buraxma tutmasa BİRBAŞA bağlantı məcbur edilir", () =>
    withChrome({ proxies: [P], ok: false, stickyClear: true }, async ({ proxy, calls, browser }: any) => {
      await proxy.connectProxy(proxyKey(P));
      expect(browser(), "trafik birbaşa bağlantıya qaytarılmalıdır").toStrictEqual({ mode: "direct" });
      expect(calls.set.some((call: any) => call.value?.mode === "direct")).toBeTruthy();
      expect(calls.status.at(-1).level).toBe("warn");
    }));

  it("heç bir yolla buraxılmasa istifadəçiyə səbəbi deyilir", () =>
    withChrome({ proxies: [P], ok: false, frozen: true, applied: proxyConfig(P) }, async ({ proxy, calls }: any) => {
      await proxy.connectProxy(proxyKey(P));
      expect(calls.status.at(-1).level).toBe("warn");
      expect(calls.status.at(-1).text).toMatch(/Chrome-u yenidən başlat/);
    }));

  it("siyahıda olmayan proxy üçün aydın xəta", () =>
    withChrome({ proxies: [] }, async ({ proxy }: any) => {
      await expect(() => proxy.connectProxy("http://1.2.3.4:8080")).rejects.toThrow(/siyahıda yoxdur/);
    }));

  it("ayrılma parametri təmizləyir və aktiv qeydi silir", () =>
    withChrome({ proxies: [P], active: P, applied: ROUTED }, async ({ proxy, calls, local, browser }: any) => {
      await proxy.disconnectProxy();
      expect(calls.clear).toBe(1);
      expect(local.activeProxy).toBe(undefined);
      expect(browser()).toBe(null);
      expect(calls.status.at(-1).text).toMatch(/ayrıldı/);
      expect(calls.status.at(-1).level).toBe("info");
    }));

  it("ayrılma: `clear` tutmasa parametr yenə birbaşa bağlantıya qaytarılır", () =>
    withChrome({ proxies: [P], active: P, applied: ROUTED, stickyClear: true },
      async ({ proxy, calls, local, browser }: any) => {
        await proxy.disconnectProxy();
        expect(local.activeProxy).toBe(undefined);
        expect(browser()).toStrictEqual({ mode: "direct" });
        expect(calls.status.at(-1).level, "trafik birbaşadır — xəbərdarlığa ehtiyac yoxdur").toBe("info");
      }));

  it("ayrılma: parametr heç bir yolla buraxılmasa qeyd YENƏ silinir və səbəb deyilir", () =>
    withChrome({ proxies: [P], active: P, applied: ROUTED, frozen: true },
      async ({ proxy, calls, local }: any) => {
        await proxy.disconnectProxy();
        expect(local.activeProxy, "popup 'qoşulu' göstərməməlidir").toBe(undefined);
        expect(calls.status.at(-1).level).toBe("warn");
        expect(calls.status.at(-1).text).toMatch(/brauzerin parametri hələ qüvvədədir/);
      }));

  it("aktiv proxy silinəndə bağlantı da kəsilir", () =>
    withChrome({ proxies: [P], active: P }, async ({ proxy, calls, local }: any) => {
      await proxy.removeProxy(proxyKey(P));
      expect(local.proxies.list).toStrictEqual([]);
      expect(calls.clear).toBe(1);
    }));

  it("TOPLU silmə: bir neçə açar bir sorğuda gedir, sayı statusda deyilir", () =>
    withChrome({ proxies: [P, { scheme: "http", host: "1.1.1.1", port: 80 }, { scheme: "http", host: "2.2.2.2", port: 80 }] },
      async ({ proxy, calls, local }: any) => {
        const result = await proxy.removeProxy(["http://1.1.1.1:80", "http://2.2.2.2:80"]);
        expect(result).toStrictEqual({ removed: 2, total: 1 });
        expect(local.proxies.list.map((p: any) => p.host)).toStrictEqual(["203.0.113.9"]);
        expect(calls.status.at(-1).text).toMatch(/2 proxy silindi/);
      }));

  it("toplu silmədə qoşulu proxy də varsa bağlantı kəsilir", () =>
    withChrome({ proxies: [P], active: P }, async ({ proxy, calls, local }: any) => {
      await proxy.removeProxy([proxyKey(P), "http://9.9.9.9:80"]);
      expect(local.proxies.list).toStrictEqual([]);
      expect(local.activeProxy).toBe(undefined);
      expect(calls.clear).toBe(1);
    }));

  it("siyahıda olmayan açar səssiz keçir (silinən sayı 0)", () =>
    withChrome({ proxies: [P] }, async ({ proxy, local }: any) => {
      expect(await proxy.removeProxy(["http://9.9.9.9:80"])).toStrictEqual({ removed: 0, total: 1 });
      expect(local.proxies.list.length).toBe(1);
    }));
});

describe("resumeProxy — saxlanc ilə BRAUZERİN parametrinin uzlaşdırılması", () => {
  // Qüsurun özü: istifadəçi proxy-ni ayırdı (saxlancdaki qeyd silindi), Chrome-un parametri isə
  // profil faylında qaldı. Nəticədə popup "qoşulu deyil" yazırdı, bütün saytlar isə yalnız
  // extension söndürüləndə açılırdı. Bərpa addımı məhz bu vəziyyəti düzəldir.
  it("saxlancda qeyd YOXDUR, brauzerin parametri qalıb → parametr buraxılır", () =>
    withChrome({ proxies: [], active: null, applied: ROUTED }, async ({ proxy, calls, browser }: any) => {
      await proxy.resumeProxy();
      expect(browser(), "qalmış parametr buraxılmalıdır").toBe(null);
      expect(calls.status.at(-1).level).toBe("info");
      expect(calls.status.at(-1).text).toMatch(/Brauzerdə qalmış proxy parametri buraxıldı/);
    }));

  it("qalmış parametr buraxılmasa istifadəçiyə nə edəcəyi deyilir", () =>
    withChrome({ applied: ROUTED, frozen: true }, async ({ proxy, calls }: any) => {
      await proxy.resumeProxy();
      expect(calls.status.at(-1).level).toBe("warn");
      expect(calls.status.at(-1).text).toMatch(/Chrome-u yenidən başlat/);
    }));

  it("qeyd yoxdur, brauzer də yönləndirmir → heç nə edilmir (adi hal)", () =>
    withChrome({}, async ({ proxy, calls }: any) => {
      await proxy.resumeProxy();
      expect(calls.set.length).toBe(0);
      expect(calls.clear).toBe(0);
      expect(calls.status, "boş status brauzer açılışında hər dəfə görünərdi").toStrictEqual([]);
    }));

  it("TƏZƏ yoxlanmış qeyd bərpa olunur, şəbəkə sorğusu göndərilmir", () =>
    withChrome({ proxies: [P], active: { ...P, checked: Date.now() } }, async ({ proxy, calls, browser }: any) => {
      await proxy.resumeProxy();
      expect(calls.set.length).toBe(1);
      expect(browser().rules.singleProxy).toStrictEqual({ scheme: "socks5", host: "203.0.113.9", port: 1080 });
      expect(calls.status).toStrictEqual([]);
    }));

  it("KÖHNƏ qeyd yenidən yoxlanılır: işləyirsə qalır və ölü nişanı düşür", () =>
    withChrome({ proxies: [{ ...P, dead: true }], active: { ...P, dead: true, checked: 1 } },
      async ({ proxy, local, browser }: any) => {
        await proxy.resumeProxy();
        expect(local.activeProxy.exitIp).toBe("203.0.113.7");
        expect(local.proxies.list[0].dead, "ölü nişanı silinməlidir").toBe(undefined);
        expect(browser().mode).toBe("fixed_servers");
      }));

  it("KÖHNƏ qeyd cavab vermirsə bağlantı kəsilir — brauzer kilidli qalmır", () =>
    withChrome({ proxies: [P], active: { ...P, checked: 1 }, ok: false },
      async ({ proxy, calls, local, browser }: any) => {
        await proxy.resumeProxy();
        expect(local.activeProxy).toBe(undefined);
        expect(local.proxies.list[0].dead).toBe(true);
        expect(browser(), "trafik birbaşa bağlantıya qaytarılmalıdır").toBe(null);
        expect(calls.status.at(-1).level).toBe("warn");
        expect(calls.status.at(-1).text).toMatch(/birbaşa bağlantıya qayıdıldı/);
      }));

  it("pozulmuş qeyd (yanlış sxem) bərpa edilmir və worker batmır", () =>
    withChrome({ active: { scheme: "ftp", host: "1.2.3.4", port: 80 } }, async ({ proxy, browser }: any) => {
      await proxy.resumeProxy();
      expect(browser()).toBe(null);
    }));
});

describe("releaseProxy / browserProxy", () => {
  it("browserProxy parametrin bizə aid olduğunu və trafikin yönləndiyini deyir", () =>
    withChrome({ applied: ROUTED }, async ({ proxy }: any) => {
      expect(await proxy.browserProxy()).toStrictEqual({
        mode: "fixed_servers", level: "controlled_by_this_extension", ours: true, routed: true,
      });
    }));

  it("yönləndirmə olmayanda `routed` false olur", () =>
    withChrome({}, async ({ proxy }: any) => {
      const control = await proxy.browserProxy();
      expect(control.routed).toBe(false);
      expect(control.ours).toBe(false);
    }));

  it("releaseProxy buraxılmanı YOXLAYIR və nəticəni qaytarır", () =>
    withChrome({ applied: ROUTED }, async ({ proxy, calls }: any) => {
      const control = await proxy.releaseProxy();
      expect(control.routed).toBe(false);
      expect(calls.clear, "bir buraxma kifayət etdi").toBe(1);
    }));

  it("buraxma tutmasa birbaşa rejim qurulur və buraxma bir daha sınanır", () =>
    withChrome({ applied: ROUTED, stickyClear: true }, async ({ proxy, calls }: any) => {
      const control = await proxy.releaseProxy();
      expect(control.mode).toBe("direct");
      expect(control.routed).toBe(false);
      expect(calls.clear).toBe(2);
      expect(calls.set.at(-1)).toStrictEqual({ value: { mode: "direct" }, scope: "regular" });
    }));

  it("chrome.proxy oxunmasa çökmür, 'yönləndirmə yoxdur' qaytarır", () =>
    withChrome({}, async ({ proxy }: any) => {
      (globalThis as any).chrome.proxy.settings.get = async () : Promise<any> => { throw new Error("no access"); };
      const control = await proxy.browserProxy();
      expect(control).toStrictEqual({ mode: null, level: null, ours: false, routed: false });
    }));
});

describe("addProxies — toplu əlavə", () => {
  it("bir sətir: yeni proxy siyahının BAŞINA düşür", () =>
    withChrome({ proxies: [P] }, async ({ proxy, local }: any) => {
      const result = await proxy.addProxies("user:pass@198.51.100.4:8080");
      expect(result.added).toBe(1);
      expect(local.proxies.list[0].host).toBe("198.51.100.4");
      expect(local.proxies.list[0].username).toBe("user");
      expect(local.proxies.list.length).toBe(2);
    }));

  it("yüzlərlə sətir bir əməliyyatda əlavə olunur", () =>
    withChrome({}, async ({ proxy, local, calls }: any) => {
      const lines = Array.from({ length: 250 }, (_, i) => `45.10.1.${(i % 254) + 1}:${8000 + i}`);
      const result = await proxy.addProxies(lines.join("\n"));
      expect(result.added).toBe(250);
      expect(local.proxies.list.length).toBe(250);
      expect(calls.status.at(-1).text).toMatch(/250 proxy əlavə olundu/);
      expect(calls.status.at(-1).level).toBe("info");
    }));

  it("fayl məzmunu (JSON) da qəbul olunur", () =>
    withChrome({}, async ({ proxy, local }: any) => {
      const json = JSON.stringify({ proxies: [
        { ip: "1.2.3.4", port: 8080, protocol: "socks5" },
        { ip: "5.6.7.8", port: 3128, username: "u", password: "p" },
      ] });
      await proxy.addProxies(json);
      expect(local.proxies.list.map((p: any) => `${p.scheme}://${p.host}:${p.port}`)).toStrictEqual(["socks5://1.2.3.4:8080", "http://5.6.7.8:3128"]);
      expect(local.proxies.list[1].username).toBe("u");
    }));

  it("təkrar sətir köhnə qeydi ƏVƏZ edir, sayı şişirtmir", () =>
    withChrome({ proxies: [{ ...P, scheme: "http", username: "old", password: "old" }] }, async ({ proxy, local, calls }: any) => {
      const result = await proxy.addProxies("http://new:secret@203.0.113.9:1080\n1.2.3.4:8080");
      expect(result.added, "yalnız yeni ünvan sayılır").toBe(1);
      expect(result.replaced).toBe(1);
      expect(local.proxies.list.length).toBe(2);
      const updated = local.proxies.list.find((p: any) => p.host === "203.0.113.9");
      expect(updated.username).toBe("new");
      expect(calls.status.at(-1).text).toMatch(/təzələndi/);
    }));

  it("pozulmuş sətirlər statusda XƏBƏRDARLIQ kimi bildirilir, qalanı əlavə olunur", () =>
    withChrome({}, async ({ proxy, local, calls }: any) => {
      const result = await proxy.addProxies("1.2.3.4:8080\nsalam\n300.1.1.1:80");
      expect(result.added).toBe(1);
      expect(result.invalid.length).toBe(2);
      expect(local.proxies.list.length).toBe(1);
      expect(calls.status.at(-1).level).toBe("warn");
      expect(calls.status.at(-1).text).toMatch(/2 sətir tanınmadı/);
    }));

  it("heç bir ünvan tanınmasa aydın xəta atılır və siyahı dəyişmir", () =>
    withChrome({ proxies: [P] }, async ({ proxy, local }: any) => {
      await expect(() => proxy.addProxies("salam\ndünya")).rejects.toThrow(/heç bir ünvan tanınmadı/);
      await expect(() => proxy.addProxies("")).rejects.toThrow(/ünvan tapılmadı/);
      expect(local.proxies.list.length).toBe(1);
    }));

  it("bir neçə fayl (massiv) bir əməliyyatda əlavə olunur", () =>
    withChrome({}, async ({ proxy, local }: any) => {
      const txt = "# satıcı\n77.1.1.1:8080\nuser:pass@77.1.1.2:3128";
      const json = JSON.stringify({ proxies: [{ ip: "88.1.1.1", port: 1080, protocol: "socks5" }] });
      const result = await proxy.addProxies([txt, json]);
      expect(result.added).toBe(3);
      expect(local.proxies.list.map((p: any) => p.host)).toStrictEqual(["77.1.1.1", "77.1.1.2", "88.1.1.1"]);
    }));

  it("yerli ünvan da qəbul olunur (istifadəçinin öz proxy-si)", () =>
    withChrome({}, async ({ proxy, local }: any) => {
      await proxy.addProxies("127.0.0.1:8899\n192.168.1.9:3128");
      expect(local.proxies.list.map((p: any) => p.host)).toStrictEqual(["127.0.0.1", "192.168.1.9"]);
    }));
});

// Köhnə versiyanın idxal etdiyi minlərlə qeyd saxlancda qalır: oxu qatı onları süzür,
// miqrasiya isə saxlancın özünü təmizləyir və idxal olunmuş proxy qoşulu qalıbsa ayırır.
describe("köhnə idxal siyahısının silinməsi", () => {
  const imported = (n: any) : any => ({ scheme: "socks5", host: `5.5.5.${n}`, port: 1080, cc: "DEU", uptime: 90, source: "geonode" });

  it("readProxies idxal qeydlərini GÖSTƏRMİR (popup dərhal təmiz görür)", () =>
    withChrome({ proxies: [imported(1), imported(2), P] }, async () => {
      const { readProxies } = await import("../src/shared/state");
      const { list } = await readProxies();
      expect(list.map((p) => p.host)).toStrictEqual(["203.0.113.9"]);
      expect((await readProxies({ raw: true })).list.length, "raw oxu saxlancı olduğu kimi verir").toStrictEqual(3);
    }));

  it("migrateProxies saxlancı təmizləyir", () =>
    withChrome({ proxies: [imported(1), imported(2), P] }, async ({ proxy, local }: any) => {
      await proxy.migrateProxies();
      expect(local.proxies.list.map((p: any) => p.host)).toStrictEqual(["203.0.113.9"]);
    }));

  it("idxal olunmuş proxy qoşulu qalıbsa bağlantı kəsilir və status yazılır", () =>
    withChrome({ proxies: [imported(1)], active: imported(1), applied: ROUTED },
      async ({ proxy, calls, local, browser }: any) => {
        await proxy.migrateProxies();
        expect(local.proxies.list).toStrictEqual([]);
        expect(local.activeProxy).toBe(undefined);
        expect(calls.clear).toBe(1);
        expect(browser(), "brauzerin parametri də buraxılmalıdır").toBe(null);
        expect(calls.status.at(-1).text).toMatch(/Köhnə \(idxal olunmuş\) proxy siyahısı silindi/);
      }));

  it("öz proxy-si qoşuludursa bağlantıya TOXUNULMUR", () =>
    withChrome({ proxies: [imported(1), P], active: P }, async ({ proxy, calls, local }: any) => {
      await proxy.migrateProxies();
      expect(local.proxies.list.map((p: any) => p.host)).toStrictEqual(["203.0.113.9"]);
      expect(local.activeProxy.host).toBe("203.0.113.9");
      expect(calls.clear).toBe(0);
    }));

  it("təmizlənəcək qeyd yoxdursa saxlanca yazılmır", () =>
    withChrome({ proxies: [P], active: P }, async ({ proxy, local }: any) => {
      const before = local.proxies.updated;
      await proxy.migrateProxies();
      expect(local.proxies.updated, "boş yazma sayğacı təzələyib bildiriş yayardı").toBe(before);
    }));
});

describe("proxy autentifikasiyası", () => {
  it("yalnız PROXY sorğusuna cavab verilir", () =>
    withChrome({ active: { ...P, scheme: "http", username: "u", password: "p" }, applied: proxyConfig({ ...P, scheme: "http" }) }, async ({ proxy }: any) => {
      const proxyAnswer = await new Promise((resolve) => proxy.answerProxyAuth({ isProxy: true, requestId: "tools-auth", challenger: { host: P.host, port: P.port } }, resolve));
      expect(proxyAnswer).toStrictEqual({ authCredentials: { username: "u", password: "p" } });
      const siteAnswer = await new Promise((resolve) => proxy.answerProxyAuth({ isProxy: false }, resolve));
      expect(siteAnswer).toStrictEqual({});
    }));

  it("giriş məlumatı yoxdursa boş cavab (Chrome özü soruşur)", () =>
    withChrome({ active: P }, async ({ proxy }: any) => {
      const answer = await new Promise((resolve) => proxy.answerProxyAuth({ isProxy: true }, resolve));
      expect(answer).toStrictEqual({});
    }));
});

describe("izləyici qalxanı — worker tərəfi", () => {
  it("açılanda ruleset işə salınır və nişan yazılır", () =>
    withChrome({}, async ({ trackers, calls, local }: any) => {
      expect(await trackers.setShield(true)).toBe(true);
      expect(calls.rulesets.at(-1)).toStrictEqual({ enableRulesetIds: ["trackers"] });
      expect(local.shield).toBe(true);
      expect(calls.status.at(-1).text).toMatch(/açıldı/);
    }));

  it("söndürüləndə ruleset dayandırılır", () =>
    withChrome({}, async ({ trackers, calls, local }: any) => {
      expect(await trackers.setShield(false)).toBe(false);
      expect(calls.rulesets.at(-1)).toStrictEqual({ disableRulesetIds: ["trackers"] });
      expect(local.shield).toBe(false);
    }));
});
