// Qeydiyyat üçün bütöv şəxs profili (shared/identity.js).
//
// İki şey vacibdir: dəyərlər HƏQİQƏTƏ BƏNZƏSİN (saytın yoxlaması keçsin) və eyni ünvan üçün
// HƏMİŞƏ EYNİ olsun — forma iki mərhələdə doldurulur, worker arada sönə bilər.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildIdentity, MAX_AGE, MIN_AGE } from "../src/shared/identity.js";

const NOW = Date.UTC(2026, 8, 15);            // 15 sentyabr 2026
const make = (address = "yorhun277+3xjuw@gmail.com") => buildIdentity(address, { now: NOW });

describe("buildIdentity — determinizm", () => {
  it("eyni ünvan həmişə eyni şəxsi verir", () => {
    assert.deepEqual(make(), make());
  });

  it("fərqli ünvan fərqli şəxs verir", () => {
    const a = make("aaa111@gmail.com");
    const b = make("bbb222@gmail.com");
    assert.notDeepEqual(a, b);
  });

  it("pozulmuş ünvanla da işlək profil qaytarır", () => {
    for (const address of [null, undefined, "", "@x.com"]) {
      const id = buildIdentity(address, { now: NOW });
      assert.match(id.firstName, /^[A-Z][a-z]+$/, String(address));
      assert.match(id.username, /^[a-z][a-z0-9]{5,19}$/, String(address));
    }
  });
});

describe("buildIdentity — ad və istifadəçi adı", () => {
  it("ad və soyad latın hərfləri ilədir və uzunluğu normaldır", () => {
    for (const seed of ["a@x.com", "b@x.com", "c@x.com", "d@x.com", "e@x.com"]) {
      const id = make(seed);
      for (const part of [id.firstName, id.lastName, id.middleName]) {
        assert.match(part, /^[A-Z][a-z]{2,9}$/, part);
      }
      assert.equal(id.fullName, `${id.firstName} ${id.lastName}`);
    }
  });

  it("istifadəçi adı ünvandan törədilir", () => {
    assert.equal(make("yavashuseyin15@gmail.com").username, "yavashuseyin15");
  });
});

describe("buildIdentity — ünvan və telefon uzlaşır", () => {
  it("şəhər, ştat, indeks və sahə kodu eyni yerə aiddir", () => {
    const pairs = new Map([
      ["Austin", ["TX", "78701", "512"]], ["Denver", ["CO", "80202", "303"]],
      ["Portland", ["OR", "97205", "503"]], ["Columbus", ["OH", "43215", "614"]],
      ["Seattle", ["WA", "98101", "206"]], ["Madison", ["WI", "53703", "608"]],
      ["Raleigh", ["NC", "27601", "919"]], ["Tucson", ["AZ", "85701", "520"]],
    ]);
    for (let i = 0; i < 40; i++) {
      const id = make(`user${i}@gmail.com`);
      const expected = pairs.get(id.city);
      assert.ok(expected, `naməlum şəhər: ${id.city}`);
      assert.equal(id.stateCode, expected[0]);
      assert.equal(id.postal, expected[1]);
      assert.ok(id.phoneDigits.startsWith(expected[2]), `${id.city} ↔ ${id.phoneDigits}`);
      assert.equal(id.country, "United States");
      assert.equal(id.countryCode, "US");
    }
  });

  it("indeks 5 rəqəm, telefon 10 rəqəmdir (NANP: mərkəz kodu 2-9 ilə başlayır)", () => {
    for (let i = 0; i < 30; i++) {
      const id = make(`p${i}@gmail.com`);
      assert.match(id.postal, /^\d{5}$/);
      assert.match(id.phoneDigits, /^\d{3}[2-9]\d{6}$/);
      assert.equal(id.phone, `+1${id.phoneDigits}`);
      assert.match(id.phoneNational, /^\(\d{3}\) \d{3}-\d{4}$/);
      assert.equal(id.phoneCountryCode, "+1");
    }
  });

  it("küçə ünvanı nömrə + ad + növ formasındadır", () => {
    for (let i = 0; i < 10; i++) {
      assert.match(make(`s${i}@gmail.com`).street, /^\d{3,4} [A-Z][a-z]+ (Street|Avenue|Road|Lane|Drive)$/);
    }
  });
});

describe("buildIdentity — doğum tarixi", () => {
  it("yaş 24…38 arasındadır (18-dən aşağı və 60+ yoxlamalara düşür)", () => {
    for (let i = 0; i < 40; i++) {
      const id = make(`b${i}@gmail.com`);
      const age = Number(id.age);
      assert.ok(age >= MIN_AGE && age <= MAX_AGE, `yaş: ${age}`);
      assert.equal(Number(id.birthYear), 2026 - age);
    }
  });

  it("tarix ISO formasındadır və gün 28-i keçmir (fevral xətası olmasın)", () => {
    for (let i = 0; i < 40; i++) {
      const id = make(`d${i}@gmail.com`);
      assert.match(id.birthIso, /^\d{4}-\d{2}-\d{2}$/);
      assert.equal(id.birthIso, `${id.birthYear}-${id.birthMonth}-${id.birthDay}`);
      assert.ok(Number(id.birthDay) >= 1 && Number(id.birthDay) <= 28);
      assert.ok(Number(id.birthMonth) >= 1 && Number(id.birthMonth) <= 12);
      assert.equal(new Date(id.birthIso).getUTCMonth() + 1, Number(id.birthMonth));
    }
  });

  it("ayın adı nömrəsi ilə uzlaşır", () => {
    const names = ["January", "February", "March", "April", "May", "June", "July", "August",
      "September", "October", "November", "December"];
    for (let i = 0; i < 20; i++) {
      const id = make(`m${i}@gmail.com`);
      assert.equal(id.birthMonthName, names[Number(id.birthMonth) - 1]);
    }
  });
});

describe("buildIdentity — qalan sahələr", () => {
  it("cins, şirkət, vəzifə, sayt və haqqında sahəsi doldurulur", () => {
    const id = make();
    assert.ok(["male", "female"].includes(id.gender));
    assert.match(id.company, /^[A-Z][a-z]+ [A-Z][a-z]+$/);
    assert.match(id.jobTitle, /^[A-Z][a-z]+( [A-Z][a-z]+)+$/);
    assert.equal(id.website, `https://${id.username}.example.com`);
    assert.ok(id.bio.includes(id.firstName));
    // "Haqqında" mətni normal uzunluqdadır: çox qısa da, çox uzun da olmamalıdır
    assert.ok(id.bio.length >= 40 && id.bio.length <= 160, `bio uzunluğu: ${id.bio.length}`);
  });

  it("mənzil sətri qısa və adi formadadır", () => {
    assert.match(make().street2, /^(Apt|Suite|Unit) \w{1,3}$/);
  });

  it("bütün dəyərlər sətirdir (səhifəyə hazır formada gedir)", () => {
    for (const [key, value] of Object.entries(make())) {
      assert.equal(typeof value, "string", key);
      assert.notEqual(value, "", key);
    }
  });
});
