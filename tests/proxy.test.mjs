// Şəxsi proxy sətirlərinin oxunması və Chrome konfiqurasiyası (shared/proxy.js).
//
// Siyahı yalnız istifadəçinin yazdığı sətirlərdən dolur (açıq mənbələr yoxdur), amma satıcılar
// hər cür format verir: "ip:port", "socks5://…", "user:pass@…", "ip:port:user:pass". Səhv
// ayrıştırma iki cür ziyan verir: ya işlək proxy rədd olunur, ya yanlış ünvana qoşulmağa
// çalışırıq — üstəlik parol yerində olmasa Chrome hər sorğuda pəncərə açır.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  BYPASS, DEFAULT_SCHEME, DIRECT_MODES, formatPing, isImported, isIpv4, isRouting, MAX_PROXIES,
  mergeProxies, orderProxies, parseProxy, parseProxyLines, PROXY_SCHEMES, proxyConfig, proxyKey,
  proxyLabel, proxyLines, proxyProblem, pruneImported, readProxyControl,
} from "../src/shared/proxy.js";

describe("parseProxy — formatlar", () => {
  it("URL formatında kodlanmış giriş məlumatı və JSON xüsusi simvolları saxlanır", () => {
    const expected = { scheme: "http", host: "proxy.example.com", port: 8080, username: "u@x", password: "p:@ /%" };
    assert.deepEqual(parseProxy("http://u%40x:p%3A%40%20%2F%25@proxy.example.com:8080"), expected);
    assert.deepEqual(parseProxyLines(JSON.stringify([expected])).proxies, [expected]);
  });
  it("adi ip:port", () => {
    assert.deepEqual(parseProxy("1.2.3.4:8080"), { scheme: "http", host: "1.2.3.4", port: 8080 });
  });

  it("sətirdəki sxem üstün tutulur", () => {
    assert.deepEqual(parseProxy("socks5://5.6.7.8:1080", "http"),
      { scheme: "socks5", host: "5.6.7.8", port: 1080 });
    assert.equal(parseProxy("socks4://5.6.7.8:1080").scheme, "socks4");
    assert.equal(parseProxy("https://5.6.7.8:443").scheme, "https");
    // "socks" tək başına SOCKS5 sayılır (bəzi satıcılar belə yazır)
    assert.equal(parseProxy("socks://5.6.7.8:1080").scheme, "socks5");
  });

  it("sxem yoxdursa http sayılır", () => {
    assert.equal(parseProxy("1.2.3.4:8080").scheme, DEFAULT_SCHEME);
    assert.equal(DEFAULT_SCHEME, "http");
    // çağıran tərəf başqa ehtiyat sxem verə bilər
    assert.equal(parseProxy("1.2.3.4:1080", "socks5").scheme, "socks5");
  });

  it("naməlum sxem atılır (v2ray, ss, trojan)", () => {
    for (const line of ["vmess://abc", "ss://abc@1.2.3.4:8080", "trojan://1.2.3.4:443"]) {
      assert.equal(parseProxy(line), null, line);
    }
  });

  it("istifadəçi adı və parol", () => {
    assert.deepEqual(parseProxy("user:s3cret@1.2.3.4:8080"),
      { scheme: "http", host: "1.2.3.4", port: 8080, username: "user", password: "s3cret" });
    assert.deepEqual(parseProxy("socks5://u:p@1.2.3.4:1080").username, "u");
    // host:port:user:pass formatı
    assert.deepEqual(parseProxy("1.2.3.4:8080:user:pass"),
      { scheme: "http", host: "1.2.3.4", port: 8080, username: "user", password: "pass" });
    // parolda ":" ola bilər
    assert.equal(parseProxy("user:a:b:c@1.2.3.4:8080").password, "a:b:c");
  });

  it("giriş məlumatı olan SOCKS qeydi aydın səbəblə rədd olunur", () => {
    for (const scheme of ["socks4", "socks5"]) {
      const { proxies, invalid } = parseProxyLines(`${scheme}://user:secret@1.2.3.4:1080`);
      assert.deepEqual(proxies, [], scheme);
      assert.equal(invalid.length, 1, scheme);
      assert.match(invalid[0].reason, /SOCKS/i);
      assert.match(invalid[0].reason, /giriş|istifadəçi|parol/i);
    }
  });

  it("giriş məlumatı HTTP/HTTPS üçün qalır, autentifikasiyasız SOCKS qəbul olunur", () => {
    const { proxies, invalid } = parseProxyLines([
      "http://user:secret@1.2.3.4:8080",
      "https://user:secret@1.2.3.5:8443",
      "socks4://1.2.3.6:1080",
      "socks5://1.2.3.7:1080",
    ].join("\n"));
    assert.deepEqual(invalid, []);
    assert.deepEqual(proxies.map(({ scheme, username }) => ({ scheme, username })), [
      { scheme: "http", username: "user" },
      { scheme: "https", username: "user" },
      { scheme: "socks4", username: undefined },
      { scheme: "socks5", username: undefined },
    ]);
  });

  it("host adı da qəbul olunur", () => {
    assert.deepEqual(parseProxy("proxy.example.com:3128"),
      { scheme: "http", host: "proxy.example.com", port: 3128 });
  });

  it("YERLİ ünvan da qəbul olunur — istifadəçinin öz serveri ola bilər", () => {
    assert.deepEqual(parseProxy("127.0.0.1:8899"), { scheme: "http", host: "127.0.0.1", port: 8899 });
    assert.deepEqual(parseProxy("192.168.1.9:3128"), { scheme: "http", host: "192.168.1.9", port: 3128 });
  });

  it("artıq sözlər və boşluqlar atılır", () => {
    assert.deepEqual(parseProxy("  1.2.3.4:8080   Germany  1.2s "),
      { scheme: "http", host: "1.2.3.4", port: 8080 });
  });

  it("şərh sətirləri və zibil null qaytarır", () => {
    for (const line of ["", "   ", "# başlıq", "// qeyd", "salam dünya", "1.2.3.4",
      "1.2.3.4:0", "1.2.3.4:99999", "300.1.1.1:80", "not-a-host:80", ":8080"]) {
      assert.equal(parseProxy(line), null, JSON.stringify(line));
    }
  });
});

