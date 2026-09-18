// Popup-ın status göstərmə qaydaları. null status real haldır (extension təzə qurulanda
// storage boşdur) və əvvəllər burada TypeError yaranırdı.
import { describe, expect, it } from "vitest";

import { EMPTY_STATUS_TEXT, formatStatusText, STATUS_TTL_MS, statusExpired, statusLevel, statusTimeLeft } from "../src/popup/format";
import { StatusLevel } from "../src/shared/state";

const at = (level: any, text: any) : any => ({ level, text, time: new Date("2026-09-11T10:20:30").getTime() });

describe("formatStatusText", () => {
  it("status yoxdursa boş mətn qaytarır (xəta atmır)", () => {
    expect(formatStatusText(null)).toBe(EMPTY_STATUS_TEXT);
    expect(formatStatusText(undefined)).toBe(EMPTY_STATUS_TEXT);
  });

  it("xəta səviyyəsində prefiks əlavə edir", () => {
    expect(formatStatusText(at(StatusLevel.error, "tab yüklənmədi"))).toMatch(/Xəta: tab yüklənmədi$/);
  });

  it("info və warn səviyyələrində prefiks əlavə etmir", () => {
    expect(formatStatusText(at(StatusLevel.info, "Başladı"))).toMatch(/Başladı$/);
    expect(formatStatusText(at(StatusLevel.warn, "diqqət"))).toMatch(/diqqət$/);
    expect(formatStatusText(at(StatusLevel.info, "Başladı"))).not.toMatch(/Xəta/);
  });

  it("vaxtı əvvəldə göstərir", () => {
    const text = formatStatusText(at(StatusLevel.info, "Başladı"));
    expect(text.indexOf("Başladı") > text.indexOf(":")).toBe(true);
  });
});

describe("statusLevel", () => {
  it("status yoxdursa info qaytarır", () => {
    expect(statusLevel(null)).toBe(StatusLevel.info);
  });
  it("səviyyəni olduğu kimi qaytarır", () => {
    expect(statusLevel(at(StatusLevel.error, "x"))).toBe(StatusLevel.error);
    expect(statusLevel(at(StatusLevel.warn, "x"))).toBe(StatusLevel.warn);
  });
});


// Status bildiriş kimidir: görünür, sonra öz-özünə yoxa çıxır. Saxlancda qalması qəsdəndir
// (popup bağlı olanda gələn hadisə itməsin), amma köhnə mesaj ekranda durmamalıdır.
describe("statusTimeLeft / statusExpired", () => {
  const now = new Date("2026-09-11T10:20:30").getTime();
  const aged = (level: any, ms: any) : any => ({ level, text: "x", time: now - ms });

  it("status yoxdursa vaxt qalmır (qutu gizlənir)", () => {
    for (const bad of [null, undefined, {}, { level: "info" }, { time: "indi" }]) {
      expect(statusTimeLeft(bad as any, now), String(bad)).toBe(0);
      expect(statusExpired(bad as any, now)).toBe(true);
    }
  });

  it("təzə status göstərilir", () => {
    expect(statusTimeLeft(aged(StatusLevel.info, 0), now) > 0).toBeTruthy();
    expect(statusExpired(aged(StatusLevel.info, 0), now)).toBe(false);
  });

  it("ömür səviyyəyə görədir: xəta ən uzun qalır", () => {
    expect(STATUS_TTL_MS[StatusLevel.info] < STATUS_TTL_MS[StatusLevel.warn]).toBe(true);
    expect(STATUS_TTL_MS[StatusLevel.warn] < STATUS_TTL_MS[StatusLevel.error]).toBe(true);
  });

  it("adi bildiriş ömrü bitəndə gizlənir", () => {
    const ttl = STATUS_TTL_MS[StatusLevel.info];
    expect(statusExpired(aged(StatusLevel.info, ttl - 1), now)).toBe(false);
    expect(statusExpired(aged(StatusLevel.info, ttl), now)).toBe(true);
    expect(statusExpired(aged(StatusLevel.info, ttl + 5000), now)).toBe(true);
  });

  it("xəbərdarlıq və xəta adi bildirişdən uzun qalır", () => {
    const infoTtl = STATUS_TTL_MS[StatusLevel.info];
    expect(statusExpired(aged(StatusLevel.warn, infoTtl + 1), now)).toBe(false);
    expect(statusExpired(aged(StatusLevel.error, infoTtl + 1), now)).toBe(false);
  });

  it("qalan vaxt azalır və sıfırdan aşağı düşmür", () => {
    const ttl = STATUS_TTL_MS[StatusLevel.info];
    expect(statusTimeLeft(aged(StatusLevel.info, 1000), now)).toBe(ttl - 1000);
    expect(statusTimeLeft(aged(StatusLevel.info, ttl * 10), now)).toBe(0);
  });

  it("naməlum səviyyə adi bildiriş kimi sayılır", () => {
    expect(statusTimeLeft({ level: "naməlum", text: "x", time: now } as any, now)).toBe(STATUS_TTL_MS[StatusLevel.info]);
  });
});
