// API rejimi: ünvan birbaşa service worker-dən sorğulanır — tab açılmır, səhifənin
// yüklənməsi gözlənilmir, DOM-a toxunulmur. Bu, həm daha sürətli, həm də brauzerdə
// əlavə iz qoymur (provider saytının cookie-ləri yaranmır).
//
// Saytın API protokolu (sorğu şablonu, cavabın oxunması, xəta mətnləri) provider-in öz
// api.js faylındadır. Burada yalnız hər sayt üçün eyni olan mexanika var: vaxt məhdudiyyəti
// və xətanın istifadəçiyə aydın formada çatdırılması.

import type { TempMailDescriptor } from "../providers/contract";
import { describeFailure, ExpectedError } from "../shared/errors";
import type { OptionValues } from "../shared/options";

// Sorğunun ən çox nə qədər gözlənilməsi. temp.tf adətən 1-3 saniyədə cavab verir; 429
// (çox sorğu) halında saytın özü Retry-After ilə mətn qaytarır və o, xəta kimi göstərilir.
const REQUEST_TIMEOUT_MS = 20000;

export async function fetchFromApi(
  provider: TempMailDescriptor,
  values: OptionValues,
  { signal }: { signal?: AbortSignal } = {},
): Promise<string> {
  const controller = new AbortController();
  const abort = (): void => controller.abort();
  if (signal?.aborted) controller.abort();
  else signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    // API rejimində fetchAddress MÜTLƏQ var (contract.ts → acquireMode) — `!` yalnız
    // tip səviyyəsindədir, runtime-da orijinal `provider.fetchAddress(...)` çağırışıdır.
    return await provider.fetchAddress!({ values, signal: controller.signal });
  } catch (e) {
    // Sayt sərhədi. Mesaj provider adı ilə prefixed qaytarılır: popup-da hansı saytın səhvi
    // olduğu görünür. Növü isə ExpectedError-dir, çünki buradan gələn hər xəta saytın
    // cavabı, limiti və ya cavabsız sorğusudur — extension-ın öz qüsuru deyil (provider-in
    // protokolu node testlərində yoxlanılır). Nəticə: console.warn, səhvlər səhifəsinə düşmür.
    // Əsl səbəb `cause`-da saxlanılır: istifadəçiyə yalnız aydın mətn çatır, detal itmir.
    throw new ExpectedError(provider.name + ": " + describeFailure(e), { cause: e });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}