describe("isIpv4", () => {
  it("IPv4 tanınır", () => {
    assert.equal(isIpv4("192.168.0.1"), true);
    assert.equal(isIpv4("255.255.255.255"), true);
    assert.equal(isIpv4("1.2.3"), false);
    assert.equal(isIpv4("1.2.3.256"), false);
    assert.equal(isIpv4("01.2.3.4"), false, "sıfırla başlayan oktet qəbul olunmur");
    assert.equal(isIpv4("proxy.example.com"), false);
  });
});

describe("mergeProxies", () => {
  const a = { scheme: "http", host: "1.1.1.1", port: 80 };
  const b = { scheme: "http", host: "2.2.2.2", port: 80 };

  it("təkrarlar birləşdirilir, İLK qeyd qalır", () => {
    const withAuth = { ...a, username: "u", password: "p" };
    const merged = mergeProxies([withAuth], [a]);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].username, "u", "giriş məlumatı itdi");
  });

  it("sıra dəyişmir — istifadəçinin yazdığı ardıcıllıq qalır", () => {
    assert.deepEqual(mergeProxies([a, b], []).map(proxyKey), ["http://1.1.1.1:80", "http://2.2.2.2:80"]);
  });

  it("fərqli sxem/port ayrı qeyddir", () => {
    assert.equal(mergeProxies([a, { ...a, scheme: "socks5" }, { ...a, port: 8080 }], []).length, 3);
  });

  it("tavan gözlənilir (toplu əlavə yüzlərlə sətir ola bilər)", () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ scheme: "http", host: `3.3.3.${i}`, port: 80 }));
    assert.equal(mergeProxies([], many, { max: 5 }).length, 5);
    assert.equal(MAX_PROXIES, 1000);
  });

  it("boş və pozulmuş giriş boş nəticə verir", () => {
    assert.deepEqual(mergeProxies(), []);
    assert.deepEqual(mergeProxies([null, undefined], []), []);
  });
});

describe("orderProxies — göstərmə sırası", () => {
  const live = { scheme: "http", host: "1.1.1.1", port: 80 };
  const dead = { scheme: "http", host: "2.2.2.2", port: 80, dead: true };
  const other = { scheme: "socks5", host: "3.3.3.3", port: 1080 };

  it("cavab verməyən qeydlər sona keçir, qalanı olduğu kimi qalır", () => {
    assert.deepEqual(orderProxies([dead, live, other]).map((p) => p.host), ["1.1.1.1", "3.3.3.3", "2.2.2.2"]);
  });

  it("giriş siyahısı dəyişdirilmir", () => {
    const list = [dead, live];
    orderProxies(list);
    assert.deepEqual(list.map((p) => p.host), ["2.2.2.2", "1.1.1.1"]);
  });

  it("boş və pozulmuş giriş boş nəticə verir", () => {
    for (const value of [null, undefined, []]) assert.deepEqual(orderProxies(value), []);
    assert.deepEqual(orderProxies([null]), []);
  });
});

