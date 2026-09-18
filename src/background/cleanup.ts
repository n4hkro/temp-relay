// Təmizləmə qatı: bir saytın bütün izlərini silir.
//
// İki istifadəsi var:
//   1) RELAY axını — tab bağlananda saytın izləri silinir; plan relay deskriptorunun
//      `cleanup` sahəsindədir (hansı cookie domeni, hansı origin-lər).
//   2) "Bu saytın məlumatını sil" düyməsi — plan tabın URL-indən törədilir
//      (shared/cleanup.ts → tabCleanupPlan), yəni istənilən sayt üçün işləyir.
//
// Mexanika ikisində də eynidir və buradadır. Silinənlər:
//   1) səhifə saxlancı  — sessionStorage + localStorage tabın özündə (sessionStorage
//                         browsingData ilə silinmir və tab yenilənəndə də qalır)
//   2) cookie-lər       — cookieDomains üzrə (alt-domenlər daxil) + partitionTopLevelSites
//                         üzrə partitioned (CHIPS) cookie-lər (məs. Cloudflare Turnstile)
//   3) saxlanc + keş    — storageOrigins üzrə localStorage, IndexedDB, cacheStorage,
//                         serviceWorkers, fileSystems, HTTP keşi və origin-ə bağlı cookie-lər
//
// Relay saytı eyni anda həm öz cookie-lərini, həm də üçüncü tərəf frame-lərin
// partitioned cookie-lərini saxlaya bildiyi üçün iki sorğu üst-üstə düşə bilər;
// ona görə cookie-lər silinməmişdən əvvəl təkrarsızlaşdırılır.

import { DATA_TYPES, ORIGIN_TYPES } from "../shared/cleanup";
import type { RelayCleanup } from "../providers/contract";
import { registrableDomain } from "../shared/domains";

const cookieKey = (c: chrome.cookies.Cookie): string =>
  [c.domain, c.name, c.path, c.storeId, JSON.stringify(c.partitionKey ?? null)].join("|");

function dedupe(cookies: chrome.cookies.Cookie[]): chrome.cookies.Cookie[] {
  const seen = new Set<string>();
  const unique: chrome.cookies.Cookie[] = [];
  for (const cookie of cookies) {
    const key = cookieKey(cookie);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(cookie);
  }
  return unique;
}

async function collectCookies(cleanup: Partial<RelayCleanup>): Promise<chrome.cookies.Cookie[]> {
  const found: chrome.cookies.Cookie[] = [];
  // Hər domen ayrı sorğudur və AYRI tutulur: identity ailəsi silinəndə siyahıda host icazəsi
  // olmayan domenlər də olur (məs. login.live.com) — biri batsa qalanları yenə yığılmalıdır.
  // Onların cookie-ləri `browsingData` ilə onsuz da silinir, burada yalnız sayğac və
  // partitioned cookie-lər itir.
  for (const domain of cleanup.cookieDomains ?? []) {
    try {
      const cookies = await chrome.cookies.getAll({ domain });
      // Hostinq tenant-ları üst domenin hesab ailəsinə aid deyildir.
      found.push(...cookies.filter((cookie) => registrableDomain(cookie.domain.replace(/^\./, "")) === domain));
    } catch (e) {
      console.warn("cookie-lər sadalanmadı:", domain, (e as { message?: unknown })?.message ?? e);
    }
  }
  for (const topLevelSite of cleanup.partitionTopLevelSites ?? []) {
    try {
      found.push(...await chrome.cookies.getAll({ partitionKey: { topLevelSite } } as Parameters<typeof chrome.cookies.getAll>[0]));
    } catch (e) {
      console.warn("partitioned cookie-lər sadalanmadı:", topLevelSite, (e as { message?: unknown })?.message ?? e);
    }
  }
  return dedupe(found);
}

async function removeCookies(cookies: chrome.cookies.Cookie[]): Promise<number> {
  let removed = 0;
  for (const c of cookies) {
    const details: chrome.cookies.CookieDetails = {
      url: (c.secure ? "https://" : "http://") + c.domain.replace(/^\./, "") + c.path,
      name: c.name,
      storeId: c.storeId,
    };
    // partitioned cookie öz partitionKey-i ilə silinir, yoxsa əsas bankdakı eyni adlı cookie silinir
    if (c.partitionKey) details.partitionKey = c.partitionKey;
    try {
      if (await chrome.cookies.remove(details)) removed++;
    } catch (e) {
      console.warn("cookie silinmədi:", c.domain, c.name, (e as { message?: unknown })?.message ?? e);
    }
  }
  return removed;
}

// Silinmiş cookie-lərin sayını qaytarır (status mesajında göstərilir).
// `plan` — relay deskriptorunun `cleanup` sahəsi (yalnız cookie/saxlanc sahələri var) və ya
// tabdan törədilən tam plan; ikisi də bu altçoxluğa uyğundur.
export async function clearData(plan: Partial<RelayCleanup> = {}): Promise<{ cookies: number }> {
  const removed = await removeCookies(await collectCookies(plan));
  const origins = plan.storageOrigins ?? [];
  if (origins.length) {
    await chrome.browsingData.remove(
      { origins: origins as [string, ...string[]], originTypes: ORIGIN_TYPES as chrome.browsingData.OriginTypes },
      DATA_TYPES as chrome.browsingData.DataTypeSet,
    );
  }
  return { cookies: removed };
}

export const clearRelayData = (
  relay: { cleanup?: RelayCleanup | null | undefined },
): Promise<{ cookies: number }> => clearData(relay.cleanup ?? {});

// Tabın öz saxlancı. sessionStorage-ı NƏ browsingData silir, NƏ də tabın yenilənməsi:
// o, tab bağlanana qədər yaşayır. Ona görə səhifədə birbaşa təmizlənir. Bütün frame-lərdə
// işlədilir — sayt token-i iframe-də saxlaya bilər.
export async function clearPageStorage(
  tabId: number,
  allowedOrigins: string[] = [],
): Promise<number> {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      // Səhifəyə köçürülür: import yoxdur, chrome.* yoxdur, throw etmir
      args: [allowedOrigins],
      func: (origins: string[]): number => {
        if (!origins.includes(location.origin)) return 0;
        let cleared = 0;
        for (const area of ["sessionStorage", "localStorage"]) {
          try {
            const store = (globalThis as unknown as Record<string, { length: number; clear(): void } | undefined>)[area];
            if (!store) continue;
            cleared += store.length;
            store.clear();
          } catch { /* opaque origin və ya bloklanmış saxlanc — atlanılır */ }
        }
        return cleared;
      },
    });
    return results.reduce((sum, r) => sum + (Number(r?.result) || 0), 0);
  } catch (e) {
    // Skript yeridilə bilməyən səhifə (chrome://, mağaza, silinmiş tab) — əsas silmə davam edir
    console.warn("səhifə saxlancı təmizlənmədi:", (e as { message?: unknown })?.message ?? e);
    return 0;
  }
}
