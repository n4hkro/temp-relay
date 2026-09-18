// Poçt qutusunun izlənməsi — ünvan yaradılandan sonra relay saytının göndərdiyi məktub
// gözlənilir və ondan YALNIZ lazım olan dəyər çıxarılır: aktivasiya kodu və ya keçid.
//
// Niyə ayrı modul: izləmə dəqiqələrlə davam edən döngüdür və nə ünvanın alınmasından, nə
// də relay tabının yenidən açılmasından asılıdır. Ona görə orchestrator onu növbəyə
// QOYMUR — izləmə işə salınır və nəticə status, bildiriş və popup paneli ilə görünür.
// Əks halda "Yeni ünvan" əmri növbədə 5 dəqiqə gözləyərdi.
//
// Bölgü: saytın protokolu provider-dədir (fetchMessages), məktubun bu sayta aid olmasının
// və kodun seçilmə qaydaları shared/extract.js-də, vəziyyətin forması shared/inbox.js-də.
// Burada yalnız bütün saytlar üçün eyni olan mexanika var: döngü, vaxt limiti, nəbz.

import { supportsInbox } from "../providers/contract.js";
import { TEMP_MAIL } from "../providers/temp-mail/index.js";
import { BadgeKind, clearBadge, setBadge } from "../shared/badge.js";
import { describeFailure, logFailure } from "../shared/errors.js";
import { mailHints, pickFromMessages } from "../shared/extract.js";
import {
  INBOX_DEADLINE_MS,
  INBOX_KEEPALIVE_MS,
  INBOX_POLL_TIMEOUT_MS,
  INBOX_RETRY_MS,
  InboxPhase,
  closedInbox,
  deliveryNote,
  foundInbox,
  inboxNotification,
  inboxPayload,
  inboxSummary,
  progressInbox,
  watchingInbox,
} from "../shared/inbox.js";
import { clearInbox, isLiveSession, readInbox, readSession, StatusLevel, writeInbox } from "../shared/state.js";
import { copyText } from "./clipboard.js";
import { fillForm } from "./forms.js";
import { report } from "./notify.js";
import { resolveRelay } from "./relay.js";
import { runSignup, SignupPhase, supportsSignup } from "./signup.js";

// Aktiv izləmənin nişanı. Modul səviyyəsində saxlanılır, çünki Dayandır və yeni ünvan
// köhnə döngünü DƏRHAL kəsməlidir; saxlancdakı vəziyyət isə popup üçündür.
let watcher = null;
let watchGeneration = 0;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const minutes = (ms) => Math.round(ms / 60000);

// MV3 worker-i ~30 saniyə iş görməyəndə sönür. Uzun sorğuda (wait:true, ~8 saniyə)
// gözləmədən başqa iş olmadığı üçün nəbz göndərilir — döngü ortada qırılmır.
const pulse = () => setInterval(() => { chrome.runtime.getPlatformInfo().catch(() => {}); }, INBOX_KEEPALIVE_MS);

// Bir sorğu: provider-in öz protokolu + bizim vaxt limitimiz. Xarici signal (Dayandır,
// yeni ünvan) daxili controller-ə körpülənir ki, gözləyən sorğu dərhal kəsilsin.
async function pollOnce(provider, address, { wait, signal }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), INBOX_POLL_TIMEOUT_MS);
  const forward = () => controller.abort();
  if (signal.aborted) controller.abort();
  else signal.addEventListener("abort", forward, { once: true });
  try {
    return await provider.fetchMessages({ email: address, wait, signal: controller.signal });
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", forward);
  }
}

// İzləməni dayandırır və vəziyyəti silir. Dayandır, pəncərənin bağlanması və relay tabının
// yenidən açılması bunu çağırır: köhnə ünvanın kodu popup-da qalmamalıdır.
export async function stopWatching() {
  ++watchGeneration;
  const current = watcher;
  watcher = null;
  current?.controller.abort();
  await clearBadge();
  await clearInbox();
}

