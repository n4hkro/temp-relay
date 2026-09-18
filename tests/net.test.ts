// declarativeNetRequest qaydalarının deskriptordan törədilməsi.
//
// Niyə vacibdir: qayda faylı (mənbədə public/rules/provider-origin.json, dist-də
// rules/provider-origin.json) manifest-də STATİK ruleset kimi
// yazılır, yəni əl ilə saxlanılır. Uyğunsuzluq extension-ı sındırmır, sadəcə sorğu yad
// Origin ilə gedir və sayt 403 Forbidden qaytarır — səssiz nasazlıq. Ona görə həm bu testlər,
// həm `npm run check` faylı deskriptorlarla tutuşdurur.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";

import { RELAY } from "../src/providers/relay/index";
import { TEMP_MAIL } from "../src/providers/temp-mail/index";
import { ORIGIN_RULES_PATH, ORIGIN_RULESET_ID, originRules } from "../src/shared/net";
import type { OriginRuleProvider } from "../src/shared/net";
import type { SiteRelayDescriptor, TempMailDescriptor } from "../src/providers/contract";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// Qayda faylları mənbə ağacında `public/` altındadır (Vite onları dist kökünə köçürür),
// ona görə birbaşa tapılmasa `public/`-da axtarılır.
const read = (file: string) => {
  const direct = path.join(root, file);
  const p = existsSync(direct) ? direct : path.join(root, "public", file);
  return JSON.parse(readFileSync(p, "utf8"));
};

const site = { id: "a", name: "A", url: "https://www.a.example/", hosts: ["a.example"] };

describe("originRules", () => {
  it("requestOrigin yoxdursa qayda da yoxdur", () => {
    expect(originRules(site)).toStrictEqual([]);
  });

  it("boş dəyər və qeyri-sətir nəzərə alınmır", () => {
    const badOrigin = { ...site, requestOrigin: 7 } as unknown as OriginRuleProvider;
    expect(originRules({ ...site, requestOrigin: "" }, badOrigin, null)).toStrictEqual([]);
  });

  it("qayda Origin başlığını saytın origin-i ilə əvəz edir", () => {
    const [rule] = originRules({ ...site, requestOrigin: "https://www.a.example" });
    expect(rule.action.type).toBe("modifyHeaders");
    expect(rule.action.requestHeaders).toStrictEqual([
      { header: "origin", operation: "set", value: "https://www.a.example" },
    ]);
  });

  it("şərt saytın hostlarına bağlanır (apex + alt-domenlər), yalnız API sorğularına", () => {
    const [rule] = originRules({ ...site, requestOrigin: "https://www.a.example" });
    expect(rule.condition.requestDomains).toStrictEqual(["a.example"]);
    expect(rule.condition.resourceTypes).toStrictEqual(["xmlhttprequest", "other"]);
  });

  it("üçüncü tərəf hostlar şərtə düşmür (yalnız origin-i əhatə edən host)", () => {
    const [rule] = originRules({
      ...site,
      hosts: ["a.example", "challenges.cloudflare.com"],
      requestOrigin: "https://www.a.example",
    });
    expect(rule.condition.requestDomains).toStrictEqual(["a.example"]);
  });

  it("id-lər 1-dən başlayır və ardıcıldır (fayl ilə müqayisə dərin bərabərlikdir)", () => {
    // Həddindən artıq açar yoxlamasına düşməmək üçün literallar dəyişəndə saxlanılır.
    const plain = { id: "b", name: "B", url: "https://b.example/", hosts: ["b.example"] };
    const withOrigin = { id: "c", name: "C", url: "https://c.example/", hosts: ["c.example"], requestOrigin: "https://c.example" };
    const rules = originRules(
      { ...site, requestOrigin: "https://www.a.example" },
      plain,
      withOrigin,
    );
    expect(rules.map((r) => r.id)).toStrictEqual([1, 2]);
    expect(rules.map((r) => r.priority)).toStrictEqual([1, 1]);
  });
});

describe("manifest ↔ qayda faylı", () => {
  const manifest = read("manifest.json");
  const providers = [...TEMP_MAIL.all(), ...RELAY.all()];
  // Aktiv-tab relay-in hosts-u yoxdur — Origin qaydası üçün yalnız hostlular lazımdır
  // (requestOrigin daşıyanların hamısının hosts-u var, ona görə süzgəc neytraldır).
  const expected = originRules(
    ...providers.filter((p): p is TempMailDescriptor | SiteRelayDescriptor => Array.isArray(p.hosts)),
  );

  it("ən azı bir provider Origin əvəzləməsi tələb edir (emailnator)", () => {
    expect(expected.length >= 1, "gözlənilən qayda yoxdur — test mənasını itirir").toBeTruthy();
  });

  it("manifest ruleset-i modulun sabitləri ilə uyğundur", () => {
    const ruleset = (manifest.declarative_net_request?.rule_resources ?? []).find((r: any) => r.id === ORIGIN_RULESET_ID);
    expect(ruleset, `manifest-də "${ORIGIN_RULESET_ID}" ruleset-i yoxdur`).toBeTruthy();
    expect(ruleset.path).toBe(ORIGIN_RULES_PATH);
    expect(ruleset.enabled).toBe(true);
  });

  it("qayda faylı deskriptorlardan törədilənlə birebir uyğundur", () => {
    expect(read(ORIGIN_RULES_PATH)).toStrictEqual(expected);
  });

  it("başlıq əvəzləməsi üçün icazə yazılıb", () => {
    // TAM `declarativeNetRequest` icazəsi lazımdır: `...WithHostAccess` variantı qaydaları
    // yalnız host icazəsi olan saytlara tətbiq edir və izləyici qalxanı işləməzdi
    // (bax: background/trackers.ts). `modifyHeaders` isə yenə host icazəsi tələb edir —
    // aşağıdaki test onu yoxlayır.
    expect((manifest.permissions ?? []).includes("declarativeNetRequest")).toBeTruthy();
  });

  it("hər qaydanın hostu üçün host icazəsi də var (DNR host access tələb edir)", () => {
    for (const rule of expected) {
      for (const domain of rule.condition.requestDomains) {
        expect((manifest.host_permissions ?? []).includes(`*://*.${domain}/*`), `${domain} üçün host_permissions şablonu yoxdur`).toBeTruthy();
      }
    }
  });
});
