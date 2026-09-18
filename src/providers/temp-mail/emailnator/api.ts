// ============================================================================
//  emailnator.com API PROTOKOLU — saf modul (chrome yoxdur, DOM yoxdur)
// ============================================================================
// Saytın öz client kodundan (/_next/static/chunks/*.js → `api` obyekti) oxunub və curl ilə
// yoxlanılıb. Heç bir endpoint cookie, CSRF açarı və ya session tələb ETMİR — ona görə
// rejim API-dir: emailnator tabı AÇILMIR.
//
//   POST /api/generate-email   { ids: [1|2|3|8, …] }
//       200 → { status: "success", email, type, email_type_id }
//       403 → { status: "error", code: "NO_ACCESSIBLE_TYPES", message, available_types }
//       422 → { message: "The selected ids.0 is invalid.", errors: {…} }
//   POST /api/message-list     { email, limit }
//       200 → { status: "success", messages: [{ id, from, subject, timestamp, time_ago,
//                                               locked? }], message_count, message_limit }
//       404 → { status: "error", message: "Email not found" }   (ünvan hovuzda yoxdur)
//       422 → { message: "The email field must be a valid email address.", errors: {…} }
//   GET  /api/message/<id>
//       200 → { id, from, subject, date (unix saniyə), content (HTML), has_attachments }
//       locked məktubda content boşdur: "Upgrade to Premium…" (24 saatdan köhnə məktublar)
//
// İKİ FƏRQ temp.tf-dən (bax: aşağıdaki bölmələr):
//   1. siyahı GÖVDƏSİZ gəlir — hər məktubun HTML-i ayrıca sorğu ilə oxunur (keşlənir);
//   2. sayt long-poll DƏSTƏKLƏMİR — `wait` burada emulyasiya olunur, yoxsa worker-in
//      izləmə döngüsü fasiləsiz sorğu göndərərdi.
//
// Bu fayl yalnız protokoldur: sorğunu qurur, cavabı ünvana / məktub siyahısına və ya aydın
// xəta mətninə çevirir. `fetchImpl` testdə stub-lanır — production-da `fetch`-dir.

import { normalizeMessages, type NormalizedMessage } from "../../../shared/extract";
import { type FieldChoice, type OptionValues } from "../../../shared/options";
import {
  type FetchAddressArgs,
  type FetchMessagesArgs,
  type RequestMessagesOptions,
  type RequestOptions,
} from "../../contract";

export const API_BASE = "https://www.emailnator.com/api";

const JSON_HEADERS = Object.freeze({ Accept: "application/json", "Content-Type": "application/json" });
const isPlain = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

// --- seçimlər ----------------------------------------------------------------------------
// Saytın öz `EMAIL_TYPES` cədvəli: hansı ünvan növü hansı id ilə sorğulanır.
// Etiketlər saytın chip mətnləridir ki, popup ilə sayt bir-birinə uyğun görünsün.

export const TYPE_IDS: Record<string, number> = Object.freeze({ domain: 1, plusGmail: 2, dotGmail: 3, googleMail: 8 });

export const TYPE_CHOICES = Object.freeze([
  Object.freeze({ value: "domain", label: "Domain" }),
  Object.freeze({ value: "plusGmail", label: "+Gmail" }),
  Object.freeze({ value: "dotGmail", label: ".Gmail" }),
  Object.freeze({ value: "googleMail", label: "GoogleMail" }),
]) as FieldChoice[];

const TYPE_ORDER = TYPE_CHOICES.map((c) => c.value);

// Default yalnız `.Gmail`-dir: nöqtəli variant əsl gmail.com ünvanıdır, ona görə qeydiyyat
// formaları onu ən çox qəbul edir. `+Gmail` alias-ları bir çox sayt kəsir, `Domain` isə
// disposable domen siyahılarında olur.
export const DEFAULT_VALUES: OptionValues = Object.freeze({
  types: Object.freeze({ domain: false, plusGmail: false, dotGmail: true, googleMail: false }),
});