// Ünvan alındıqda çağrılır (gözlənmir — bax: orchestrator.js). `resume` worker yenidən işə
// düşəndə köhnə başlanğıc vaxtını qorumaq üçün ötürülür: son müddət mütləq vaxtdır.
export async function watchInbox(session, address, resume = {}) {
  const generation = watchGeneration;
  const validSession = async () => await isLiveSession(session) && (await readSession())?.address === address;
  if (!await validSession() || generation !== watchGeneration) return;
  const provider = TEMP_MAIL.get(session.tempId);
  // Sayt poçtu oxumağa imkan vermirsə izləmə də yoxdur — bu xəta deyil, imkandır (contract.js)
  if (!supportsInbox(provider)) {
    await clearInbox();
    return;
  }
  // "Bu sayt" relay-ində ipuçları aktiv tabın saytından gəlir (bax: background/relay.js)
  const relay = resolveRelay(session);
  const hints = mailHints(relay);
  const controller = new AbortController();
  const token = { controller };
  watcher?.controller.abort();
  watcher = token;
  ++watchGeneration;

  const started = resume.started ?? Date.now();
  const deadline = started + INBOX_DEADLINE_MS;
  const seen = new Set();
  const contents = new Map();
  let inbox = watchingInbox(address, { started, checked: resume.checked ?? 0 });
  let first = true;       // ilk sorğu qısadır: qutuda hazır məktub varsa dərhal tapılsın
  let lastError = null;   // tək xəta izləməni bitirmir; yalnız gözləmə boş qurtarsa göstərilir
  const beat = pulse();

  // Yazı yalnız bu döngü hələ aktivdirsə aparılır: Dayandır-dan və ya yeni ünvandan sonra
  // köhnə döngü vəziyyəti geri qaytara bilməz.
  const own = () => watcher === token && !controller.signal.aborted;
  const alive = async () => own() && await validSession() && own();
  const save = async (next) => {
    if (!await alive()) return false;
    inbox = next;
    return writeInbox(inbox, alive);
  };

  try {
    await clearBadge();
    if (!await save(inbox)) return;
    while (Date.now() < deadline) {
      if (!await alive()) return;

      let messages;
      try {
        messages = await pollOnce(provider, address, { wait: !first, signal: controller.signal });
        if (!await alive()) return;
        first = false;
        lastError = null;
      } catch (e) {
        if (!await alive()) return;
        lastError = `${provider.name}: ${describeFailure(e)}`;
        if (!await save(progressInbox(inbox, inbox.checked))) return;
        await sleep(Math.min(INBOX_RETRY_MS, Math.max(0, deadline - Date.now())));
        continue;
      }

      // Yeni və ya məzmunu dəyişmiş məktublar yoxlanılır: bəzi API-lər əvvəl zərfi,
      // sonra gövdəni qaytarır. Eyni id ikinci dəfə gəlsə də gecikmiş kod itməməlidir.
      const fresh = messages.filter((message) => {
        const received = Date.parse(message.date);
        // Server saatına bir dəqiqə möhlət; əvvəlki qeydiyyatın məktubu bu sessiyaya aid deyil.
        if (session.addressSince && Number.isFinite(received) && received < session.addressSince - 60000) return false;
        const content = JSON.stringify([message.from, message.subject, message.body, message.text, message.bodyContentType]);
        if (contents.get(message.id) === content) return false;
        contents.set(message.id, content);
        return true;
      });
      for (const message of messages) seen.add(message.id);
      if (!await save(progressInbox(inbox, seen.size))) return;

      const hit = pickFromMessages(fresh, hints);
      if (!hit) continue;   // pauza provider-in `wait` cavabındadır (bax: providers/contract.js)

      const found = foundInbox(inbox, hit, { checked: seen.size });
      if (!await save(found)) return;
      await deliver(session, found, relay, alive);
      return;
    }

    // Gözləmə bitdi: poçt heç oxunmayıbsa səbəb xəta kimi, oxunubsa boş nəticə kimi yazılır.
    const closed = closedInbox(
      inbox,
      lastError ? InboxPhase.error : InboxPhase.empty,
      lastError ?? `${minutes(INBOX_DEADLINE_MS)} dəqiqə ərzində ${hints.domains.join(", ")} tərəfdən məktub gəlmədi (${seen.size} məktub yoxlanıldı)`,
    );
    if (await save(closed)) await setBadge(BadgeKind.warn, closed.message);
  } catch (e) {
    // Döngü heç vaxt kənara rejection qaytarmır: gözləmənin xətası status kimi çatdırılır.
    // Səviyyəni xətanın növü seçir (shared/errors.js): saytın xətası warn, öz qüsurumuz error.
    logFailure("poçt izləməsi qırıldı:", e);
    await save(closedInbox(inbox, InboxPhase.error, describeFailure(e)));
  } finally {
    clearInterval(beat);
    if (watcher === token) watcher = null;
  }
}

