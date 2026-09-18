// Təmizləmə planının testləri (shared/cleanup.ts).
//
// Plan "nə silinəcək" sualının cavabıdır və iki yerdə işlənir: popup düyməni göstərmək üçün
// (hansı sayt, silinə bilirmi), worker isə silmək üçün. Səhv plan ya lazımsız məlumatı
// silərdi, ya da silinməli olanı buraxardı — ona görə hər qayda burada yoxlanılır.
import { describe, expect, it } from "vitest";

import { DATA_TYPES, IDENTITY_FAMILIES, identityFamily, ORIGIN_TYPES, tabCleanupPlan } from "../src/shared/cleanup";
import { registrableDomain } from "../src/shared/extract";

describe("audit: silmə domen sərhədləri", () => {
  it("Microsoft və Google-un əlavə hesab üzvləri ailəyə daxildir", () => {
    for (const host of ["hotmail.com", "xbox.com", "skype.com", "msn.com"]) expect(identityFamily(host)?.id).toBe("microsoft");
    for (const host of ["gmail.com", "googlemail.com"]) expect(identityFamily(host)?.id).toBe("google");
    expect(tabCleanupPlan("https://icloud.com")!.storageOrigins.includes("https://account.apple.com")).toBeTruthy();
  });
  it("böyük şirkətlərin yeni hesab ailələri əlaqəli login origin-lərini əhatə edir", () => {
    for (const [url, family, login] of [
      ["https://www.primevideo.com/", "amazon", "https://www.amazon.com"],
      ["https://www.behance.net/", "adobe", "https://ims-na1.adobelogin.com"],
      ["https://trello.com/", "atlassian", "https://id.atlassian.com"],
    ]) {
      const plan = tabCleanupPlan(url);
      expect(plan!.family).toBe(family);
      expect(plan!.storageOrigins.includes(login)).toBeTruthy();
    }
  });
  it("PSL-in şəxsi, wildcard və exception qaydaları tenant-ları ayırır", () => {
    for (const [host, expected] of [
      ["alice.blogspot.com", "alice.blogspot.com"],
      ["shop.example.com.np", "example.com.np"],
      ["a.b.ck", "a.b.ck"],
      ["sub.www.ck", "www.ck"],
      ["x.city.kawasaki.jp", "city.kawasaki.jp"],
    ]) expect(tabCleanupPlan(`https://${host}/`)!.cookieDomains).toStrictEqual([expected]);
  });
  it("Azure müştəri tenantı Microsoft hesabını silmir", () => {
    const plan = tabCleanupPlan("https://account.blob.core.windows.net/");
    expect(plan!.family).toBe(null);
    expect(plan!.cookieDomains).toStrictEqual(["account.blob.core.windows.net"]);
    expect(plan!.storageOrigins.includes("https://login.live.com")).toBe(false);
  });
  it("IP və localhost üçün saxta www origin-i yaradılmır", () => {
    for (const url of ["http://[::1]:3000/", "http://127.0.0.1:8080/", "http://localhost:3000/"]) {
      const plan = tabCleanupPlan(url);
      expect(plan!.storageOrigins).toStrictEqual([new URL(url).origin]);
      for (const origin of plan!.storageOrigins) expect(new URL(origin).origin).toBe(origin);
    }
  });
});

describe("tabCleanupPlan — dəstəklənən ünvanlar", () => {
  it("https saytı üçün plan qurulur", () => {
    const plan = tabCleanupPlan("https://nexora.example/sign-up?aff=k6du");
    expect(plan!.host).toBe("nexora.example");
    expect(plan!.domain).toBe("nexora.example");
  });

  it("http da qəbul olunur", () => {
    expect(tabCleanupPlan("http://example.com/")!.domain).toBe("example.com");
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
    ]) expect(tabCleanupPlan(url), url).toBe(null);
  });

  it("pozulmuş və boş dəyərlər üçün null", () => {
    for (const url of ["", "   ", "yox", null, undefined, 5, {}] as any[]) expect(tabCleanupPlan(url), String(url)).toBe(null);
  });

  it("hostu olmayan http ünvanı üçün null", () => {
    expect(tabCleanupPlan("http://")).toBe(null);
  });
});

