// İzləyici qalxanı: analitika, reklam şəbəkələri, sosial pikselləri və seans yazıcılarının
// sorğularını bloklayır.
//
// Necə işləyir: `rules/trackers.json` STATİK declarativeNetRequest ruleset-idir və manifest-də
// `enabled: false` ilə yazılıb — yəni default sönülüdür, istifadəçi qalxanı özü açır.
// Açıb-söndürmə `updateEnabledRulesets` ilə edilir və Chrome bu seçimi özü qalıcı saxlayır;
// saxlancdaki nişan yalnız popup-ın vəziyyəti göstərməsi üçündür.
//
// Niyə DNR (webRequest deyil): qayda şəbəkə qatında işləyir, sorğu heç vaxt getmir və səhifənin
// işini gecikdirmir.
//
// DİQQƏT — İCAZƏ SEÇİMİ: manifest-də `declarativeNetRequest` (tam) icazəsi lazımdır.
// `declarativeNetRequestWithHostAccess` variantı qaydaları YALNIZ host icazəsi olan saytlara
// tətbiq edir; bizim host icazələrimiz isə yalnız provider saytlarıdır, yəni qalxan heç vaxt
// işləməzdi (real brauzer yoxlamasında məhz belə oldu: ruleset "aktiv" görünürdü, sorğular isə
// keçirdi). Tam icazə ilə `block` qaydaları hər saytda işləyir; `modifyHeaders` (Origin
// əvəzlənməsi) isə yenə host icazəsi tələb edir — o, provider saytları üçün onsuz da var.
//
// QƏSDƏN BLOKLANMAYANLAR: barmaq izi kitabxanaları (fingerprintjs və s.) və saytın öz
// analitikası. Səbəb: onlar çox vaxt saytın giriş/qeydiyyat müdafiəsinin bir hissəsidir —
// bloklamaq səhifəni sındırır. Qalxanın işi İZLƏMƏni azaltmaqdır, müdafiəni aşmaq deyil.

import { StatusLevel, readShield, writeShield, writeStatus } from "../shared/state.js";

export const TRACKER_RULESET_ID = "trackers";

export async function isShieldOn() {
  try {
    const enabled = await chrome.declarativeNetRequest.getEnabledRulesets();
    return enabled.includes(TRACKER_RULESET_ID);
  } catch {
    return readShield();
  }
}

export async function setShield(on) {
  const enable = on === true;
  await chrome.declarativeNetRequest.updateEnabledRulesets(enable
    ? { enableRulesetIds: [TRACKER_RULESET_ID] }
    : { disableRulesetIds: [TRACKER_RULESET_ID] });
  await writeShield(enable);
  await writeStatus(StatusLevel.info, enable
    ? "İzləyici qalxanı açıldı: analitika, reklam və seans yazıcıları bloklanır"
    : "İzləyici qalxanı söndürüldü");
  return enable;
}

// Brauzer açılanda saxlancdaki nişanla Chrome-un vəziyyətini uzlaşdırır (extension yenidən
// yüklənəndə ruleset default vəziyyətə qaytarıla bilər).
export async function resumeShield() {
  const wanted = await readShield();
  const actual = await isShieldOn();
  if (wanted === actual) return;
  try {
    await chrome.declarativeNetRequest.updateEnabledRulesets(wanted
      ? { enableRulesetIds: [TRACKER_RULESET_ID] }
      : { disableRulesetIds: [TRACKER_RULESET_ID] });
  } catch (e) {
    console.warn("qalxan bərpa olunmadı:", e?.message ?? e);
  }
}