// Tapıntı istifadəçiyə dörd yolla çatır: relay formasının doldurulması (sayt addımlar
// veribsə — kod + parol yazılır və hesab yaradılır), saxlanc (popup paneli), clipboard və
// bildiriş (popup bağlı ola bilər). Heç biri məcburi deyil — biri alınmasa qalanları
// işləyir və status nəyin alındığını açıq yazır.
async function deliver(session, inbox, relay, alive) {
  if (!await alive()) return;
  const payload = inboxPayload(inbox);
  let filled = false;
  let reason = null;
  let blocked = false;
  let submitted = null;

  // Kod formaya yazılır: addımlar varsa onlarla (kod + parol + "hesab yarat"), yoxsa
  // naməlum formanın kod xanası evristika ilə tapılır. Keçid forma sahəsi deyil — onu
  // popup-dan açırlar.
  if (inbox.code) {
    const result = supportsSignup(relay, SignupPhase.afterCode)
      ? await runSignup(session, relay, SignupPhase.afterCode, {
        address: inbox.address,
        code: inbox.code,
        username: session.username,
        password: session.password,
      })
      : await fillForm(session, { code: inbox.code });
    filled = result.done === true;
    submitted = typeof result.submitted === "string" && result.submitted !== "" ? result.submitted : null;
    if (!filled) {
      reason = result.reason ?? null;
      // İcazə itibsə (tab bu arada başqa sayta keçib) səbəb kod kopyalansa da göstərilir:
      // istifadəçi nə edəcəyini bilməlidir. Digər səbəblər adi haldır — yalnız console.
      blocked = result.blocked === true;
      console.warn("forma doldurulmadı:", reason);
    }
  }

  let copied = false;
  if (!await alive()) return;
  try {
    if (payload) {
      await copyText(payload, { windowId: session.windowId });
      copied = true;
    }
  } catch (e) {
    console.warn("aktivasiya dəyəri kopyalanmadı:", e?.message ?? e);
  }
  // Forma doldurulubsa "çatdırılmadı" səbəbi göstərilmir — nəticə onsuz da uğurludur.
  // İstisna: icazə itibsə səbəb kod kopyalansa da yazılır (istifadəçi düzəldə bilər).
  const note = deliveryNote({ filled, copied, submitted, reason: copied ? null : reason });
  const summary = inboxSummary(inbox) + note + (blocked && copied ? ` (forma doldurulmadı: ${reason})` : "");
  if (!await alive()) return;
  await report(StatusLevel.info, summary, inboxNotification(inbox));
  // Nişan ikonun üstündə qalır: sistem bildirişi görünməsə də istifadəçi kodun gəldiyini bilir
  if (await alive()) await setBadge(BadgeKind.found, summary);
}

// Worker yenidən işə düşəndə (background.js) çağrılır: döngü worker ilə birgə ölə bilər,
// vəziyyət isə saxlancda qalır. Son müddət keçməyibsə izləmə davam etdirilir və bu arada
// gələn məktub itmir — ilk sorğu qutunu olduğu kimi oxuyur.
export async function resumeWatching() {
  const [session, inbox] = await Promise.all([readSession(), readInbox()]);
  if (!session || !inbox || inbox.phase !== InboxPhase.watching || !inbox.address
      || inbox.address !== session.address || !TEMP_MAIL.has(session.tempId)) return;
  await watchInbox(session, inbox.address, { started: inbox.started, checked: inbox.checked });
}
