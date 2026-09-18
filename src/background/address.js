// Ünvanın alınması — iki rejimin dispatcher-i.
//
// Hansı rejimin işləyəcəyini provider-in özü müəyyən edir (contract.js → acquireMode):
//   api  — sorğu worker-dən gedir, tab açılmır (address-api.js)
//   page — skript saytın səhifəsində icra olunur, tab lazımdır (address-page.js)
//
// Ortaq qaydalar burada saxlanılır ki, yeni sayt əlavə edəndə təkrar yazılmasın:
// sessiyanın canlılıq yoxlaması və ünvanın etibarlılığı.

import { AcquireMode, acquireMode } from "../providers/contract.js";
import { TEMP_MAIL } from "../providers/temp-mail/index.js";
import { ExpectedError } from "../shared/errors.js";
import { isLiveSession } from "../shared/state.js";
import { fetchFromApi } from "./address-api.js";
import { acquireFromPage } from "./address-page.js";

// Yeni ünvanı qaytarır. Saxlama və clipboard orchestrator-dadır. null — sessiya Dayandır ilə
// silinib: axın öz-özünə dayanır, xəta sayılmır.
// session.options — popup-da seçilmiş və orchestrator-da normallaşdırılmış dəyərlər.
export async function acquireAddress(session, { signal } = {}) {
  if (signal?.aborted || !await isLiveSession(session)) return null;
  const provider = TEMP_MAIL.get(session.tempId);
  const values = session.options ?? {};

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
function checkAddress(provider, address) {
  if (typeof address !== "string" || address.length > 254 || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(address)) {
    throw new ExpectedError(`${provider.name}: etibarlı ünvan qaytarılmadı (${JSON.stringify(address ?? null)})`);
  }
  return address;
}
