// Poçt qutusu izləməsinin vəziyyət modeli və siyasəti.
//
// Niyə ayrı fayl: izləmə döngüsü worker-dədir və `chrome`-a toxunur (background/inbox.ts),
// ona görə node-da test oluna bilmir. Vəziyyətin ÖZÜ isə saf məlumatdır — hansı mərhələ,
// tapılan kod/keçid, istifadəçiyə göstərilən mətn. Burada saxlanılır ki, worker, popup və
// testlər eyni formanı oxusun, mətnlər iki yerdə təkrarlanmasın.
//
// Vəziyyət chrome.storage.session-da "inbox" açarı ilə saxlanılır (shared/state.ts): worker
// sönsə də popup onu göstərir, worker yenidən işə düşəndə isə izləməni davam etdirir.

import type { ExtractResult } from "./extract";

export const InboxPhase = Object.freeze({
  watching: "watching", // poçt gözlənilir
  found: "found",       // uyğun məktubdan kod və ya keçid çıxarıldı
  empty: "empty",       // gözləmə müddəti bitdi — bu sayta aid məktub gəlmədi
  error: "error",       // qutu oxuna bilmədi (səbəb `message` sahəsindədir)
} as const);
export type InboxPhaseValue = (typeof InboxPhase)[keyof typeof InboxPhase];

export interface InboxState {
  phase: InboxPhaseValue;
  address: string | null;
  code: string | null;
  link: string | null;
  subject: string;
  from: string;
  reasons: string[];
  checked: number;
  message: string | null;
  started: number;
  updated: number;
}

// --- siyasət -------------------------------------------------------------------------------
// Bir sorğunun limiti provider-in gözləmə pəncərəsindən böyük olmalıdır: temp.tf /api/check
// sorğusunu wait:true ilə ~8 saniyə saxlayır, emailnator isə long-poll vermədiyi üçün pauzanı
// öz içində verir (~12 saniyə + gövdə sorğuları). Ümumi gözləmə adi qeydiyyat üçün kifayətdir.
export const INBOX_DEADLINE_MS = 5 * 60 * 1000;  // nə qədər gözlənilir (started-dan sayılır)
export const INBOX_POLL_TIMEOUT_MS = 25000;      // bir uzun sorğunun limiti
export const INBOX_RETRY_MS = 4000;              // xəta sonrası təkrar cəhdə qədər fasilə
export const INBOX_KEEPALIVE_MS = 20000;         // worker-in sönməməsi üçün nəbz aralığı
export const INBOX_STALE_MS = 75000;             // bundan köhnə "watching" dayandı sayılır

// --- vəziyyətin qurulması ------------------------------------------------------------------
// Bütün dəyişikliklər YENİ obyekt qaytarır: saxlancdakı köhnə forma korlanmır və popup
// storage.onChanged ilə təzə dəyəri görür.

// İzləmə başlayır. `started` sonradan dəyişmir — worker yenidən işə düşəndə eyni son müddət
// qalır, yəni izləmə sonsuza qədər uzanmır.
export function watchingInbox(
  address: string | null,
  { started = Date.now(), checked = 0 }: { started?: number; checked?: number } = {},
): InboxState {
  return {
    phase: InboxPhase.watching,
    address,
    code: null,
    link: null,
    subject: "",
    from: "",
    reasons: [],
    checked,
    message: null,
    started,
    updated: Date.now(),
  };
}

// Tapıntı: hit — shared/extract.ts → extractFromMessage/pickFromMessages nəticəsi
export function foundInbox(
  inbox: InboxState | null | undefined,
  // Tapıntı qismən də ola bilər — oxunmayan sahələr boş dəyərlə əvəzlənir
  // (testlər də natamam hit ötürür; real hit-lər tam ExtractResult-dur).
  hit: Partial<ExtractResult> | null | undefined,
  { checked = inbox?.checked ?? 0 }: { checked?: number } = {},
): InboxState {
  const previous = (inbox ?? {}) as InboxState;
  return {
    ...previous,
    phase: InboxPhase.found,
    code: hit?.code ?? null,
    link: hit?.link ?? null,
    subject: hit?.subject ?? "",
    from: hit?.from ?? "",
    reasons: Array.isArray(hit?.reasons) ? hit.reasons : [],
    message: null,
    checked,
    updated: Date.now(),
  };
}

// Neçə məktub yoxlanıldı — popup-da "izlənilir" mətni üçün
export const progressInbox = (inbox: InboxState, checked: number): InboxState =>
  ({ ...inbox, checked, updated: Date.now() });

// Gözləmə bitdi və ya qutu oxunmadı: səbəb istifadəçiyə mətn kimi çatır
export const closedInbox = (
  inbox: InboxState,
  phase: InboxPhaseValue,
  message: string | null,
): InboxState => ({ ...inbox, phase, message, updated: Date.now() });