describe("proxyProblem / etiketlər", () => {
  it("qaydalı proxy problem vermir", () => {
    assert.equal(proxyProblem({ scheme: "socks5", host: "1.2.3.4", port: 1080 }), null);
  });

  it("səbəb istifadəçi dilində qaytarılır", () => {
    assert.match(proxyProblem(null), /ünvan tanınmadı/);
    assert.match(proxyProblem({ scheme: "ftp", host: "1.2.3.4", port: 80 }), /naməlum sxem/);
    assert.match(proxyProblem({ scheme: "http", host: "1.2.3.4", port: 0 }), /port/);
    assert.match(proxyProblem({ scheme: "http", host: "!!", port: 80 }), /host/);
  });

  it("açar və etiket", () => {
    const proxy = { scheme: "socks5", host: "1.2.3.4", port: 1080 };
    assert.equal(proxyKey(proxy), "socks5://1.2.3.4:1080");
    assert.equal(proxyLabel(proxy), "1.2.3.4:1080");
  });
});

describe("proxyConfig — chrome.proxy formatı", () => {
  it("fixed_servers + singleProxy + yerli bypass", () => {
    const config = proxyConfig({ scheme: "socks5", host: "1.2.3.4", port: 1080 });
    assert.equal(config.mode, "fixed_servers");
    assert.deepEqual(config.rules.singleProxy, { scheme: "socks5", host: "1.2.3.4", port: 1080 });
    // Yerli ünvanlar proxy-dən keçməməlidir (extension-ın öz localhost sorğuları da var)
    assert.deepEqual(config.rules.bypassList, [...BYPASS]);
    assert.ok(BYPASS.includes("localhost") && BYPASS.includes("<local>"));
  });

  it("giriş məlumatı konfiqurasiyaya YAZILMIR (Chrome onu ayrıca soruşur)", () => {
    const config = proxyConfig({ scheme: "http", host: "1.2.3.4", port: 8080, username: "zzuser", password: "zzsecret" });
    const text = JSON.stringify(config);
    assert.equal(text.includes("zzuser"), false);
    assert.equal(text.includes("zzsecret"), false);
  });

  it("pozulmuş proxy üçün throw edir", () => {
    assert.throws(() => proxyConfig({ scheme: "ftp", host: "1.2.3.4", port: 80 }), /naməlum sxem/);
  });

  it("dəstəklənən sxemlər Chrome-un qəbul etdikləridir", () => {
    assert.deepEqual([...PROXY_SCHEMES], ["http", "https", "socks4", "socks5"]);
  });
});

describe("formatPing", () => {
  it("ölçülmüş gecikmə ms ilə, yoxsa tire", () => {
    assert.equal(formatPing({ ping: 237 }), "237 ms");
    assert.equal(formatPing({}), "—", "hələ qoşulmayıb");
    assert.equal(formatPing(null), "—");
  });
});

// Brauzerin parametri saxlancdaki qeyddən AYRI həqiqətdir: profil faylında qalır və extension
// hər aktivləşəndə yenidən tətbiq olunur. Bu oxunuş olmasa "qeyd yoxdur, trafik isə hələ
// proxy-dən keçir" vəziyyəti görünməz qalır — saytlar yalnız extension söndürüləndə açılır.
describe("readProxyControl — brauzerin parametrinin oxunuşu", () => {
  const details = (mode, level) => ({ value: { mode }, levelOfControl: level });

  it("bizim qurduğumuz fixed_servers = yönləndirmə", () => {
    const control = readProxyControl(details("fixed_servers", "controlled_by_this_extension"));
    assert.deepEqual(control,
      { mode: "fixed_servers", level: "controlled_by_this_extension", ours: true, routed: true });
    assert.equal(isRouting(control), true);
  });

  it("pac_script də yönləndirmə sayılır", () => {
    assert.equal(readProxyControl(details("pac_script", "controlled_by_this_extension")).routed, true);
  });

  it("birbaşa/sistem rejimləri yönləndirmə deyil", () => {
    for (const mode of DIRECT_MODES) {
      const control = readProxyControl(details(mode, "controlled_by_this_extension"));
      assert.equal(control.routed, false, mode);
      assert.equal(isRouting(control), false, mode);
    }
    assert.deepEqual([...DIRECT_MODES], ["direct", "system", "auto_detect"]);
  });

  it("BAŞQA extension-ın parametrinə toxunmuruq", () => {
    const control = readProxyControl(details("fixed_servers", "controlled_by_other_extensions"));
    assert.equal(control.ours, false);
    assert.equal(control.routed, true, "trafik yönlənir, amma bizim əlimizdə deyil");
    assert.equal(isRouting(control), false);
  });

  it("oxunmayan/boş cavab 'yönləndirmə yoxdur' sayılır", () => {
    for (const value of [null, undefined, {}, { value: {} }]) {
      assert.deepEqual(readProxyControl(value), { mode: null, level: null, ours: false, routed: false });
      assert.equal(isRouting(readProxyControl(value)), false);
    }
    assert.equal(isRouting(null), false);
  });
});

