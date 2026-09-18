// ============================================================================
//  temp.tf API PROTOKOLU — saf modul (chrome yoxdur, DOM yoxdur)
// ============================================================================
// Saytın öz client kodundan (/​_next/​static/​chunks/​app/​page-*.js) oxunub və curl ilə
// yoxlanılıb:
//
//   GET /api/account?providers=<vergül>&dot=<0|1>&plus=<0|1>
//       200 → { email: "user+alias@gmail.com" }
//       400 → { error: "…", email: null }        (qayda pozuntusu)
//       429 → Retry-After başlığı ilə            (limit)
//       200 → { email: null }                    (naməlum provider)
//   POST /api/check { email, wait } → { data: [məktub…], totalReceived }   (poçt qutusu)
//       məktub: { id, date, from, subject, body, bodyContentType ("html" → HTML),
//                 attachments: […], inlineCids: {…} }
//       wait=true → server cavabı ~8 saniyə saxlayır (long-poll), wait=false → dərhal qaytarır
//
// Heç biri cookie, session və ya açar tələb ETMİR — ona görə ünvanı service worker-də
// birbaşa fetch ilə almaq olur və temp.tf tabını açmağa ehtiyac qalmır.
//
// Bu fayl yalnız protokoldur: sorğunu qurur, cavabı ünvana və ya aydın xəta mətninə
// çevirir. Qaydalar saytın öz qaydalarıdır (validate) — server də eynisini yoxlayır,
// amma erkən yoxlama popup-ı əvvəlcədən bilə biləcəyi uğursuz sorğunu göndərməkdən saxlayır.

import { normalizeMessages, type NormalizedMessage } from "../../../shared/extract";
import { type FieldChoice, type OptionValues } from "../../../shared/options";
import {
  type FetchAddressArgs,
  type FetchMessagesArgs,
  type RequestMessagesOptions,
  type RequestOptions,
} from "../../contract";

export const API_BASE = "https://temp.tf/api";

// Saytın öz ardıcıllığı: sorğudakı providers siyahısı bu sırada qurulur.
// `value` API-yə göndərilən token, `label` istifadəçiyə göstərilən domendir.
export const PROVIDER_CHOICES = Object.freeze([
  Object.freeze({ value: "outlook", label: "outlook.com" }),
  Object.freeze({ value: "hotmail", label: "hotmail.com" }),
  Object.freeze({ value: "gmail", label: "gmail.com" }),
  Object.freeze({ value: "high.edu.pl", label: "high.edu.pl" }),
]) as FieldChoice[];
const PROVIDER_ORDER = PROVIDER_CHOICES.map((c) => c.value);
const SYNTAX_PROVIDERS = new Set(["gmail", "outlook", "hotmail"]);

// Sorğu cavabları JSON-da xam gəlir — qəbuldan əvvəl unknown kimi daraldılır
const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

export const DEFAULT_VALUES: OptionValues = Object.freeze({
  providers: Object.freeze({ outlook: false, hotmail: false, gmail: true, "high.edu.pl": false }),
  dot: false,
  plus: true,
});

// Saytın qaydaları (mənbə kodundakı eN/ek funksiyaları ilə eyni). Xəta mətni və ya null.
// Boş siyahı yoxlanılmır — onu sxemdəki min:1 qaydası tutur.
export function validate(values: OptionValues): string | null {
  const providers: unknown = values?.providers;
  const flags: Record<string, unknown> = isRecord(providers) ? providers : {};
  const chosen = PROVIDER_ORDER.filter((name) => flags[name] === true);
  const eduOnly = chosen.length === 1 && chosen[0] === "high.edu.pl";
  const dotOnly = values?.dot === true && values?.plus !== true;

  if (!eduOnly && !values?.dot && !values?.plus
      && chosen.some((name) => SYNTAX_PROVIDERS.has(name)) && !chosen.includes("high.edu.pl")) {
    return "Gmail, Outlook və Hotmail üçün Dot və ya Plus işarələnməlidir";
  }
  if (!eduOnly && dotOnly && !chosen.includes("gmail")) {
    return "Dot yalnız Gmail ilə işləyir — Plus-ı işarələyin və ya Gmail seçin";
  }
  return null;
}

