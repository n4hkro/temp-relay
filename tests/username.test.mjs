// Qeydiyyat üçün istifadəçi adı (shared/username.js).
//
// Ad ünvandan törədilir: hesabın açarıdır, ona görə istifadəçi onu ünvana baxıb xatırlaya
// bilməlidir. Burada saytların adi qaydaları yoxlanılır — yalnız hərf/rəqəm, hərflə başlayır,
// 6…20 simvol.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { usernameFromAddress, USERNAME_MAX, USERNAME_MIN } from "../src/shared/username.js";

// Determinist "təsadüfi" mənbə: hər dəfə eyni bayt (pick → alfabetin ilk simvolu)
const fixed = (byte) => (count) => new Uint8Array(count).fill(byte);

describe("usernameFromAddress", () => {
  it("ünvanın lokal hissəsini alır, domeni atır", () => {
    assert.equal(usernameFromAddress("yorhun277@gmail.com"), "yorhun277");
  });

  it("nöqtə, plus etiketi və digər simvollar silinir", () => {
    assert.equal(usernameFromAddress("yavas.huseyin15+2t0t8@gmail.com"), "yavashuseyin152t0t8");
    assert.equal(usernameFromAddress("a_b-c.d@temp.tf", { random: fixed(0) }), "abcd22");
  });

  it("böyük hərflər kiçildilir", () => {
    assert.equal(usernameFromAddress("YorHun277@Gmail.com"), "yorhun277");
  });

  it("rəqəmlə başlayan ad hərflə başlayır (saytlar tələb edir)", () => {
    const name = usernameFromAddress("277yorhun@gmail.com");
    assert.match(name, /^[a-z]/);
    assert.equal(name.slice(1), "277yorhun");
  });

  it("qısa ad minimuma qədər uzadılır", () => {
    const name = usernameFromAddress("ab@temp.tf", { random: fixed(0) });
    assert.equal(name.length, USERNAME_MIN);
    assert.equal(name, "ab2222");
  });

  it("uzun ad kəsilir (default 20 simvol)", () => {
    const name = usernameFromAddress("abcdefghijklmnopqrstuvwxyz@temp.tf");
    assert.equal(name.length, USERNAME_MAX);
    assert.equal(name, "abcdefghijklmnopqrst");
  });

  it("xananın maxlength-i nəzərə alınır", () => {
    assert.equal(usernameFromAddress("yavashuseyin15@gmail.com", { maxLength: 8 }), "yavashus");
    // Mənasız limit (minimumdan kiçik) nəzərə alınmır — default işləyir
    assert.equal(usernameFromAddress("yavashuseyin15@gmail.com", { maxLength: 2 }), "yavashuseyin15");
    // Limit 20-dən böyük olsa da tavan USERNAME_MAX-dır
    assert.equal(usernameFromAddress("abcdefghijklmnopqrstuvwxyz@temp.tf", { maxLength: 99 }).length, USERNAME_MAX);
  });

  it("boş və pozulmuş dəyər üçün də işlək ad qaytarır", () => {
    for (const input of [null, undefined, "", "@gmail.com", "..++..@gmail.com"]) {
      const name = usernameFromAddress(input, { random: fixed(0) });
      assert.match(name, /^[a-z][a-z0-9]*$/, String(input));
      assert.ok(name.length >= USERNAME_MIN, String(input));
    }
  });

  it("həqiqi crypto ilə də qayda pozulmur", () => {
    for (let i = 0; i < 50; i++) {
      const name = usernameFromAddress("q@temp.tf");
      assert.match(name, /^[a-z][a-z0-9]{5,19}$/);
    }
  });
});
