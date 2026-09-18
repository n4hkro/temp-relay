// Parol yaradıcısının testləri (shared/password.ts).
// Parolu extension yaradır (Chrome-un "Suggest strong password" pəncərəsi kənardan açıla
// bilmir), ona görə keyfiyyət burada yoxlanılır: uzunluq, sinif təminatı, təsadüfilik və
// modulo meylinin olmaması.
import { describe, expect, it } from "vitest";

import { generatePassword, PASSWORD_LENGTH } from "../src/shared/password";

// Generatorun əlifbaları ilə BİREBİR: kiçik hərflərdən yalnız `l` çıxarılıb (i/o qalır, çünki
// qarışdıqları `1` və `0` rəqəmləri onsuz da yoxdur), böyükdən `I` və `O`, rəqəmlərdən `0`/`1`.
const LOWER = /[a-km-z]/;          // yalnız l çıxarılıb
const UPPER = /[A-HJ-NP-Z]/;       // I, O çıxarılıb
const DIGIT = /[2-9]/;             // 0, 1 çıxarılıb

// Determinist "təsadüfi": verilmiş baytları sıra ilə qaytarır
const bytesFrom = (list: any) => {
  let i = 0;
  return (count: any) => Uint8Array.from({ length: count }, () => list[i++ % list.length]);
};

describe("generatePassword", () => {
  it("default uzunluq 8-dir (saytların ən yayğın minimumu, yuxarı hədləri də keçir)", () => {
    expect(generatePassword().length).toBe(PASSWORD_LENGTH);
    expect(PASSWORD_LENGTH).toBe(8);
  });

  it("istənilən uzunluq verilə bilər", () => {
    for (const length of [8, 12, 20, 32]) expect(generatePassword(length).length).toBe(length);
  });

  it("8-dən qısa parol rədd olunur", () => {
    for (const bad of [7, 0, -1, 1.5, "16", null]) expect(() => generatePassword(bad as any)).toThrow(/ən azı 8/);
  });

  it("hər parolda kiçik, böyük hərf, rəqəm və DƏQİQ bir xüsusi simvol var", () => {
    for (let i = 0; i < 200; i++) {
      const password = generatePassword();
      expect(password, password).toMatch(LOWER);
      expect(password, password).toMatch(UPPER);
      expect(password, password).toMatch(DIGIT);
      expect((password.match(/[!@#$%*]/g) ?? []).length, password).toBe(1);
    }
  });

  it("səhv oxunan simvollar işlənmir (l/I/1, O/0) — parol əl ilə də yazıla bilməlidir", () => {
    for (let i = 0; i < 200; i++) expect(generatePassword(32)).not.toMatch(/[lIO01]/);
  });

  it("xüsusi simvol İÇƏRİDƏDİR (əvvəldə/sonda deyil)", () => {
    // Bəzi yoxlayıcılar simvolla başlayan/bitən parolu qəbul etmir
    for (let i = 0; i < 300; i++) {
      const password = generatePassword(8);
      expect(password[0], password).not.toMatch(/[!@#$%*]/);
      expect(password[password.length - 1], password).not.toMatch(/[!@#$%*]/);
    }
  });

  it("simvolun yeri sabit deyil (təsadüfi seçilir)", () => {
    const spots = new Set();
    for (let i = 0; i < 300; i++) spots.add(generatePassword().search(/[!@#$%*]/));
    expect(spots.size > 3, `simvol həmişə eyni yerdədir: ${[...spots].join(",")}`).toBeTruthy();
  });

  it("qalan simvollar alfanumerikdir (yalnız bir simvol var)", () => {
    for (let i = 0; i < 50; i++) {
      const password = generatePassword(24);
      expect(password, password).toMatch(/^[A-Za-z0-9]*[!@#$%*][A-Za-z0-9]*$/);
    }
  });

  it("təkrarlanmır (hər çağırış yeni parol)", () => {
    const seen = new Set();
    for (let i = 0; i < 500; i++) seen.add(generatePassword());
    expect(seen.size).toBe(500);
  });

  it("sinif təminatı sabit yerdə qalmır (qarışdırılır)", () => {
    // İlk üç simvol həmişə kiçik/böyük/rəqəm sırasında olsaydı bu say 100-ə bərabər olardı
    let digitFirst = 0;
    for (let i = 0; i < 300; i++) if (DIGIT.test(generatePassword()[0])) digitFirst++;
    expect(digitFirst > 10, `qarışdırma işləmir: ${digitFirst}`).toBeTruthy();
  });

  it("modulo meyli yoxdur: 256-nın quyruğuna düşən bayt atılır", () => {
    // 255 → LOWER (25 simvol) üçün limitdən yuxarıdır (250), ona görə atılmalı və növbəti
    // bayt (0) işlənməlidir. Meyl olsaydı 255 % 25 = 5 → "f" alınardı.
    const password = generatePassword(8, bytesFrom([255, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]));
    expect(password[0] === "f", password).toBe(false);
    expect(password.length).toBe(8);
  });

  it("determinist mənbə ilə nəticə təkrarlanır (mənbə yeganə təsadüfilik qaynağıdır)", () => {
    const source = [7, 42, 13, 200, 3, 88, 150, 21, 64, 99, 111, 5];
    expect(generatePassword(12, bytesFrom(source))).toBe(generatePassword(12, bytesFrom(source)));
  });

  it("mənbə həmişə eyni baytı verirsə sonsuz döngüyə düşmür", () => {
    // 255 hər üç alfabet üçün rədd edilir → qoruyucu xəta atmalıdır, döngü ilişməməlidir
    expect(() => generatePassword(8, () => Uint8Array.of(255))).toThrow(/təsadüfi simvol seçilə bilmədi/);
  });
});