// Sorğunun `ids` massivi — saytın öz ardıcıllığı ilə. Boş siyahını sxemdəki min:1 tutur
// (server də 403 NO_ACCESSIBLE_TYPES qaytarır).
export const typeIds = (values: OptionValues): number[] => {
  const types: unknown = values?.types;
  const flags: Record<string, unknown> = isPlain(types) ? types : {};
  return TYPE_ORDER.filter((name) => flags[name] === true).map((name) => TYPE_IDS[name]);
};

// --- cavabın oxunuşu ---------------------------------------------------------------------

// Server HTML qaytarsa da (Cloudflare səhifəsi, boş cavab) JSON oxunuşu xəta atmasın
const readJson = (response: Response): Promise<unknown> =>
  response.json().catch(() => ({})) as Promise<unknown>;

// Saytın öz mesajı varsa istifadəçiyə onu göstəririk — dəqiq səbəbi o bilir
function serverMessage(body: unknown): string | null {
  for (const key of ["message", "error"]) {
    const value = isPlain(body) ? body[key] : undefined;
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

// Uğursuz statuslar üçün ORTAQ xəta mətni. Hamısı istifadəçiyə göstərilir, ona görə
// mətn onun dilindədir; worker mesajın əvvəlinə saytın adını yazır.
function throwForResponse(response: Response, body: unknown): void {
  if (response.status === 429) {
    const retry = response.headers?.get?.("Retry-After");
    throw new Error(retry ? `çox sorğu göndərilib, ${retry} saniyə gözləyin` : "çox sorğu göndərilib, bir az gözləyin");
  }
  if (response.status === 404) {
    // /api/message-list → "Email not found": ünvan saytın hovuzundan çıxıb (vaxtı bitib)
    throw new Error(serverMessage(body) ?? "ünvan saytın hovuzunda tapılmadı — yeni ünvan alın");
  }
  if (!response.ok) throw new Error(serverMessage(body) ?? `server ${response.status} cavabı qaytardı`);
  // 200 ilə də { status: "error" } gələ bilər — saytın öz client kodu da bunu yoxlayır
  if (isPlain(body) && body.status === "error") throw new Error(serverMessage(body) ?? "sayt sorğunu qəbul etmədi");
}

// --- ünvan -------------------------------------------------------------------------------

export const GENERATE_URL = `${API_BASE}/generate-email`;

export async function requestAccount(
  values: OptionValues,
  { signal, fetchImpl = fetch }: RequestOptions = {},
): Promise<string> {
  const response = await fetchImpl(GENERATE_URL, {
    method: "POST",
    signal,
    headers: JSON_HEADERS,
    body: JSON.stringify({ ids: typeIds(values) }),
  });
  const body = await readJson(response);
  throwForResponse(response, body);
  const email = isPlain(body) && typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!email.includes("@")) throw new Error("server etibarlı ünvan qaytarmadı");
  return email;
}

// Deskriptorun fetchAddress sahəsi bunu işlədir (service worker-də çağrılır)
export const fetchAddress = ({ values, signal }: FetchAddressArgs): Promise<string> =>
  requestAccount(values, { signal });

// --- poçt qutusu -------------------------------------------------------------------------

export const MESSAGE_LIST_URL = `${API_BASE}/message-list`;
export const messageUrl = (id: string | number): string => `${API_BASE}/message/${encodeURIComponent(id)}`;

export const LIST_LIMIT = 20;      // saytın öz sorğusundakı dəyər
export const MAX_BODIES = 10;      // pulsuz hesabın message_limit-i — bundan çoxu oxunmur

// `wait` emulyasiyası: sayt long-poll vermir, öz inbox səhifəsini 10 saniyədə bir yeniləyir.
// Worker-in döngüsü isə cavab gələn kimi yenidən sorğu göndərir, yəni pauza provider-dən
// gəlməlidir. Pəncərə INBOX_POLL_TIMEOUT_MS-dən (25 s) xeyli kiçikdir: gövdə sorğuları da
// həmin limitin içinə sığmalıdır.
export const WAIT_WINDOW_MS = 12000;
export const WAIT_GAP_MS = 6000;

const BODY_CACHE_LIMIT = 60;       // eyni məktubun HTML-i bir dəfə oxunur
const ADDRESS_MEMORY_LIMIT = 8;    // "bu ünvanda əvvəl hansı id-lər vardı" yaddaşı

// Modul səviyyəsindəki keş worker-in ömrü boyu yaşayır; worker sönəndə itir və bu, doğru
// davranışdır — yenidən qalxanda ilk sorğu qutunu olduğu kimi oxuyur.
const bodyCache = new Map<string, string>();
const lastIds = new Map<string, Set<string>>();

function put<K, V>(map: Map<K, V>, key: K, value: V, limit: number): void {
  map.delete(key);                                     // yenidən yazılan açar sıranın sonuna keçir
  map.set(key, value);
  while (map.size > limit) {
    const oldest = map.keys().next();
    if (oldest.done) break;
    map.delete(oldest.value);
  }
}

// Vaxt limitini və "Dayandır"-ı gözləyən pauza: signal düşəndə dərhal AbortError verir.
export function sleep(ms: number, signal?: AbortSignal | null): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(aborted());
      return;
    }
    const finish = (fn: (arg?: unknown) => void, arg?: unknown): void => {
      clearTimeout(timer);
      signal?.removeEventListener?.("abort", onAbort);
      fn(arg);
    };
    const onAbort = (): void => finish(reject, aborted());
    const timer = setTimeout(() => finish(resolve as (arg?: unknown) => void), ms);
    signal?.addEventListener?.("abort", onAbort, { once: true });
  });
}

