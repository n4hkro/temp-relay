// Host icazələri provider deskriptorlarının `hosts` sahəsindən törədilir — yeganə mənbə
// deskriptordur, şablonlar əl ilə uyğunlaşdırılmır.
// Eyni funksiyanı popup (icazə varmı?) və tools/check.mjs (manifest-də yazılıbmı?) işlədir.

import { isLocalHost } from "./domains.js";

export const originPattern = (host) => `*://${isLocalHost(host) ? "" : "*."}${host}/*`;

// Verilmiş provider-lərin hamısı üçün lazım olan unikal origin şablonları (çeşidli)
export function requiredOrigins(...providers) {
  const hosts = providers.filter(Boolean).flatMap((p) => p.hosts ?? []);
  return [...new Set(hosts.map(originPattern))].sort();
}

// Seçilmiş cütlük üçün çatışmayan icazələr — boş massiv "hamısı verilib" deməkdir
export async function missingOrigins(...providers) {
  const origins = requiredOrigins(...providers);
  if (!origins.length) return [];
  return (await chrome.permissions.contains({ origins })) ? [] : origins;
}

// "Bu saytın məlumatını sil" düyməsi üçün: silmənin TAM işləməsi host icazəsindən asılıdır.
//   browsingData    — icazə tələb ETMİR (cookie, saxlanc, keş origin üzrə silinir);
//   chrome.cookies  — icazə lazımdır (partitioned/CHIPS cookie-lər yalnız bununla silinir);
//   scripting       — icazə lazımdır (sessionStorage yalnız səhifədə təmizlənə bilər).
// Ona görə icazə istənilir, verilməsə silmə yenə aparılır — sadəcə tam olmur və status
// bunu açıq yazır. Şablon manifest-dəki optional_host_permissions ilə örtülür.
export const hasOriginAccess = (host) => chrome.permissions.contains({ origins: [originPattern(host)] });

// chrome.permissions.request YALNIZ istifadəçi jesti içində çağrıla bilər (popup-dakı klik).
// Artıq verilmiş icazə üçün pəncərə açılmır, sadəcə true qaytarır.
export const requestOriginAccess = (host) => chrome.permissions.request({ origins: [originPattern(host)] });


// Bütün saytlar üçün icazə (manifest → optional_host_permissions). İki yerdə lazımdır:
//   • "sayt məlumatını sil" düyməsi — konkret domen üçün (yuxarıdaki funksiyalar);
//   • ŞƏXSİ proxy-nin istifadəçi adı/parolu — Chrome-un autentifikasiya sorğusunu
//     `webRequest.onAuthRequired` ilə cavablandırmaq üçün sorğuları görmək lazımdır.
// İcazə verilməsə proxy yenə işləyir, sadəcə Chrome parolu istifadəçidən özü soruşur.
export const ALL_SITES = "*://*/*";
export const hasAllSitesAccess = () => chrome.permissions.contains({ origins: [ALL_SITES] });
export const requestAllSitesAccess = () => chrome.permissions.request({ origins: [ALL_SITES] });
