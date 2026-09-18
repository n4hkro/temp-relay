// Bildiriş + status qatı. Hər hadisə iki yerə gedə bilir:
//   status     — popup açılanda görünür (chrome.storage.session, shared/state.ts)
//   bildiriş   — popup bağlı olanda görünür (chrome.notifications)
// Bildirişin uğursuzluğu udulur: əsas axın ona görə qırılmamalıdır.
//
// Uğursuz axının üçüncü ünvanı worker console-dır. Onun səviyyəsini xətanın növü müəyyən
// edir (shared/errors.ts) və bu qayda YALNIZ reportFailure-də yazılıb: axınlar console-a
// özü yazmır, ona görə qayda heç yerdə unudulmur.

import { isExpected, logFailure } from "../shared/errors";
import { StatusLevel, type StatusLevelValue, writeStatus } from "../shared/state";

export const ICON_PATH = "assets/icon.png";
const ERROR_TITLE = "Temp mail + relay: xəta";
const WARN_TITLE = "Temp mail + relay: xəbərdarlıq";

export async function notify(title: string, message: string): Promise<void> {
  try {
    await chrome.notifications.create({ type: "basic", iconUrl: chrome.runtime.getURL(ICON_PATH), title, message });
  } catch (e) {
    console.warn("bildiriş göstərilmədi:", (e as { message?: unknown })?.message ?? e);
  }
}

export interface NotificationPayload {
  title: string;
  message?: string;
}

// notification verilməsə yalnız status yazılır. Veriləndə { title, message } olur;
// message göstərilməsə status mətni işlədilir (status və bildiriş fərqli görünsə də,
// məs. bildirişdə yalnız ünvan, statusda "Ünvan kopyalandı: ..." yazıla bilər).
export async function report(
  level: StatusLevelValue,
  text: string,
  notification?: NotificationPayload | null,
): Promise<void> {
  await writeStatus(level, text);
  if (notification) await notify(notification.title, notification.message ?? text);
}

export const reportInfo = (text: string, notification?: NotificationPayload | null): Promise<void> =>
  report(StatusLevel.info, text, notification);

// Uğursuz axın. Mesaj həmişə eyni aydınlıqda çatır, fərq yalnız onun ağırlıq dərəcəsidir:
//   saytın xətası (limit, cavabsız sorğu, pozulmuş cavab) → sarı status, "xəbərdarlıq"
//     bildirişi, console.warn — chrome://extensions səhvlər səhifəsinə DÜŞMÜR;
//   extension-ın öz qüsuru (proqram xətası)               → qırmızı status, "xəta"
//     bildirişi, console.error — səhvlər səhifəsində görünür.
export async function reportFailure(e: unknown, context = "axın pozuldu:"): Promise<void> {
  logFailure(context, e);
  const text = ((e as { message?: unknown })?.message ?? String(e)) as string;
  const expected = isExpected(e);
  await report(expected ? StatusLevel.warn : StatusLevel.error, text, {
    title: expected ? WARN_TITLE : ERROR_TITLE,
    message: text,
  });
}
