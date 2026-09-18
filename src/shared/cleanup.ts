// Bir saytın izlərini silmək üçün PLAN qurulması — saf modul (chrome yoxdur).
//
// Niyə ayrı fayl: silmə mexanikası worker-dədir (background/cleanup.ts) və `chrome`-a
// toxunur, ona görə node-da test oluna bilmir. "Nə silinəcək" isə sadəcə URL-dən çıxarılan
// məlumatdır: hansı cookie domeni, hansı origin-lər. Burada saxlanılır ki, popup (düyməni
// göstərmək üçün), worker (silmək üçün) və testlər eyni qaydanı işlətsin.
//
// Relay provider-i öz planını deskriptorda ELAN edir (`cleanup` sahəsi); bu modul isə
// istənilən tab üçün plan törədir — "bu saytın hər şeyini sil" düyməsi buna söykənir.

import { registrableDomain } from "./extract";
import { isLocalHost } from "./domains";

// ===========================================================================================
// EYNİ HESABIN ARXASINDA DURAN ƏLAQƏLİ DOMENLƏR (SSO / identity ailələri)
// ===========================================================================================
// Böyük saytlarda "hesaba daxil olma" vəziyyəti BİR domendə deyil, bir NEÇƏ AYRI qeydə
// alınabilən domendə saxlanılır. Microsoft-da eyni giriş üçün ən azı bunlar var:
//
//   login.microsoftonline.com   ESTSAUTH, ESTSAUTHPERSISTENT, ESTSAUTHLIGHT, buid, esctx,
//                               SignInStateCookie, stsservicecookie  (iş/məktəb hesabı)
//   login.live.com              MSPAuth, MSPProf, MSPCID, RPSSecAuth, JSH  (şəxsi hesab)
//   login.microsoft.com, account.microsoft.com, account.live.com       (hesab səthi)
//   msauth.net, msftauth.net, msidentity.com                           (köməkçi/CDN)
//   azure.com, office.com, windows.net                                 (portallar)
//
// Üstəlik "son işlədilən hesab" siyahısı login səhifəsinin localStorage/IndexedDB-sindədir.
//
// QÜSUR BUDUR: plan yalnız tabın domenindən qurulurdu, ona görə `login.microsoftonline.com`
// səhifəsində silmə yalnız `microsoftonline.com`-u təmizləyirdi — `login.live.com` cookie-si
// və digər ailə üzvləri yerində qalırdı, sayt isə YENƏ eyni hesabı tanıyırdı (istifadəçinin
// gördüyü hal: Microsoft Foundry qeydiyyatı hər dəfə köhnə hesaba qayıdırdı).
//
// Ailə YALNIZ silinən saytın özü onun içindədirsə tətbiq olunur. Yəni "Sign in with Google"
// düyməsi olan yad sayt silinəndə istifadəçinin Google seansına toxunulmur — silmə hədəfi
// genişləndirmir, sadəcə hədəfin bütün domenlərini əhatə edir.
//
// Yeni ailə əlavə etmək bir qeyddir: `domains` (cookie üçün, alt-domenlər daxil) və `origins`
// (localStorage/IndexedDB daşıyan konkret hostlar).
export interface IdentityFamily {
  id: string;
  name: string;
  domains: readonly string[];
  origins: readonly string[];
}

