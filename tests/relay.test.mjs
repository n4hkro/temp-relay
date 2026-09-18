// "Bu sayt" relay-i: sabit saytı yoxdur, aktiv tabın saytını mənimsəyir.
//
// Niyə testlənir: mənimsənilən relay qalan qatlara ADİ relay kimi görünməlidir — poçt
// ipuçları, təmizləmə və status mətnləri fərq görməməlidir. Forma pozulsa ya kod yanlış
// sayta görə axtarılar, ya da istifadəçinin öz saytının məlumatı silinər.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { adoptedRelay, isAdopted, resolveRelay } from "../src/background/relay.js";
import { adoptsActiveTab, supportsInbox } from "../src/providers/contract.js";
import { RELAY } from "../src/providers/relay/index.js";
import { mailHints } from "../src/shared/extract.js";
import { supportsSignup, SignupPhase } from "../src/background/signup.js";

const active = RELAY.get("active-tab");

// Sayta bağlı relay deskriptoru artıq yoxdur (yalnız "bu sayt" var), amma `signup` addımlarının
// mexanizmi qalır — gələcək relay-lar üçün. Ona görə "adi relay" burada YERLİ deskriptor kimi
// təsvir olunur: reyestrdən asılı olmayan, kontraktın yoxladığı minimal forma.
const plainRelay = Object.freeze({
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
    assert.deepEqual(RELAY.problems, []);
    assert.equal(adoptsActiveTab(active), true);
    assert.equal(adoptsActiveTab(plainRelay), false);
  });

  it("reyestrdə YALNIZ 'bu sayt' relay-i var (sayta bağlı deskriptorlar silinib)", () => {
    assert.deepEqual(RELAY.ids(), ["active-tab"]);
  });

  it("sayt məlumatı daşımır (işləmə anında bilinir)", () => {
    for (const field of ["url", "hosts", "cleanup", "mail", "signup", "requestOrigin"]) {
      assert.equal(active[field], undefined, field);
    }
  });

  it("qeydiyyat addımı yoxdur — naməlum saytın forması evristika ilə doldurulur", () => {
    assert.equal(supportsSignup(active, SignupPhase.afterAddress), false);
    assert.equal(supportsSignup(active, SignupPhase.afterCode), false);
  });
});

describe("adoptedRelay — tabdan törədilən forma", () => {
  const relay = adoptedRelay(active, "https://www.facebook.com");

  it("adi relay-in sahələrini daşıyır", () => {
    assert.equal(relay.id, "active-tab");
    assert.equal(relay.url, "https://www.facebook.com");
    assert.deepEqual(relay.hosts, ["facebook.com"]);
    assert.equal(isAdopted(relay), true);
    assert.equal(isAdopted(plainRelay), false);
  });

  it("adı domendir: poçt ipuçları onun tokenlərini işlədir", () => {
    assert.equal(relay.name, "facebook.com");
    const hints = mailHints(relay);
    assert.deepEqual(hints.domains, ["facebook.com"]);
    assert.ok(hints.keywords.includes("facebook"), JSON.stringify(hints.keywords));
  });

  it("alt-domendə də qeydə alınabilən domen götürülür", () => {
    const sub = adoptedRelay(active, "https://accounts.google.com");
    assert.deepEqual(sub.hosts, ["google.com"]);
    assert.deepEqual(mailHints(sub).domains, ["google.com"]);
  });

  it("silmə planı adi relay-in cleanup forması ilə eynidir", () => {
    assert.deepEqual(Object.keys(relay.cleanup).sort(), Object.keys(plainRelay.cleanup).sort());
    assert.ok(relay.cleanup.cookieDomains.includes("facebook.com"));
    assert.ok(relay.cleanup.storageOrigins.includes("https://www.facebook.com"));
  });

  // Mənimsənilən sayt tanınmış identity ailəsindəndirsə tab bağlananda AİLƏ də silinir:
  // əks halda tab yenidən açılanda sayt qonşu domendəki cookie ilə eyni hesabı tanıyır.
  it("identity ailəsi olan sayt üçün plan ailənin domenlərini də əhatə edir", () => {
    for (const domain of ["messenger.com", "instagram.com"]) {
      assert.ok(relay.cleanup.cookieDomains.includes(domain), domain);
    }
    const microsoft = adoptedRelay(active, "https://login.microsoftonline.com");
    assert.ok(microsoft.cleanup.cookieDomains.includes("live.com"), "şəxsi hesab domeni də silinməlidir");
    assert.ok(microsoft.cleanup.storageOrigins.includes("https://login.live.com"));
  });

  it("ailəyə aid olmayan sayt genişlənmir", () => {
    const plain = adoptedRelay(active, "https://relaysite.example");
    assert.deepEqual(plain.cleanup.cookieDomains, ["relaysite.example"]);
  });

  it("adi sayt olmayan ünvan rədd olunur", () => {
    for (const site of ["chrome://extensions", "about:blank", "", null]) {
      assert.throws(() => adoptedRelay(active, site), /adi sayt deyil/, String(site));
    }
  });
});

