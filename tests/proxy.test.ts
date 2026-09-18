// Şəxsi proxy sətirlərinin oxunması və Chrome konfiqurasiyası (shared/proxy.ts).
//
// Siyahı yalnız istifadəçinin yazdığı sətirlərdən dolur (açıq mənbələr yoxdur), amma satıcılar
// hər cür format verir: "ip:port", "socks5://…", "user:pass@…", "ip:port:user:pass". Səhv
// ayrıştırma iki cür ziyan verir: ya işlək proxy rədd olunur, ya yanlış ünvana qoşulmağa
// çalışırıq — üstəlik parol yerində olmasa Chrome hər sorğuda pəncərə açır.
import { describe, expect, it } from "vitest";

import {
  BYPASS, DEFAULT_SCHEME, DIRECT_MODES, formatPing, isImported, isIpv4, isRouting, MAX_PROXIES,
  mergeProxies, orderProxies, parseProxy, parseProxyLines, PROXY_SCHEMES, proxyConfig, proxyKey,
  proxyLabel, proxyLines, proxyProblem, pruneImported, readProxyControl,
} from "../src/shared/proxy";
import type { ProxyEntry } from "../src/shared/proxy";

describe("parseProxy — formatlar", () => {
  it("URL formatında kodlanmış giriş məlumatı və JSON xüsusi simvolları saxlanır", () => {
    const expected = { scheme: "http", host: "proxy.example.com", port: 8080, username: "u@x", password: "p:@ /%" };
    expect(parseProxy("http://u%40x:p%3A%40%20%2F%25@proxy.example.com:8080")).toStrictEqual(expected);
    expect(parseProxyLines(JSON.stringify([expected])).proxies).toStrictEqual([expected]);
  });
  it("adi ip:port", () => {
    expect(parseProxy("1.2.3.4:8080")).toStrictEqual({ scheme: "http", host: "1.2.3.4", port: 8080 });
  });

  it("sətirdəki sxem üstün tutulur", () => {
    expect(parseProxy("socks5://5.6.7.8:1080", "http")).toStrictEqual({ scheme: "socks5", host: "5.6.7.8", port: 1080 });
    expect(parseProxy("socks4://5.6.7.8:1080")!.scheme).toBe("socks4");
    expect(parseProxy("https://5.6.7.8:443")!.scheme).toBe("https");
    // "socks" tək başına SOCKS5 sayılır (bəzi satıcılar belə yazır)
    expect(parseProxy("socks://5.6.7.8:1080")!.scheme).toBe("socks5");
  });

  it("sxem yoxdursa http sayılır", () => {
    expect(parseProxy("1.2.3.4:8080")!.scheme).toBe(DEFAULT_SCHEME);
    expect(DEFAULT_SCHEME).toBe("http");
    // çağıran tərəf başqa ehtiyat sxem verə bilər
    expect(parseProxy("1.2.3.4:1080", "socks5")!.scheme).toBe("socks5");
  });

  it("naməlum sxem atılır (v2ray, ss, trojan)", () => {
    for (const line of ["vmess://abc", "ss://abc@1.2.3.4:8080", "trojan://1.2.3.4:443"]) {
      expect(parseProxy(line), line).toBe(null);
    }
  });

  it("istifadəçi adı və parol", () => {
    expect(parseProxy("user:s3cret@1.2.3.4:8080")).toStrictEqual({ scheme: "http", host: "1.2.3.4", port: 8080, username: "user", password: "s3cret" });
    expect(parseProxy("socks5://u:p@1.2.3.4:1080")!.username).toStrictEqual("u");
    // host:port:user:pass formatı
    expect(parseProxy("1.2.3.4:8080:user:pass")).toStrictEqual({ scheme: "http", host: "1.2.3.4", port: 8080, username: "user", password: "pass" });
    // parolda ":" ola bilər
    expect(parseProxy("user:a:b:c@1.2.3.4:8080")!.password).toBe("a:b:c");
  });

  it("giriş məlumatı olan SOCKS qeydi aydın səbəblə rədd olunur", () => {
    for (const scheme of ["socks4", "socks5"]) {
      const { proxies, invalid } = parseProxyLines(`${scheme}://user:secret@1.2.3.4:1080`);
      expect(proxies, scheme).toStrictEqual([]);
      expect(invalid.length, scheme).toBe(1);
      expect(invalid[0].reason).toMatch(/SOCKS/i);
      expect(invalid[0].reason).toMatch(/giriş|istifadəçi|parol/i);
    }
  });

  it("giriş məlumatı HTTP/HTTPS üçün qalır, autentifikasiyasız SOCKS qəbul olunur", () => {
    const { proxies, invalid } = parseProxyLines([
      "http://user:secret@1.2.3.4:8080",
      "https://user:secret@1.2.3.5:8443",
      "socks4://1.2.3.6:1080",
      "socks5://1.2.3.7:1080",
    ].join("\n"));
    expect(invalid).toStrictEqual([]);
    expect(proxies.map(({ scheme, username }: any) : any => ({ scheme, username }))).toStrictEqual([
      { scheme: "http", username: "user" },
      { scheme: "https", username: "user" },
      { scheme: "socks4", username: undefined },
      { scheme: "socks5", username: undefined },
    ]);
  });

  it("host adı da qəbul olunur", () => {
    expect(parseProxy("proxy.example.com:3128")).toStrictEqual({ scheme: "http", host: "proxy.example.com", port: 3128 });
  });

  it("YERLİ ünvan da qəbul olunur — istifadəçinin öz serveri ola bilər", () => {
    expect(parseProxy("127.0.0.1:8899")).toStrictEqual({ scheme: "http", host: "127.0.0.1", port: 8899 });
    expect(parseProxy("192.168.1.9:3128")).toStrictEqual({ scheme: "http", host: "192.168.1.9", port: 3128 });
  });

  it("artıq sözlər və boşluqlar atılır", () => {
    expect(parseProxy("  1.2.3.4:8080   Germany  1.2s ")).toStrictEqual({ scheme: "http", host: "1.2.3.4", port: 8080 });
  });

  it("şərh sətirləri və zibil null qaytarır", () => {
    for (const line of ["", "   ", "# başlıq", "// qeyd", "salam dünya", "1.2.3.4",
      "1.2.3.4:0", "1.2.3.4:99999", "300.1.1.1:80", "not-a-host:80", ":8080"]) {
      expect(parseProxy(line), JSON.stringify(line)).toBe(null);
    }
  });
});

