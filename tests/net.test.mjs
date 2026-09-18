// declarativeNetRequest qaydalarının deskriptordan törədilməsi.
//
// Niyə vacibdir: qayda faylı (rules/provider-origin.json) manifest-də STATİK ruleset kimi
// yazılır, yəni əl ilə saxlanılır. Uyğunsuzluq extension-ı sındırmır, sadəcə sorğu yad
// Origin ilə gedir və sayt 403 Forbidden qaytarır — səssiz nasazlıq. Ona görə həm bu testlər,
// həm `npm run check` faylı deskriptorlarla tutuşdurur.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { RELAY } from "../src/providers/relay/index.js";
import { TEMP_MAIL } from "../src/providers/temp-mail/index.js";
import { ORIGIN_RULES_PATH, ORIGIN_RULESET_ID, originRules } from "../src/shared/net.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => JSON.parse(readFileSync(path.join(root, file), "utf8"));

const site = { id: "a", name: "A", url: "https://www.a.example/", hosts: ["a.example"] };

describe("originRules", () => {
  it("requestOrigin yoxdursa qayda da yoxdur", () => {
    assert.deepEqual(originRules(site), []);
  });

  it("boş dəyər və qeyri-sətir nəzərə alınmır", () => {
    assert.deepEqual(originRules({ ...site, requestOrigin: "" }, { ...site, requestOrigin: 7 }, null), []);
  });

  it("qayda Origin başlığını saytın origin-i ilə əvəz edir", () => {
    const [rule] = originRules({ ...site, requestOrigin: "https://www.a.example" });
    assert.equal(rule.action.type, "modifyHeaders");
    assert.deepEqual(rule.action.requestHeaders, [
      { header: "origin", operation: "set", value: "https://www.a.example" },
    ]);
  });

  it("şərt saytın hostlarına bağlanır (apex + alt-domenlər), yalnız API sorğularına", () => {
    const [rule] = originRules({ ...site, requestOrigin: "https://www.a.example" });
    assert.deepEqual(rule.condition.requestDomains, ["a.example"]);
    assert.deepEqual(rule.condition.resourceTypes, ["xmlhttprequest", "other"]);
  });

  it("üçüncü tərəf hostlar şərtə düşmür (yalnız origin-i əhatə edən host)", () => {
    const [rule] = originRules({
      ...site,
      hosts: ["a.example", "challenges.cloudflare.com"],
      requestOrigin: "https://www.a.example",
    });
    assert.deepEqual(rule.condition.requestDomains, ["a.example"]);
  });

  it("id-lər 1-dən başlayır və ardıcıldır (fayl ilə müqayisə dərin bərabərlikdir)", () => {
    const rules = originRules(
      { ...site, requestOrigin: "https://www.a.example" },
      { id: "b", name: "B", url: "https://b.example/", hosts: ["b.example"] },
      { id: "c", name: "C", url: "https://c.example/", hosts: ["c.example"], requestOrigin: "https://c.example" },
    );
    assert.deepEqual(rules.map((r) => r.id), [1, 2]);
    assert.deepEqual(rules.map((r) => r.priority), [1, 1]);
  });
});

describe("manifest ↔ qayda faylı", () => {
  const manifest = read("manifest.json");
  const providers = [...TEMP_MAIL.all(), ...RELAY.all()];
  const expected = originRules(...providers);

  it("ən azı bir provider Origin əvəzləməsi tələb edir (emailnator)", () => {
    assert.ok(expected.length >= 1, "gözlənilən qayda yoxdur — test mənasını itirir");
  });

  it("manifest ruleset-i modulun sabitləri ilə uyğundur", () => {
    const ruleset = (manifest.declarative_net_request?.rule_resources ?? []).find((r) => r.id === ORIGIN_RULESET_ID);
    assert.ok(ruleset, `manifest-də "${ORIGIN_RULESET_ID}" ruleset-i yoxdur`);
    assert.equal(ruleset.path, ORIGIN_RULES_PATH);
    assert.equal(ruleset.enabled, true);
  });

  it("qayda faylı deskriptorlardan törədilənlə birebir uyğundur", () => {
    assert.deepEqual(read(ORIGIN_RULES_PATH), expected);
  });

  it("başlıq əvəzləməsi üçün icazə yazılıb", () => {
    // TAM `declarativeNetRequest` icazəsi lazımdır: `...WithHostAccess` variantı qaydaları
    // yalnız host icazəsi olan saytlara tətbiq edir və izləyici qalxanı işləməzdi
    // (bax: background/trackers.js). `modifyHeaders` isə yenə host icazəsi tələb edir —
    // aşağıdaki test onu yoxlayır.
    assert.ok((manifest.permissions ?? []).includes("declarativeNetRequest"));
  });

  it("hər qaydanın hostu üçün host icazəsi də var (DNR host access tələb edir)", () => {
    for (const rule of expected) {
      for (const domain of rule.condition.requestDomains) {
        assert.ok(
          (manifest.host_permissions ?? []).includes(`*://*.${domain}/*`),
          `${domain} üçün host_permissions şablonu yoxdur`,
        );
      }
    }
  });
});
