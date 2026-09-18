#!/usr/bin/env -S npx tsx
// Statik yoxlama aləti — extension-ı açmadan əvvəl işlədilir:
//   tsx tools/check.ts    (və ya: npm run check)
//
// Yoxlanılanlar:
//   1. provider reyestrləri: deskriptorlar kontrakta uyğundur, təkrar id yoxdur,
//      hər temp-mail saytının rejimi (api/page), poçt qutusu imkanı və seçim sahələri göstərilir
//   2. manifest.json: hər provider-in hostları üçün icazə şablonu yazılıb
//   3. manifest.json: göstərilən fayllar (popup, service worker, ikonlar) mövcuddur
//      (dist/ yığılıbsa oradakı built fayllar, yoxsa mənbə — .js istinadı .ts-ə düşür)
//   4. manifest.json ↔ package.json versiyaları üst-üstə düşür
//   5. kodda istinad olunan offscreen sənədi mövcuddur
//
// Alət yalnız node API-si və chrome-a toxunmayan modullar (providers, shared) istifadə edir.

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rel = (p: string): string => path.relative(root, p).split(path.sep).join("/");

// Build olunmuş fayllar dist/-dədir; dist yoxdursa mənbə qovluq yoxlanılır.
const distDir = path.join(root, "dist");
const base = existsSync(distDir) ? distDir : root;
if (base === distDir) console.log("Yoxlama hədəfi: dist/ (build olunmuş)");
else console.log("Yoxlama hədəfi: mənbə (dist/ yoxdur — əvvəlcə npm run build)");

const { TEMP_MAIL } = await import("../src/providers/temp-mail/index");
const { RELAY } = await import("../src/providers/relay/index");
const { acquireMode, adoptsActiveTab, supportsInbox } = await import("../src/providers/contract");
const { supportsSignup, SignupPhase } = await import("../src/background/signup");
const { requiredOrigins, originPattern } = await import("../src/shared/permissions");
import type { OriginRuleProvider } from "../src/shared/net";
import type { SiteRelayDescriptor, TempMailDescriptor } from "../src/providers/contract";
const { ORIGIN_RULES_PATH, ORIGIN_RULESET_ID, originRules } = await import("../src/shared/net");
const { OFFSCREEN_URL } = await import("../src/background/clipboard");
const { ICON_PATH } = await import("../src/background/notify");
const { IP_CHECK_URL } = await import("../src/background/proxy");
const { TRACKER_RULESET_ID } = await import("../src/background/trackers");

interface Manifest {
  host_permissions?: string[];
  optional_host_permissions?: string[];
  permissions?: string[];
  action?: { default_popup?: string };
  background?: { service_worker?: string; type?: string };
  icons?: Record<string, string>;
  declarative_net_request?: {
    rule_resources?: Array<{ id: string; enabled: boolean; path: string }>;
  };
  version?: string;
}

const manifest = JSON.parse(readFileSync(path.join(root, "manifest.json"), "utf8")) as Manifest;
const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as { version: string };

let errors = 0;
let warnings = 0;
const pass = (m: string): void => console.log("  ok   " + m);
const fail = (m: string): void => { errors++; console.error("  XETA " + m); };
const warn = (m: string): void => { warnings++; console.warn("  XEBERDARLIQ " + m); };
const section = (title: string): void => console.log("\n" + title);
const fileExists = (p: string): boolean => {
  const abs = path.isAbsolute(p) ? p : path.join(base, p);
  if (existsSync(abs)) return true;
  // Mənbə yoxlanılırsa manifest-dəki .js built fayla yox, .ts mənbəyə işarə edir.
  if (base === root && p.endsWith(".js")) {
    const ts = path.join(root, p.slice(0, -3) + ".ts");
    if (existsSync(ts)) return true;
  }
  // Qayda/asset faylları mənbədə `public/` altındadır (Vite dist kökünə köçürür).
  if (base === root && (p.startsWith("rules/") || p.startsWith("assets/"))) {
    if (existsSync(path.join(root, "public", p))) return true;
  }
  return false;
};
// JSON oxuma — `fileExists` ilə eyni fallback məntiqi.
const readJSON = (p: string): unknown => {
  const cands = [path.join(base, p)];
  if (base === root) {
    if (p.endsWith(".js")) cands.push(path.join(root, p.slice(0, -3) + ".ts"));
    if (p.startsWith("rules/") || p.startsWith("assets/")) cands.push(path.join(root, "public", p));
  }
  const found = cands.find((c) => existsSync(c));
  if (!found) throw new Error(`fayl tapılmadı: ${p}`);
  return JSON.parse(readFileSync(found, "utf8"));
};