describe("resolveRelay — sessiyanın relay-i", () => {
  it("mənimsəyən relay üçün sessiyadaki sayt işlədilir", () => {
    const relay = resolveRelay({ relayId: "active-tab", relaySite: "https://github.com" });
    assert.equal(relay.name, "github.com");
    assert.equal(relay.url, "https://github.com");
  });

  it("sessiyada sayt yoxdursa aydın xəta verilir", () => {
    assert.throws(() => resolveRelay({ relayId: "active-tab" }), /sessiyada sayt yazılmayıb/);
  });

  // Silinmiş relay-ə istinad edən KÖHNƏ sessiya: storage.session brauzer bağlananadək yaşayır,
  // ona görə provider silindikdən sonra belə sessiya qala bilər. Səbəb istifadəçiyə aydın
  // çatmalıdır (reyestrin "naməlum sayt" xətası qüsur kimi görünərdi).
  it("silinmiş/naməlum relay id-si üçün nə edəcəyini deyən xəta verilir", () => {
    assert.throws(() => resolveRelay({ relayId: "relaysite.example" }), /artıq mövcud deyil/);
    assert.throws(() => resolveRelay({ relayId: "yoxdur" }), /Dayandır və yenidən Başlat/);
    assert.throws(() => resolveRelay({}), /artıq mövcud deyil/);
  });
});

describe("kontrakt yoxlaması", () => {
  // Mənimsəyən relay-ə sayt məlumatı yazılsa reyestrə düşməməlidir: hansı sayt olduğu
  // Başlat anında bilinir, deskriptordaki dəyər yanıltıcı olardı.
  const build = async (patch) => {
    const { createRegistry, validateRelay } = await import("../src/providers/contract.js");
    const original = console.error;
    console.error = () => {};
    try { return createRegistry("test", [{ ...active, ...patch }], validateRelay).problems; } finally { console.error = original; }
  };

  it("düzgün deskriptor qəbul olunur", async () => {
    assert.deepEqual(await build({}), []);
  });

  it("id və name məcburidir", async () => {
    assert.match((await build({ name: "" }))[0], /name boş olmayan sətir/);
  });

  it("url, hosts, cleanup, mail, signup və requestOrigin rədd olunur", async () => {
    for (const [field, value] of [
      ["url", "https://a.example"],
      ["hosts", ["a.example"]],
      ["cleanup", { cookieDomains: ["a.example"], storageOrigins: ["https://a.example"] }],
      ["mail", { keywords: ["x"] }],
      ["signup", { afterCode: [{ click: "#a" }] }],
      ["requestOrigin", "https://a.example"],
    ]) {
      assert.match((await build({ [field]: value }))[0], new RegExp(`${field} adoptActiveTab relay-ində ola bilməz`), field);
    }
  });

  it("temp-mail imkanları relay-ə qarışmır", () => {
    assert.equal(supportsInbox(active), false);
  });
});