describe("isIpv4", () => {
  it("IPv4 tanınır", () => {
    expect(isIpv4("192.168.0.1")).toBe(true);
    expect(isIpv4("255.255.255.255")).toBe(true);
    expect(isIpv4("1.2.3")).toBe(false);
    expect(isIpv4("1.2.3.256")).toBe(false);
    expect(isIpv4("01.2.3.4"), "sıfırla başlayan oktet qəbul olunmur").toBe(false);
    expect(isIpv4("proxy.example.com")).toBe(false);
  });
});

describe("mergeProxies", () => {
  const a: ProxyEntry = { scheme: "http", host: "1.1.1.1", port: 80 };
  const b: ProxyEntry = { scheme: "http", host: "2.2.2.2", port: 80 };

  it("təkrarlar birləşdirilir, İLK qeyd qalır", () => {
    const withAuth = { ...a, username: "u", password: "p" };
    const merged = mergeProxies([withAuth], [a]);
    expect(merged.length).toBe(1);
    expect(merged[0].username, "giriş məlumatı itdi").toBe("u");
  });

  it("sıra dəyişmir — istifadəçinin yazdığı ardıcıllıq qalır", () => {
    expect(mergeProxies([a, b], []).map(proxyKey)).toStrictEqual(["http://1.1.1.1:80", "http://2.2.2.2:80"]);
  });

  it("fərqli sxem/port ayrı qeyddir", () => {
    expect(mergeProxies([a, { ...a, scheme: "socks5" }, { ...a, port: 8080 }], []).length).toBe(3);
  });

  it("tavan gözlənilir (toplu əlavə yüzlərlə sətir ola bilər)", () => {
    const many = Array.from({ length: 20 }, (_, i) : any => ({ scheme: "http", host: `3.3.3.${i}`, port: 80 }));
    expect(mergeProxies([], many, { max: 5 }).length).toBe(5);
    expect(MAX_PROXIES).toBe(1000);
  });

  it("boş və pozulmuş giriş boş nəticə verir", () => {
    expect(mergeProxies()).toStrictEqual([]);
    expect(mergeProxies([null, undefined] as any, [])).toStrictEqual([]);
  });
});

