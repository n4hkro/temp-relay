// Provider kontraktı: deskriptorların yoxlanması və reyestrin qurulması.
//
// Məqsəd — yeni sayt əlavə edəndə səhv mümkün qədər tez və aydın görünsün. Deskriptor
// reyestrə düşəndə yoxlanır; keçməyən provider digərlərinin işini pozmur, amma console-a
// aydın mesaj yazılır və tools/check.mjs onu xəta kimi qaytarır.
//
// Bu fayl `chrome` API-sinə toxunmur: həm extension-da, həm node-da (yoxlama aləti) import olunur.

import {
  validateSchema,
  type OptionField,
  type OptionsProvider,
  type OptionValues,
} from "../shared/options";
import type { NormalizedMessage } from "../shared/extract";

// Xəta mesajındakı sahə yolu: `temp-mail: "temp.tf" → options.schema.providers`
type AtFn = (field: string) => string;

const isNonEmptyString = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";
const isStringArray = (v: unknown): v is string[] =>
  Array.isArray(v) && v.length > 0 && v.every(isNonEmptyString);
const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const isOrigin = (v: string): boolean => /^https:\/\/[^\s/]+$/.test(v);
const isHost = (v: string): boolean => /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(v);

function require(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

// Xəta mesajı üçün deskriptorun id-si; hələ yoxlanılmayıbsa "?" yazılır
const describeId = (d: unknown): string => {
  const id = isPlainObject(d) ? d.id : undefined;
  return id === undefined || id === null ? "?" : String(id);
};

// Worker-də işləyən provider funksiyası (fetchAddress, fetchMessages) node-da test olunur —
// orada chrome yoxdur. Qayda təyinatlı funksiyaya baxır: əsl iş adətən <slug>/api.js-də olur.
const NO_BROWSER_API = /\b(chrome|browser)\s*\./;
function requireWorkerFunction(value: unknown, at: AtFn, field: string): void {
  require(typeof value === "function", at(field) + " funksiya olmalıdır");
  require(!NO_BROWSER_API.test(String(value)),
    at(field) + " chrome.*/browser.* işlədə bilməz — provider node-da test oluna bilməlidir");
}

// Temp mail provider-in ünvanı necə aldığı. Background qatı qolu buna görə seçir.
export const AcquireMode = Object.freeze({ api: "api", page: "page" } as const);
export type AcquireMode = (typeof AcquireMode)[keyof typeof AcquireMode];

// api  — fetchAddress worker-də işləyir, tab açılmır (üstün tutulan rejim)
// page — newAddress saytın səhifəsinə köçürülür, tab açılır (API-si olmayan saytlar üçün)
export const acquireMode = (provider: { fetchAddress?: unknown } | null | undefined): AcquireMode =>
  typeof provider?.fetchAddress === "function" ? AcquireMode.api : AcquireMode.page;

// Poçt qutusunun oxunması İSTƏYƏ BAĞLI imkandır: fetchMessages varsa worker gələn məktubları
// izləyib aktivasiya kodunu/keçidini özü tapır; yoxdursa sessiya izləməsiz işləyir.
//
// DİQQƏT: sorğular arasındaki PAUZA da bu funksiyanın işidir. Worker uğurlu sorğudan sonra
// gözləmir — `wait: true` cavabı saxlamalıdır. Sayt long-poll verirsə pauza oradan gəlir
// (temp.tf), vermirsə provider onu emulyasiya etməlidir (emailnator) — əks halda döngü saytı
// fasiləsiz sorğu ilə doldurar.
export const supportsInbox = (provider: { fetchMessages?: unknown } | null | undefined): boolean =>
  typeof provider?.fetchMessages === "function";

// Relay-in xüsusi növü: sabit saytı yoxdur, AKTİV TABIN saytını mənimsəyir. Belə relay
// seçiləndə heç bir tab açılmır — istifadəçi hansı saytda dayanıbsa kod onun üçün axtarılır
// (məs. facebook.com-da qeydiyyatdan keçirsən). Sayt məlumatı yalnız işləmə anında bilinir,
// ona görə deskriptorda url/hosts/cleanup/mail/signup OLMAMALIDIR — onları
// background/relay.ts → resolveRelay() tabdan törədir.
export const adoptsActiveTab = (relay: { adoptActiveTab?: unknown } | null | undefined): boolean =>
  relay?.adoptActiveTab === true;

// --- təsdiqlənmiş deskriptor formaları ----------------------------------------------------
// validate* funksiyaları aşağıdakı formaları yoxlayır; reyestrdən çıxan deskriptor bu tipdədir.

export interface ProviderCommon {
  id: string;
  name: string;
  url: string;
  hosts: string[];
  // Sayt yalnız öz origin-indən gələn sorğuları qəbul edirsə (İSTƏYƏ BAĞLI)
  requestOrigin?: string;
}

// fetchAddress / fetchMessages-in arqumentləri — worker-dən çağrılır
export interface FetchAddressArgs {
  values: OptionValues;
  signal?: AbortSignal;
}

export interface FetchMessagesArgs {
  email: string;
  wait?: boolean;
  signal?: AbortSignal;
}

// Səhifə rejimində sayta köçürülən newAddress funksiyasının arqumenti və nəticəsi
export interface PageAddressArgs {
  values: OptionValues;
  config?: Record<string, unknown>;
}

export interface PageAddressResult {
  address?: string;
  error?: string;
}

export interface TempMailDescriptor extends ProviderCommon, OptionsProvider {
  fetchAddress?: (args: FetchAddressArgs) => Promise<string>;
  fetchMessages?: (args: FetchMessagesArgs) => Promise<NormalizedMessage[]>;
  newAddress?: (args: PageAddressArgs) => PageAddressResult | Promise<PageAddressResult>;
  pageConfig?: Record<string, unknown>;
}

export interface RelayCleanup {
  cookieDomains: string[];
  storageOrigins: string[];
  partitionTopLevelSites?: string[];
}

export interface RelayMailHints {
  fromDomains?: string[];
  keywords?: string[];
}

// fill addımının `value`-su — sessiyadan götürülən dəyərin adı
export type SignupSlot = "address" | "username" | "code" | "password";

export interface SignupStep {
  click?: string;
  fill?: string;
  waitValue?: string;
  text?: string;
  enabled?: true;
  timeoutMs?: number;
  value?: SignupSlot;
}

export interface RelaySignup {
  password?: { length?: number };
  afterAddress?: SignupStep[];
  afterCode?: SignupStep[];
}

// Sayta bağlı relay: url/hosts/cleanup deskriptordadır
export interface SiteRelayDescriptor extends ProviderCommon {
  adoptActiveTab?: false;
  cleanup: RelayCleanup;
  mail?: RelayMailHints;
  signup?: RelaySignup;
}

// "Bu sayt" relay-i: sayt məlumatı yoxdur, işləmə anında aktiv tabdan alınır.
// validateRelay bu sahələri runtime-da qadağan edir — tip də eyni qadağanı əks etdirir.
export interface ActiveTabRelayDescriptor {
  id: string;
  name: string;
  adoptActiveTab: true;
  url?: undefined;
  hosts?: undefined;
  cleanup?: undefined;
  mail?: undefined;
  signup?: undefined;
  requestOrigin?: undefined;
}

export type RelayDescriptor = SiteRelayDescriptor | ActiveTabRelayDescriptor;

// Provider sorğularının ortaq parametrləri: ləğvetmə siqnalı və testdə stub-lanan fetch
export interface RequestOptions {
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}

export interface RequestMessagesOptions extends RequestOptions {
  wait?: boolean;
}

// --- yoxlama ----------------------------------------------------------------------------

// `requestOrigin` (İSTƏYƏ BAĞLI) — sayt yalnız öz origin-i ilə gələn sorğuları qəbul edirsə.
// Worker-in fetch-i `Origin: chrome-extension://<id>` göndərir və belə sayt onu 403 ilə
// rədd edir; declarativeNetRequest başlığı saytın öz origin-i ilə əvəz edir
// (bax: shared/net.ts → originRules).
function validateRequestOrigin(d: Record<string, unknown>, at: AtFn, urlHost: string): void {
  if (d.requestOrigin === undefined) return;
  require(isNonEmptyString(d.requestOrigin) && isOrigin(d.requestOrigin),
    at("requestOrigin") + ' origin formatında olmalıdır ("https://sayt.com", yol olmadan)');
  const host = new URL(d.requestOrigin).hostname;
  // Başqa saytın origin-ini yazmaq olmaz: qayda yalnız provider-in öz hostlarına tətbiq olunur
  // (validateCommon artıq hosts-un düzgünlüyünü yoxlayıb)
  const hosts = d.hosts as string[];
  require(hosts.some((h) => host === h || host.endsWith("." + h)),
    at("requestOrigin") + ` hostu (${host}) hosts siyahısında əhatə olunmayıb`);
  require(urlHost === host || registrable(urlHost) === registrable(host),
    at("requestOrigin") + ` saytın öz origin-i olmalıdır (url hostu: ${urlHost})`);
}

// Hər iki provider növünün ortaq sahələri: id, name, url, hosts
function validateCommon(kind: string, d: unknown): void {
  const at: AtFn = (field) => `${kind}: "${describeId(d)}" → ${field}`;
  require(isPlainObject(d), `${kind}: deskriptor obyekt deyil`);
  require(isNonEmptyString(d.id), at("id") + " boş olmayan sətir olmalıdır");
  require(isNonEmptyString(d.name), at("name") + " boş olmayan sətir olmalıdır");
  require(isNonEmptyString(d.url) && d.url.startsWith("https://"), at("url") + " https:// ilə başlamalıdır");
  require(isStringArray(d.hosts), at("hosts") + " ən azı bir host adı olan massiv olmalıdır");

  let hostname: string | null = null;
  try { hostname = new URL(d.url).hostname; } catch { /* aşağıdakı require xəbər verəcək */ }
  require(hostname, at("url") + " oxuna bilən URL deyil");
  // url-in özü icazə şablonlarının əhatəsində olmalıdır, yoxsa nə tab, nə də fetch işləyir
  require(d.hosts.some((h) => hostname === h || hostname.endsWith("." + h)),
    at("hosts") + ` url-in hostunu (${hostname}) əhatə etmir`);
  // eyni host iki dəfə yazılıbsa manifest-də təkrar şablon yaranır
  require(new Set(d.hosts).size === d.hosts.length, at("hosts") + " təkrarlanan host var");

  validateRequestOrigin(d, at, hostname);
}

const registrable = (host: string): string =>
  String(host).toLowerCase().split(".").filter(Boolean).slice(-2).join(".");

// Seçim sxemi popup-da formanı qurur, worker-də dəyərləri normallaşdırır. Səhv sxem
// popup-ı sındırardı, ona görə import anında yoxlanır. `options` istəyə bağlıdır:
// seçimsiz sayt da ola bilər.
function validateOptions(d: { options?: unknown }, at: AtFn): void {
  if (d.options === undefined) return;
  require(isPlainObject(d.options), at("options") + " obyekt olmalıdır");
  const options = d.options;
  // Sxemin öz yoxlaması validateSchema-dadır — pozuntunu o, require ilə bildirir
  validateSchema(
    options.schema as OptionField[],
    options.defaults as OptionValues,
    (suffix: string) => at("options") + suffix,
  );
  if (options.validate !== undefined) {
    require(typeof options.validate === "function", at("options.validate") + " funksiya olmalıdır");
  }
}

// Poçt qutusu imkanı (istəyə bağlı). Hər iki rejimdə qayda eynidir: funksiya worker-də
// işləyir, ona görə chrome-a toxuna bilməz. Qaytarılan siyahını shared/extract.ts →
// normalizeMessages oxuyur; provider öz saytının cavabını həmin formaya salmalıdır
// (nümunə: temp-mail/temp-tf/api.js → requestMessages).
function validateInbox(d: { fetchMessages?: unknown }, at: AtFn): void {
  if (d.fetchMessages === undefined) return;
  requireWorkerFunction(d.fetchMessages, at, "fetchMessages");
}

export function validateTempMail(d: unknown): void {
  validateCommon("temp-mail", d);
  const at: AtFn = (field) => `temp-mail: "${describeId(d)}" → ${field}`;
  // validateCommon keçibsə d təsdiqlənmiş formadadır; qalan sahələr aşağıda yoxlanılır
  const t = d as TempMailDescriptor;
  validateOptions(t, at);
  validateInbox(t, at);

  const hasApi = t.fetchAddress !== undefined;
  const hasPage = t.newAddress !== undefined;
  require(hasApi || hasPage, at("rejim") + " ya fetchAddress (API), ya da newAddress (səhifə) olmalıdır");
  require(!(hasApi && hasPage), at("rejim") + " həm fetchAddress, həm newAddress ola bilməz — bir rejim seçin");

  if (hasApi) {
    requireWorkerFunction(t.fetchAddress, at, "fetchAddress");
    return;
  }

  require(typeof t.newAddress === "function", at("newAddress") + " funksiya olmalıdır");
  if (t.pageConfig !== undefined) require(isPlainObject(t.pageConfig), at("pageConfig") + " obyekt olmalıdır");

  // newAddress chrome.scripting.executeScript({ func }) ilə saytın səhifəsinə KÖÇÜRÜLÜR
  // (funksiyanın toString-i işləyir): modul əhatəsi, import və extension API-ləri orada yoxdur.
  const source = String(t.newAddress);
  require(/^(async\s+)?(\(|function\b|[A-Za-z0-9_$]+\s*=>)/.test(source.trimStart()),
    at("newAddress") + " arrow/function ifadəsi olmalıdır (metod qısa yazılışı serializasiyada sınır)");
  require(!/\b(chrome|browser)\s*\./.test(source),
    at("newAddress") + " səhifədə icra olunur — chrome.*/browser.* işlədə bilməz");
  require(!/\bimport\s*\(|\brequire\s*\(/.test(source),
    at("newAddress") + " heç nə idxal edə bilməz (səhifədə modul əhatəsi yoxdur)");
}

// Relay provider-i: tabı bağlananda hansı izlərin silinəcəyini təsvir edir
export function validateRelay(d: unknown): void {
  // Aktiv tabı mənimsəyən relay-in sayt məlumatı YOXDUR: url, hosts, cleanup və qalanı
  // işləmə anında tabdan törədilir. Deskriptorda onların yazılması yanlış olardı —
  // hansı sayt olduğu əvvəlcədən bilinmir.
  if (adoptsActiveTab(d as { adoptActiveTab?: unknown } | null | undefined)) {
    const at: AtFn = (field) => `relay: "${describeId(d)}" → ${field}`;
    require(isPlainObject(d), "relay: deskriptor obyekt deyil");
    require(isNonEmptyString(d.id), at("id") + " boş olmayan sətir olmalıdır");
    require(isNonEmptyString(d.name), at("name") + " boş olmayan sətir olmalıdır");
    for (const field of ["url", "hosts", "cleanup", "mail", "signup", "requestOrigin"]) {
      require(d[field] === undefined,
        at(field) + " adoptActiveTab relay-ində ola bilməz (sayt işləmə anında tabdan alınır)");
    }
    return;
  }

  validateCommon("relay", d);
  const at: AtFn = (field) => `relay: "${describeId(d)}" → ${field}`;
  const r = d as SiteRelayDescriptor;
  const c = r.cleanup;
  require(isPlainObject(c), "relay: cleanup obyekti olmalıdır (cookieDomains, storageOrigins, partitionTopLevelSites)");
  require(isStringArray(c.cookieDomains), "relay: cleanup.cookieDomains host adları massivi olmalıdır");
  require(isStringArray(c.storageOrigins) && c.storageOrigins.every(isOrigin),
    'relay: cleanup.storageOrigins origin formatında olmalıdır ("https://sayt.com", yol olmadan)');
  if (c.partitionTopLevelSites !== undefined) {
    require(isStringArray(c.partitionTopLevelSites) && c.partitionTopLevelSites.every(isOrigin),
      'relay: cleanup.partitionTopLevelSites origin formatında olmalıdır ("https://sayt.com")');
  }

  // Poçt ipuçları (İSTƏYƏ BAĞLI): gələn məktublardan hansının bu sayta aid olduğunu və
  // aktivasiya keçidinin hara getdiyini təyin edir. Yazılmayıbsa shared/extract.ts ipuçlarını
  // url-dən və name-dən özü törədir. hosts siyahısı bu işə yaramır — orada Cloudflare kimi
  // üçüncü tərəf hostlar da var.
  if (r.mail !== undefined) {
    require(isPlainObject(r.mail), "relay: mail obyekt olmalıdır (fromDomains, keywords)");
    const mail = r.mail;
    const known = ["fromDomains", "keywords"];
    for (const key of Object.keys(mail)) {
      require(known.includes(key), `relay: mail içində naməlum açar var: "${key}" (icazəli: ${known.join(", ")})`);
    }
    require(mail.fromDomains !== undefined || mail.keywords !== undefined,
      "relay: mail obyekti boş ola bilməz — ya fromDomains, ya keywords yazın (lazım deyilsə sahəni silin)");
    if (mail.fromDomains !== undefined) {
      require(Array.isArray(mail.fromDomains) && mail.fromDomains.every(isHost),
        'relay: mail.fromDomains host adları massivi olmalıdır ("sayt.com", https:// olmadan)');
    }
    if (mail.keywords !== undefined) {
      require(Array.isArray(mail.keywords) && mail.keywords.every(isNonEmptyString),
        "relay: mail.keywords sətir massivi olmalıdır");
    }
  }

  // Qeydiyyat addımları (İSTƏYƏ BAĞLI): sayt formasının doldurulması və hesabın yaradılması
  // (background/signup.ts). Yazılmayıbsa yalnız clipboard + bildiriş qalır.
  validateSignup(r);
}

// Qeydiyyat addımları (İSTƏYƏ BAĞLI) — background/signup.ts onları relay tabında icra edir.
// Yazılmayıbsa heç nə dəyişmir: kod yalnız clipboard-a düşür və istifadəçi formanı özü doldurur.
//
//   signup: {
//     password: { length: 16 },                                   // istəyə bağlı
//     afterAddress: [ { click: "sel" }, { fill: "sel", value: "address" }, { waitValue: "sel" } ],
//     afterCode:    [ { fill: "sel", value: "code" }, { click: "sel", enabled: true } ],
//   }
//
// Addımın üç növü var (biri seçilir):
//   click     — elementi kliklər (görünən olmalı; `enabled: true` aktivləşməsini gözləyir)
//   fill      — xanaya `value` adındaki dəyəri yazır (address | code | password)
//   waitValue — selektorun `value`-su dolana qədər gözləyir; GİZLİ element də olar.
//               Turnstile token-i belə gözlənilir: düymə token gəlməmiş də klikləniləndir,
//               ona görə `enabled` kifayət etmir (sayt sorğunu 'verification failed' ilə kəsir).
const SIGNUP_PHASES = ["afterAddress", "afterCode"];
const SIGNUP_SLOTS = ["address", "username", "code", "password"];

function validateSignup(d: SiteRelayDescriptor): void {
  const at: AtFn = (field) => `relay: "${describeId(d)}" → signup${field}`;
  const signup: unknown = d.signup;
  if (signup === undefined) return;
  require(isPlainObject(signup), at("") + " obyekt olmalıdır (afterAddress, afterCode, password)");

  const known = [...SIGNUP_PHASES, "password"];
  for (const key of Object.keys(signup)) {
    require(known.includes(key), at("") + ` içində naməlum açar var: "${key}" (icazəli: ${known.join(", ")})`);
  }
  require(SIGNUP_PHASES.some((phase) => signup[phase] !== undefined),
    at("") + " boş ola bilməz — ən azı bir faza yazın (lazım deyilsə sahəni silin)");

  if (signup.password !== undefined) {
    require(isPlainObject(signup.password), at(".password") + " obyekt olmalıdır ({ length })");
    const password = signup.password;
    if (password.length !== undefined) {
      require(typeof password.length === "number" && Number.isInteger(password.length) && password.length >= 8 && password.length <= 64,
        at(".password.length") + " 8 ilə 64 arasında tam ədəd olmalıdır");
    }
  }

  let needsPassword = false;
  for (const phase of SIGNUP_PHASES) {
    if (signup[phase] === undefined) continue;
    const steps = signup[phase];
    require(Array.isArray(steps) && steps.length > 0, at("." + phase) + " ən azı bir addımı olan massiv olmalıdır");
    const stepList: unknown[] = steps;
    stepList.forEach((step, i) => {
      const path: AtFn = (suffix) => at(`.${phase}[${i}]${suffix}`);
      require(isPlainObject(step), path("") + " obyekt olmalıdır");
      const kinds = (["click", "fill", "waitValue"] as const).filter((kind) => step[kind] !== undefined);
      require(kinds.length === 1,
        path("") + " ya click, ya fill, ya waitValue selektoru daşımalıdır (yalnız biri; hazırda: "
          + (kinds.join(", ") || "heç biri") + ")");
      // Yuxarıdakı require kinds-in düz bir elementli olduğunu təsdiqlədi
      const kind = kinds[0] as "click" | "fill" | "waitValue";
      require(isNonEmptyString(step[kind]), path("." + kind) + " boş olmayan CSS selektoru olmalıdır");
      if (step.text !== undefined) require(isNonEmptyString(step.text), path(".text") + " boş olmayan sətir olmalıdır");
      if (step.enabled !== undefined) {
        require(step.enabled === true, path(".enabled") + " yalnız true ola bilər (gözləmə deməkdir)");
        require(kind === "click", path(".enabled") + " yalnız click addımında olur");
      }
      if (step.timeoutMs !== undefined) {
        require(typeof step.timeoutMs === "number" && Number.isInteger(step.timeoutMs) && step.timeoutMs > 0 && step.timeoutMs <= 25000,
          path(".timeoutMs") + " 1 ilə 25000 arasında tam ədəd olmalıdır (worker sorğunu sonra kəsir)");
      }
      if (kind === "fill") {
        require(typeof step.value === "string" && SIGNUP_SLOTS.includes(step.value),
          path(".value") + ` ${SIGNUP_SLOTS.join(" | ")} olmalıdır`);
        if (step.value === "password") needsPassword = true;
      } else {
        require(step.value === undefined, path(".value") + " yalnız fill addımında olur");
      }
    });
  }

  // `code` yalnız afterCode fazasında mövcuddur: kod ünvan alınanda hələ gəlməmişdir
  // (faza döngüsü artıq addımların obyekt olduğunu yoxlayıb)
  const afterAddress = signup.afterAddress as unknown[] | undefined;
  for (const step of afterAddress ?? []) {
    require((step as Record<string, unknown>).value !== "code",
      at(".afterAddress") + " içində code dəyəri ola bilməz (kod hələ gəlməyib)");
  }
  if (needsPassword && signup.password === undefined) {
    // Parol tələb olunur, uzunluq yazılmayıb → shared/password.ts default-u işlənir (xəta deyil)
  }
}

export interface Registry<TDescriptor> {
  kind: string;
  problems: string[];
  all: () => TDescriptor[];
  ids: () => string[];
  has: (id: string) => boolean;
  get: (id: string) => TDescriptor;
}

// Deskriptor siyahısından immutabel reyestr qurur. Keçməyən provider problems-ə düşür.
export function createRegistry<TDescriptor>(
  kind: string,
  descriptors: readonly unknown[],
  validate: (d: unknown) => void,
): Registry<TDescriptor> {
  const byId = new Map<string, TDescriptor>();
  const problems: string[] = [];

  for (const d of descriptors) {
    const label = isPlainObject(d) && isNonEmptyString(d.id) ? d.id : "(idsiz deskriptor)";
    try {
      validate(d);
      // validate keçibsə id təsdiqlənib — reyestrə düşməyə hazırdır
      const valid = d as TDescriptor & { id: string };
      require(!byId.has(valid.id), `${kind}: "${valid.id}" id-si təkrarlanır`);
      byId.set(valid.id, Object.freeze({ ...valid }));
    } catch (e) {
      // e.message artıq növü və id-ni ehtiva edir ("relay: \"x\" → url ..."), təkrar prefiks lazım deyil
      const message = e instanceof Error ? e.message : String(e);
      problems.push(message);
      console.error(`[providers] ${kind} "${label}" reyestrə düşmədi — ${message}`);
    }
  }

  return Object.freeze({
    kind,
    problems,                              // tools/check.mjs bunu xəta kimi hesablayır
    all: () => [...byId.values()],
    ids: () => [...byId.keys()],
    has: (id: string) => byId.has(id),
    // Naməlum id üçün aydın xəta: sessiya silinmiş provider-ə istinad edəndə səbəb görünür
    get(id: string) {
      const found = byId.get(id);
      if (!found) throw new Error(`${kind}: naməlum sayt "${id}" (mövcud: ${[...byId.keys()].join(", ") || "—"})`);
      return found;
    },
  }) as Registry<TDescriptor>;
}