// Sorğunun parametr hissəsi. Saytın məntiqi ilə eyni:
//   • yalnız high.edu.pl seçilibsə dot/plus məcburi 0-dır (edu ünvanlarında sintaksis yoxdur)
//   • dot-only rejimində və Gmail seçilibsə siyahı "gmail"-ə daralır (dot yalnız Gmail-ə aiddir)
export function accountQuery(values: OptionValues): string {
  const providers: unknown = values?.providers;
  const flags: Record<string, unknown> = isRecord(providers) ? providers : {};
  const chosen = PROVIDER_ORDER.filter((name) => flags[name] === true);
  const eduOnly = chosen.length === 1 && chosen[0] === "high.edu.pl";
  const dotOnly = values?.dot === true && values?.plus !== true;
  const list = dotOnly && chosen.includes("gmail") ? ["gmail"] : chosen;

  return new URLSearchParams({
    providers: list.join(","),
    dot: eduOnly || !values?.dot ? "0" : "1",
    plus: eduOnly || !values?.plus ? "0" : "1",
  }).toString();
}

export const accountUrl = (values: OptionValues): string => `${API_BASE}/account?${accountQuery(values)}`;

// 429 və digər uğursuz statuslar üçün ORTAQ xəta mətni — istifadəçiyə göstərilir:
// server öz mesajını veribsə onu saxlayırıq (saytın dəqiq sözləridir), 429-da gözləmə müddəti də.
function throwForResponse(response: Response, body: unknown): void {
  if (response.status === 429) {
    const retry = response.headers?.get?.("Retry-After");
    throw new Error(retry ? `çox sorğu göndərilib, ${retry} saniyə gözləyin` : "çox sorğu göndərilib, bir az gözləyin");
  }
  if (!response.ok) {
    const detail = isRecord(body) && typeof body.error === "string" && body.error ? body.error : "";
    throw new Error(detail || `server ${response.status} cavabı qaytardı`);
  }
}

// Server HTML qaytarsa da (Cloudflare səhifəsi, boş cavab) JSON oxunuşu xəta atmasın
const readJson = (response: Response): Promise<unknown> =>
  response.json().catch(() => ({})) as Promise<unknown>;

// HTTP cavabını ünvana çevirir.
export async function requestAccount(
  values: OptionValues,
  { signal, fetchImpl = fetch }: RequestOptions = {},
): Promise<string> {
  const response = await fetchImpl(accountUrl(values), { signal, headers: { Accept: "application/json" } });
  const body = await readJson(response);
  throwForResponse(response, body);
  const email = isRecord(body) && typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!email.includes("@")) throw new Error("server etibarlı ünvan qaytarmadı");
  return email;
}

// Deskriptorun fetchAddress sahəsi bunu işlədir (service worker-də çağrılır)
export const fetchAddress = ({ values, signal }: FetchAddressArgs): Promise<string> =>
  requestAccount(values, { signal });

// --- poçt qutusu --------------------------------------------------------------------------

export const CHECK_URL = `${API_BASE}/check`;

// Qutudakı məktubları oxuyur və extract.ts-in gözlədiyi formaya salır.
// `wait: true` — sayt cavabı ~8 saniyə saxlayır, məktub gələn kimi qaytarır (long-poll).
// Buna görə saniyədə bir sorğu göndərməyə ehtiyac qalmır: bir sorğu ≈ 8 saniyə gözləmə.
//
// QAYDALAR (saytın öz client kodundan oxunub, curl ilə yoxlanılıb):
//   • cavabdakı `totalReceived` saytın ÜMUMİ sayğacıdır, bu qutuya aid DEYİL —
//     "yeni məktub gəldi" əlaməti kimi işlədilməməlidir; worker təkrarı id ilə yoxlayır;
//   • cavab həm { data: […] }, həm çılpaq massiv ola bilər — normalizeMessages ikisini də oxuyur;
//   • boş massiv "qutu boşdur" deməkdir, xəta deyil.
export async function requestMessages(
  email: string,
  { wait = true, signal, fetchImpl = fetch }: RequestMessagesOptions = {},
): Promise<NormalizedMessage[]> {
  const response = await fetchImpl(CHECK_URL, {
    method: "POST",
    signal,
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ email, wait }),
  });
  const body = await readJson(response);
  throwForResponse(response, body);
  return normalizeMessages(body);
}

// Deskriptorun fetchMessages sahəsi bunu işlədir
export const fetchMessages = ({ email, wait, signal }: FetchMessagesArgs): Promise<NormalizedMessage[]> =>
  requestMessages(email, { wait, signal });
