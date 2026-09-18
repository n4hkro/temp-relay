// Alət qatı: izləyici qalxanı və proxy-nin worker tərəfi
// (background/trackers.js, background/proxy.js, background/tools.js).
//
// Proxy siyahısı YALNIZ istifadəçinin əlavə etdiyi ünvanlardan ibarətdir: açıq (ictimai) proxy
// mənbələri, onların formatları və "canlılıq" metadatası ümumiyyətlə yoxdur.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { MessageType, Message } from "../src/shared/messages.js";
import { proxyConfig, proxyKey } from "../src/shared/proxy.js";
import { isToolCommand } from "../src/background/tools.js";
import { TRACKER_RULESET_ID } from "../src/background/trackers.js";
import { IP_CHECK_URL } from "../src/background/proxy.js";

const RULES = JSON.parse(readFileSync(new URL("../rules/trackers.json", import.meta.url), "utf8"));

describe("izləyici qalxanının qaydaları", () => {
  it("hər qayda üçüncü tərəf sorğusunu bloklayır", () => {
    for (const rule of RULES) {
      assert.equal(rule.action.type, "block", `qayda ${rule.id}`);
      assert.equal(rule.condition.domainType, "thirdParty", `qayda ${rule.id}`);
      assert.ok(Array.isArray(rule.condition.requestDomains) && rule.condition.requestDomains.length);
    }
  });

  it("qayda id-ləri təkrarlanmır", () => {
    const ids = RULES.map((rule) => rule.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  it("tanınmış izləyicilər siyahıdadır", () => {
    const domains = new Set(RULES.flatMap((rule) => rule.condition.requestDomains));
    for (const domain of ["google-analytics.com", "doubleclick.net", "connect.facebook.net",
      "hotjar.com", "mc.yandex.ru", "clarity.ms", "appsflyer.com"]) {
      assert.ok(domains.has(domain), domain);
    }
  });

  it("saytın öz müdafiəsi bloklanmır (fingerprint kitabxanaları siyahıda yoxdur)", () => {
    const text = JSON.stringify(RULES);
    for (const domain of ["fingerprintjs", "recaptcha", "hcaptcha", "challenges.cloudflare.com", "turnstile"]) {
      assert.equal(text.includes(domain), false, domain);
    }
  });

  it("ruleset id-si kodla eynidir", () => {
    assert.equal(TRACKER_RULESET_ID, "trackers");
  });
});

describe("alət əmrləri", () => {
  it("mesaj qurucuları tip və dəyəri daşıyır", () => {
    assert.deepEqual(Message.setShield(true), { type: MessageType.SET_SHIELD, on: true });
    assert.deepEqual(Message.setShield("bəli"), { type: MessageType.SET_SHIELD, on: false }, "yalnız true qəbul olunur");
    assert.deepEqual(Message.proxyAdd(" 1.2.3.4:8080 "), { type: MessageType.PROXY_ADD, text: " 1.2.3.4:8080 " });
    assert.deepEqual(Message.proxyAdd("1.2.3.4:8080\n5.6.7.8:1080"),
      { type: MessageType.PROXY_ADD, text: "1.2.3.4:8080\n5.6.7.8:1080" }, "çoxsətirli mətn olduğu kimi ötürülür");
    assert.deepEqual(Message.proxyConnect("http://1.2.3.4:8080"), { type: MessageType.PROXY_CONNECT, key: "http://1.2.3.4:8080" });
    assert.deepEqual(Message.proxyRemove("k"), { type: MessageType.PROXY_REMOVE, keys: ["k"] });
    assert.deepEqual(Message.proxyRemove(["a", "b"]), { type: MessageType.PROXY_REMOVE, keys: ["a", "b"] },
      "toplu silmə massiv göndərir");
    assert.deepEqual(Message.proxyDisconnect(), { type: MessageType.PROXY_DISCONNECT });
  });

  it("idxal əmri ARTIQ YOXDUR (açıq mənbələr silindi)", () => {
    assert.equal(MessageType.PROXY_IMPORT, undefined);
    assert.equal(Message.proxyImport, undefined);
    assert.equal(isToolCommand({ type: "proxyImport" }), false);
  });

  it("router yalnız alət əmrlərini tanıyır", () => {
    for (const type of [MessageType.SET_SHIELD, MessageType.PROXY_ADD,
      MessageType.PROXY_REMOVE, MessageType.PROXY_CONNECT, MessageType.PROXY_DISCONNECT,
      MessageType.DESCRIBE_PAGE]) {
      assert.equal(isToolCommand({ type }), true, type);
    }
    for (const type of [MessageType.START, MessageType.STOP, MessageType.NEW_ADDRESS,
      MessageType.CLEAR_TAB, MessageType.COPY, "toString", undefined]) {
      assert.equal(isToolCommand({ type }), false, String(type));
    }
    assert.equal(isToolCommand(null), false);
  });

  it("diaqnostika əmri yalnız tab id-si daşıyır (səhifəni worker özü oxuyur)", () => {
    assert.deepEqual(Message.describePage(7), { type: MessageType.DESCRIBE_PAGE, tabId: 7 });
  });

  it("çıxış IP xidməti https-dir və yalnız IP qaytarır", () => {
    assert.match(IP_CHECK_URL, /^https:\/\/api\.ipify\.org\//);
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
  applied: initial = null, stickyClear = false, frozen = false }, fn) {
  const previous = { chrome: globalThis.chrome, fetch: globalThis.fetch };
  const local = { proxies: { list: proxies, updated: 1 }, ...(active ? { activeProxy: active } : {}) };
  const calls = { set: [], clear: 0, status: [], rulesets: [] };
  // Brauzerin cari parametri: null = extension yönləndirmir
  let applied = initial;
  globalThis.chrome = {
    storage: {
      local: {
        get: async (key) => (typeof key === "string" ? { [key]: local[key] } : local),
        set: async (patch) => Object.assign(local, patch),
        remove: async (key) => { delete local[key]; },
      },
      session: {
        get: async () => ({}),
        set: async (patch) => { if (patch.status) calls.status.push(patch.status); },
        remove: async () => {},
      },
    },
    proxy: {
      settings: {
        set: async (options) => { calls.set.push(options); if (!frozen) applied = options.value; },
        clear: async () => { calls.clear += 1; if (!frozen && !stickyClear) applied = null; },
        get: async () => ({
          value: applied ?? { mode: "system" },
          levelOfControl: applied ? "controlled_by_this_extension" : "controllable_by_this_extension",
        }),
      },
    },
    declarativeNetRequest: {
      getEnabledRulesets: async () => [],
      updateEnabledRulesets: async (options) => calls.rulesets.push(options),
    },
  };
  globalThis.fetch = async () => (ok
    ? { ok: true, text: async () => ip }
    : Promise.reject(Object.assign(new Error("timeout"), { name: "TimeoutError" })));

  const proxy = await import("../src/background/proxy.js");
  const trackers = await import("../src/background/trackers.js");
  try {
    return await fn({ proxy, trackers, calls, local, browser: () => applied });
  } finally {
    globalThis.chrome = previous.chrome;
    globalThis.fetch = previous.fetch;
    if (previous.chrome === undefined) delete globalThis.chrome;
    if (previous.fetch === undefined) delete globalThis.fetch;
  }
}

const P = { scheme: "socks5", host: "203.0.113.9", port: 1080 };
// Brauzerdə qalmış (extension-ın qurduğu) fixed_servers parametri
const ROUTED = { mode: "fixed_servers", rules: { singleProxy: { scheme: "http", host: "31.59.20.176", port: 6754 } } };

describe("worker: idxal funksiyası yoxdur", () => {
  it("background/proxy.js açıq mənbələrdən çəkmə ixrac etmir", async () => {
    const module = await import("../src/background/proxy.js");
    assert.equal(module.importProxies, undefined);
    assert.equal(module.verifyProxies, undefined);
    // ixrac olunanlar: toplu əlavə/sil/qoşul/ayır + yoxlama, brauzer parametrinin
    // oxunması/buraxılması, autentifikasiya və miqrasiya
    assert.deepEqual(Object.keys(module).sort(), [
      "IP_CHECK_URL", "addProxies", "answerProxyAuth", "browserProxy", "checkExit", "connectProxy",
      "disconnectProxy", "migrateProxies", "releaseProxy", "removeProxy", "resumeProxy",
    ]);
  });
});

describe("connectProxy / disconnectProxy", () => {
  it("Chrome parametri qurulur və çıxış IP saxlanca yazılır", () =>
    withChrome({ proxies: [P] }, async ({ proxy, calls, local }) => {
      const result = await proxy.connectProxy(proxyKey(P));
      assert.equal(result.exit.ok, true);
      assert.equal(calls.set.length, 1);
      assert.equal(calls.set[0].scope, "regular");
      assert.deepEqual(calls.set[0].value.rules.singleProxy, { scheme: "socks5", host: "203.0.113.9", port: 1080 });
      assert.equal(local.activeProxy.exitIp, "203.0.113.7");
      assert.match(calls.status.at(-1).text, /çıxış IP 203\.0\.113\.7/);
    }));

  it("ölçülmüş gecikmə siyahıdaki qeydə də yazılır (popup onu göstərir)", () =>
    withChrome({ proxies: [P] }, async ({ proxy, local }) => {
      await proxy.connectProxy(proxyKey(P));
      assert.equal(typeof local.proxies.list[0].ping, "number");
      assert.equal(local.proxies.list[0].dead, undefined);
    }));

  it("ölü proxy: bağlantı KƏSİLİR (brauzerdə qalsa bütün saytlar açılmazdı)", () =>
    withChrome({ proxies: [P], ok: false }, async ({ proxy, calls, local, browser }) => {
      const result = await proxy.connectProxy(proxyKey(P));
      assert.equal(result.exit.ok, false);
      assert.equal(local.activeProxy, undefined, "aktiv qeyd qalmamalıdır");
      assert.equal(browser(), null, "brauzerin parametri buraxılmalıdır");
      assert.equal(local.proxies.list[0].dead, true);
      assert.equal(calls.status.at(-1).level, "warn");
      assert.match(calls.status.at(-1).text, /cavab vermir/);
      assert.match(calls.status.at(-1).text, /Bağlantı kəsildi/);
    }));

  it("ölü proxy: buraxma tutmasa BİRBAŞA bağlantı məcbur edilir", () =>
    withChrome({ proxies: [P], ok: false, stickyClear: true }, async ({ proxy, calls, browser }) => {
      await proxy.connectProxy(proxyKey(P));
      assert.deepEqual(browser(), { mode: "direct" }, "trafik birbaşa bağlantıya qaytarılmalıdır");
      assert.ok(calls.set.some((call) => call.value?.mode === "direct"));
      assert.equal(calls.status.at(-1).level, "warn");
    }));

  it("heç bir yolla buraxılmasa istifadəçiyə səbəbi deyilir", () =>
    withChrome({ proxies: [P], ok: false, frozen: true, applied: proxyConfig(P) }, async ({ proxy, calls }) => {
      await proxy.connectProxy(proxyKey(P));
      assert.equal(calls.status.at(-1).level, "warn");
      assert.match(calls.status.at(-1).text, /Chrome-u yenidən başlat/);
    }));

  it("siyahıda olmayan proxy üçün aydın xəta", () =>
    withChrome({ proxies: [] }, async ({ proxy }) => {
      await assert.rejects(() => proxy.connectProxy("http://1.2.3.4:8080"), /siyahıda yoxdur/);
    }));

  it("ayrılma parametri təmizləyir və aktiv qeydi silir", () =>
    withChrome({ proxies: [P], active: P, applied: ROUTED }, async ({ proxy, calls, local, browser }) => {
      await proxy.disconnectProxy();
      assert.equal(calls.clear, 1);
      assert.equal(local.activeProxy, undefined);
      assert.equal(browser(), null);
      assert.match(calls.status.at(-1).text, /ayrıldı/);
      assert.equal(calls.status.at(-1).level, "info");
    }));

  it("ayrılma: `clear` tutmasa parametr yenə birbaşa bağlantıya qaytarılır", () =>
    withChrome({ proxies: [P], active: P, applied: ROUTED, stickyClear: true },
      async ({ proxy, calls, local, browser }) => {
        await proxy.disconnectProxy();
        assert.equal(local.activeProxy, undefined);
        assert.deepEqual(browser(), { mode: "direct" });
        assert.equal(calls.status.at(-1).level, "info", "trafik birbaşadır — xəbərdarlığa ehtiyac yoxdur");
      }));

  it("ayrılma: parametr heç bir yolla buraxılmasa qeyd YENƏ silinir və səbəb deyilir", () =>
    withChrome({ proxies: [P], active: P, applied: ROUTED, frozen: true },
      async ({ proxy, calls, local }) => {
        await proxy.disconnectProxy();
        assert.equal(local.activeProxy, undefined, "popup 'qoşulu' göstərməməlidir");
        assert.equal(calls.status.at(-1).level, "warn");
        assert.match(calls.status.at(-1).text, /brauzerin parametri hələ qüvvədədir/);
      }));

  it("aktiv proxy silinəndə bağlantı da kəsilir", () =>
    withChrome({ proxies: [P], active: P }, async ({ proxy, calls, local }) => {
      await proxy.removeProxy(proxyKey(P));
      assert.deepEqual(local.proxies.list, []);
      assert.equal(calls.clear, 1);
    }));

  it("TOPLU silmə: bir neçə açar bir sorğuda gedir, sayı statusda deyilir", () =>
    withChrome({ proxies: [P, { scheme: "http", host: "1.1.1.1", port: 80 }, { scheme: "http", host: "2.2.2.2", port: 80 }] },
      async ({ proxy, calls, local }) => {
        const result = await proxy.removeProxy(["http://1.1.1.1:80", "http://2.2.2.2:80"]);
        assert.deepEqual(result, { removed: 2, total: 1 });
        assert.deepEqual(local.proxies.list.map((p) => p.host), ["203.0.113.9"]);
        assert.match(calls.status.at(-1).text, /2 proxy silindi/);
      }));

  it("toplu silmədə qoşulu proxy də varsa bağlantı kəsilir", () =>
    withChrome({ proxies: [P], active: P }, async ({ proxy, calls, local }) => {
      await proxy.removeProxy([proxyKey(P), "http://9.9.9.9:80"]);
      assert.deepEqual(local.proxies.list, []);
      assert.equal(local.activeProxy, undefined);
      assert.equal(calls.clear, 1);
    }));

  it("siyahıda olmayan açar səssiz keçir (silinən sayı 0)", () =>
    withChrome({ proxies: [P] }, async ({ proxy, local }) => {
      assert.deepEqual(await proxy.removeProxy(["http://9.9.9.9:80"]), { removed: 0, total: 1 });
      assert.equal(local.proxies.list.length, 1);
    }));
});

describe("resumeProxy — saxlanc ilə BRAUZERİN parametrinin uzlaşdırılması", () => {
  // Qüsurun özü: istifadəçi proxy-ni ayırdı (saxlancdaki qeyd silindi), Chrome-un parametri isə
  // profil faylında qaldı. Nəticədə popup "qoşulu deyil" yazırdı, bütün saytlar isə yalnız
  // extension söndürüləndə açılırdı. Bərpa addımı məhz bu vəziyyəti düzəldir.
  it("saxlancda qeyd YOXDUR, brauzerin parametri qalıb → parametr buraxılır", () =>
    withChrome({ proxies: [], active: null, applied: ROUTED }, async ({ proxy, calls, browser }) => {
      await proxy.resumeProxy();
      assert.equal(browser(), null, "qalmış parametr buraxılmalıdır");
      assert.equal(calls.status.at(-1).level, "info");
      assert.match(calls.status.at(-1).text, /Brauzerdə qalmış proxy parametri buraxıldı/);
    }));

  it("qalmış parametr buraxılmasa istifadəçiyə nə edəcəyi deyilir", () =>
    withChrome({ applied: ROUTED, frozen: true }, async ({ proxy, calls }) => {
      await proxy.resumeProxy();
      assert.equal(calls.status.at(-1).level, "warn");
      assert.match(calls.status.at(-1).text, /Chrome-u yenidən başlat/);
    }));

  it("qeyd yoxdur, brauzer də yönləndirmir → heç nə edilmir (adi hal)", () =>
    withChrome({}, async ({ proxy, calls }) => {
      await proxy.resumeProxy();
      assert.equal(calls.set.length, 0);
      assert.equal(calls.clear, 0);
      assert.deepEqual(calls.status, [], "boş status brauzer açılışında hər dəfə görünərdi");
    }));

  it("TƏZƏ yoxlanmış qeyd bərpa olunur, şəbəkə sorğusu göndərilmir", () =>
    withChrome({ proxies: [P], active: { ...P, checked: Date.now() } }, async ({ proxy, calls, browser }) => {
      await proxy.resumeProxy();
      assert.equal(calls.set.length, 1);
      assert.deepEqual(browser().rules.singleProxy, { scheme: "socks5", host: "203.0.113.9", port: 1080 });
      assert.deepEqual(calls.status, []);
    }));

  it("KÖHNƏ qeyd yenidən yoxlanılır: işləyirsə qalır və ölü nişanı düşür", () =>
    withChrome({ proxies: [{ ...P, dead: true }], active: { ...P, dead: true, checked: 1 } },
      async ({ proxy, local, browser }) => {
        await proxy.resumeProxy();
        assert.equal(local.activeProxy.exitIp, "203.0.113.7");
        assert.equal(local.proxies.list[0].dead, undefined, "ölü nişanı silinməlidir");
        assert.equal(browser().mode, "fixed_servers");
      }));

  it("KÖHNƏ qeyd cavab vermirsə bağlantı kəsilir — brauzer kilidli qalmır", () =>
    withChrome({ proxies: [P], active: { ...P, checked: 1 }, ok: false },
      async ({ proxy, calls, local, browser }) => {
        await proxy.resumeProxy();
        assert.equal(local.activeProxy, undefined);
        assert.equal(local.proxies.list[0].dead, true);
        assert.equal(browser(), null, "trafik birbaşa bağlantıya qaytarılmalıdır");
        assert.equal(calls.status.at(-1).level, "warn");
        assert.match(calls.status.at(-1).text, /birbaşa bağlantıya qayıdıldı/);
      }));

  it("pozulmuş qeyd (yanlış sxem) bərpa edilmir və worker batmır", () =>
    withChrome({ active: { scheme: "ftp", host: "1.2.3.4", port: 80 } }, async ({ proxy, browser }) => {
      await proxy.resumeProxy();
      assert.equal(browser(), null);
    }));
});

describe("releaseProxy / browserProxy", () => {
  it("browserProxy parametrin bizə aid olduğunu və trafikin yönləndiyini deyir", () =>
    withChrome({ applied: ROUTED }, async ({ proxy }) => {
      assert.deepEqual(await proxy.browserProxy(), {
        mode: "fixed_servers", level: "controlled_by_this_extension", ours: true, routed: true,
      });
    }));

  it("yönləndirmə olmayanda `routed` false olur", () =>
    withChrome({}, async ({ proxy }) => {
      const control = await proxy.browserProxy();
      assert.equal(control.routed, false);
      assert.equal(control.ours, false);
    }));

  it("releaseProxy buraxılmanı YOXLAYIR və nəticəni qaytarır", () =>
    withChrome({ applied: ROUTED }, async ({ proxy, calls }) => {
      const control = await proxy.releaseProxy();
      assert.equal(control.routed, false);
      assert.equal(calls.clear, 1, "bir buraxma kifayət etdi");
    }));

  it("buraxma tutmasa birbaşa rejim qurulur və buraxma bir daha sınanır", () =>
    withChrome({ applied: ROUTED, stickyClear: true }, async ({ proxy, calls }) => {
      const control = await proxy.releaseProxy();
      assert.equal(control.mode, "direct");
      assert.equal(control.routed, false);
      assert.equal(calls.clear, 2);
      assert.deepEqual(calls.set.at(-1), { value: { mode: "direct" }, scope: "regular" });
    }));

  it("chrome.proxy oxunmasa çökmür, 'yönləndirmə yoxdur' qaytarır", () =>
    withChrome({}, async ({ proxy }) => {
      chrome.proxy.settings.get = async () => { throw new Error("no access"); };
      const control = await proxy.browserProxy();
      assert.deepEqual(control, { mode: null, level: null, ours: false, routed: false });
    }));
});

describe("addProxies — toplu əlavə", () => {
  it("bir sətir: yeni proxy siyahının BAŞINA düşür", () =>
    withChrome({ proxies: [P] }, async ({ proxy, local }) => {
      const result = await proxy.addProxies("user:pass@198.51.100.4:8080");
      assert.equal(result.added, 1);
      assert.equal(local.proxies.list[0].host, "198.51.100.4");
      assert.equal(local.proxies.list[0].username, "user");
      assert.equal(local.proxies.list.length, 2);
    }));

  it("yüzlərlə sətir bir əməliyyatda əlavə olunur", () =>
    withChrome({}, async ({ proxy, local, calls }) => {
      const lines = Array.from({ length: 250 }, (_, i) => `45.10.1.${(i % 254) + 1}:${8000 + i}`);
      const result = await proxy.addProxies(lines.join("\n"));
      assert.equal(result.added, 250);
      assert.equal(local.proxies.list.length, 250);
      assert.match(calls.status.at(-1).text, /250 proxy əlavə olundu/);
      assert.equal(calls.status.at(-1).level, "info");
    }));

  it("fayl məzmunu (JSON) da qəbul olunur", () =>
    withChrome({}, async ({ proxy, local }) => {
      const json = JSON.stringify({ proxies: [
        { ip: "1.2.3.4", port: 8080, protocol: "socks5" },
        { ip: "5.6.7.8", port: 3128, username: "u", password: "p" },
      ] });
      await proxy.addProxies(json);
      assert.deepEqual(local.proxies.list.map((p) => `${p.scheme}://${p.host}:${p.port}`),
        ["socks5://1.2.3.4:8080", "http://5.6.7.8:3128"]);
      assert.equal(local.proxies.list[1].username, "u");
    }));

  it("təkrar sətir köhnə qeydi ƏVƏZ edir, sayı şişirtmir", () =>
    withChrome({ proxies: [{ ...P, scheme: "http", username: "old", password: "old" }] }, async ({ proxy, local, calls }) => {
      const result = await proxy.addProxies("http://new:secret@203.0.113.9:1080\n1.2.3.4:8080");
      assert.equal(result.added, 1, "yalnız yeni ünvan sayılır");
      assert.equal(result.replaced, 1);
      assert.equal(local.proxies.list.length, 2);
      const updated = local.proxies.list.find((p) => p.host === "203.0.113.9");
      assert.equal(updated.username, "new");
      assert.match(calls.status.at(-1).text, /təzələndi/);
    }));

  it("pozulmuş sətirlər statusda XƏBƏRDARLIQ kimi bildirilir, qalanı əlavə olunur", () =>
    withChrome({}, async ({ proxy, local, calls }) => {
      const result = await proxy.addProxies("1.2.3.4:8080\nsalam\n300.1.1.1:80");
      assert.equal(result.added, 1);
      assert.equal(result.invalid.length, 2);
      assert.equal(local.proxies.list.length, 1);
      assert.equal(calls.status.at(-1).level, "warn");
      assert.match(calls.status.at(-1).text, /2 sətir tanınmadı/);
    }));

  it("heç bir ünvan tanınmasa aydın xəta atılır və siyahı dəyişmir", () =>
    withChrome({ proxies: [P] }, async ({ proxy, local }) => {
      await assert.rejects(() => proxy.addProxies("salam\ndünya"), /heç bir ünvan tanınmadı/);
      await assert.rejects(() => proxy.addProxies(""), /ünvan tapılmadı/);
      assert.equal(local.proxies.list.length, 1);
    }));

  it("bir neçə fayl (massiv) bir əməliyyatda əlavə olunur", () =>
    withChrome({}, async ({ proxy, local }) => {
      const txt = "# satıcı\n77.1.1.1:8080\nuser:pass@77.1.1.2:3128";
      const json = JSON.stringify({ proxies: [{ ip: "88.1.1.1", port: 1080, protocol: "socks5" }] });
      const result = await proxy.addProxies([txt, json]);
      assert.equal(result.added, 3);
      assert.deepEqual(local.proxies.list.map((p) => p.host), ["77.1.1.1", "77.1.1.2", "88.1.1.1"]);
    }));

  it("yerli ünvan da qəbul olunur (istifadəçinin öz proxy-si)", () =>
    withChrome({}, async ({ proxy, local }) => {
      await proxy.addProxies("127.0.0.1:8899\n192.168.1.9:3128");
      assert.deepEqual(local.proxies.list.map((p) => p.host), ["127.0.0.1", "192.168.1.9"]);
    }));
});

// Köhnə versiyanın idxal etdiyi minlərlə qeyd saxlancda qalır: oxu qatı onları süzür,
// miqrasiya isə saxlancın özünü təmizləyir və idxal olunmuş proxy qoşulu qalıbsa ayırır.
describe("köhnə idxal siyahısının silinməsi", () => {
  const imported = (n) => ({ scheme: "socks5", host: `5.5.5.${n}`, port: 1080, cc: "DEU", uptime: 90, source: "geonode" });

  it("readProxies idxal qeydlərini GÖSTƏRMİR (popup dərhal təmiz görür)", () =>
    withChrome({ proxies: [imported(1), imported(2), P] }, async () => {
      const { readProxies } = await import("../src/shared/state.js");
      const { list } = await readProxies();
      assert.deepEqual(list.map((p) => p.host), ["203.0.113.9"]);
      assert.deepEqual((await readProxies({ raw: true })).list.length, 3, "raw oxu saxlancı olduğu kimi verir");
    }));

  it("migrateProxies saxlancı təmizləyir", () =>
    withChrome({ proxies: [imported(1), imported(2), P] }, async ({ proxy, local }) => {
      await proxy.migrateProxies();
      assert.deepEqual(local.proxies.list.map((p) => p.host), ["203.0.113.9"]);
    }));

  it("idxal olunmuş proxy qoşulu qalıbsa bağlantı kəsilir və status yazılır", () =>
    withChrome({ proxies: [imported(1)], active: imported(1), applied: ROUTED },
      async ({ proxy, calls, local, browser }) => {
        await proxy.migrateProxies();
        assert.deepEqual(local.proxies.list, []);
        assert.equal(local.activeProxy, undefined);
        assert.equal(calls.clear, 1);
        assert.equal(browser(), null, "brauzerin parametri də buraxılmalıdır");
        assert.match(calls.status.at(-1).text, /Köhnə \(idxal olunmuş\) proxy siyahısı silindi/);
      }));

  it("öz proxy-si qoşuludursa bağlantıya TOXUNULMUR", () =>
    withChrome({ proxies: [imported(1), P], active: P }, async ({ proxy, calls, local }) => {
      await proxy.migrateProxies();
      assert.deepEqual(local.proxies.list.map((p) => p.host), ["203.0.113.9"]);
      assert.equal(local.activeProxy.host, "203.0.113.9");
      assert.equal(calls.clear, 0);
    }));

  it("təmizlənəcək qeyd yoxdursa saxlanca yazılmır", () =>
    withChrome({ proxies: [P], active: P }, async ({ proxy, local }) => {
      const before = local.proxies.updated;
      await proxy.migrateProxies();
      assert.equal(local.proxies.updated, before, "boş yazma sayğacı təzələyib bildiriş yayardı");
    }));
});

describe("proxy autentifikasiyası", () => {
  it("yalnız PROXY sorğusuna cavab verilir", () =>
    withChrome({ active: { ...P, scheme: "http", username: "u", password: "p" }, applied: proxyConfig({ ...P, scheme: "http" }) }, async ({ proxy }) => {
      const proxyAnswer = await new Promise((resolve) => proxy.answerProxyAuth({ isProxy: true, requestId: "tools-auth", challenger: { host: P.host, port: P.port } }, resolve));
      assert.deepEqual(proxyAnswer, { authCredentials: { username: "u", password: "p" } });
      const siteAnswer = await new Promise((resolve) => proxy.answerProxyAuth({ isProxy: false }, resolve));
      assert.deepEqual(siteAnswer, {});
    }));

  it("giriş məlumatı yoxdursa boş cavab (Chrome özü soruşur)", () =>
    withChrome({ active: P }, async ({ proxy }) => {
      const answer = await new Promise((resolve) => proxy.answerProxyAuth({ isProxy: true }, resolve));
      assert.deepEqual(answer, {});
    }));
});

describe("izləyici qalxanı — worker tərəfi", () => {
  it("açılanda ruleset işə salınır və nişan yazılır", () =>
    withChrome({}, async ({ trackers, calls, local }) => {
      assert.equal(await trackers.setShield(true), true);
      assert.deepEqual(calls.rulesets.at(-1), { enableRulesetIds: ["trackers"] });
      assert.equal(local.shield, true);
      assert.match(calls.status.at(-1).text, /açıldı/);
    }));

  it("söndürüləndə ruleset dayandırılır", () =>
    withChrome({}, async ({ trackers, calls, local }) => {
      assert.equal(await trackers.setShield(false), false);
      assert.deepEqual(calls.rulesets.at(-1), { disableRulesetIds: ["trackers"] });
      assert.equal(local.shield, false);
    }));
});
