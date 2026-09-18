// "Bu sayt" relay-i: sabit saytı yoxdur, aktiv tabın saytını mənimsəyir.
//
// Niyə testlənir: mənimsənilən relay qalan qatlara ADİ relay kimi görünməlidir — poçt
// ipuçları, təmizləmə və status mətnləri fərq görməməlidir. Forma pozulsa ya kod yanlış
// sayta görə axtarılar, ya da istifadəçinin öz saytının məlumatı silinər.
import { describe, expect, it } from "vitest";

import { adoptedRelay, isAdopted, resolveRelay } from "../src/background/relay";
import { adoptsActiveTab, supportsInbox } from "../src/providers/contract";
import type { RelayDescriptor, SiteRelayDescriptor } from "../src/providers/contract";
import { RELAY } from "../src/providers/relay/index";
import { mailHints } from "../src/shared/extract";
import { supportsSignup, SignupPhase } from "../src/background/signup";

const active: RelayDescriptor = RELAY.get("active-tab");

// Sayta bağlı relay deskriptoru artıq yoxdur (yalnız "bu sayt" var), amma `signup` addımlarının
// mexanizmi qalır — gələcək relay-lar üçün. Ona görə "adi relay" burada YERLİ deskriptor kimi
// təsvir olunur: reyestrdən asılı olmayan, kontraktın yoxladığı minimal forma.
const plainRelay: SiteRelayDescriptor = Object.freeze({
  id: "example-relay",
  name: "example-relay",
  url: "https://relaysite.example/sign-up",
  hosts: ["relaysite.example"],
  cleanup: {
    cookieDomains: ["relaysite.example"],
    partitionTopLevelSites: ["https://relaysite.example"],
    storageOrigins: ["https://relaysite.example"],
  },
});

describe("deskriptor", () => {
  it("reyestrə düşür və mənimsəyən kimi tanınır", () => {
    expect(RELAY.problems).toStrictEqual([]);
    expect(adoptsActiveTab(active)).toBe(true);
    expect(adoptsActiveTab(plainRelay)).toBe(false);
  });

  it("reyestrdə YALNIZ 'bu sayt' relay-i var (sayta bağlı deskriptorlar silinib)", () => {
    expect(RELAY.ids()).toStrictEqual(["active-tab"]);
  });

  it("sayt məlumatı daşımır (işləmə anında bilinir)", () => {
    for (const field of ["url", "hosts", "cleanup", "mail", "signup", "requestOrigin"]) {
      expect((active as unknown as Record<string, unknown>)[field], field).toBe(undefined);
    }
  });

  it("qeydiyyat addımı yoxdur — naməlum saytın forması evristika ilə doldurulur", () => {
    expect(supportsSignup(active, SignupPhase.afterAddress)).toBe(false);
    expect(supportsSignup(active, SignupPhase.afterCode)).toBe(false);
  });
});

describe("adoptedRelay — tabdan törədilən forma", () => {
  const relay = adoptedRelay(active, "https://www.facebook.com");

  it("adi relay-in sahələrini daşıyır", () => {
    expect(relay.id).toBe("active-tab");
    expect(relay.url).toBe("https://www.facebook.com");
    expect(relay.hosts).toStrictEqual(["facebook.com"]);
    expect(isAdopted(relay)).toBe(true);
    expect(isAdopted(plainRelay)).toBe(false);
  });

  it("adı domendir: poçt ipuçları onun tokenlərini işlədir", () => {
    expect(relay.name).toBe("facebook.com");
    const hints = mailHints(relay);
    expect(hints.domains).toStrictEqual(["facebook.com"]);
    expect(hints.keywords.includes("facebook"), JSON.stringify(hints.keywords)).toBeTruthy();
  });

  it("alt-domendə də qeydə alınabilən domen götürülür", () => {
    const sub = adoptedRelay(active, "https://accounts.google.com");
    expect(sub.hosts).toStrictEqual(["google.com"]);
    expect(mailHints(sub).domains).toStrictEqual(["google.com"]);
  });

  it("silmə planı adi relay-in cleanup forması ilə eynidir", () => {
    expect(Object.keys(relay.cleanup!).sort()).toStrictEqual(Object.keys(plainRelay.cleanup).sort());
    expect(relay.cleanup!.cookieDomains.includes("facebook.com")).toBeTruthy();
    expect(relay.cleanup!.storageOrigins.includes("https://www.facebook.com")).toBeTruthy();
  });

  // Mənimsənilən sayt tanınmış identity ailəsindəndirsə tab bağlananda AİLƏ də silinir:
  // əks halda tab yenidən açılanda sayt qonşu domendəki cookie ilə eyni hesabı tanıyır.
  it("identity ailəsi olan sayt üçün plan ailənin domenlərini də əhatə edir", () => {
    for (const domain of ["messenger.com", "instagram.com"]) {
      expect(relay.cleanup!.cookieDomains.includes(domain), domain).toBeTruthy();
    }
    const microsoft = adoptedRelay(active, "https://login.microsoftonline.com");
    expect(microsoft.cleanup!.cookieDomains.includes("live.com"), "şəxsi hesab domeni də silinməlidir").toBeTruthy();
    expect(microsoft.cleanup!.storageOrigins.includes("https://login.live.com")).toBeTruthy();
  });

  it("ailəyə aid olmayan sayt genişlənmir", () => {
    const plain = adoptedRelay(active, "https://relaysite.example");
    expect(plain.cleanup!.cookieDomains).toStrictEqual(["relaysite.example"]);
  });

  it("adi sayt olmayan ünvan rədd olunur", () => {
    for (const site of ["chrome://extensions", "about:blank", "", null]) {
      expect(() => adoptedRelay(active, site as unknown as string), String(site)).toThrow(/adi sayt deyil/);
    }
  });
});

