// Sorğu başlıqlarının düzəlişi — declarativeNetRequest qaydalarının deskriptordan törədilməsi.
//
// PROBLEM: service worker-dən gedən `fetch` cross-origin sayılır və Chrome ona
// `Origin: chrome-extension://<id>` başlığı yazır. Bəzi saytların API-si yalnız öz
// origin-indən çağrıla bilər və yad Origin görəndə 403 qaytarır (emailnator.com →
// `{"status":"error","message":"Forbidden"}`). Başlığı fetch-in özündən dəyişmək MÜMKÜN
// DEYİL: `Origin` qadağan olunmuş başlıqdır, `headers`-ə yazılsa brauzer onu atır.
//
// HƏLL: declarativeNetRequest saytın öz origin-ini sorğu göndərilməzdən əvvəl yazır.
// Qaydalar manifest-dəki STATİK ruleset-dədir (dinamik deyil), çünki statik qaydalar
// extension yüklənən andan aktivdir — worker oyanana qədər gedən ilk sorğu da qorunur.
// Fayl əl ilə yazılır, amma məzmunu bu moduldan törədilir və `npm run check` uyğunluğu
// yoxlayır: eyni qayda host_permissions üçün də işləyir (bax: shared/permissions.ts).
//
// Bu fayl `chrome`-a toxunmur: həm extension, həm node (tools/check.mjs, testlər) işlədir.

// manifest.json → declarative_net_request.rule_resources ilə birebir uyğun olmalıdır
export const ORIGIN_RULESET_ID = "provider-origin";
export const ORIGIN_RULES_PATH = "rules/provider-origin.json";

// fetch() Chrome-da `xmlhttprequest` kimi görünür; `other` ehtiyat üçündür (mühitdən asılı
// olaraq worker sorğuları belə də təsnif oluna bilər). Naviqasiya və alt-resurslar
// qəsdən siyahıda deyil — qayda yalnız API sorğularına tətbiq olunmalıdır.
const RESOURCE_TYPES: readonly string[] = Object.freeze(["xmlhttprequest", "other"]);

// Origin başlığı əvəzlənməsi üçün provider deskriptorunun lazım olan hissəsi
export interface OriginRuleProvider {
  requestOrigin?: string | null;
  hosts: string[];
}

export interface OriginHeaderRule {
  id: number;
  priority: number;
  action: {
    type: "modifyHeaders";
    requestHeaders: { header: string; operation: "set"; value: string }[];
  };
  condition: {
    requestDomains: string[];
    resourceTypes: string[];
  };
}

// `requestOrigin` daşıyan provider-lər üçün qaydalar. Sıra deskriptorların sırasıdır —
// id-lər sabit qalsın (qayda faylı ilə müqayisə dərin bərabərlikdir).
// Arqumentlərə bilərəkdən geniş tip verilib: funksiya onsuz da runtime-da süzür
// (requestOrigin olmayan/null provider qayda yaratmır) — testlər də bunu yoxlayır.
export function originRules(...providers: Array<OriginRuleProvider | null | undefined>): OriginHeaderRule[] {
  const rules: OriginHeaderRule[] = [];
  const withOrigin = providers.filter(
    (p): p is OriginRuleProvider => typeof p?.requestOrigin === "string" && p.requestOrigin !== "",
  );
  for (const provider of withOrigin) {
    const requestOrigin = provider.requestOrigin as string;
    // Qayda saytın BÜTÜN hostlarına tətbiq olunur (apex + www): API_BASE sonradan
    // www-dan apex-ə keçsə də başlıq yenə əvəzlənir.
    const host = new URL(requestOrigin).hostname;
    const requestDomains = provider.hosts.filter((h) => host === h || host.endsWith("." + h));
    rules.push({
      id: rules.length + 1,
      priority: 1,
      action: {
        type: "modifyHeaders",
        requestHeaders: [{ header: "origin", operation: "set", value: requestOrigin }],
      },
      condition: { requestDomains, resourceTypes: [...RESOURCE_TYPES] },
    });
  }
  return rules;
}
