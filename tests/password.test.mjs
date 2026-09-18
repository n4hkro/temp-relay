// Parol yaradıcısının testləri (shared/password.js).
// Parolu extension yaradır (Chrome-un "Suggest strong password" pəncərəsi kənardan açıla
// bilmir), ona görə keyfiyyət burada yoxlanılır: uzunluq, sinif təminatı, təsadüfilik və
// modulo meylinin olmaması.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { generatePassword, PASSWORD_LENGTH } from "../src/shared/password.js";

// Generatorun əlifbaları ilə BİREBİR: kiçik hərflərdən yalnız `l` çıxarılıb (i/o qalır, çünki
// qarışdıqları `1` və `0` rəqəmləri onsuz da yoxdur), böyükdən `I` və `O`, rəqəmlərdən `0`/`1`.
const LOWER = /[a-km-z]/;          // yalnız l çıxarılıb
const UPPER = /[A-HJ-NP-Z]/;       // I, O çıxarılıb
const DIGIT = /[2-9]/;             // 0, 1 çıxarılıb

// Determinist "təsadüfi": verilmiş baytları sıra ilə qaytarır
const bytesFrom = (list) => {
  let i = 0;
  return (count) => Uint8Array.from({ length: count }, () => list[i++ % list.length]);
};

describe("generatePassword", () => {
  it("default uzunluq 8-dir (saytların ən yayğın minimumu, yuxarı hədləri də keçir)", () => {
    assert.equal(generatePassword().length, PASSWORD_LENGTH);
    assert.equal(PASSWORD_LENGTH, 8);
  });

  it("istənilən uzunluq verilə bilər", () => {
    for (const length of [8, 12, 20, 32]) assert.equal(generatePassword(length).length, length);
  });

  it("8-dən qısa parol rədd olunur", () => {
    for (const bad of [7, 0, -1, 1.5, "16", null]) assert.throws(() => generatePassword(bad), /ən azı 8/);
  });

  it("hər parolda kiçik, böyük hərf, rəqəm və DƏQİQ bir xüsusi simvol var", () => {
    for (let i = 0; i < 200; i++) {
      const password = generatePassword();
      assert.match(password, LOWER, password);
      assert.match(password, UPPER, password);
      assert.match(password, DIGIT, password);
      assert.equal((password.match(/[!@#$%*]/g) ?? []).length, 1, password);
    }
  });

  it("səhv oxunan simvollar işlənmir (l/I/1, O/0) — parol əl ilə də yazıla bilməlidir", () => {
    for (let i = 0; i < 200; i++) assert.doesNotMatch(generatePassword(32), /[lIO01]/);
  });

  it("xüsusi simvol İÇƏRİDƏDİR (əvvəldə/sonda deyil)", () => {
    // Bəzi yoxlayıcılar simvolla başlayan/bitən parolu qəbul etmir
    for (let i = 0; i < 300; i++) {
      const password = generatePassword(8);
      assert.doesNotMatch(password[0], /[!@#$%*]/, password);
      assert.doesNotMatch(password[password.length - 1], /[!@#$%*]/, password);
    }
  });

  it("simvolun yeri sabit deyil (təsadüfi seçilir)", () => {
    const spots = new Set();
    for (let i = 0; i < 300; i++) spots.add(generatePassword().search(/[!@#$%*]/));
    assert.ok(spots.size > 3, `simvol həmişə eyni yerdədir: ${[...spots].join(",")}`);
  });

  it("qalan simvollar alfanumerikdir (yalnız bir simvol var)", () => {
    for (let i = 0; i < 50; i++) {
      const password = generatePassword(24);
      assert.match(password, /^[A-Za-z0-9]*[!@#$%*][A-Za-z0-9]*$/, password);
    }
  });

  it("təkrarlanmır (hər çağırış yeni parol)", () => {
    const seen = new Set();
    for (let i = 0; i < 500; i++) seen.add(generatePassword());
    assert.equal(seen.size, 500);
  });

  it("sinif təminatı sabit yerdə qalmır (qarışdırılır)", () => {
    // İlk üç simvol həmişə kiçik/böyük/rəqəm sırasında olsaydı bu say 100-ə bərabər olardı
    let digitFirst = 0;
    for (let i = 0; i < 300; i++) if (DIGIT.test(generatePassword()[0])) digitFirst++;
    assert.ok(digitFirst > 10, `qarışdırma işləmir: ${digitFirst}`);
  });

  it("modulo meyli yoxdur: 256-nın quyruğuna düşən bayt atılır", () => {
    // 255 → LOWER (25 simvol) üçün limitdən yuxarıdır (250), ona görə atılmalı və növbəti
    // bayt (0) işlənməlidir. Meyl olsaydı 255 % 25 = 5 → "f" alınardı.
    const password = generatePassword(8, bytesFrom([255, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]));
    assert.equal(password[0] === "f", false, password);
    assert.equal(password.length, 8);
  });

  it("determinist mənbə ilə nəticə təkrarlanır (mənbə yeganə təsadüfilik qaynağıdır)", () => {
    const source = [7, 42, 13, 200, 3, 88, 150, 21, 64, 99, 111, 5];
    assert.equal(generatePassword(12, bytesFrom(source)), generatePassword(12, bytesFrom(source)));
  });

  it("mənbə həmişə eyni baytı verirsə sonsuz döngüyə düşmür", () => {
    // 255 hər üç alfabet üçün rədd edilir → qoruyucu xəta atmalıdır, döngü ilişməməlidir
    assert.throws(() => generatePassword(8, () => Uint8Array.of(255)), /təsadüfi simvol seçilə bilmədi/);
  });
});