describe("orderProxies — göstərmə sırası", () => {
  const live: ProxyEntry = { scheme: "http", host: "1.1.1.1", port: 80 };
  const dead: ProxyEntry = { scheme: "http", host: "2.2.2.2", port: 80, dead: true };
  const other: ProxyEntry = { scheme: "socks5", host: "3.3.3.3", port: 1080 };

  it("cavab verməyən qeydlər sona keçir, qalanı olduğu kimi qalır", () => {
    expect(orderProxies([dead, live, other]).map((p) => p.host)).toStrictEqual(["1.1.1.1", "3.3.3.3", "2.2.2.2"]);
  });

  it("giriş siyahısı dəyişdirilmir", () => {
    const list = [dead, live];
    orderProxies(list);
    expect(list.map((p) => p.host)).toStrictEqual(["2.2.2.2", "1.1.1.1"]);
  });

  it("boş və pozulmuş giriş boş nəticə verir", () => {
    for (const value of [null, undefined, []]) expect(orderProxies(value)).toStrictEqual([]);
    expect(orderProxies([null] as any)).toStrictEqual([]);
  });
});

describe("proxyProblem / etiketlər", () => {
  it("qaydalı proxy problem vermir", () => {
    expect(proxyProblem({ scheme: "socks5", host: "1.2.3.4", port: 1080 })).toBe(null);
  });

  it("səbəb istifadəçi dilində qaytarılır", () => {
    expect(proxyProblem(null)).toMatch(/ünvan tanınmadı/);
    expect(proxyProblem({ scheme: "ftp", host: "1.2.3.4", port: 80 } as any)).toMatch(/naməlum sxem/);
    expect(proxyProblem({ scheme: "http", host: "1.2.3.4", port: 0 })).toMatch(/port/);
    expect(proxyProblem({ scheme: "http", host: "!!", port: 80 })).toMatch(/host/);
  });

  it("açar və etiket", () => {
    const proxy: ProxyEntry = { scheme: "socks5", host: "1.2.3.4", port: 1080 };
    expect(proxyKey(proxy)).toBe("socks5://1.2.3.4:1080");
    expect(proxyLabel(proxy)).toBe("1.2.3.4:1080");
  });
});

describe("proxyConfig — chrome.proxy formatı", () => {
  it("fixed_servers + singleProxy + yerli bypass", () => {
    const config = proxyConfig({ scheme: "socks5", host: "1.2.3.4", port: 1080 });
    expect(config.mode).toBe("fixed_servers");
    expect(config.rules.singleProxy).toStrictEqual({ scheme: "socks5", host: "1.2.3.4", port: 1080 });
    // Yerli ünvanlar proxy-dən keçməməlidir (extension-ın öz localhost sorğuları da var)
    expect(config.rules.bypassList).toStrictEqual([...BYPASS]);
    expect(BYPASS.includes("localhost") && BYPASS.includes("<local>")).toBeTruthy();
  });

  it("giriş məlumatı konfiqurasiyaya YAZILMIR (Chrome onu ayrıca soruşur)", () => {
    const config = proxyConfig({ scheme: "http", host: "1.2.3.4", port: 8080, username: "zzuser", password: "zzsecret" });
    const text = JSON.stringify(config);
    expect(text.includes("zzuser")).toBe(false);
    expect(text.includes("zzsecret")).toBe(false);
  });

  it("pozulmuş proxy üçün throw edir", () => {
    expect(() => proxyConfig({ scheme: "ftp", host: "1.2.3.4", port: 80 } as any)).toThrow(/naməlum sxem/);
  });

  it("dəstəklənən sxemlər Chrome-un qəbul etdikləridir", () => {
    expect([...PROXY_SCHEMES]).toStrictEqual(["http", "https", "socks4", "socks5"]);
  });
});

describe("formatPing", () => {
  it("ölçülmüş gecikmə ms ilə, yoxsa tire", () => {
    expect(formatPing({ ping: 237 } as ProxyEntry)).toBe("237 ms");
    expect(formatPing({} as any), "hələ qoşulmayıb").toBe("—");
    expect(formatPing(null)).toBe("—");
  });
});