// --- 1. provider reyestrləri -----------------------------------------------------------
section("1. Provider reyestrləri");
const registryHeader = (kind: string, ids: string[], problems: string[], count: number): boolean => {
  const list = ids.join(", ") || "—";
  if (problems.length) {
    for (const p of problems) fail(`${kind}: ${p}`);
    return false;
  }
  if (!count) {
    fail(`${kind}: reyestr boşdur (ən azı bir provider olmalıdır)`);
    return false;
  }
  pass(`${kind}: ${count} provider — ${list}`);
  return true;
};
// temp-mail-də REJİM önəmlidir: api → sorğu worker-dən gedir, tab açılmır;
// page → saytın səhifəsində skript işləyir, tab açılır. Seçimlər popup formasını qurur.
if (registryHeader(TEMP_MAIL.kind, TEMP_MAIL.ids(), TEMP_MAIL.problems, TEMP_MAIL.all().length)) {
  for (const provider of TEMP_MAIL.all()) {
    const fields = (provider.options?.schema ?? []).map((field) => field.key).join(", ") || "seçimsiz";
    // Poçt qutusu imkanı rejimdən asılı deyil (fetchMessages istəyə bağlıdır): sayt onu
    // verməyibsə ünvan yaradılan kimi izləmə açılmır — bunu burada görmək lazımdır.
    const inbox = supportsInbox(provider) ? "poçt oxunur" : "poçt oxunmur";
    pass(`  ├ ${provider.id}: ${acquireMode(provider)} rejimi, ${inbox}, seçimlər → ${fields}`);
  }
}
// Relay-də qeydiyyat addımları istəyə bağlıdır: yazılmayıbsa tapılan kod yalnız
// clipboard-a düşür və formanı istifadəçi özü doldurur.
if (registryHeader(RELAY.kind, RELAY.ids(), RELAY.problems, RELAY.all().length)) {
  for (const provider of RELAY.all()) {
    // Diskriminant sahə ilə daraltma: aktiv-tabda signup yoxdur.
    if (provider.adoptActiveTab) {
      pass(`  ├ ${provider.id}: aktiv tabın saytını mənimsəyir (tab açılmır, qeydiyyat evristika ilə aparılır)`);
      continue;
    }
    const phases = Object.values(SignupPhase)
      .filter((phase) => supportsSignup(provider, phase))
      .map((phase) => `${phase} (${provider.signup?.[phase]?.length ?? 0} addım)`);
    pass(`  ├ ${provider.id}: ${phases.length ? "qeydiyyat → " + phases.join(", ") : "qeydiyyat addımı yoxdur (yalnız clipboard)"}`);
  }
}
// Proxy siyahısı provider növü YOXDUR: proxy-ləri yalnız istifadəçi özü əlavə edir
// (bax: src/background/proxy.ts → addProxy), ona görə burada yoxlanacaq mənbə də yoxdur.
// createRegistry console.error ilə artıq xəbər verir; burada ayrıca yoxlama təkrar olunmur

// --- 2. host icazələri -----------------------------------------------------------------
section("2. manifest.json → host_permissions");
const providers = [...TEMP_MAIL.all(), ...RELAY.all()];
const declared = new Set(manifest.host_permissions ?? []);
// Kodun özünün işlətdiyi host: proxy qoşulanda çıxış IP-ni deyən xidmət.
// `originPattern` şablonu `*://*.<host>/*` verir, yəni alt domenləri də örtür.
const codeHosts = [IP_CHECK_URL].map((url: string) => new URL(url).hostname);
const needed = new Set([...requiredOrigins(...providers), ...codeHosts.map(originPattern)]);

for (const provider of providers) {
  const missing = requiredOrigins(provider).filter((o: string) => !declared.has(o));
  if (missing.length) fail(`${provider.id}: host_permissions-da çatışmır → ${missing.join("  ")}`);
  else pass(`${provider.id}: bütün host şablonları yazılıb (${requiredOrigins(provider).join("  ")})`);
}
for (const extra of [...declared].filter((o) => !needed.has(o))) {
  warn(`host_permissions-da heç bir provider-ə lazım olmayan şablon: ${extra}`);
}
for (const host of codeHosts) {
  if (declared.has(originPattern(host))) pass(`${host}: kodun işlətdiyi host üçün icazə yazılıb`);
  else fail(`host_permissions-da ${originPattern(host)} yoxdur — proxy-nin çıxış IP yoxlaması işləməz`);
}

