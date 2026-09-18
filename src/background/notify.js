// Bildiriş + status qatı. Hər hadisə iki yerə gedə bilir:
//   status     — popup açılanda görünür (chrome.storage.session, shared/state.js)
//   bildiriş   — popup bağlı olanda görünür (chrome.notifications)
// Bildirişin uğursuzluğu udulur: əsas axın ona görə qırılmamalıdır.
//
// Uğursuz axının üçüncü ünvanı worker console-dır. Onun səviyyəsini xətanın növü müəyyən
// edir (shared/errors.js) və bu qayda YALNIZ reportFailure-də yazılıb: axınlar console-a
// özü yazmır, ona görə qayda heç yerdə unudulmur.

import { isExpected, logFailure } from "../shared/errors.js";
import { StatusLevel, writeStatus } from "../shared/state.js";

export const ICON_PATH = "assets/icon.png";
const ERROR_TITLE = "Temp mail + relay: xəta";
const WARN_TITLE = "Temp mail + relay: xəbərdarlıq";

export async function notify(title, message) {
  try {
    await chrome.notifications.create({ type: "basic", iconUrl: chrome.runtime.getURL(ICON_PATH), title, message });
  } catch (e) {
    console.warn("bildiriş göstərilmədi:", e?.message ?? e);
  }
}

// notification verilməsə yalnız status yazılır. Veriləndə { title, message } olur;
// message göstərilməsə status mətni işlədilir (status və bildiriş fərqli görünsə də,
// məs. bildirişdə yalnız ünvan, statusda "Ünvan kopyalandı: ..." yazıla bilər).
export async function report(level, text, notification) {
  await writeStatus(level, text);
  if (notification) await notify(notification.title, notification.message ?? text);
}

export const reportInfo = (text, notification) => report(StatusLevel.info, text, notification);

// Uğursuz axın. Mesaj həmişə eyni aydınlıqda çatır, fərq yalnız onun ağırlıq dərəcəsidir:
//   saytın xətası (limit, cavabsız sorğu, pozulmuş cavab) → sarı status, "xəbərdarlıq"
//     bildirişi, console.warn — chrome://extensions səhvlər səhifəsinə DÜŞMÜR;
//   extension-ın öz qüsuru (proqram xətası)               → qırmızı status, "xəta"
//     bildirişi, console.error — səhvlər səhifəsində görünür.
export async function reportFailure(e, context = "axın pozuldu:") {
  logFailure(context, e);
  const text = e?.message ?? String(e);
  const expected = isExpected(e);
  await report(expected ? StatusLevel.warn : StatusLevel.error, text, {
    title: expected ? WARN_TITLE : ERROR_TITLE,
    message: text,
  });
}
