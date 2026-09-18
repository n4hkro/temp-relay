// Poçt qutusunun təhlili — gələn məktublardan BİZƏ LAZIM OLAN aktivasiya kodunu və ya
// keçidini çıxarır. Saf moduldur: `chrome` yoxdur, DOM yoxdur, ona görə node-da test olunur.
//
// İki məsələni həll edir:
//   1. UYĞUNLUQ — bu məktub hazırda işlədiyimiz relay saytına aiddirmi? Siyahıda onlarla
//      başqa məktub ola bilər; hamısını göstərmək istifadəçini çaşdırardı.
//   2. ÇIXARIŞ — aid olan məktubun mətnindən kodu (rəqəm/hərf-rəqəm qrupu) və ya aktivasiya
//      keçidini tapmaq. Poçt HTML-dir: keçidlər href-də, kod isə adətən ayrıca elementdə olur.
//
// Sayt məlumatı burada saxlanılmır: relay deskriptorundan `mailHints()` ilə törədilir,
// mesajların forması isə provider-in api.js faylında normallaşdırılır.

// "Kod" yaxınlığında axtarılan açar sözlər — token yaxınlığında belə söz varsa
// onun endirim kodu yox, aktivasiya kodu olması ehtimalı artır.
export const CODE_KEYWORDS = Object.freeze([
  "code", "kod", "код", "verification", "verify", "confirm", "confirmation",
  "activation", "activate", "aktivasiya", "otp", "pin", "token", "one-time",
  "təsdiq", "doğrulama", "подтвер",
]);

// Aktivasiya keçidinin özündə tez-tez rast gəlinən parçalar
const LINK_HINTS = Object.freeze([
  "confirm", "verify", "verification", "activate", "activation", "token", "code",
  "təsdiq", "aktivasiya", "dogrula", "podtver",
]);

// Reklam/servis keçidləri: saytın özünə aid deyilsə bunlar aktivasiya keçidi sayılmır.
// Qayda: relay domeninə UYĞUN GƏLƏN keçid həmişə saxlanılır — siyahı yalnız
// uyğun gəlməyən keçidlərə tətbiq olunur.
const IGNORED_HOSTS = Object.freeze([
  "facebook.com", "instagram.com", "twitter.com", "x.com", "linkedin.com",
  "youtube.com", "tiktok.com", "wa.me", "t.me", "telegram.org",
  "google.com", "apple.com", "microsoft.com",
  "sendgrid.net", "mailchimp.com", "list-manage.com", "mailgun.org", "mailgun.com",
  "zendesk.com", "intercom.io", "crisp.chat", "helpscout.net", "freshdesk.com",
]);
const IGNORED_PARTS = Object.freeze([
  "unsubscribe", "cdn-cgi/l/email-protection", "/privacy", "/terms", "preferences",
  "list-manage", "tracking.", "/track?", "mailto:",
]);

// Ən azı bu qədər uyğunluq lazımdır ki, məktub "bizim sayt üçündür" sayılsın.
// Yalnız CODE_KEYWORDS (15) kifayət etmir: endirim kodu göndərən bülletenlər də
// "code" sözünü işlədir. Saytın adı və ya domeni tutulmalıdır.
export const MIN_RELEVANCE = 40;

// --- HTML-dən mətn ----------------------------------------------------------------------
// DOMParser extension-da yoxdur (worker), node-da da yoxdur — ona görə sadə regex çevirmə.
// Məqsəd gözəllik deyil, kodun ətrafındakı sözlərin və keçid mətninin qorunmasıdır.