describe("tabCleanupPlan — cookie domeni", () => {
  it("qeydə alınabilən domen götürülür ki, alt-domenlər də düşsün", () => {
    const plan = tabCleanupPlan("https://app.dashboard.example.com/panel");
    expect(plan!.host).toBe("app.dashboard.example.com");
    expect(plan!.cookieDomains).toStrictEqual(["example.com"]);
  });

  it("apex domendə də eyni nəticə", () => {
    expect(tabCleanupPlan("https://example.com/")!.cookieDomains).toStrictEqual(["example.com"]);
  });

  it("host böyük hərflərlə yazılsa kiçildilir", () => {
    expect(tabCleanupPlan("https://WWW.Example.COM/x")!.host).toBe("www.example.com");
  });
});

describe("tabCleanupPlan — saxlanc origin-ləri", () => {
  it("tabın origin-i, apex və www variantları siyahıya düşür", () => {
    expect(tabCleanupPlan("https://app.example.com/x")!.storageOrigins).toStrictEqual([
      "https://app.example.com",
      "https://example.com",
      "https://www.example.com",
    ]);
  });

  it("təkrarlanan origin bir dəfə yazılır", () => {
    expect(tabCleanupPlan("https://example.com/x")!.storageOrigins).toStrictEqual([
      "https://example.com",
      "https://www.example.com",
    ]);
    expect(tabCleanupPlan("https://www.example.com/x")!.storageOrigins).toStrictEqual([
      "https://www.example.com",
      "https://example.com",
    ]);
  });

  it("origin-lərdə yol və sorğu qalmır (browsingData yalnız origin qəbul edir)", () => {
    for (const origin of tabCleanupPlan("https://example.com/a/b?c=1#d")!.storageOrigins) {
      expect(origin, origin).toMatch(/^https:\/\/[^/]+$/);
    }
  });

  it("port origin-in bir hissəsidir (fərqli port fərqli saytdır)", () => {
    expect(tabCleanupPlan("http://localhost:3000/x")!.storageOrigins[0]).toBe("http://localhost:3000");
  });
});

