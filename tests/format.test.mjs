// Popup-ın status göstərmə qaydaları. null status real haldır (extension təzə qurulanda
// storage boşdur) və əvvəllər burada TypeError yaranırdı.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { EMPTY_STATUS_TEXT, formatStatusText, STATUS_TTL_MS, statusExpired, statusLevel, statusTimeLeft } from "../src/popup/format.js";
import { StatusLevel } from "../src/shared/state.js";

const at = (level, text) => ({ level, text, time: new Date("2026-09-11T10:20:30").getTime() });

describe("formatStatusText", () => {
  it("status yoxdursa boş mətn qaytarır (xəta atmır)", () => {
    assert.equal(formatStatusText(null), EMPTY_STATUS_TEXT);
    assert.equal(formatStatusText(undefined), EMPTY_STATUS_TEXT);
  });

  it("xəta səviyyəsində prefiks əlavə edir", () => {
    assert.match(formatStatusText(at(StatusLevel.error, "tab yüklənmədi")), /Xəta: tab yüklənmədi$/);
  });

  it("info və warn səviyyələrində prefiks əlavə etmir", () => {
    assert.match(formatStatusText(at(StatusLevel.info, "Başladı")), /Başladı$/);
    assert.match(formatStatusText(at(StatusLevel.warn, "diqqət")), /diqqət$/);
    assert.doesNotMatch(formatStatusText(at(StatusLevel.info, "Başladı")), /Xəta/);
  });

  it("vaxtı əvvəldə göstərir", () => {
    const text = formatStatusText(at(StatusLevel.info, "Başladı"));
    assert.equal(text.indexOf("Başladı") > text.indexOf(":"), true);
  });
});

describe("statusLevel", () => {
  it("status yoxdursa info qaytarır", () => {
    assert.equal(statusLevel(null), StatusLevel.info);
  });
  it("səviyyəni olduğu kimi qaytarır", () => {
    assert.equal(statusLevel(at(StatusLevel.error, "x")), StatusLevel.error);
    assert.equal(statusLevel(at(StatusLevel.warn, "x")), StatusLevel.warn);
  });
});


// Status bildiriş kimidir: görünür, sonra öz-özünə yoxa çıxır. Saxlancda qalması qəsdəndir
// (popup bağlı olanda gələn hadisə itməsin), amma köhnə mesaj ekranda durmamalıdır.
describe("statusTimeLeft / statusExpired", () => {
  const now = new Date("2026-09-11T10:20:30").getTime();
  const aged = (level, ms) => ({ level, text: "x", time: now - ms });

  it("status yoxdursa vaxt qalmır (qutu gizlənir)", () => {
    for (const bad of [null, undefined, {}, { level: "info" }, { time: "indi" }]) {
      assert.equal(statusTimeLeft(bad, now), 0, String(bad));
      assert.equal(statusExpired(bad, now), true);
    }
  });

  it("təzə status göstərilir", () => {
    assert.ok(statusTimeLeft(aged(StatusLevel.info, 0), now) > 0);
    assert.equal(statusExpired(aged(StatusLevel.info, 0), now), false);
  });

  it("ömür səviyyəyə görədir: xəta ən uzun qalır", () => {
    assert.equal(STATUS_TTL_MS[StatusLevel.info] < STATUS_TTL_MS[StatusLevel.warn], true);
    assert.equal(STATUS_TTL_MS[StatusLevel.warn] < STATUS_TTL_MS[StatusLevel.error], true);
  });

  it("adi bildiriş ömrü bitəndə gizlənir", () => {
    const ttl = STATUS_TTL_MS[StatusLevel.info];
    assert.equal(statusExpired(aged(StatusLevel.info, ttl - 1), now), false);
    assert.equal(statusExpired(aged(StatusLevel.info, ttl), now), true);
    assert.equal(statusExpired(aged(StatusLevel.info, ttl + 5000), now), true);
  });

  it("xəbərdarlıq və xəta adi bildirişdən uzun qalır", () => {
    const infoTtl = STATUS_TTL_MS[StatusLevel.info];
    assert.equal(statusExpired(aged(StatusLevel.warn, infoTtl + 1), now), false);
    assert.equal(statusExpired(aged(StatusLevel.error, infoTtl + 1), now), false);
  });

  it("qalan vaxt azalır və sıfırdan aşağı düşmür", () => {
    const ttl = STATUS_TTL_MS[StatusLevel.info];
    assert.equal(statusTimeLeft(aged(StatusLevel.info, 1000), now), ttl - 1000);
    assert.equal(statusTimeLeft(aged(StatusLevel.info, ttl * 10), now), 0);
  });

  it("naməlum səviyyə adi bildiriş kimi sayılır", () => {
    assert.equal(statusTimeLeft({ level: "naməlum", text: "x", time: now }, now), STATUS_TTL_MS[StatusLevel.info]);
  });
});
