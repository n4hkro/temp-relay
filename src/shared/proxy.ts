// ŞƏXSİ proxy qeydlərinin oxunması və Chrome konfiqurasiyasına çevrilməsi — saf modul.
//
// Siyahı YALNIZ istifadəçinin yazdığı sətirlərdən dolur: açıq (ictimai) proxy mənbələri
// qəsdən yoxdur — onlar tanımadığın maşınlardır, şifrələnməmiş trafiki oxuya bilər və
// dəqiqələr içində sönür. Ona görə burada nə mənbə formatı, nə "canlılıq" metadatası var.
//
// Niyə ayrı fayl: qaydalar həm worker-də (əlavə etmə, qoşulma), həm popup-da (yoxlama, göstərmə),
// həm testlərdə lazımdır. Bu fayl `chrome`-a toxunmur.
//
// Tanınan formatlar (bir sətirdə bir proxy):
//   1.2.3.4:8080                     — ən adi hal, sxem yazılmayıbsa http sayılır
//   socks5://1.2.3.4:1080            — sxem sətirdədir
//   user:pass@1.2.3.4:8080           — istifadəçi adı və parol
//   1.2.3.4:8080:user:pass           — bəzi satıcıların formatı
//   proxy.example.com:3128           — host adı ilə
//   #, // ilə başlayan sətirlər və boşluqlar atılır

export type ProxyScheme = "http" | "https" | "socks4" | "socks5";

// İstifadəçinin yazdığı proxy qeydi. İndeks imzası köhnə idxal qeydlərindəki artıq
// sahələrə görədir (`source`, `manual` və s. — bax: pruneImported/isImported).
export interface ProxyEntry {
  scheme: ProxyScheme;
  host: string;
  port: number;
  username?: string;
  password?: string;
  ping?: number;
  checked?: number;
  dead?: boolean;
  [key: string]: unknown;
}

export const PROXY_SCHEMES: readonly string[] = Object.freeze(["http", "https", "socks4", "socks5"]);
export const DEFAULT_SCHEME = "http";

// Toplu əlavə real haldır (satıcı yüzlərlə ünvan verir), ona görə tavan böyükdür. Yeganə
// məqsəd saxlanc kvotasını və popup-ın ləngiməsini qorumaqdır.
export const MAX_PROXIES = 1000;

const isPort = (value: unknown): value is number =>
  Number.isInteger(value) && (value as number) >= 1 && (value as number) <= 65535;

// Yalnız IPv4 və adi host adları. Son etiket hərflə yazılır (TLD) — belədə "300.1.1.1" kimi
// pozulmuş IP host adı sayılmır.
const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const HOSTNAME = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,}$/i;

export const isIpv4 = (host: unknown): boolean => {
  const parts = IPV4.exec(String(host ?? ""));
  return Boolean(parts) && (parts as RegExpExecArray).slice(1).every((octet) => Number(octet) <= 255 && String(Number(octet)) === octet);
};

const cleanScheme = (value: unknown): ProxyScheme | null => {
  const scheme = String(value ?? "").toLowerCase().trim();
  if (scheme === "socks") return "socks5";          // bəzi satıcılar sadəcə "socks" yazır
  return PROXY_SCHEMES.includes(scheme) ? (scheme as ProxyScheme) : null;
};

// Sətir → proxy obyekti (və ya null). `fallbackScheme` sətirdə sxem olmayanda işlədilir.
export function parseProxy(line: unknown, fallbackScheme: string = DEFAULT_SCHEME): ProxyEntry | null {
  let text = String(line ?? "").trim();
  if (text === "" || text.startsWith("#") || text.startsWith("//")) return null;
  // Sətirdə əlavə sözlər ola bilər (satıcılar bəzən "ip:port  ölkə" yazır)
  text = text.split(/[\s,;|]+/)[0] ?? "";
  if (text === "") return null;

  let scheme: ProxyScheme = cleanScheme(fallbackScheme) ?? DEFAULT_SCHEME;
  const withScheme = /^([a-z0-9]+):\/\/(.*)$/i.exec(text);
  if (withScheme) {
    const named = cleanScheme(withScheme[1]);
    if (!named) return null;                        // naməlum sxem (məs. "v2ray://") — atılır
    scheme = named;
    text = withScheme[2];
  }

  let username: string | null = null;
  let password: string | null = null;
  // user:pass@host:port
  const at = text.lastIndexOf("@");
  if (at !== -1) {
    const credentials = text.slice(0, at).split(":");
    text = text.slice(at + 1);
    username = credentials[0] ?? null;
    password = credentials.slice(1).join(":") || null;
    // URL formatının escape-ləri bir dəfə açılır; xam satıcı formatında % literal qalır.
    if (withScheme) {
      try {
        username = decodeURIComponent(username ?? "");
        password = decodeURIComponent(password ?? "");
      } catch { return null; }
    }
  }

  const parts = text.split(":");
  if (parts.length < 2) return null;
  const host = parts[0].trim().toLowerCase();
  const port = Number(parts[1].trim());
  if (!isPort(port)) return null;
  if (!isIpv4(host) && !HOSTNAME.test(host)) return null;

  // host:port:user:pass — üçüncü və dördüncü sahə hərf-rəqəmdirsə giriş məlumatıdır
  if (!username && parts.length >= 4 && /^[\w.\-@]+$/.test(parts[2]) && parts[3] !== "") {
    username = parts[2];
    password = parts[3];
  }

  return {
    scheme,
    host,
    port,
    ...(username ? { username, password: password ?? "" } : {}),
  };
}