// Brauzerin parametri saxlancdaki qeyddən AYRI həqiqətdir: profil faylında qalır və extension
// hər aktivləşəndə yenidən tətbiq olunur. Bu oxunuş olmasa "qeyd yoxdur, trafik isə hələ
// proxy-dən keçir" vəziyyəti görünməz qalır — saytlar yalnız extension söndürüləndə açılır.
describe("readProxyControl — brauzerin parametrinin oxunuşu", () => {
  const details = (mode: any, level: any) : any => ({ value: { mode }, levelOfControl: level });

  it("bizim qurduğumuz fixed_servers = yönləndirmə", () => {
    const control = readProxyControl(details("fixed_servers", "controlled_by_this_extension"));
    expect(control).toStrictEqual({ mode: "fixed_servers", level: "controlled_by_this_extension", ours: true, routed: true });
    expect(isRouting(control)).toBe(true);
  });

  it("pac_script də yönləndirmə sayılır", () => {
    expect(readProxyControl(details("pac_script", "controlled_by_this_extension")).routed).toBe(true);
  });

  it("birbaşa/sistem rejimləri yönləndirmə deyil", () => {
    for (const mode of DIRECT_MODES) {
      const control = readProxyControl(details(mode, "controlled_by_this_extension"));
      expect(control.routed, mode).toBe(false);
      expect(isRouting(control), mode).toBe(false);
    }
    expect([...DIRECT_MODES]).toStrictEqual(["direct", "system", "auto_detect"]);
  });

  it("BAŞQA extension-ın parametrinə toxunmuruq", () => {
    const control = readProxyControl(details("fixed_servers", "controlled_by_other_extensions"));
    expect(control.ours).toBe(false);
    expect(control.routed, "trafik yönlənir, amma bizim əlimizdə deyil").toBe(true);
    expect(isRouting(control)).toBe(false);
  });

  it("oxunmayan/boş cavab 'yönləndirmə yoxdur' sayılır", () => {
    for (const value of [null, undefined, {}, { value: {} }]) {
      expect(readProxyControl(value)).toStrictEqual({ mode: null, level: null, ours: false, routed: false });
      expect(isRouting(readProxyControl(value))).toBe(false);
    }
    expect(isRouting(null)).toBe(false);
  });
});

describe("açıq (ictimai) proxy mənbələri YOXDUR", () => {
  it("modul mənbə/metadata/PAC funksiyası ixrac etmir", async () => {
    const module: any = await import("../src/shared/proxy");
    for (const name of ["parseProxyList", "liveEntries", "normalizeEntry", "isLive", "isRoutable",
      "facets", "selectProxies", "SORTS", "buildPacScript", "probeUrl", "pickCandidates",
      "formatSpeed", "formatUptime", "MAX_PER_SOURCE", "PROBE_ENDPOINTS"]) {
      expect(module[name], `${name} hələ də ixrac olunur`).toBe(undefined);
    }
  });
});



