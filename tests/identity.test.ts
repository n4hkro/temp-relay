// Qeydiyyat üçün bütöv şəxs profili (shared/identity.ts).
//
// İki şey vacibdir: dəyərlər HƏQİQƏTƏ BƏNZƏSİN (saytın yoxlaması keçsin) və eyni ünvan üçün
// HƏMİŞƏ EYNİ olsun — forma iki mərhələdə doldurulur, worker arada sönə bilər.
import { describe, expect, it } from "vitest";

import { buildIdentity, MAX_AGE, MIN_AGE } from "../src/shared/identity";

const NOW = Date.UTC(2026, 8, 15);            // 15 sentyabr 2026
const make = (address = "yorhun277+3xjuw@gmail.com") => buildIdentity(address, { now: NOW });

describe("buildIdentity — determinizm", () => {
  it("eyni ünvan həmişə eyni şəxsi verir", () => {
    expect(make()).toStrictEqual(make());
  });

  it("fərqli ünvan fərqli şəxs verir", () => {
    const a = make("aaa111@gmail.com");
    const b = make("bbb222@gmail.com");
    expect(a).not.toStrictEqual(b);
  });

  it("pozulmuş ünvanla da işlək profil qaytarır", () => {
    for (const address of [null, undefined, "", "@x.com"]) {
      const id = buildIdentity(address, { now: NOW });
      expect(id.firstName, String(address)).toMatch(/^[A-Z][a-z]+$/);
      expect(id.username, String(address)).toMatch(/^[a-z][a-z0-9]{5,19}$/);
    }
  });
});

describe("buildIdentity — ad və istifadəçi adı", () => {
  it("ad və soyad latın hərfləri ilədir və uzunluğu normaldır", () => {
    for (const seed of ["a@x.com", "b@x.com", "c@x.com", "d@x.com", "e@x.com"]) {
      const id = make(seed);
      for (const part of [id.firstName, id.lastName, id.middleName]) {
        expect(part, part).toMatch(/^[A-Z][a-z]{2,9}$/);
      }
      expect(id.fullName).toBe(`${id.firstName} ${id.lastName}`);
    }
  });

  it("istifadəçi adı ünvandan törədilir", () => {
    expect(make("yavashuseyin15@gmail.com").username).toBe("yavashuseyin15");
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
      expect(expected, `naməlum şəhər: ${id.city}`).toBeTruthy();
      expect(id.stateCode).toBe(expected![0]);
      expect(id.postal).toBe(expected![1]);
      expect(id.phoneDigits.startsWith(expected![2]), `${id.city} ↔ ${id.phoneDigits}`).toBeTruthy();
      expect(id.country).toBe("United States");
      expect(id.countryCode).toBe("US");
    }
  });

  it("indeks 5 rəqəm, telefon 10 rəqəmdir (NANP: mərkəz kodu 2-9 ilə başlayır)", () => {
    for (let i = 0; i < 30; i++) {
      const id = make(`p${i}@gmail.com`);
      expect(id.postal).toMatch(/^\d{5}$/);
      expect(id.phoneDigits).toMatch(/^\d{3}[2-9]\d{6}$/);
      expect(id.phone).toBe(`+1${id.phoneDigits}`);
      expect(id.phoneNational).toMatch(/^\(\d{3}\) \d{3}-\d{4}$/);
      expect(id.phoneCountryCode).toBe("+1");
    }
  });

  it("küçə ünvanı nömrə + ad + növ formasındadır", () => {
    for (let i = 0; i < 10; i++) {
      expect(make(`s${i}@gmail.com`).street).toMatch(/^\d{3,4} [A-Z][a-z]+ (Street|Avenue|Road|Lane|Drive)$/);
    }
  });
});

describe("buildIdentity — doğum tarixi", () => {
  it("yaş 24…38 arasındadır (18-dən aşağı və 60+ yoxlamalara düşür)", () => {
    for (let i = 0; i < 40; i++) {
      const id = make(`b${i}@gmail.com`);
      const age = Number(id.age);
      expect(age >= MIN_AGE && age <= MAX_AGE, `yaş: ${age}`).toBeTruthy();
      expect(Number(id.birthYear)).toBe(2026 - age);
    }
  });

  it("tarix ISO formasındadır və gün 28-i keçmir (fevral xətası olmasın)", () => {
    for (let i = 0; i < 40; i++) {
      const id = make(`d${i}@gmail.com`);
      expect(id.birthIso).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(id.birthIso).toBe(`${id.birthYear}-${id.birthMonth}-${id.birthDay}`);
      expect(Number(id.birthDay) >= 1 && Number(id.birthDay) <= 28).toBeTruthy();
      expect(Number(id.birthMonth) >= 1 && Number(id.birthMonth) <= 12).toBeTruthy();
      expect(new Date(id.birthIso).getUTCMonth() + 1).toBe(Number(id.birthMonth));
    }
  });

  it("ayın adı nömrəsi ilə uzlaşır", () => {
    const names = ["January", "February", "March", "April", "May", "June", "July", "August",
      "September", "October", "November", "December"];
    for (let i = 0; i < 20; i++) {
      const id = make(`m${i}@gmail.com`);
      expect(id.birthMonthName).toBe(names[Number(id.birthMonth) - 1]);
    }
  });
});

describe("buildIdentity — qalan sahələr", () => {
  it("cins, şirkət, vəzifə, sayt və haqqında sahəsi doldurulur", () => {
    const id = make();
    expect(["male", "female"].includes(id.gender)).toBeTruthy();
    expect(id.company).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+$/);
    expect(id.jobTitle).toMatch(/^[A-Z][a-z]+( [A-Z][a-z]+)+$/);
    expect(id.website).toBe(`https://${id.username}.example.com`);
    expect(id.bio.includes(id.firstName)).toBeTruthy();
    // "Haqqında" mətni normal uzunluqdadır: çox qısa da, çox uzun da olmamalıdır
    expect(id.bio.length >= 40 && id.bio.length <= 160, `bio uzunluğu: ${id.bio.length}`).toBeTruthy();
  });

  it("mənzil sətri qısa və adi formadadır", () => {
    expect(make().street2).toMatch(/^(Apt|Suite|Unit) \w{1,3}$/);
  });

  it("bütün dəyərlər sətirdir (səhifəyə hazır formada gedir)", () => {
    for (const [key, value] of Object.entries(make())) {
      expect(typeof value, key).toBe("string");
      expect(value, key).not.toBe("");
    }
  });
});