export const proxyKey = (proxy: ProxyEntry | null | undefined): string =>
  `${proxy?.scheme}://${proxy?.host}:${proxy?.port}`;
export const proxyLabel = (proxy: ProxyEntry | null | undefined): string =>
  `${proxy?.host}:${proxy?.port}`;

// Əlavə etmə yoxlaması: səbəb qaytarılır (null = qaydadır)
export function proxyProblem(proxy: ProxyEntry | null | undefined): string | null {
  if (!proxy) return "ünvan tanınmadı — nümunə: 1.2.3.4:8080 və ya socks5://1.2.3.4:1080";
  if (!PROXY_SCHEMES.includes(proxy.scheme)) return `naməlum sxem: ${proxy.scheme}`;
  if ((proxy.scheme === "socks4" || proxy.scheme === "socks5") && proxy.username) {
    return "SOCKS proxy üçün istifadəçi adı/parol Chrome tərəfindən dəstəklənmir — autentifikasiyasız SOCKS və ya HTTP/HTTPS istifadə et";
  }
  if (!isPort(proxy.port)) return "port 1…65535 aralığında olmalıdır";
  if (!isIpv4(proxy.host) && !HOSTNAME.test(proxy.host)) return "host IP ünvanı və ya domen olmalıdır";
  return null;
}

// Köhnə siyahı + yeni qeydlər: təkrarsız (ilk qeyd üstündür), tavan gözlənilir.
// Sıra İSTİFADƏÇİNİN yazdığı sıradır — nə sıralama, nə süzgəc: qeydlərin hansının nə olduğunu
// istifadəçi özü bilir.
export function mergeProxies(
  existing: ProxyEntry[] = [],
  incoming: ProxyEntry[] = [],
  { max = MAX_PROXIES } = {},
): ProxyEntry[] {
  const byKey = new Map<string, ProxyEntry>();
  for (const proxy of [...existing, ...incoming]) {
    if (!proxy) continue;
    const key = proxyKey(proxy);
    if (byKey.has(key)) continue;
    byKey.set(key, proxy);
  }
  return [...byKey.values()].slice(0, max);
}

// ===========================================================================================
// TOPLU ƏLAVƏ (çoxsətirli mətn və ya fayl)
// ===========================================================================================
// Satıcı yüzlərlə proxy verir: `.txt` faylı, JSON, ya sadəcə kopyalanmış blok. Hamısı bir
// funksiyadan keçir ki, mənbə formatı UI-ni maraqlandırmasın.
//
// Nəticə: { proxies, invalid: [{ line, reason }], duplicates }
//   • `invalid` — istifadəçi HANSI sətrin niyə düşmədiyini görsün (səssiz atmaq yanlışdır);
//   • `duplicates` — təkrarlar səssizcə birləşdirilir, sayı isə statusda deyilir.

export interface InvalidProxyLine {
  line: string;
  reason: string;
}

export interface ParsedProxyLines {
  proxies: ProxyEntry[];
  invalid: InvalidProxyLine[];
  duplicates: number;
}

// Bir sətirdən çox qeyd çıxara bilən JSON formaları: satıcılar hər cür yazır.
//   ["1.2.3.4:8080", …]                                  — sətir massivi
//   [{ host, port, protocol|scheme|type, username, password }, …]
//   { proxies: [...] } / { data: [...] } / { list: [...] } / { results: [...] }
const JSON_LISTS = ["proxies", "data", "list", "results", "items"];