export const IDENTITY_FAMILIES: readonly IdentityFamily[] = Object.freeze([
  {
    id: "microsoft",
    name: "Microsoft hesabı",
    domains: Object.freeze([
      "microsoftonline.com", "microsoftonline-p.com", "microsoft.com", "live.com",
      "msauth.net", "msftauth.net", "msidentity.com", "azure.com", "windowsazure.com",
      "windows.net", "office.com", "office365.com", "microsoft365.com", "outlook.com",
      "onmicrosoft.com", "sharepoint.com",
      "hotmail.com", "msn.com", "skype.com", "xbox.com", "xboxlive.com",
    ]),
    origins: Object.freeze([
      "https://login.microsoftonline.com", "https://login.microsoft.com",
      "https://login.live.com", "https://login.windows.net",
      "https://account.microsoft.com", "https://account.live.com", "https://signup.live.com",
      "https://logincdn.msauth.net", "https://aadcdn.msftauth.net",
      "https://ai.azure.com", "https://portal.azure.com", "https://www.office.com",
      "https://outlook.live.com", "https://www.xbox.com", "https://account.xbox.com",
    ]),
  },
  {
    id: "google",
    name: "Google hesabı",
    domains: Object.freeze(["google.com", "googleusercontent.com", "youtube.com", "gstatic.com", "gmail.com", "googlemail.com"]),
    origins: Object.freeze([
      "https://accounts.google.com", "https://accounts.youtube.com", "https://myaccount.google.com",
      "https://mail.google.com",
    ]),
  },
  {
    id: "apple",
    name: "Apple ID",
    domains: Object.freeze(["apple.com", "icloud.com"]),
    origins: Object.freeze(["https://appleid.apple.com", "https://idmsa.apple.com", "https://www.icloud.com", "https://account.apple.com"]),
  },
  {
    id: "meta",
    name: "Facebook hesabı",
    domains: Object.freeze(["facebook.com", "messenger.com", "fb.com", "instagram.com"]),
    origins: Object.freeze(["https://www.facebook.com", "https://m.facebook.com", "https://www.instagram.com"]),
  },
  {
    id: "amazon",
    name: "Amazon hesabı",
    domains: Object.freeze([
      "amazon.com", "amazon.co.uk", "amazon.de", "amazon.fr", "amazon.it", "amazon.es",
      "amazon.ca", "amazon.com.au", "amazon.co.jp", "amazon.in", "amazon.com.br",
      "amazon.com.mx", "amazon.com.tr", "amazon.ae", "amazon.sa", "amazon.nl",
      "amazon.se", "amazon.pl", "amazon.sg", "primevideo.com", "audible.com", "audible.co.uk",
    ]),
    origins: Object.freeze([
      "https://www.amazon.com", "https://www.amazon.co.uk", "https://www.amazon.de",
      "https://www.primevideo.com", "https://www.audible.com", "https://www.audible.co.uk",
    ]),
  },
  {
    id: "adobe",
    name: "Adobe hesabı",
    domains: Object.freeze(["adobe.com", "adobelogin.com", "adobejanus.com", "behance.net"]),
    origins: Object.freeze([
      "https://account.adobe.com", "https://auth.services.adobe.com",
      "https://ims-na1.adobelogin.com", "https://ims-na2.adobelogin.com",
      "https://adobelogin.prod.ims.adobejanus.com", "https://www.behance.net",
    ]),
  },
  {
    id: "atlassian",
    name: "Atlassian hesabı",
    domains: Object.freeze(["atlassian.com", "atlassian.net", "trello.com", "bitbucket.org"]),
    origins: Object.freeze([
      "https://id.atlassian.com", "https://auth.atlassian.com", "https://start.atlassian.com",
      "https://trello.com", "https://bitbucket.org",
    ]),
  },
]);

// Hostun aid olduğu ailə (və ya null)
export function identityFamily(host: string | null | undefined): IdentityFamily | null {
  const clean = String(host ?? "").toLowerCase();
  if (!clean) return null;
  // Xidmətə məxsus domen müştərinin ayrıca registrable tenant-ı ilə qarışdırılmır.
  const site = registrableDomain(clean);
  return IDENTITY_FAMILIES.find((family) => family.domains.includes(site)) ?? null;
}

// Ailənin silinəcək origin-ləri: konkret login hostları + hər domenin apex-i (cookie-lər
// `browsingData` ilə origin-in BÜTÜN qeydə alınabilən domeni üzrə silinir, ona görə apex kifayətdir)
const familyOrigins = (family: IdentityFamily | null | undefined): string[] =>
  (family ? [...family.origins, ...family.domains.map((domain) => `https://${domain}`)] : []);