// --- 3. manifest-dəki fayl yolları ------------------------------------------------------
section("3. manifest.json → fayl yolları");
const manifestFiles = [
  manifest.action?.default_popup,
  manifest.background?.service_worker,
  ...Object.values(manifest.icons ?? {}),
].filter((f): f is string => Boolean(f));

for (const file of new Set(manifestFiles)) {
  if (fileExists(file)) pass(`${file} (${path.relative(root, base) || "."})`);
  else fail(`manifest.json istinad edir, fayl yoxdur: ${file}`);
}
if (manifest.background?.type !== "module") fail("background.type \"module\" olmalıdır (kod ESM import işlədir)");
else pass("background.type = \"module\"");

// `activeTab` — naməlum saytın formasını doldurmaq üçün lazımdır: extension ikonuna basanda
// aktiv taba skript yeritmək icazəsi verilir (bax: src/background/forms.ts). Quraşdırmada
// "bütün saytlardaki məlumatı oxu" xəbərdarlığı çıxarmır, ona görə host_permissions-a
// "*://*/*" yazılmır.
for (const permission of ["activeTab", "tabs", "cookies", "browsingData", "scripting", "storage", "offscreen", "notifications", "clipboardWrite", "declarativeNetRequest", "proxy", "webRequest", "webRequestAuthProvider"]) {
  if (!(manifest.permissions ?? []).includes(permission)) fail(`permissions-da "${permission}" yoxdur (kod onu işlədir)`);
}
pass(`permissions: ${(manifest.permissions ?? []).join(", ")}`);

// "Bu saytın məlumatını sil" düyməsi istənilən sayt üçün icazə istəyir (partitioned cookie
// və sessionStorage yalnız host icazəsi ilə silinir), ona görə şablon manifest-də olmalıdır.
if ((manifest.optional_host_permissions ?? []).includes("*://*/*")) pass("optional_host_permissions: \"*://*/*\" (tab məlumatının silinməsi)");
else fail("optional_host_permissions-da \"*://*/*\" yoxdur — \"Bu saytın məlumatını sil\" tam işləməz");

// --- 3b. declarativeNetRequest qaydaları -------------------------------------------------
// `requestOrigin` daşıyan provider varsa Origin başlığı DNR ilə əvəzlənməlidir; qayda faylı
// əl ilə yazılır, ona görə burada deskriptorlardan törədilən qayda ilə müqayisə olunur
// (host_permissions ilə eyni prinsip). Uyğunsuzluq sorğunun 403 ilə rədd olunması demək olardı.
section("3b. declarativeNetRequest → Origin başlığı");
const expectedRules = originRules(
  // Aktiv-tab relay-in hosts-u yoxdur — Origin qaydası üçün yalnız hostlular lazımdır
  // (requestOrigin daşıyanların hamısının hosts-u var, ona görə süzgəc neytraldır).
  ...providers.filter((p): p is TempMailDescriptor | SiteRelayDescriptor => Array.isArray(p.hosts)),
);
const rulesets = manifest.declarative_net_request?.rule_resources ?? [];
const ruleset = rulesets.find((r) => r.id === ORIGIN_RULESET_ID);