describe("açıq (ictimai) proxy mənbələri YOXDUR", () => {
  it("modul mənbə/metadata/PAC funksiyası ixrac etmir", async () => {
    const module = await import("../src/shared/proxy.js");
    for (const name of ["parseProxyList", "liveEntries", "normalizeEntry", "isLive", "isRoutable",
      "facets", "selectProxies", "SORTS", "buildPacScript", "probeUrl", "pickCandidates",
      "formatSpeed", "formatUptime", "MAX_PER_SOURCE", "PROBE_ENDPOINTS"]) {
      assert.equal(module[name], undefined, `${name} hələ də ixrac olunur`);
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
    assert.deepEqual(proxyLines("a\r\nb\nc"), ["a", "b", "c"]);
  });

  it("sətir massivi olan JSON", () => {
    assert.deepEqual(proxyLines('["1.2.3.4:8080","socks5://5.6.7.8:1080"]'),
      ["1.2.3.4:8080", "socks5://5.6.7.8:1080"]);
  });

  it("obyekt massivi: host/ip + port + sxem + giriş məlumatı ortaq sətirə çevrilir", () => {
    const json = JSON.stringify([
      { host: "1.2.3.4", port: 8080 },
      { ip: "5.6.7.8", port: "1080", protocol: "socks5" },
      { host: "9.9.9.9", port: 3128, type: "http", username: "u", password: "p" },
      { server: "proxy.example.com", port: 3128, protocols: ["socks4"] },
    ]);
    assert.deepEqual(proxyLines(json), [
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
    assert.deepEqual(proxies, [{ scheme: "http", host: "9.9.9.9", port: 8080 }]);
    assert.equal(invalid.length, 2);
  });

  it("zərfli JSON (proxies / data / list / results)", () => {
    for (const key of ["proxies", "data", "list", "results", "items"]) {
      assert.deepEqual(proxyLines(JSON.stringify({ [key]: ["1.2.3.4:8080"] })), ["1.2.3.4:8080"], key);
    }
  });

  it("pozulmuş JSON mətn kimi oxunur (throw etmir)", () => {
    assert.deepEqual(proxyLines("[1.2.3.4:8080"), ["[1.2.3.4:8080"]);
  });

  it("boş giriş boş nəticə verir", () => {
    for (const value of [null, undefined, "", "   "]) assert.deepEqual(proxyLines(value), []);
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
    assert.deepEqual(proxies.map(proxyKey),
      ["http://1.2.3.4:8080", "socks5://5.6.7.8:1080", "http://9.9.9.9:3128"]);
    assert.deepEqual(invalid, []);
    assert.equal(duplicates, 0);
  });

  it("təkrarlar birləşdirilir və sayılır", () => {
    const { proxies, duplicates } = parseProxyLines("1.2.3.4:8080\n1.2.3.4:8080\nhttp://1.2.3.4:8080");
    assert.equal(proxies.length, 1);
    assert.equal(duplicates, 2);
  });

  it("pozulmuş sətir SƏBƏBİ ilə qaytarılır (səssiz atılmır)", () => {
    const { proxies, invalid } = parseProxyLines("1.2.3.4:8080\nsalam\n300.1.1.1:80\nvmess://xyz");
    assert.equal(proxies.length, 1);
    assert.equal(invalid.length, 3);
    assert.equal(invalid[0].line, "salam");
    assert.match(invalid[0].reason, /ünvan tanınmadı/);
  });

  it("uzun sətir statusda yer tutmasın deyə kəsilir, xəta siyahısı da məhduddur", () => {
    const long = "x".repeat(200);
    const { invalid } = parseProxyLines(Array.from({ length: 50 }, () => long).join("\n"));
    assert.equal(invalid.length, 20);
    assert.equal(invalid[0].line.length, 40);
  });

  it("tavan gözlənilir", () => {
    const many = Array.from({ length: 300 }, (_, i) => `10.0.${Math.floor(i / 254)}.${(i % 254) + 1}:8080`).join("\n");
    assert.equal(parseProxyLines(many, { max: 100 }).proxies.length, 100);
  });

  it("yüzlərlə sətir işlənir (real satıcı bloku ölçüsü)", () => {
    const lines = Array.from({ length: 500 }, (_, i) => `45.${Math.floor(i / 254)}.1.${(i % 254) + 1}:${8000 + i}`);
    const { proxies, invalid } = parseProxyLines(lines.join("\n"));
    assert.equal(proxies.length, 500);
    assert.deepEqual(invalid, []);
  });

  it("JSON fayl məzmunu da eyni yolla oxunur", () => {
    const json = JSON.stringify({ proxies: [{ ip: "1.2.3.4", port: 8080, protocol: "socks5" }] });
    assert.deepEqual(parseProxyLines(json).proxies, [{ scheme: "socks5", host: "1.2.3.4", port: 8080 }]);
  });

  it("boş mətn boş nəticə verir", () => {
    assert.deepEqual(parseProxyLines("").proxies, []);
    assert.deepEqual(parseProxyLines(null).invalid, []);
  });

  it("BİR NEÇƏ mətn (seçilmiş bir neçə fayl) ayrı-ayrı oxunur", () => {
    // Birləşdirilsəydi JSON tanınmayan sətrə çevrilərdi — məhz bu hal sınanır
    const txt = "# satıcı\n77.1.1.1:8080\nsocks5://77.1.1.2:1080";
    const json = JSON.stringify([{ ip: "88.1.1.1", port: 3128, protocol: "socks5" }]);
    const { proxies, invalid } = parseProxyLines([txt, json]);
    assert.deepEqual(proxies.map(proxyKey),
      ["http://77.1.1.1:8080", "socks5://77.1.1.2:1080", "socks5://88.1.1.1:3128"]);
    assert.deepEqual(invalid, []);
    // proxyLines də massivi qəbul edir
    assert.equal(proxyLines(["1.2.3.4:8080", "5.6.7.8:1080"]).length, 2);
    assert.deepEqual(proxyLines([]), []);
  });
});

// ===========================================================================================
// KÖHNƏ İDXAL QEYDLƏRİNİN TƏMİZLƏNMƏSİ
// ===========================================================================================
// v1.19.0-a qədər saxlancda minlərlə idxal olunmuş qeyd yığıla bilərdi (istifadəçinin
// ekranında 1910 ünvan qalmışdı). Kod artıq idxal etmir, amma SAXLANC öz-özünə təmizlənmir.
describe("pruneImported / isImported", () => {
  const own = { scheme: "http", host: "1.1.1.1", port: 8080 };
  const imported = { scheme: "socks5", host: "2.2.2.2", port: 1080, cc: "DEU", uptime: 90, source: "geonode" };

  it("mənbə metadatası daşıyan qeyd idxal sayılır", () => {
    assert.equal(isImported(imported), true);
    for (const mark of ["source", "cc", "uptime", "speed", "verified", "alive"]) {
      assert.equal(isImported({ ...own, [mark]: null }), true, mark);
    }
  });

  it("istifadəçinin qeydi idxal sayılmır", () => {
    assert.equal(isImported(own), false);
    assert.equal(isImported({ ...own, username: "u", password: "p", ping: 120, dead: true }), false);
    assert.equal(isImported(null), false);
  });

  it("köhnə `manual: true` qeydi SAXLANILIR, nişan isə silinir", () => {
    const old = { ...own, manual: true, cc: "AZE" };   // köhnə versiyada cc hər qeyddə var idi
    assert.equal(isImported(old), false);
    assert.deepEqual(pruneImported([old]), [{ ...own, cc: "AZE" }]);
  });

  it("idxal qeydləri siyahıdan çıxır, öz qeydlər qalır", () => {
    assert.deepEqual(pruneImported([imported, own, { ...imported, host: "3.3.3.3" }]), [own]);
  });

  it("1910 idxal qeydi + 2 öz qeyd → yalnız 2 qalır", () => {
    const junk = Array.from({ length: 1910 }, (_, i) => ({ ...imported, host: `5.5.${Math.floor(i / 254)}.${(i % 254) + 1}` }));
    const mine = [own, { scheme: "socks5", host: "127.0.0.1", port: 9050 }];
    assert.deepEqual(pruneImported([...junk, ...mine]), mine);
  });

  it("boş və pozulmuş giriş boş nəticə verir", () => {
    for (const value of [null, undefined, []]) assert.deepEqual(pruneImported(value), []);
    assert.deepEqual(pruneImported([null, undefined]), []);
  });
});
