// Popup-ın göstərmə qaydaları — saf funksiyalar, DOM-a və chrome-a toxunmur, ona görə
// test oluna bilir (tests/format.test.mjs).
//
// Qayda: status mətni storage-da SAF saxlanılır (level + text). "Xəta:" prefiksi və CSS
// sinfi presentation-dır və yalnız burada əlavə olunur — eyni mətn service worker-də
// bildirişə, popup-da isə prefiksli yazılır.

import { StatusLevel } from "../shared/state.js";

export const EMPTY_STATUS_TEXT = "—";

// status null ola bilər: extension təzə qurulanda hələ heç bir hadisə yazılmayıb
export function formatStatusText(status) {
  if (!status) return EMPTY_STATUS_TEXT;
  const prefix = status.level === StatusLevel.error ? "Xəta: " : "";
  const time = new Date(status.time).toLocaleTimeString();
  return `${time}  ${prefix}${status.text}`;
}

// Status yoxdursa "info" sayılır (qutu neytral göstərilir)
export const statusLevel = (status) => status?.level ?? StatusLevel.info;

// --- statusun ömrü ---------------------------------------------------------------------
// Status bildiriş kimidir: görünür, sonra yoxa çıxır. Saxlancda qalması qəsdəndir (worker
// onu silmir, popup köhnəni sadəcə göstərmir) — beləliklə popup bağlı olanda gələn hadisə
// itmir, amma dünəndən qalan mesaj da ekranda durmur.
//
// Səviyyə ömrü müəyyən edir: adi bildiriş tez gedir, xəbərdarlıq və xəta oxunmağa vaxt
// istəyir.
export const STATUS_TTL_MS = Object.freeze({
  [StatusLevel.info]: 7000,
  [StatusLevel.warn]: 20000,
  [StatusLevel.error]: 45000,
});

// Nə qədər vaxt qalıb (ms). 0 — göstərilməməlidir.
export function statusTimeLeft(status, now = Date.now()) {
  if (!status || typeof status.time !== "number") return 0;
  const ttl = STATUS_TTL_MS[statusLevel(status)] ?? STATUS_TTL_MS[StatusLevel.info];
  return Math.max(0, status.time + ttl - now);
}

export const statusExpired = (status, now = Date.now()) => statusTimeLeft(status, now) === 0;