function jsonToLines(value: unknown, out: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) jsonToLines(item, out);
    return out;
  }
  if (typeof value === "string" || typeof value === "number") {
    out.push(String(value));
    return out;
  }
  if (!value || typeof value !== "object") return out;

  const record = value as Record<string, unknown>;
  for (const key of JSON_LISTS) {
    if (Array.isArray(record[key])) return jsonToLines(record[key], out);
  }
  // Qeyd obyekti: host/ip + port (+ sxem və giriş məlumatı) — ortaq sətirə çevrilir
  const host = record.host ?? record.ip ?? record.address ?? record.server ?? null;
  const port = record.port ?? record.portNumber ?? null;
  if (host === null || port === null) return out;
  const rawScheme = record.scheme ?? record.protocol ?? record.type
    ?? (Array.isArray(record.protocols) ? record.protocols[0] : null);
  const scheme = cleanScheme(rawScheme);
  const auth = record.username
    ? `${encodeURIComponent(String(record.username))}:${encodeURIComponent(String(record.password ?? ""))}@`
    : "";
  // Sxem ümumiyyətlə verilməyibsə HTTP ehtiyatı işləyir. Açıq yazılmış, amma tanınmayan
  // dəyəri isə sətirdə saxlayırıq ki, parseProxyLines onu rədd etsin; səssizcə HTTP-yə
  // çevirmək istifadəçini tamam başqa protokolla qoşardı.
  const prefix = rawScheme == null && !auth ? "" : `${rawScheme == null ? DEFAULT_SCHEME : scheme ?? String(rawScheme).trim().toLowerCase()}://`;
  out.push(`${prefix}${auth}${host}:${port}`);
  return out;
}

// Mətn → sətirlər. JSON-dursa qeydlər ondan çıxarılır, deyilsə sadə sətir bölgüsü işləyir.
// Bir NEÇƏ mətn (məs. seçilmiş bir neçə fayl) massiv kimi verilə bilər: hər biri AYRI oxunur,
// çünki `.txt` və `.json` birləşdirilsə JSON tanınmayan sətrə çevrilərdi.
export function proxyLines(text: string | string[] | null | undefined): string[] {
  if (Array.isArray(text)) return text.flatMap((part) => proxyLines(part));
  const source = String(text ?? "").trim();
  if (source === "") return [];
  if (source.startsWith("{") || source.startsWith("[")) {
    try { return jsonToLines(JSON.parse(source)); } catch { /* JSON deyil — mətn kimi oxunur */ }
  }
  return source.split(/\r?\n/);
}

export function parseProxyLines(
  text: string | string[] | null | undefined,
  { scheme = DEFAULT_SCHEME, max = MAX_PROXIES }: { scheme?: string; max?: number } = {},
): ParsedProxyLines {
  const proxies: ProxyEntry[] = [];
  const invalid: InvalidProxyLine[] = [];
  const seen = new Set<string>();
  let duplicates = 0;

  for (const raw of proxyLines(text)) {
    const line = String(raw ?? "").trim();
    if (line === "" || line.startsWith("#") || line.startsWith("//")) continue;
    if (proxies.length >= max) break;

    const proxy = parseProxy(line, scheme);
    const problem = proxyProblem(proxy);
    if (problem) {
      // Uzun sətri statusda göstərməyə dəyməz: ilk 40 simvol kifayətdir
      if (invalid.length < 20) invalid.push({ line: line.slice(0, 40), reason: problem });
      continue;
    }
    const key = proxyKey(proxy);
    if (seen.has(key)) { duplicates += 1; continue; }
    seen.add(key);
    proxies.push(proxy as ProxyEntry);
  }
  return { proxies, invalid, duplicates };
}

// ===========================================================================================
// KÖHNƏ İDXAL QEYDLƏRİNİN TƏMİZLƏNMƏSİ (miqrasiya)
// ===========================================================================================
// v1.19.0-a qədər siyahı açıq mənbələrdən idxal olunurdu və `storage.local`-da minlərlə qeyd
// qala bilər. Kod artıq idxal etmir, amma SAXLANC özü təmizlənmir — ona görə köhnə qeydlər
// oxunanda atılır. Nişan: idxal qeydləri mənbə metadatası daşıyır (`source`, `cc`, `uptime`,
// `speed`, `verified`, `alive`); istifadəçinin yazdığı qeyddə bu sahələr heç vaxt olmur.
// Köhnə əl ilə əlavələr `manual: true` daşıyırdı — onlar SAXLANILIR, nişan isə artıq lazım
// deyil (bütün qeydlər şəxsidir) və silinir.
const IMPORT_MARKS = ["source", "cc", "uptime", "speed", "verified", "alive"];

export const isImported = (proxy: ProxyEntry | null | undefined): boolean => {
  if (!proxy) return false;
  const entry = proxy as ProxyEntry;
  return entry.manual !== true
    && IMPORT_MARKS.some((mark) => mark in entry);
};

export function pruneImported(list: ProxyEntry[] | null | undefined): ProxyEntry[] {
  const out: ProxyEntry[] = [];
  for (const proxy of list ?? []) {
    if (!proxy || isImported(proxy)) continue;
    if (proxy.manual === undefined) { out.push(proxy); continue; }
    const { manual: _manual, ...rest } = proxy;
    out.push(rest);
  }
  return out;
}

