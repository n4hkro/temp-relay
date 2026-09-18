// Qeydiyyat üçün istifadəçi adı (shared/username.ts).
//
// Ad ünvandan törədilir: hesabın açarıdır, ona görə istifadəçi onu ünvana baxıb xatırlaya
// bilməlidir. Burada saytların adi qaydaları yoxlanılır — yalnız hərf/rəqəm, hərflə başlayır,
// 6…20 simvol.
import { describe, expect, it } from "vitest";

import { usernameFromAddress, USERNAME_MAX, USERNAME_MIN } from "../src/shared/username";

// Determinist "təsadüfi" mənbə: hər dəfə eyni bayt (pick → alfabetin ilk simvolu)
const fixed = (byte: any) => (count: any) => new Uint8Array(count).fill(byte);

describe("usernameFromAddress", () => {
  it("ünvanın lokal hissəsini alır, domeni atır", () => {
    expect(usernameFromAddress("yorhun277@gmail.com")).toBe("yorhun277");
  });

  it("nöqtə, plus etiketi və digər simvollar silinir", () => {
    expect(usernameFromAddress("yavas.huseyin15+2t0t8@gmail.com")).toBe("yavashuseyin152t0t8");
    expect(usernameFromAddress("a_b-c.d@temp.tf", { random: fixed(0) })).toBe("abcd22");
  });

  it("böyük hərflər kiçildilir", () => {
    expect(usernameFromAddress("YorHun277@Gmail.com")).toBe("yorhun277");
  });

  it("rəqəmlə başlayan ad hərflə başlayır (saytlar tələb edir)", () => {
    const name = usernameFromAddress("277yorhun@gmail.com");
    expect(name).toMatch(/^[a-z]/);
    expect(name.slice(1)).toBe("277yorhun");
  });

  it("qısa ad minimuma qədər uzadılır", () => {
    const name = usernameFromAddress("ab@temp.tf", { random: fixed(0) });
    expect(name.length).toBe(USERNAME_MIN);
    expect(name).toBe("ab2222");
  });

  it("uzun ad kəsilir (default 20 simvol)", () => {
    const name = usernameFromAddress("abcdefghijklmnopqrstuvwxyz@temp.tf");
    expect(name.length).toBe(USERNAME_MAX);
    expect(name).toBe("abcdefghijklmnopqrst");
  });

  it("xananın maxlength-i nəzərə alınır", () => {
    expect(usernameFromAddress("yavashuseyin15@gmail.com", { maxLength: 8 })).toBe("yavashus");
    // Mənasız limit (minimumdan kiçik) nəzərə alınmır — default işləyir
    expect(usernameFromAddress("yavashuseyin15@gmail.com", { maxLength: 2 })).toBe("yavashuseyin15");
    // Limit 20-dən böyük olsa da tavan USERNAME_MAX-dır
    expect(usernameFromAddress("abcdefghijklmnopqrstuvwxyz@temp.tf", { maxLength: 99 }).length).toBe(USERNAME_MAX);
  });

  it("boş və pozulmuş dəyər üçün də işlək ad qaytarır", () => {
    for (const input of [null, undefined, "", "@gmail.com", "..++..@gmail.com"]) {
      const name = usernameFromAddress(input, { random: fixed(0) });
      expect(name, String(input)).toMatch(/^[a-z][a-z0-9]*$/);
      expect(name.length >= USERNAME_MIN, String(input)).toBeTruthy();
    }
  });

  it("həqiqi crypto ilə də qayda pozulmur", () => {
    for (let i = 0; i < 50; i++) {
      const name = usernameFromAddress("q@temp.tf");
      expect(name).toMatch(/^[a-z][a-z0-9]{5,19}$/);
    }
  });
});
