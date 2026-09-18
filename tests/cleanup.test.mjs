// Təmizləmə planının testləri (shared/cleanup.js).
//
// Plan "nə silinəcək" sualının cavabıdır və iki yerdə işlənir: popup düyməni göstərmək üçün
// (hansı sayt, silinə bilirmi), worker isə silmək üçün. Səhv plan ya lazımsız məlumatı
// silərdi, ya da silinməli olanı buraxardı — ona görə hər qayda burada yoxlanılır.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DATA_TYPES, IDENTITY_FAMILIES, identityFamily, ORIGIN_TYPES, tabCleanupPlan } from "../src/shared/cleanup.js";
import { registrableDomain } from "../src/shared/extract.js";

describe("audit: silmə domen sərhədləri", () => {
  it("Microsoft və Google-un əlavə hesab üzvləri ailəyə daxildir", () => {
    for (const host of ["hotmail.com", "xbox.com", "skype.com", "msn.com"]) assert.equal(identityFamily(host)?.id, "microsoft");
    for (const host of ["gmail.com", "googlemail.com"]) assert.equal(identityFamily(host)?.id, "google");
    assert.ok(tabCleanupPlan("https://icloud.com").storageOrigins.includes("https://account.apple.com"));
  });
  it("böyük şirkətlərin yeni hesab ailələri əlaqəli login origin-lərini əhatə edir", () => {
    for (const [url, family, login] of [
      ["https://www.primevideo.com/", "amazon", "https://www.amazon.com"],
      ["https://www.behance.net/", "adobe", "https://ims-na1.adobelogin.com"],
      ["https://trello.com/", "atlassian", "https://id.atlassian.com"],
    ]) {
      const plan = tabCleanupPlan(url);
      assert.equal(plan.family, family);
      assert.ok(plan.storageOrigins.includes(login));
    }
  });
  it("PSL-in şəxsi, wildcard və exception qaydaları tenant-ları ayırır", () => {
    for (const [host, expected] of [
      ["alice.blogspot.com", "alice.blogspot.com"],
      ["shop.example.com.np", "example.com.np"],
      ["a.b.ck", "a.b.ck"],
      ["sub.www.ck", "www.ck"],
      ["x.city.kawasaki.jp", "city.kawasaki.jp"],
    ]) assert.deepEqual(tabCleanupPlan(`https://${host}/`).cookieDomains, [expected]);
  });
  it("Azure müştəri tenantı Microsoft hesabını silmir", () => {
    const plan = tabCleanupPlan("https://account.blob.core.windows.net/");
    assert.equal(plan.family, null);
    assert.deepEqual(plan.cookieDomains, ["account.blob.core.windows.net"]);
    assert.equal(plan.storageOrigins.includes("https://login.live.com"), false);
  });
  it("IP və localhost üçün saxta www origin-i yaradılmır", () => {
    for (const url of ["http://[::1]:3000/", "http://127.0.0.1:8080/", "http://localhost:3000/"]) {
      const plan = tabCleanupPlan(url);
      assert.deepEqual(plan.storageOrigins, [new URL(url).origin]);
      for (const origin of plan.storageOrigins) assert.equal(new URL(origin).origin, origin);
    }
  });
});

describe("tabCleanupPlan — dəstəklənən ünvanlar", () => {
  it("https saytı üçün plan qurulur", () => {
    const plan = tabCleanupPlan("https://nexora.example/sign-up?aff=k6du");
    assert.equal(plan.host, "nexora.example");
    assert.equal(plan.domain, "nexora.example");
  });

  it("http da qəbul olunur", () => {
    assert.equal(tabCleanupPlan("http://example.com/").domain, "example.com");
  });

  it("adi sayt olmayan ünvanlar üçün null (düymə söndürülür)", () => {
    for (const url of [
      "chrome://extensions/",
      "chrome-extension://abc/popup.html",
      "about:blank",
      "file:///C:/tmp/a.html",
      "data:text/html,<b>x</b>",
      "devtools://devtools/bundled/inspector.html",
      "view-source:https://example.com/",
    ]) assert.equal(tabCleanupPlan(url), null, url);
  });

  it("pozulmuş və boş dəyərlər üçün null", () => {
    for (const url of ["", "   ", "yox", null, undefined, 5, {}]) assert.equal(tabCleanupPlan(url), null, String(url));
  });

  it("hostu olmayan http ünvanı üçün null", () => {
    assert.equal(tabCleanupPlan("http://"), null);
  });
});