// Göstərmə sırası: cavab verməyən (ölü nişanlanmış) qeydlər sona keçir, qalanı olduğu kimi.
export function orderProxies(list: ProxyEntry[] | null | undefined): ProxyEntry[] {
  return (list ?? []).filter(Boolean).slice()
    .sort((a, b) => ((a as ProxyEntry).dead ? 1 : 0) - ((b as ProxyEntry).dead ? 1 : 0));
}

// chrome.proxy üçün konfiqurasiya. Bütün sxemlər bir proxy-dən keçir (`singleProxy`),
// yerli ünvanlar isə kənarda saxlanılır — əks halda extension-ın öz `localhost` sorğuları
// (və istifadəçinin yerli serverləri) proxy-ə düşərdi.
export const BYPASS: readonly string[] = Object.freeze(["localhost", "127.0.0.1", "[::1]", "<local>"]);

export interface ChromeProxyConfig {
  mode: "fixed_servers";
  rules: {
    singleProxy: { scheme: ProxyScheme; host: string; port: number };
    bypassList: string[];
  };
}

export function proxyConfig(proxy: ProxyEntry): ChromeProxyConfig {
  const problem = proxyProblem(proxy);
  if (problem) throw new Error(problem);
  return {
    mode: "fixed_servers",
    rules: {
      singleProxy: { scheme: proxy.scheme, host: proxy.host, port: proxy.port },
      bypassList: [...BYPASS],
    },
  };
}

// Popup-da göstərilən ölçü: qoşulma yoxlamasında ÖLÇÜLMÜŞ gecikmə
export const formatPing = (entry: ProxyEntry | null | undefined): string =>
  (typeof entry?.ping === "number" ? `${entry.ping} ms` : "—");

// ===========================================================================================
// BRAUZERİN HƏQİQİ PROXY PARAMETRİ (chrome.proxy.settings.get nəticəsinin oxunuşu)
// ===========================================================================================
// Chrome-un proxy parametri BRAUZER SƏVİYYƏSİNDƏ və PROFİL FAYLINDA saxlanılır: extension onu
// bir dəfə qursa, dəyər extension söndürülüb-açılandan və brauzer yenidən başladıqdan sonra da
// qalır və extension hər aktivləşəndə YENİDƏN tətbiq olunur.
//
// Ona görə iki AYRI həqiqət var və onlar uzlaşdırılmalıdır:
//   • saxlancdaki `activeProxy` — bizim qeydimiz (popup bunu göstərir);
//   • brauzerin parametri     — trafikin həqiqətən nədən keçdiyi.
//
// Bunlar ayrılanda extension brauzeri yararsız qoyur: saxlancda heç nə yoxdur (popup "qoşulu
// deyil" yazır), trafik isə hələ də cavab verməyən proxy-dən keçir — saytlar YALNIZ extension
// söndürüləndə açılır. Məhz bu vəziyyət real brauzerdə yaşandı, ona görə uzlaşdırma
// `resumeProxy()`-nin ilk işidir (bax: background/proxy.ts).
//
// Bu funksiya `chrome`-a toxunmur: nəticəni çağıran oxuyur (worker və popup ayrı-ayrılıqda).

// Trafikin proxy-dən KEÇMƏDİYİ rejimlər (Chrome-un öz adları)
export const DIRECT_MODES: readonly string[] = Object.freeze(["direct", "system", "auto_detect"]);

export interface ProxyControl {
  mode: string | null;
  level: string | null;
  // parametr MƏHZ bu extension-a aiddir — yəni onu buraxmaq bizim əlimizdədir
  ours: boolean;
  // trafik proxy-dən keçir (`fixed_servers`, `pac_script`, `auto_detect` istisna)
  routed: boolean;
}

export function readProxyControl(details: unknown): ProxyControl {
  const d = details as { value?: { mode?: unknown }; levelOfControl?: unknown } | null | undefined;
  const mode = typeof d?.value?.mode === "string" ? d.value.mode : null;
  const level = typeof d?.levelOfControl === "string" ? d.levelOfControl : null;
  return {
    mode,
    level,
    // parametr MƏHZ bu extension-a aiddir — yəni onu buraxmaq bizim əlimizdədir
    ours: level === "controlled_by_this_extension",
    // trafik proxy-dən keçir (`fixed_servers`, `pac_script`, `auto_detect` istisna)
    routed: mode !== null && !DIRECT_MODES.includes(mode),
  };
}

// Extension bu anda bütün brauzer trafikini yönləndirir? Saytların açılmamasının səbəbi
// məhz bu haldır, ona görə həm worker, həm popup eyni yoxlamadan keçir.
export const isRouting = (control: ProxyControl | null | undefined): boolean =>
  Boolean(control?.ours && control?.routed);