describe("tabCleanupPlan — partitioned (CHIPS) cookie-lər", () => {
  it("sayt birinci tərəf olanda yazılmış partition-lar siyahıya düşür", () => {
    expect(tabCleanupPlan("https://nexora.example/sign-up")!.partitionTopLevelSites).toStrictEqual(["https://nexora.example"]);
  });

  it("alt-domendə həm origin, həm apex yazılır", () => {
    expect(tabCleanupPlan("https://app.example.com/")!.partitionTopLevelSites).toStrictEqual([
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
    expect(plan!.family).toBe("microsoft");
    expect(plan!.familyName).toBe("Microsoft hesabı");
    for (const domain of ["microsoftonline.com", "live.com", "microsoft.com", "msauth.net", "msftauth.net"]) {
      expect(plan!.cookieDomains.includes(domain), domain).toBeTruthy();
    }
  });

  it("şəxsi hesab (login.live.com) da eyni ailəni açır", () => {
    const plan = tabCleanupPlan("https://login.live.com/oauth20_authorize.srf");
    expect(plan!.family).toBe("microsoft");
    expect(plan!.cookieDomains.includes("microsoftonline.com"), "iş hesabı domeni də silinməlidir").toBeTruthy();
  });

  it("Foundry (ai.azure.com) silinəndə login domenləri də silinir", () => {
    const plan = tabCleanupPlan("https://ai.azure.com/");
    expect(plan!.family).toBe("microsoft");
    expect(plan!.storageOrigins.includes("https://login.microsoftonline.com")).toBeTruthy();
    expect(plan!.storageOrigins.includes("https://login.live.com")).toBeTruthy();
  });

  it("login səhifələrinin origin-ləri saxlanc siyahısındadır (hesab seçimi orada yaşayır)", () => {
    const origins = tabCleanupPlan("https://login.microsoftonline.com/")!.storageOrigins;
    for (const origin of ["https://login.microsoftonline.com", "https://login.live.com",
      "https://account.microsoft.com", "https://login.microsoft.com"]) {
      expect(origins.includes(origin), origin).toBeTruthy();
    }
    // apex-lər də var: browsingData cookie-ləri origin-in domeni üzrə silir
    expect(origins.includes("https://live.com")).toBeTruthy();
  });

  it("origin-lər təkrarlanmır", () => {
    const origins = tabCleanupPlan("https://login.live.com/")!.storageOrigins;
    expect(new Set(origins).size).toBe(origins.length);
  });

  it("ailəyə aid OLMAYAN sayt genişlənmir — yad saytın silinməsi Google seansına toxunmur", () => {
    const plan = tabCleanupPlan("https://nexora.example/sign-up");
    expect(plan!.family).toBe(null);
    expect(plan!.familyName).toBe(null);
    expect(plan!.cookieDomains).toStrictEqual(["nexora.example"]);
    expect(plan!.storageOrigins.some((o) => o.includes("google"))).toBe(false);
  });

  it("ailə qeydləri düzgün formadadır", () => {
    expect(IDENTITY_FAMILIES.length >= 1).toBeTruthy();
    const ids = IDENTITY_FAMILIES.map((f) => f.id);
    expect(new Set(ids).size, "id-lər təkrarlanmır").toBe(ids.length);
    for (const family of IDENTITY_FAMILIES) {
      expect(typeof family.name).toBe("string");
      expect(family.domains.length >= 1, family.id).toBeTruthy();
      for (const domain of family.domains) {
        expect(domain, `${family.id}: ${domain}`).toMatch(/^[a-z0-9.-]+\.[a-z]{2,}$/);
        expect(domain, `${family.id}: ${domain} apex olmalıdır`).toBe(registrableDomain(domain));
      }
      for (const origin of family.origins) expect(origin, origin).toMatch(/^https:\/\/[^/]+$/);
    }
  });

  it("identityFamily hostu tanıyır, alt-domenlər də düşür", () => {
    expect(identityFamily("login.microsoftonline.com")!.id).toBe("microsoft");
    expect(identityFamily("microsoftonline.com")!.id).toBe("microsoft");
    expect(identityFamily("accounts.google.com")!.id).toBe("google");
    expect(identityFamily("appleid.apple.com")!.id).toBe("apple");
    expect(identityFamily("www.facebook.com")!.id).toBe("meta");
    expect(identityFamily("example.com")).toBe(null);
    // "notmicrosoft.com" ailəyə DÜŞMƏMƏLİDİR (sadə `includes` səhvi)
    expect(identityFamily("notmicrosoft.com")).toBe(null);
    expect(identityFamily("")).toBe(null);
    expect(identityFamily(null)).toBe(null);
  });
});

describe("DATA_TYPES — silinən növlər", () => {
  it("cookie, saxlanc və keş silinir", () => {
    expect(Object.keys(DATA_TYPES).sort()).toStrictEqual([
      "cache", "cacheStorage", "cookies", "fileSystems", "indexedDB", "localStorage", "serviceWorkers",
    ]);
    expect(Object.values(DATA_TYPES).every((v) => v === true)).toBeTruthy();
  });

  it("parollar SİLİNMİR — Chrome 144-dən extension-lar bunu edə bilmir və növ origin üzrə süzülmür", () => {
    expect("passwords" in DATA_TYPES).toBe(false);
  });

  it("origin ilə süzülməyən növlər siyahıda yoxdur (bütün profil silinərdi)", () => {
    for (const type of ["history", "formData", "downloads", "passwords"]) {
      expect(type in DATA_TYPES, type).toBe(false);
    }
  });
});


describe("ORIGIN_TYPES — hansı origin növləri silinir", () => {
  it("PWA kimi quraşdırılmış sayt da silinir (protectedWeb)", () => {
    expect(ORIGIN_TYPES.unprotectedWeb).toBe(true);
    expect(ORIGIN_TYPES.protectedWeb).toBe(true);
  });

  it("extension saxlancına toxunulmur", () => {
    expect("extension" in ORIGIN_TYPES).toBe(false);
  });
});