describe("resolveRelay — sessiyanın relay-i", () => {
  it("mənimsəyən relay üçün sessiyadaki sayt işlədilir", () => {
    const relay = resolveRelay({ relayId: "active-tab", relaySite: "https://github.com" });
    expect(relay.name).toBe("github.com");
    expect(relay.url).toBe("https://github.com");
  });

  it("sessiyada sayt yoxdursa aydın xəta verilir", () => {
    expect(() => resolveRelay({ relayId: "active-tab" })).toThrow(/sessiyada sayt yazılmayıb/);
  });

  // Silinmiş relay-ə istinad edən KÖHNƏ sessiya: storage.session brauzer bağlananadək yaşayır,
  // ona görə provider silindikdən sonra belə sessiya qala bilər. Səbəb istifadəçiyə aydın
  // çatmalıdır (reyestrin "naməlum sayt" xətası qüsur kimi görünərdi).
  it("silinmiş/naməlum relay id-si üçün nə edəcəyini deyən xəta verilir", () => {
    expect(() => resolveRelay({ relayId: "relaysite.example" })).toThrow(/artıq mövcud deyil/);
    expect(() => resolveRelay({ relayId: "yoxdur" })).toThrow(/Dayandır və yenidən Başlat/);
    expect(() => resolveRelay({})).toThrow(/artıq mövcud deyil/);
  });
});

describe("kontrakt yoxlaması", () => {
  // Mənimsəyən relay-ə sayt məlumatı yazılsa reyestrə düşməməlidir: hansı sayt olduğu
  // Başlat anında bilinir, deskriptordaki dəyər yanıltıcı olardı.
  const build = async (patch: Record<string, unknown>) => {
    const { createRegistry, validateRelay } = await import("../src/providers/contract");
    const original = console.error;
    console.error = () => {};
    try { return createRegistry("test", [{ ...active, ...patch }], validateRelay).problems; } finally { console.error = original; }
  };

  it("düzgün deskriptor qəbul olunur", async () => {
    expect(await build({})).toStrictEqual([]);
  });

  it("id və name məcburidir", async () => {
    expect((await build({ name: "" }))[0]).toMatch(/name boş olmayan sətir/);
  });

  it("url, hosts, cleanup, mail, signup və requestOrigin rədd olunur", async () => {
    for (const [field, value] of [
      ["url", "https://a.example"],
      ["hosts", ["a.example"]],
      ["cleanup", { cookieDomains: ["a.example"], storageOrigins: ["https://a.example"] }],
      ["mail", { keywords: ["x"] }],
      ["signup", { afterCode: [{ click: "#a" }] }],
      ["requestOrigin", "https://a.example"],
    ] as [string, any][]) {
      expect((await build({ [field]: value }))[0], field).toMatch(new RegExp(`${field} adoptActiveTab relay-ində ola bilməz`));
    }
  });

  it("temp-mail imkanları relay-ə qarışmır", () => {
    // Aktiv-tab relay-də poçt qutusu imkanı yoxdur — supportsInbox yalnız fetchMessages-ə baxır
    expect(supportsInbox(active as unknown as { fetchMessages?: unknown })).toBe(false);
  });
});
