// Ünvanın alınması — iki rejimin dispatcher-i.
//
// Hansı rejimin işləyəcəyini provider-in özü müəyyən edir (contract.ts → acquireMode):
//   api  — sorğu worker-dən gedir, tab açılmır (address-api.ts)
//   page — skript saytın səhifəsində icra olunur, tab lazımdır (address-page.ts)
//
// Ortaq qaydalar burada saxlanılır ki, yeni sayt əlavə edəndə təkrar yazılmasın:
// sessiyanın canlılıq yoxlaması və ünvanın etibarlılığı.

import { AcquireMode, acquireMode, type TempMailDescriptor } from "../providers/contract";
import { TEMP_MAIL } from "../providers/temp-mail/index";
import { ExpectedError } from "../shared/errors";
import type { OptionValues } from "../shared/options";
import { isLiveSession, type Session } from "../shared/state";
import { fetchFromApi } from "./address-api";
import { acquireFromPage } from "./address-page";

// Yeni ünvanı qaytarır. Saxlama və clipboard orchestrator-dadır. null — sessiya Dayandır ilə
// silinib: axın öz-özünə dayanır, xəta sayılmır.
// session.options — popup-da seçilmiş və orchestrator-da normallaşdırılmış dəyərlər.
export async function acquireAddress(
  session: Session,
  { signal }: { signal?: AbortSignal } = {},
): Promise<string | null> {
  if (signal?.aborted || !await isLiveSession(session)) return null;
  const provider = TEMP_MAIL.get(session.tempId as string);
  // session.options popup-da normallaşdırılmış OptionValues-dir (bax: orchestrator.ts)
  const values = (session.options ?? {}) as OptionValues;

  // API rejimində tab yoxdur; səhifə rejimində tabın hazır olması 20+ saniyə çəkə bilər.
  // Ona görə canlılıq yoxlaması hər iki halda nəticədən SONRA bir daha aparılır.
  const address = acquireMode(provider) === AcquireMode.api
    ? await fetchFromApi(provider, values, { signal })
    : await acquireFromPage(session, provider, values);
  if (address === null) return null;
  if (signal?.aborted || !await isLiveSession(session)) return null;

  return checkAddress(provider, address);
}

// Sayt (və ya səhifə skripti) gözlənilməz cavab qaytarıb — istifadəçiyə boş ünvan
// kopyalanmasın deyə burada kəsilir.
function checkAddress(provider: TempMailDescriptor, address: unknown): string {
  if (typeof address !== "string" || address.length > 254 || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(address)) {
    throw new ExpectedError(`${provider.name}: etibarlı ünvan qaytarılmadı (${JSON.stringify(address ?? null)})`);
  }
  return address;
}