// AbortError adı shared/errors.ts tərəfindən tanınır: gözlənilən hal kimi warn olur
function aborted(): Error {
  const e = new Error("sorğu dayandırıldı");
  e.name = "AbortError";
  return e;
}

// Xam məktub qeydi — saytın /message-list cavabındakı forma
interface MessageEntry {
  id: unknown;
  timestamp?: unknown;
  from?: unknown;
  subject?: unknown;
  locked?: unknown;
}

const isEntry = (v: unknown): v is MessageEntry => isPlain(v);

// Siyahı sorğusu — XAM zərfdəki `messages` massivi
export async function listMessages(
  email: string,
  { signal, fetchImpl = fetch }: RequestOptions = {},
): Promise<MessageEntry[]> {
  const response = await fetchImpl(MESSAGE_LIST_URL, {
    method: "POST",
    signal,
    headers: JSON_HEADERS,
    body: JSON.stringify({ email, limit: LIST_LIMIT }),
  });
  const body = await readJson(response);
  throwForResponse(response, body);
  return isPlain(body) && Array.isArray(body.messages) ? body.messages.filter(isEntry) : [];
}

// Oxunabilən məktublar: `locked` olanların gövdəsi boşdur (24 saatdan köhnə → "Upgrade to
// Premium"), ona görə onlara sorğu göndərilmir. Siyahı saytda təzədən köhnəyə sıralanıb.
const readable = (entries: MessageEntry[]): MessageEntry[] =>
  entries
    .filter((e) => e.locked !== true && e.id !== undefined && e.id !== null && String(e.id) !== "")
    .slice(0, MAX_BODIES);

// Bu ünvanda əvvəlki sorğudan sonra yeni məktub görünübmü? Ünvan ilk dəfə oxunursa "hə"
// sayılır: pauza vermək mənasızdır, qutu olduğu kimi qaytarılmalıdır.
function hasFresh(email: string, entries: MessageEntry[]): boolean {
  const known = lastIds.get(email);
  if (!known) return true;
  return entries.some((e) => !known.has(String(e.id)));
}

const remember = (email: string, entries: MessageEntry[]): void =>
  put(lastIds, email, new Set(entries.map((e) => String(e.id))), ADDRESS_MEMORY_LIMIT);

interface BodyResult {
  content: string;
  cacheable: boolean;
}