const ENTITY_CODES = Object.freeze({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " });

export function decodeEntities(input) {
  if (typeof input !== "string" || input === "") return "";
  return input.replace(/&(#[xX]?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body) => {
    if (body[0] === "#") {
      const hex = body[1] === "x" || body[1] === "X";
      const code = parseInt(hex ? body.slice(2) : body.slice(1), hex ? 16 : 10);
      // 0x10FFFF-dan yuxarı və surrogat aralığı etibarlı simvol vermir
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return whole;
      return String.fromCodePoint(code);
    }
    const named = ENTITY_CODES[body.toLowerCase()];
    return named === undefined ? whole : named;
  });
}

// style/script blokları tam atılır (orada keçid yoxdur, amma kod kimi oxunan sətirlər var),
// blok elementləri boşluğa çevrilir ki, iki söz birləşməsin.
export function htmlToText(html) {
  if (typeof html !== "string") return "";
  return decodeEntities(
    html
      .replace(/<(script|style|head)[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|tr|li|h[1-6]|table|section|article)\s*>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
  ).replace(/[ \t\r\f\v]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{2,}/g, "\n").trim();
}

// Poçtun həm HTML, həm düz mətn hissəsi gəlir; bodyContentType hansının əsas olduğunu deyir.
export function messageText(message) {
  const body = typeof message?.body === "string" ? message.body : "";
  const asText = typeof message?.text === "string" ? message.text : "";
  if (message?.bodyContentType === "html") return htmlToText(body) + (asText ? "\n" + asText : "");
  return body + (asText ? "\n" + asText : "");
}

// --- sayt məlumatı ----------------------------------------------------------------------
// Relay deskriptorundan törədilir: `mail.fromDomains` / `mail.keywords` yazılmayıbsa
// saytın url-indən və adından alınır. Beləliklə yeni relay əlavə edəndə heç nə yazmaq
// lazım deyil — sadə saytlarda domen özü kifayət edir.

import { registrableDomain } from "./domains.js";
export { registrableDomain } from "./domains.js";

// Domenə uyğunluq: eyni domen və ya onun alt-domeni ("a.b.nexora.example" → "nexora.example").
export function hostMatches(host, domain) {
  const h = String(host ?? "").toLowerCase();
  const d = String(domain ?? "").toLowerCase();
  if (!h || !d) return false;
  return h === d || h.endsWith("." + d);
}

// Domen adından açar söz: "nexora.example" → "nexora". Ümumi sözlər atılır — məsələn
// "Relay Example" saytının "relay" sözü hər məktubda var və heç nəyi ayırmır.
const GENERIC_TOKENS = new Set([
  "relay", "mail", "email", "temp", "register", "signup", "login", "account", "www",
  "app", "site", "example", "test", "demo", "com", "net", "org", "io", "co", "dev",
]);
function tokensOf(value) {
  return String(value ?? "").toLowerCase().split(/[^a-z0-9əğıöşüç]+/i)
    .filter((t) => t.length >= 4 && !GENERIC_TOKENS.has(t));
}

export function mailHints(relay) {
  const declared = isPlain(relay?.mail) ? relay.mail : {};
  const urlHost = safeHost(relay?.url);
  const domains = new Set();
  for (const domain of [...toArray(declared.fromDomains), registrableDomain(urlHost)]) {
    if (domain) domains.add(domain);
  }
  const keywords = new Set();
  for (const domain of domains) for (const token of tokensOf(domain)) keywords.add(token);
  for (const token of tokensOf(relay?.name)) keywords.add(token);
  for (const keyword of toArray(declared.keywords)) {
    if (typeof keyword === "string" && keyword.trim().length >= 3) keywords.add(keyword.trim().toLowerCase());
  }
  return Object.freeze({
    domains: Object.freeze([...domains]),
    keywords: Object.freeze([...keywords]),
  });
}

const isPlain = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
const toArray = (v) => (Array.isArray(v) ? v : []);
function safeHost(url) {
  try { return new URL(String(url ?? "")).hostname.toLowerCase(); } catch { return ""; }
}

// --- uyğunluq ---------------------------------------------------------------------------
// Məktubun bizə aid olub-olmadığını qiymətləndirir. Güclü əlamətlər (göndərənin domeni,
// məktubdakı keçidin sayta getməsi, mövzuda saytın adı) təkbaşına kifayət edir; zəiflər
// (yalnız mətn adı, yalnız "code" sözü) yox.

const WEIGHTS = Object.freeze({
  fromDomain: 60,   // göndərən saytın domenindəndir — ən güclü əlamət
  linkDomain: 45,   // məktubdakı keçid saytın domeninə gedir
  subjectWord: 45,  // mövzuda saytın adı var
  bodyWord: 20,     // mətndə saytın adı var (footer-də də ola bilər)
  subjectCode: 15,  // mövzuda "verification code" kimi söz
  bodyCode: 10,
});

const fromHost = (message) => {
  // "Nexora <no-reply@nexora.example>" və ya sadə "no-reply@nexora.example"
  const raw = String(message?.from ?? "");
  const match = raw.match(/[\w.+-]+@([\w.-]+)/);
  return match ? match[1].toLowerCase() : "";
};

export function relevance(message, hints, links = harvestLinks(message)) {
  let score = 0;
  const reasons = [];
  const host = fromHost(message);
  if (host && toArray(hints?.domains).some((d) => hostMatches(host, d))) {
    score += WEIGHTS.fromDomain;
    reasons.push(`göndərən: ${host}`);
  }
  const linkHosts = new Set(links.map((l) => safeHost(l.url)).filter(Boolean));
  if ([...linkHosts].some((h) => toArray(hints?.domains).some((d) => hostMatches(h, d)))) {
    score += WEIGHTS.linkDomain;
    reasons.push("keçid sayta gedir");
  }
  const subject = String(message?.subject ?? "").toLowerCase();
  const text = (messageText(message) + "\n" + subject).toLowerCase();
  const words = toArray(hints?.keywords);
  if (words.some((w) => subject.includes(w))) {
    score += WEIGHTS.subjectWord;
    reasons.push("mövzuda saytın adı");
  } else if (words.some((w) => text.includes(w))) {
    score += WEIGHTS.bodyWord;
    reasons.push("mətndə saytın adı");
  }
  if (CODE_KEYWORDS.some((w) => subject.includes(w))) {
    score += WEIGHTS.subjectCode;
    reasons.push("mövzuda kod sözü");
  } else if (CODE_KEYWORDS.some((w) => text.includes(w))) {
    score += WEIGHTS.bodyCode;
    reasons.push("mətndə kod sözü");
  }
  return { score, reasons };
}

export const isRelevant = (message, hints, links) => relevance(message, hints, links).score >= MIN_RELEVANCE;

// --- keçidlər ----------------------------------------------------------------------------
// İki mənbə: HTML-dəki href atributları və düz mətndəki çılpaq ünvanlar (bəzi serverlər
// keçidi yalnız mətndə verir). Sonra süzgəc və qiymətləndirmə.

const HREF_RE = /href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
const BARE_URL_RE = /\bhttps?:\/\/[^\s<>"'`)\]}]+/gi;

export function harvestLinks(message) {
  const html = typeof message?.body === "string" && message?.bodyContentType === "html" ? message.body : "";
  const text = messageText(message);
  const seen = new Set();
  const links = [];
  const push = (raw, index, label = "") => {
    const url = cleanUrl(raw);
    if (!url || seen.has(url)) return;
    seen.add(url);
    links.push({ url, index, label });
  };
  let match;
  HREF_RE.lastIndex = 0;
  while ((match = HREF_RE.exec(html)) !== null) {
    const anchor = html.slice(HREF_RE.lastIndex, HREF_RE.lastIndex + 1500).match(/^[^>]*>([\s\S]*?)<\/a\s*>/i);
    push(match[1] ?? match[2] ?? match[3], match.index, anchor ? htmlToText(anchor[1]) : "");
  }
  BARE_URL_RE.lastIndex = 0;
  while ((match = BARE_URL_RE.exec(text)) !== null) push(match[0], match.index);
  return links;
}

// HTML entity-lər (&amp;) açılır, sondaki punktuasiya kəsilir ("url)." → "url")
export function cleanUrl(raw) {
  let url = decodeEntities(String(raw ?? "")).trim();
  if (!/^https?:\/\//i.test(url)) return "";
  url = url.replace(/[)\]}>.,;:!?'"…]+$/, "");
  try { return new URL(url).href; } catch { return ""; }
}

function isIgnored(url, hints) {
  const host = safeHost(url);
  const domains = toArray(hints?.domains);
  const lower = url.toLowerCase();
  if (IGNORED_PARTS.some((part) => lower.includes(part))) return true;
  if (domains.some((d) => hostMatches(host, d))) return false;
  if (IGNORED_HOSTS.some((h) => hostMatches(host, h))) return true;
  // "click.mailer.com", "links.example.io" — klik izləyiciləri aktivasiya keçidi deyil
  if (/^(click|track|tracking|links?|url|go|t|ct|m)\./i.test(host)) return true;
  return false;
}

const QUERY_HINTS = Object.freeze(["token", "code", "key", "hash", "sig", "confirm", "verify", "activate", "activation", "otp", "uid"]);

function linkScore(url, hints, index, total) {
  const host = safeHost(url);
  let score = 0;
  if (toArray(hints?.domains).some((d) => hostMatches(host, d))) score += 40;
  const path = url.toLowerCase();
  const hits = LINK_HINTS.filter((w) => path.includes(w)).length;
  score += Math.min(hits, 2) * 20;
  let query = "";
  try { query = new URL(url).search.toLowerCase(); } catch { /* yuxarıda URL qurulub, bu nadir haldır */ }
  if (QUERY_HINTS.some((w) => query.includes(w + "="))) score += 15;
  if (query.length >= 40) score += 10;
  if (total > 0 && index < total / 2) score += 10;   // aktivasiya düyməsi adətən yuxarıdadır
  return score;
}

// Ən uyğun keçid (və ya null). Süzgəcdən keçənlər qiymətləndirilir, eyni xalda
// məktubda daha əvvəl duran qalır.
export function bestLink(message, hints, links = harvestLinks(message)) {
  const candidates = links
    .filter((l) => !isIgnored(l.url, hints))
    .filter((l) => {
      const parsed = new URL(l.url);
      const path = parsed.pathname.toLowerCase();
      return LINK_HINTS.some((hint) => path.includes(hint))
        || LINK_HINTS.some((hint) => String(l.label ?? "").toLowerCase().includes(hint))
        || [...parsed.searchParams.keys()].some((key) => QUERY_HINTS.includes(key.toLowerCase()));
    })
    .map((l) => ({ url: l.url, score: linkScore(l.url, hints, l.index, links.length), order: l.index }))
    .sort((a, b) => b.score - a.score || a.order - b.order);
  return candidates.length ? candidates[0] : null;
}

// --- aktivasiya kodu ---------------------------------------------------------------------
// Mətn namizəd token-lərə bölünür və hər biri qiymətləndirilir. Qaydalar:
//   • URL-lər əvvəlcədən silinir — keçidin içindəki uzun təsadüfi sətir kod deyil;
//   • yalnız rəqəmlər (4-8) ən güclü namizəddir, hərf+rəqəm qarışığı (6-10) zəifdir;
//   • yaxınlıqda "code/kod/verification…" sözü varsa xal artır;
//   • 1900-2100 arası dəyər il kimi görünür və endirilir ("© 2026" kimi).

export const MIN_CODE_SCORE = 100;
const DIGIT_CODE_RE = /(?<![\w.+-])(\d{4,8})(?![\w-])/g;
const MIXED_CODE_RE = /(?<![\w])([A-Za-z0-9]{6,10})(?![\w])/g;
const KEYWORD_WINDOW = 48;

// URL-ləri eyni uzunluqda boşluqla əvəz edir — indekslər sürüşmür, ona görə
// "yaxınlıqda açar söz" yoxlaması orijinal mətndə aparıla bilər.
function blankUrls(text) {
  return text.replace(BARE_URL_RE, (m) => " ".repeat(m.length));
}

function keywordBonus(text, at, length) {
  const before = text.slice(Math.max(0, at - KEYWORD_WINDOW), at).toLowerCase();
  const after = text.slice(at + length, at + length + KEYWORD_WINDOW).toLowerCase();
  if (CODE_KEYWORDS.some((w) => before.includes(w))) return 50;
  if (CODE_KEYWORDS.some((w) => after.includes(w))) return 30;
  return 0;
}

// HTML-də vurğulanmışdırsa (qalın, başlıq, cədvəl xanası, böyük şrift) kod deməkdir.
function emphasisBonus(html, value) {
  if (!html) return 0;
  const at = html.indexOf(value);
  if (at < 0) return 0;
  const before = html.slice(Math.max(0, at - 120), at).toLowerCase();
  return /<(b|strong|h[1-3]|td|th|span|div|p)[^>]*>\s*(?:<[^>]*>\s*)*$/.test(before) || before.includes("font-size")
    ? 25
    : 0;
}

const isYearLike = (value) => /^\d{4}$/.test(value) && Number(value) >= 1900 && Number(value) <= 2100;

function scoreCode(value, text, html, at, total) {
  const digits = /\d/.test(value);
  const letters = /[A-Za-z]/.test(value);
  let score = digits && !letters ? 100 : digits && letters ? 70 : 0;
  if (!score) return { value, score: 0, at };
  score += keywordBonus(text, at, value.length);
  score += emphasisBonus(html, value);
  if (isYearLike(value)) score -= 60;
  if (/^(\d)\1+$/.test(value)) score -= 20;              // "000000" — çox vaxt placeholder-dir
  if (total > 0) score += Math.round((1 - at / total) * 8);   // yuxarıda duran bir az üstündür
  return { value, score, at };
}

// Boşluq və ya defislə ayrılmış rəqəm qrupları ("123 456", "1234-5678") bir kod sayılır.
// Yanlış müsbət hallar (telefon nömrəsi, tarix) çox olduğu üçün belə namizəd yalnız
// yaxınlığında açar söz varsa qəbul edilir.
const GROUPED_CODE_RE = /(?<![\w.])(\d{3,4})[\s-](\d{3,4})(?![\w])/g;

// Ən güclü kod namizədi (və ya null). Eyni xalda mətndə birinci duran qalır.
export function findCode(message) {
  const html = typeof message?.body === "string" && message?.bodyContentType === "html" ? message.body : "";
  // Qeyri-boşluq sərhədi subject sonundakı kodu body əvvəlindəki kodla birləşdirmir.
  const text = blankUrls([String(message?.subject ?? ""), messageText(message)].filter(Boolean).join("\n|\n"));
  const candidates = [];
  const spans = [];   // qruplu namizədin tutduğu aralıq — orada ayrıca rəqəm axtarılmır
  let match;

  GROUPED_CODE_RE.lastIndex = 0;
  while ((match = GROUPED_CODE_RE.exec(text)) !== null) {
    spans.push([match.index, match.index + match[0].length]);
    if (keywordBonus(text, match.index, match[0].length) === 0) continue;
    candidates.push(scoreCode(match[1] + match[2], text, html, match.index, text.length));
  }

  const covered = (from, to) => spans.some(([start, end]) => from < end && to > start);
  for (const [re, mixed] of [[DIGIT_CODE_RE, false], [MIXED_CODE_RE, true]]) {
    re.lastIndex = 0;
    while ((match = re.exec(text)) !== null) {
      const value = match[1];
      if (mixed && !(/\d/.test(value) && /[A-Za-z]/.test(value))) continue;
      if (covered(match.index, match.index + match[0].length)) continue;
      candidates.push(scoreCode(value, text, html, match.index, text.length));
    }
  }

  const best = candidates
    .filter((c) => c.score >= MIN_CODE_SCORE)
    .sort((a, b) => b.score - a.score || a.at - b.at)[0];
  return best ? { value: best.value, score: best.score } : null;
}

// --- məktub səviyyəsi --------------------------------------------------------------------
// Provider-in normallaşdırdığı mesaj forması:
//   { id, date, from, subject, body, bodyContentType ("html" → HTML), text? }
// Bu modul yalnız bu formanı oxuyur — hansı saytın hansı API-si olduğu burada bilinmir.

// Bir məktubdan nəticə: uyğun deyilsə null. `code` və `link` birlikdə də ola bilər —
// istifadəçiyə hansı lazımdırsa onu seçir, worker isə kodu üstün tutur.
export function extractFromMessage(message, hints) {
  const links = harvestLinks(message);
  const { score, reasons } = relevance(message, hints, links);
  if (score < MIN_RELEVANCE) return null;
  const code = findCode(message);
  const link = bestLink(message, hints, links);
  if (!code && !link) return null;
  return {
    code: code?.value ?? null,
    link: link?.url ?? null,
    score,
    reasons,
    subject: String(message?.subject ?? "").trim() || "(mövzusuz)",
    from: String(message?.from ?? "").trim(),
    at: Date.now(),
  };
}

// Uyğunluğu keçən aktivasiya məktublarından ən təzəsi üstün gəlir: yenidən göndərilmiş
// kod köhnə məktubun daha çox açar söz daşımasına görə itirilməməlidir.
export function pickFromMessages(messages, hints) {
  const list = toArray(messages);
  const dated = list
    .map((message) => ({ message, result: extractFromMessage(message, hints) }))
    .filter((entry) => entry.result);
  if (!dated.length) return null;
  dated.sort((a, b) => time(b.message) - time(a.message) || b.result.score - a.result.score);
  return dated[0].result;
}

const time = (message) => {
  const parsed = Date.parse(message?.date ?? "");
  return Number.isFinite(parsed) ? parsed : 0;
};

// Məktub siyahısını provider-dən gələn xam formada oxuyub normallaşdırır: yalnız lazımi
// sahələr qalır, tarix sıralanır (təzə öndə), təkrar id-lər atılır. Worker dedupikasiyanı
// `id` üzərində aparır, ona görə id-nin olması vacibdir — yoxdursa mövzu+tarix əvəz edir.
export function normalizeMessages(raw) {
  const envelope = Array.isArray(raw) ? raw : isPlain(raw) && Array.isArray(raw.data) ? raw.data : [];
  const seen = new Set();
  const out = [];
  for (const item of envelope) {
    if (!isPlain(item)) continue;
    const id = item.id === undefined || item.id === null ? `${item.subject ?? ""}|${item.date ?? ""}` : String(item.id);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      date: typeof item.date === "string" ? item.date : String(item.date ?? ""),
      from: typeof item.from === "string" ? item.from : "",
      subject: typeof item.subject === "string" ? item.subject : "",
      body: typeof item.body === "string" ? item.body : "",
      bodyContentType: typeof item.bodyContentType === "string" ? item.bodyContentType.toLowerCase() : "text",
      text: typeof item.text === "string" ? item.text : "",
    });
  }
  return out.sort((a, b) => time(b) - time(a));
}