if (!expectedRules.length) {
  if (ruleset) warn(`heç bir provider requestOrigin daşımır, amma "${ORIGIN_RULESET_ID}" ruleset-i manifest-dədir`);
  else pass("heç bir provider Origin əvəzləməsi tələb etmir");
} else if (!(manifest.permissions ?? []).includes("declarativeNetRequest")) {
  fail("permissions-da \"declarativeNetRequest\" yoxdur — Origin başlığı əvəzlənə və izləyicilər bloklana bilməz");
} else if (!ruleset) {
  fail(`manifest.json → declarative_net_request.rule_resources-da "${ORIGIN_RULESET_ID}" ruleset-i yoxdur`);
} else if (ruleset.enabled !== true) {
  fail(`"${ORIGIN_RULESET_ID}" ruleset-i enabled:true olmalıdır`);
} else if (ruleset.path !== ORIGIN_RULES_PATH) {
  fail(`"${ORIGIN_RULESET_ID}" yolu ${ORIGIN_RULES_PATH} olmalıdır (manifest-də: ${ruleset.path})`);
} else if (!fileExists(ruleset.path)) {
  fail(`manifest.json istinad edir, fayl yoxdur: ${ruleset.path}`);
} else {
  let written: unknown = null;
  try { written = readJSON(ruleset.path); }
  catch (e) { fail(`${ruleset.path} oxunmadı: ${(e as Error).message}`); }
  if (written !== null) {
    const same = JSON.stringify(written) === JSON.stringify(expectedRules);
    if (same) {
      for (const rule of expectedRules) {
        const header = rule.action.requestHeaders[0];
        pass(`${ruleset.path}: ${rule.condition.requestDomains.join(", ")} → ${header.header}=${header.value}`);
      }
    } else {
      fail(`${ruleset.path} deskriptorlardan törədilən qayda ilə üst-üstə düşmür — gözlənilən:\n${JSON.stringify(expectedRules, null, 2)}`);
    }
  }
}

// --- 3c. izləyici qalxanının qaydaları ---------------------------------------------------
// Qalxan STATİK ruleset-dir və manifest-də `enabled: false` olmalıdır: düymə ilə açılır.
// Qaydaların id-si təkrarlanmamalıdır (Chrome ruleset-i bütövlükdə rədd edir) və hər qayda
// yalnız ÜÇÜNCÜ TƏRƏF sorğularına aid olmalıdır — saytın özünə aid sorğu bloklanmır.
section("3c. izləyici qalxanı → rules/trackers.json");
const shieldRuleset = rulesets.find((r) => r.id === TRACKER_RULESET_ID);
if (!shieldRuleset) {
  fail(`manifest.json → rule_resources-da "${TRACKER_RULESET_ID}" ruleset-i yoxdur`);
} else if (shieldRuleset.enabled !== false) {
  fail(`"${TRACKER_RULESET_ID}" ruleset-i enabled:false olmalıdır (qalxan düymə ilə açılır)`);
} else if (!fileExists(shieldRuleset.path)) {
  fail(`manifest.json istinad edir, fayl yoxdur: ${shieldRuleset.path}`);
} else {
  let rules: unknown = null;
  try { rules = readJSON(shieldRuleset.path); }
  catch (e) { fail(`${shieldRuleset.path} oxunmadı: ${(e as Error).message}`); }
  if (Array.isArray(rules)) {
    const ids = new Set<unknown>();
    let domains = 0;
    let broken = 0;
    for (const rule of rules as Array<{ id: unknown; action?: { type?: string }; condition?: { domainType?: string; requestDomains?: unknown } }>) {
      if (ids.has(rule.id)) { fail(`${shieldRuleset.path}: təkrar qayda id-si ${String(rule.id)}`); broken++; }
      ids.add(rule.id);
      if (rule.action?.type !== "block") { fail(`qayda ${String(rule.id)}: action.type "block" olmalıdır`); broken++; }
      if (rule.condition?.domainType !== "thirdParty") { fail(`qayda ${String(rule.id)}: domainType "thirdParty" olmalıdır`); broken++; }
      const list = rule.condition?.requestDomains;
      if (!Array.isArray(list) || !list.length) { fail(`qayda ${String(rule.id)}: requestDomains boşdur`); broken++; }
      else domains += list.length;
    }
    if (!broken) pass(`${rules.length} qayda, ${domains} izləyici domeni (yalnız üçüncü tərəf, default sönülü)`);
  }
}

// --- 4. versiya uyğunluğu ---------------------------------------------------------------
section("4. Versiya");
if (manifest.version === pkg.version) pass(`manifest.json = package.json = ${manifest.version}`);
else fail(`versiyalar fərqlidir: manifest.json ${manifest.version}, package.json ${pkg.version}`);

// --- 5. koddan istinad olunan fayllar ---------------------------------------------------
section("5. Kodda istinad olunan fayllar");
for (const file of [OFFSCREEN_URL, ICON_PATH]) {
  if (fileExists(file)) pass(file);
  else fail(`kod istinad edir, fayl yoxdur: ${file}`);
}

// --- nəticə -----------------------------------------------------------------------------
console.log("");
if (errors) {
  console.error(`${errors} XETA, ${warnings} xəbərdarlıq`);
  process.exit(1);
} else {
  console.log(`OK (${warnings} xəbərdarlıq)`);
}