// Bir məktubun HTML gövdəsi. Silinmiş/vaxtı bitmiş məktub boş gövdə kimi keşlənir ki,
// hər sorğuda təkrar cəhd edilməsin.
async function requestBody(
  id: string | number,
  { signal, fetchImpl }: { signal?: AbortSignal; fetchImpl: typeof fetch },
): Promise<BodyResult> {
  const response = await fetchImpl(messageUrl(id), { signal, headers: { Accept: "application/json" } });
  const body = await readJson(response);
  if (response.status === 404 || response.status === 410) return { content: "", cacheable: true };
  throwForResponse(response, body);
  const content = isPlain(body) && typeof body.content === "string" ? body.content : "";
  return { content, cacheable: content.trim().length > 0 };
}

// unix saniyə → ISO tarix. extract.ts tarixi Date.parse ilə oxuyur, xam rəqəm ona çatmır.
function isoDate(value: unknown): string {
  const seconds = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return "";
  const date = new Date(seconds * 1000);
  return Number.isFinite(date.getTime()) ? date.toISOString() : "";
}

// Siyahıdakı hər məktuba gövdəni qoşur: mövzu və göndərən siyahıdan, HTML ayrı sorğudan.
async function withBodies(
  email: string,
  entries: MessageEntry[],
  { signal, fetchImpl }: { signal?: AbortSignal; fetchImpl: typeof fetch },
): Promise<NormalizedMessage[]> {
  const out: NormalizedMessage[] = [];
  for (const entry of entries) {
    const id = String(entry.id);
    const cacheKey = `${email}|${id}`;
    let content = bodyCache.get(cacheKey);
    if (content === undefined) {
      const body = await requestBody(id, { signal, fetchImpl });
      content = body.content;
      if (body.cacheable) put(bodyCache, cacheKey, content, BODY_CACHE_LIMIT);
    }
    out.push({
      id,
      date: isoDate(entry.timestamp),
      from: typeof entry.from === "string" ? entry.from : "",
      subject: typeof entry.subject === "string" ? entry.subject : "",
      body: content,
      bodyContentType: "html",
      text: "",
    });
  }
  return out;
}

export interface EmailnatorMessagesOptions extends RequestMessagesOptions {
  waitWindowMs?: number;
  gapMs?: number;
  sleepImpl?: typeof sleep;
  nowImpl?: typeof Date.now;
}

// Qutunun oxunması. `wait: true` olanda yeni məktub görünənə qədər (ən çox WAIT_WINDOW_MS)
// gözlənilir — long-poll-un provider tərəfindən emulyasiyası. `wait: false` dərhal qaytarır:
// worker-in ilk sorğusu belədir ki, o ölü ikən gələn məktub tez tapılsın.
export async function requestMessages(
  email: string,
  {
    wait = true,
    signal,
    fetchImpl = fetch,
    waitWindowMs = WAIT_WINDOW_MS,
    gapMs = WAIT_GAP_MS,
    sleepImpl = sleep,
    nowImpl = Date.now,
  }: EmailnatorMessagesOptions = {},
): Promise<NormalizedMessage[]> {
  // Pəncərə mütləq vaxtdır: gövdə sorğuları ilə birlikdə worker-in 25 saniyəlik limitinə
  // sığmalıdır. `<` (bərabər deyil) o deməkdir ki, pəncərənin son anında yeni sorğu açılmır.
  const until = nowImpl() + (wait ? waitWindowMs : 0);
  let entries = readable(await listMessages(email, { signal, fetchImpl }));
  while (!hasFresh(email, entries) && nowImpl() + gapMs < until) {
    await sleepImpl(gapMs, signal);
    entries = readable(await listMessages(email, { signal, fetchImpl }));
  }
  remember(email, entries);
  return normalizeMessages(await withBodies(email, entries, { signal, fetchImpl }));
}

// Deskriptorun fetchMessages sahəsi bunu işlədir
export const fetchMessages = ({ email, wait, signal }: FetchMessagesArgs): Promise<NormalizedMessage[]> =>
  requestMessages(email, { wait, signal });