// Silinən növlər (chrome.browsingData). Yalnız bunlar origin ilə məhdudlaşdırıla bilir:
// cookie, cache və saxlanc. `passwords` QƏSDƏN yoxdur — Chrome 144-dən extension-ların
// parol silməsi ləğv edilib (dəyər sadəcə nəzərə alınmır), üstəlik o, origin üzrə də
// süzülmür: bütün profilin parolları silinərdi. Parolu istifadəçi
// chrome://password-manager/passwords-dan özü silir.
export const DATA_TYPES = Object.freeze({
  cache: true,
  cacheStorage: true,
  cookies: true,
  fileSystems: true,
  indexedDB: true,
  localStorage: true,
  serviceWorkers: true,
});

// Hansı origin növləri silinsin. Default yalnız `unprotectedWeb`-dir; sayt PWA kimi
// quraşdırılıbsa (`protectedWeb`) onun məlumatı kənarda qalardı. Silmə origin siyahısı ilə
// məhdudlaşdığı üçün bu, yalnız SEÇİLMİŞ sayta aiddir — "a-dan z-yə hər şey" tələbi budur.
// `extension` QƏSDƏN yoxdur: extension-ların öz saxlancı bu düymənin işi deyil.
export const ORIGIN_TYPES = Object.freeze({ unprotectedWeb: true, protectedWeb: true });

// Yalnız adi veb saytları: chrome://, chrome-extension://, about:, file:// və s. silinmir
const isWeb = (protocol: string): boolean => protocol === "http:" || protocol === "https:";

export interface CleanupPlan {
  host: string;
  domain: string;
  // hansı ailəyə görə genişləndirildi (status mətni bunu istifadəçiyə deyir; yoxdursa null)
  family: string | null;
  familyName: string | null;
  // chrome.cookies.getAll({ domain }) — alt-domenlərin cookie-ləri də düşür
  cookieDomains: string[];
  // bu sayt birinci tərəf olanda üçüncü tərəflərin yazdığı partitioned cookie-lər
  partitionTopLevelSites: string[];
  storageOrigins: string[];
}

// URL → plan. Dəstəklənməyən ünvan üçün null (popup düyməni söndürür, worker isə
// istifadəçiyə səbəbi yazır).
//
// Qeyd: chrome.browsingData `origins` ilə cookie-ləri BÜTÜN qeydə alınabilən domen üzrə
// silir, ona görə alt-domenlər onsuz da düşür. Buna baxmayaraq cookie-lər ayrıca da
// yığılır: partitioned (CHIPS) cookie-lər `origins` ilə silinmir və sayğac istifadəçiyə
// nəyin silindiyini göstərir.
export function tabCleanupPlan(url: string | null | undefined): CleanupPlan | null {
  let parsed: URL | null = null;
  try { parsed = new URL(String(url ?? "")); } catch { return null; }
  if (!isWeb(parsed.protocol) || !parsed.hostname) return null;

  const host = parsed.hostname.toLowerCase();
  const domain = registrableDomain(host);
  // Sayt tanınmış identity ailəsinə aiddirsə ailənin bütün domenləri də silinir — əks halda
  // giriş vəziyyəti qonşu domendə qalır və sayt eyni hesabı yenidən tanıyır (bax: yuxarı).
  const family = identityFamily(host);
  // Saytın eyni məzmunu bir neçə origin-də saxlaya bilər (apex ↔ www); mövcud olmayan
  // origin xəta vermir, ona görə hər üçü siyahıya alınır.
  const storageOrigins = [...new Set([
    parsed.origin, ...(isLocalHost(host) ? [] : [`https://${domain}`, `https://www.${domain}`]), ...familyOrigins(family),
  ])];
  return {
    host,
    domain,
    // hansı ailəyə görə genişləndirildi (status mətni bunu istifadəçiyə deyir; yoxdursa null)
    family: family?.id ?? null,
    familyName: family?.name ?? null,
    // chrome.cookies.getAll({ domain }) — alt-domenlərin cookie-ləri də düşür
    cookieDomains: [...new Set([domain, ...(family?.domains ?? [])])],
    // bu sayt birinci tərəf olanda üçüncü tərəflərin yazdığı partitioned cookie-lər
    partitionTopLevelSites: [...new Set([parsed.origin, `https://${domain}`])],
    storageOrigins,
  };
}