describe("tabCleanupPlan — cookie domeni", () => {
  it("qeydə alınabilən domen götürülür ki, alt-domenlər də düşsün", () => {
    const plan = tabCleanupPlan("https://app.dashboard.example.com/panel");
    assert.equal(plan.host, "app.dashboard.example.com");
    assert.deepEqual(plan.cookieDomains, ["example.com"]);
  });

  it("apex domendə də eyni nəticə", () => {
    assert.deepEqual(tabCleanupPlan("https://example.com/").cookieDomains, ["example.com"]);
  });

  it("host böyük hərflərlə yazılsa kiçildilir", () => {
    assert.equal(tabCleanupPlan("https://WWW.Example.COM/x").host, "www.example.com");
  });
});

describe("tabCleanupPlan — saxlanc origin-ləri", () => {
  it("tabın origin-i, apex və www variantları siyahıya düşür", () => {
    assert.deepEqual(tabCleanupPlan("https://app.example.com/x").storageOrigins, [
      "https://app.example.com",
      "https://example.com",
      "https://www.example.com",
    ]);
  });

  it("təkrarlanan origin bir dəfə yazılır", () => {
    assert.deepEqual(tabCleanupPlan("https://example.com/x").storageOrigins, [
      "https://example.com",
      "https://www.example.com",
    ]);
    assert.deepEqual(tabCleanupPlan("https://www.example.com/x").storageOrigins, [
      "https://www.example.com",
      "https://example.com",
    ]);
  });

  it("origin-lərdə yol və sorğu qalmır (browsingData yalnız origin qəbul edir)", () => {
    for (const origin of tabCleanupPlan("https://example.com/a/b?c=1#d").storageOrigins) {
      assert.match(origin, /^https:\/\/[^/]+$/, origin);
    }
  });

  it("port origin-in bir hissəsidir (fərqli port fərqli saytdır)", () => {
    assert.equal(tabCleanupPlan("http://localhost:3000/x").storageOrigins[0], "http://localhost:3000");
  });
});

describe("tabCleanupPlan — partitioned (CHIPS) cookie-lər", () => {
  it("sayt birinci tərəf olanda yazılmış partition-lar siyahıya düşür", () => {
    assert.deepEqual(tabCleanupPlan("https://nexora.example/sign-up").partitionTopLevelSites, ["https://nexora.example"]);
  });

  it("alt-domendə həm origin, həm apex yazılır", () => {
    assert.deepEqual(tabCleanupPlan("https://app.example.com/").partitionTopLevelSites, [
      "https://app.example.com",
      "https://example.com",
    ]);
  });
});