// --- göstərmə ------------------------------------------------------------------------------
// Worker sönsə izləmə döngüsü də ölür, amma saxlancdakı vəziyyət "watching" qalır. Köhnəlmiş
// vəziyyəti istifadəçiyə "hələ də gözləyir" kimi göstərmək yalan olardı: nəbz (updated)
// dayanıbsa popup bunu açıq yazır və mövcud ünvanla təkrar yoxlamanı təklif edir.
export const inboxStale = (
  inbox: InboxState | null | undefined,
  now: number = Date.now(),
): boolean =>
  inbox?.phase === InboxPhase.watching && now - (inbox.updated ?? 0) > INBOX_STALE_MS;

// Tapıntının növü: popup panelinin başlığı, status mətni və bildiriş EYNİ sözü işlədir ki,
// üç yerdə təkrar yazılmasın. `found` mərhələsində həmişə ya kod, ya keçid olur (extract.ts
// ikisi də yoxdursa tapıntı qaytarmır), ona görə null yalnız qoruyucu haldır.
export function inboxLabel(inbox: InboxState | null | undefined): string | null {
  if (inbox?.phase !== InboxPhase.found) return null;
  return inbox.code ? "Aktivasiya kodu" : inbox.link ? "Aktivasiya keçidi" : null;
}

// Popup-dakı "Kopyala" düyməsinin dəyəri. Kod üstündür: sayta yazmaq bir addımdır; kod
// yoxdursa aktivasiya keçidi verilir.
export const inboxPayload = (inbox: InboxState | null | undefined): string | null =>
  (inbox?.phase === InboxPhase.found ? inbox.code || inbox.link || null : null);

// Tapılan dəyərin uzun izahı — popup-da boz sətir kimi görünür (məktubun haradan gəldiyi)
export function inboxDetail(inbox: InboxState | null | undefined): string | null {
  if (inbox?.phase !== InboxPhase.found) return null;
  const where = [inbox.subject, inbox.from].filter(Boolean).join(" — ");
  return where || null;
}

export function inboxSummary(
  inbox: InboxState | null | undefined,
  now: number = Date.now(),
): string | null {
  if (!inbox) return null;
  if (inbox.phase === InboxPhase.found) {
    const label = inboxLabel(inbox);
    return label ? label + ": " + inboxPayload(inbox) : "Uyğun məktub tapıldı, amma dəyər oxunmadı";
  }
  if (inbox.phase === InboxPhase.watching) {
    if (inboxStale(inbox, now)) return 'İzləmə dayandı — "Poçtu yenidən yoxla" ilə davam edin';
    return inbox.checked
      ? `Poçt izlənilir: ${inbox.checked} məktub yoxlanıldı, bu sayta aid tapılmadı`
      : "Poçt izlənilir: aktivasiya kodu və ya keçidi gözlənilir…";
  }
  // empty / error — səbəbi worker yazır
  return inbox.message ?? (inbox.phase === InboxPhase.empty ? "Uyğun məktub gəlmədi" : "Poçt qutusu oxunmadı");
}

// Bildiriş yalnız tapıntıda göndərilir (popup bağlı olanda da istifadəçi kodu görsün)
export function inboxNotification(
  inbox: InboxState | null | undefined,
): { title: string; message: string } | null {
  const label = inboxLabel(inbox);
  const payload = inboxPayload(inbox);
  if (!label || !payload) return null;
  const code = inbox?.code;
  const subject = inbox?.subject;
  // Kod bildirişində mövzu da yazılır: dəyərin hansı məktubdan gəldiyi ekrandan görünür
  return { title: label, message: code && subject ? payload + " — " + subject : payload };
}

export interface DeliveryInfo {
  filled?: boolean;
  copied?: boolean;
  submitted?: string | null;
  reason?: string | null;
}

// Tapıntı ilə NƏ edildiyi: relay forması dolduruldu? düymə basıldı? clipboard-a düşdü?
// Status mətninin quyruğu buradan gəlir ki, söz iki yerdə təkrarlanmasın.
export function deliveryNote(
  { filled = false, copied = false, submitted = null, reason = null }: DeliveryInfo = {},
): string {
  const done: string[] = [];
  if (filled) done.push("forma dolduruldu");
  if (typeof submitted === "string" && submitted) done.push(`"${submitted}" basıldı`);
  if (copied) done.push("kopyalandı");
  if (done.length) return " — " + done.join(", ");
  // Heç biri alınmadısa səbəb göstərilir: dəyər paneldə qalır, istifadəçi əl ilə götürür
  return reason ? " — çatdırılmadı: " + reason : "";
}