// ===========================================================================================
// TOPLU ƏLAVƏ: çoxsətirli mətn, JSON və fayl məzmunu
// ===========================================================================================
// Satıcı yüzlərlə proxy verir və format həmişə fərqlidir. Burada iki şey qorunur: (1) işlək
// sətirlərin heç biri itmir, (2) pozulmuş sətir SƏSSİZ atılmır — səbəbi qaytarılır.
describe("proxyLines — mətn və JSON forması", () => {
  it("adi mətn sətirlərə bölünür", () => {
    expect(proxyLines("a\r\nb\nc")).toStrictEqual(["a", "b", "c"]);
  });

  it("sətir massivi olan JSON", () => {
    expect(proxyLines('["1.2.3.4:8080","socks5://5.6.7.8:1080"]')).toStrictEqual(["1.2.3.4:8080", "socks5://5.6.7.8:1080"]);
  });

  it("obyekt massivi: host/ip + port + sxem + giriş məlumatı ortaq sətirə çevrilir", () => {
    const json = JSON.stringify([
      { host: "1.2.3.4", port: 8080 },
      { ip: "5.6.7.8", port: "1080", protocol: "socks5" },
      { host: "9.9.9.9", port: 3128, type: "http", username: "u", password: "p" },
      { server: "proxy.example.com", port: 3128, protocols: ["socks4"] },
    ]);
    expect(proxyLines(json)).toStrictEqual([
      "1.2.3.4:8080", "socks5://5.6.7.8:1080", "http://u:p@9.9.9.9:3128", "socks4://proxy.example.com:3128",
    ]);
  });

  it("JSON obyektində açıq yazılmış naməlum protokol HTTP-yə çevrilmir", () => {
    const json = JSON.stringify([
      { host: "1.2.3.4", port: 8080, protocol: "ftp" },
      { host: "5.6.7.8", port: 8080, scheme: "v2ray" },
      { host: "9.9.9.9", port: 8080 },
    ]);
    const { proxies, invalid } = parseProxyLines(json);
    expect(proxies).toStrictEqual([{ scheme: "http", host: "9.9.9.9", port: 8080 }]);
    expect(invalid.length).toBe(2);
  });

  it("zərfli JSON (proxies / data / list / results)", () => {
    for (const key of ["proxies", "data", "list", "results", "items"]) {
      expect(proxyLines(JSON.stringify({ [key]: ["1.2.3.4:8080"] })), key).toStrictEqual(["1.2.3.4:8080"]);
    }
  });

  it("pozulmuş JSON mətn kimi oxunur (throw etmir)", () => {
    expect(proxyLines("[1.2.3.4:8080")).toStrictEqual(["[1.2.3.4:8080"]);
  });

  it("boş giriş boş nəticə verir", () => {
    for (const value of [null, undefined, "", "   "]) expect(proxyLines(value)).toStrictEqual([]);
  });
});

describe("parseProxyLines — toplu əlavə", () => {
  it("çoxsətirli blok oxunur, şərh və boşluqlar atılır", () => {
    const text = [
      "# satıcının siyahısı",
      "1.2.3.4:8080",
      "",
      "socks5://5.6.7.8:1080",
      "// qeyd",
      "  user:pass@9.9.9.9:3128  ",
    ].join("\n");
    const { proxies, invalid, duplicates } = parseProxyLines(text);
    expect(proxies.map(proxyKey)).toStrictEqual(["http://1.2.3.4:8080", "socks5://5.6.7.8:1080", "http://9.9.9.9:3128"]);
    expect(invalid).toStrictEqual([]);
    expect(duplicates).toBe(0);
  });

  it("təkrarlar birləşdirilir və sayılır", () => {
    const { proxies, duplicates } = parseProxyLines("1.2.3.4:8080\n1.2.3.4:8080\nhttp://1.2.3.4:8080");
    expect(proxies.length).toBe(1);
    expect(duplicates).toBe(2);
  });

  it("pozulmuş sətir SƏBƏBİ ilə qaytarılır (səssiz atılmır)", () => {
    const { proxies, invalid } = parseProxyLines("1.2.3.4:8080\nsalam\n300.1.1.1:80\nvmess://xyz");
    expect(proxies.length).toBe(1);
    expect(invalid.length).toBe(3);
    expect(invalid[0].line).toBe("salam");
    expect(invalid[0].reason).toMatch(/ünvan tanınmadı/);
  });

  it("uzun sətir statusda yer tutmasın deyə kəsilir, xəta siyahısı da məhduddur", () => {
    const long = "x".repeat(200);
    const { invalid } = parseProxyLines(Array.from({ length: 50 }, () => long).join("\n"));
    expect(invalid.length).toBe(20);
    expect(invalid[0].line.length).toBe(40);
  });

  it("tavan gözlənilir", () => {
    const many = Array.from({ length: 300 }, (_, i) => `10.0.${Math.floor(i / 254)}.${(i % 254) + 1}:8080`).join("\n");
    expect(parseProxyLines(many, { max: 100 }).proxies.length).toBe(100);
  });

  it("yüzlərlə sətir işlənir (real satıcı bloku ölçüsü)", () => {
    const lines = Array.from({ length: 500 }, (_, i) => `45.${Math.floor(i / 254)}.1.${(i % 254) + 1}:${8000 + i}`);
    const { proxies, invalid } = parseProxyLines(lines.join("\n"));
    expect(proxies.length).toBe(500);
    expect(invalid).toStrictEqual([]);
  });

  it("JSON fayl məzmunu da eyni yolla oxunur", () => {
    const json = JSON.stringify({ proxies: [{ ip: "1.2.3.4", port: 8080, protocol: "socks5" }] });
    expect(parseProxyLines(json).proxies).toStrictEqual([{ scheme: "socks5", host: "1.2.3.4", port: 8080 }]);
  });

  it("boş mətn boş nəticə verir", () => {
    expect(parseProxyLines("").proxies).toStrictEqual([]);
    expect(parseProxyLines(null).invalid).toStrictEqual([]);
  });

  it("BİR NEÇƏ mətn (seçilmiş bir neçə fayl) ayrı-ayrı oxunur", () => {
    // Birləşdirilsəydi JSON tanınmayan sətrə çevrilərdi — məhz bu hal sınanır
    const txt = "# satıcı\n77.1.1.1:8080\nsocks5://77.1.1.2:1080";
    const json = JSON.stringify([{ ip: "88.1.1.1", port: 3128, protocol: "socks5" }]);
    const { proxies, invalid } = parseProxyLines([txt, json]);
    expect(proxies.map(proxyKey)).toStrictEqual(["http://77.1.1.1:8080", "socks5://77.1.1.2:1080", "socks5://88.1.1.1:3128"]);
    expect(invalid).toStrictEqual([]);
    // proxyLines də massivi qəbul edir
    expect(proxyLines(["1.2.3.4:8080", "5.6.7.8:1080"]).length).toBe(2);
    expect(proxyLines([])).toStrictEqual([]);
  });
});