// ===========================================================================================
// EYNİ HESABIN ARXASINDA DURAN ƏLAQƏLİ DOMENLƏR
// ===========================================================================================
// Real qüsur: `login.microsoftonline.com` səhifəsində silmə yalnız `microsoftonline.com`-u
// təmizləyirdi, `login.live.com` cookie-si isə qalırdı — Microsoft YENƏ eyni hesabı tanıyırdı.
describe("tabCleanupPlan — identity ailəsi (SSO)", () => {
  it("Microsoft login səhifəsi: ailənin bütün cookie domenləri plana düşür", () => {
    const plan = tabCleanupPlan("https://login.microsoftonline.com/common/oauth2/v2.0/authorize?x=1");
    assert.equal(plan.family, "microsoft");
    assert.equal(plan.familyName, "Microsoft hesabı");
    for (const domain of ["microsoftonline.com", "live.com", "microsoft.com", "msauth.net", "msftauth.net"]) {
      assert.ok(plan.cookieDomains.includes(domain), domain);
    }
  });

  it("şəxsi hesab (login.live.com) da eyni ailəni açır", () => {
    const plan = tabCleanupPlan("https://login.live.com/oauth20_authorize.srf");
    assert.equal(plan.family, "microsoft");
    assert.ok(plan.cookieDomains.includes("microsoftonline.com"), "iş hesabı domeni də silinməlidir");
  });

  it("Foundry (ai.azure.com) silinəndə login domenləri də silinir", () => {
    const plan = tabCleanupPlan("https://ai.azure.com/");
    assert.equal(plan.family, "microsoft");
    assert.ok(plan.storageOrigins.includes("https://login.microsoftonline.com"));
    assert.ok(plan.storageOrigins.includes("https://login.live.com"));
  });

  it("login səhifələrinin origin-ləri saxlanc siyahısındadır (hesab seçimi orada yaşayır)", () => {
    const origins = tabCleanupPlan("https://login.microsoftonline.com/").storageOrigins;
    for (const origin of ["https://login.microsoftonline.com", "https://login.live.com",
      "https://account.microsoft.com", "https://login.microsoft.com"]) {
      assert.ok(origins.includes(origin), origin);
    }
    // apex-lər də var: browsingData cookie-ləri origin-in domeni üzrə silir
    assert.ok(origins.includes("https://live.com"));
  });

  it("origin-lər təkrarlanmır", () => {
    const origins = tabCleanupPlan("https://login.live.com/").storageOrigins;
    assert.equal(new Set(origins).size, origins.length);
  });

  it("ailəyə aid OLMAYAN sayt genişlənmir — yad saytın silinməsi Google seansına toxunmur", () => {
    const plan = tabCleanupPlan("https://nexora.example/sign-up");
    assert.equal(plan.family, null);
    assert.equal(plan.familyName, null);
    assert.deepEqual(plan.cookieDomains, ["nexora.example"]);
    assert.equal(plan.storageOrigins.some((o) => o.includes("google")), false);
  });

  it("ailə qeydləri düzgün formadadır", () => {
    assert.ok(IDENTITY_FAMILIES.length >= 1);
    const ids = IDENTITY_FAMILIES.map((f) => f.id);
    assert.equal(new Set(ids).size, ids.length, "id-lər təkrarlanmır");
    for (const family of IDENTITY_FAMILIES) {
      assert.equal(typeof family.name, "string");
      assert.ok(family.domains.length >= 1, family.id);
      for (const domain of family.domains) {
        assert.match(domain, /^[a-z0-9.-]+\.[a-z]{2,}$/, `${family.id}: ${domain}`);
        assert.equal(domain, registrableDomain(domain), `${family.id}: ${domain} apex olmalıdır`);
      }
      for (const origin of family.origins) assert.match(origin, /^https:\/\/[^/]+$/, origin);
    }
  });

  it("identityFamily hostu tanıyır, alt-domenlər də düşür", () => {
    assert.equal(identityFamily("login.microsoftonline.com").id, "microsoft");
    assert.equal(identityFamily("microsoftonline.com").id, "microsoft");
    assert.equal(identityFamily("accounts.google.com").id, "google");
    assert.equal(identityFamily("appleid.apple.com").id, "apple");
    assert.equal(identityFamily("www.facebook.com").id, "meta");
    assert.equal(identityFamily("example.com"), null);
    // "notmicrosoft.com" ailəyə DÜŞMƏMƏLİDİR (sadə `includes` səhvi)
    assert.equal(identityFamily("notmicrosoft.com"), null);
    assert.equal(identityFamily(""), null);
    assert.equal(identityFamily(null), null);
  });
});

describe("DATA_TYPES — silinən növlər", () => {
  it("cookie, saxlanc və keş silinir", () => {
    assert.deepEqual(Object.keys(DATA_TYPES).sort(), [
      "cache", "cacheStorage", "cookies", "fileSystems", "indexedDB", "localStorage", "serviceWorkers",
    ]);
    assert.ok(Object.values(DATA_TYPES).every((v) => v === true));
  });

  it("parollar SİLİNMİR — Chrome 144-dən extension-lar bunu edə bilmir və növ origin üzrə süzülmür", () => {
    assert.equal("passwords" in DATA_TYPES, false);
  });

  it("origin ilə süzülməyən növlər siyahıda yoxdur (bütün profil silinərdi)", () => {
    for (const type of ["history", "formData", "downloads", "passwords"]) {
      assert.equal(type in DATA_TYPES, false, type);
    }
  });
});


describe("ORIGIN_TYPES — hansı origin növləri silinir", () => {
  it("PWA kimi quraşdırılmış sayt da silinir (protectedWeb)", () => {
    assert.equal(ORIGIN_TYPES.unprotectedWeb, true);
    assert.equal(ORIGIN_TYPES.protectedWeb, true);
  });

  it("extension saxlancına toxunulmur", () => {
    assert.equal("extension" in ORIGIN_TYPES, false);
  });
});