// ===========================================================================================
// KÖHNƏ İDXAL QEYDLƏRİNİN TƏMİZLƏNMƏSİ
// ===========================================================================================
// v1.19.0-a qədər saxlancda minlərlə idxal olunmuş qeyd yığıla bilərdi (istifadəçinin
// ekranında 1910 ünvan qalmışdı). Kod artıq idxal etmir, amma SAXLANC öz-özünə təmizlənmir.
describe("pruneImported / isImported", () => {
  const own: ProxyEntry = { scheme: "http", host: "1.1.1.1", port: 8080 };
  const imported: ProxyEntry = { scheme: "socks5", host: "2.2.2.2", port: 1080, cc: "DEU", uptime: 90, source: "geonode" };

  it("mənbə metadatası daşıyan qeyd idxal sayılır", () => {
    expect(isImported(imported)).toBe(true);
    for (const mark of ["source", "cc", "uptime", "speed", "verified", "alive"]) {
      expect(isImported({ ...own, [mark]: null }), mark).toBe(true);
    }
  });

  it("istifadəçinin qeydi idxal sayılmır", () => {
    expect(isImported(own)).toBe(false);
    expect(isImported({ ...own, username: "u", password: "p", ping: 120, dead: true })).toBe(false);
    expect(isImported(null)).toBe(false);
  });

  it("köhnə `manual: true` qeydi SAXLANILIR, nişan isə silinir", () => {
    const old = { ...own, manual: true, cc: "AZE" };   // köhnə versiyada cc hər qeyddə var idi
    expect(isImported(old)).toBe(false);
    expect(pruneImported([old])).toStrictEqual([{ ...own, cc: "AZE" }]);
  });

  it("idxal qeydləri siyahıdan çıxır, öz qeydlər qalır", () => {
    expect(pruneImported([imported, own, { ...imported, host: "3.3.3.3" }])).toStrictEqual([own]);
  });

  it("1910 idxal qeydi + 2 öz qeyd → yalnız 2 qalır", () => {
    const junk = Array.from({ length: 1910 }, (_, i) : any => ({ ...imported, host: `5.5.${Math.floor(i / 254)}.${(i % 254) + 1}` }));
    const mine: ProxyEntry[] = [own, { scheme: "socks5", host: "127.0.0.1", port: 9050 }];
    expect(pruneImported([...junk, ...mine])).toStrictEqual(mine);
  });

  it("boş və pozulmuş giriş boş nəticə verir", () => {
    for (const value of [null, undefined, []]) expect(pruneImported(value)).toStrictEqual([]);
    expect(pruneImported([null, undefined] as any)).toStrictEqual([]);
  });
});
