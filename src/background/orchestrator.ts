// Orkestr: bütün iş axınları buradadır — Başlat, Dayandır, Yeni ünvan və relay tabının
// bağlanmasına cavab. Qonşu modullar yalnız mexanikadır (tab, clipboard, təmizləmə,
// bildiriş); provider-lər isə yalnız sayt məlumatı verir.
//
// İş növbəsi: eyni anda yalnız bir axın işləyir. "Yeni ünvan" ilə tabın bağlanması
// hadisəsinin üst-üstə düşməsi vəziyyəti korlayardı (iki tab, iki clipboard yazısı),
// ona görə əmrlər ardıcıl icra olunur.
//
// Növbə "dayandır"ı gözləmir: Dayandır dərhal icra olunur, növbədəki axın isə sessiyanın
// silindiyini görüb öz-özünə dayanır (bax: updateSession / acquireAddress). Əks halda
// istifadəçi "dayandır" basanda cavab saniyələrlə gecikər və axın sonra tabları yenə açardı.

import {
  AcquireMode, acquireMode, adoptsActiveTab, type TempMailDescriptor,
} from "../providers/contract";
import { RELAY } from "../providers/relay/index";
import { TEMP_MAIL } from "../providers/temp-mail/index";
import { tabCleanupPlan, type CleanupPlan } from "../shared/cleanup";
import { ExpectedError, logFailure } from "../shared/errors";
import { MessageType } from "../shared/messages";
import { resolveValues, validateValues, type OptionValues } from "../shared/options";
import { buildIdentity, type Identity } from "../shared/identity";
import { generatePassword, PASSWORD_LENGTH } from "../shared/password";
import { hasOriginAccess, originPattern } from "../shared/permissions";
import { usernameFromAddress } from "../shared/username";
import {
  clearPendingWipe, clearSession, isLiveSession, readPendingWipe, readSession,
  StatusLevel, updateSession, writePendingWipe, writeSession, writeStatus,
  type PendingWipe, type Session,
} from "../shared/state";
import { acquireAddress } from "./address";
import { copyText } from "./clipboard";
import { stopWatching, watchInbox } from "./inbox";
import { clearData, clearPageStorage, clearRelayData } from "./cleanup";
import { fillForm, fillNote, openSignup, signupValues } from "./forms";
import { notify, reportFailure } from "./notify";
import { resolveRelay, type RelayDescriptor } from "./relay";
import { runSignup, SignupPhase, supportsSignup, usesPassword, usesSlot } from "./signup";
import { openTab, settleTab, waitForLoad } from "./tabs";

let queue: Promise<void> = Promise.resolve();
let commandGeneration = 0;
let addressRequest: AbortController | null = null;

// Axını növbənin sonuna qoyur. Xəta həmişə tutulub istifadəçiyə çatdırılır (status +
// bildiriş) və növünə görə console-a yazılır: saytın xətası warn, extension-ın öz qüsuru
// error (bax: shared/errors.ts, notify.ts → reportFailure). Növbə qırılmır, sonrakı əmr
// öz işini görə bilir.
function enqueue(job: () => Promise<unknown>, generation: number = commandGeneration): Promise<void> {
  queue = queue.then(async () => {
    if (generation !== commandGeneration) return;
    try {
      await job();
    } catch (e) {
      if (generation === commandGeneration) await reportFailure(e);
    }
  }).catch((e) => logFailure("əmr nəticəsi göstərilmədi:", e));
  return queue;
}

// Popup-dan gələn xam seçimləri sxemə görə normallaşdırır və saytın öz qaydaları ilə yoxlayır.
// Worker mesaja kor-koranə etibar etmir: popup köhnəlmiş və ya əl ilə pozulmuş ola bilər,
// səhv kombinasiya isə tab açılmadan ƏVVƏL bilinməlidir.
function resolveOptions(provider: TempMailDescriptor, raw: unknown): OptionValues {
  const values = resolveValues(provider, raw);
  const error = validateValues(provider, values);
  if (error) throw new ExpectedError(`${provider.name}: ${error}`);
  return values;
}

// Popup-dan gələn əmr.
// Uzun axınlar növbəyə qoyulur və DƏRHAL cavab qaytarılır — nəticə status və bildiriş ilə
// görünür, çünki popup bu müddətdə bağlana bilər. Seçimə aid yoxlamalar (naməlum sayt,
// aktiv sessiyanın olmaması, yanlış parametrlər) isə növbəyə qoymadan əvvəl edilir ki,
// popup dərhal { ok: false, error } cavabı alsın.
interface CommandMessage {
  type?: unknown;
  tempId?: string;
  relayId?: string;
  options?: unknown;
  tabId?: number | null;
}

export async function handleCommand(message: CommandMessage | null | undefined): Promise<void> {
  switch (message?.type) {
    case MessageType.START: {
      const temp = TEMP_MAIL.get((message as CommandMessage).tempId as string);
      const relay = RELAY.get((message as CommandMessage).relayId as string);
      const values = resolveOptions(temp, (message as CommandMessage).options);
      const generation = ++commandGeneration;
      addressRequest?.abort();
      await clearSession();
      await stopWatching();
      enqueue(() => start(temp, relay, values, (message as CommandMessage).tabId, generation), generation);
      return;
    }
    case MessageType.STOP:
      await stop();
      return;
    // Sessiyadan ASILI DEYİL: istənilən tabın saytına aid hər şeyi silir. Növbəyə
    // qoyulmur — istifadəçi düyməyə basıb cavab gözləyir, uzun axın onu saxlamamalıdır.
    case MessageType.CLEAR_TAB:
      await clearTab((message as CommandMessage).tabId);
      return;
    case MessageType.RETRY_INBOX: {
      const session = await readSession();
      if (!session?.address) throw new ExpectedError("aktiv poçt ünvanı yoxdur, əvvəlcə Başlat");
      await stopWatching();
      enqueue(async () => {
        if (!await isLiveSession(session)) return;
        watchInbox(session, session.address!).catch((e) => logFailure("poçt yenidən yoxlanmadı:", e));
      });
      return;
    }
    case MessageType.NEW_ADDRESS: {
      const session = await readSession();
      // Popup köhnəlmiş ola bilər (sessiya bu arada bitib) — proqram qüsuru deyil, istifadəçiyə
      // aydın mətn çatır: ExpectedError.
      if (!session) throw new ExpectedError("aktiv sessiya yoxdur, əvvəlcə Başlat");
      // Popup formdakı CARI dəyərləri göndərir: Gmail-dən Outlook-a keçib "Yeni ünvan"
      // basanda seçim dərhal tətbiq olunur. Dəyər göndərilməyibsə sessiyadakı saxlanılır.
      const temp = TEMP_MAIL.get(session.tempId as string);
      const values = ((message as CommandMessage).options === undefined
        ? session.options
        : resolveOptions(temp, (message as CommandMessage).options)) as OptionValues;
      await stopWatching();
      enqueue(() => renewWith(session, values));
      return;
    }
    default:
      throw new Error("naməlum əmr: " + JSON.stringify(message?.type ?? null));
  }
}

// Relay tabı bağlananda çağrılır. Bütün pəncərə bağlanırsa sessiya bitir və heç nə
// yenidən açılmır (istifadəçi işi qəsdən dayandırıb). "Bu sayt" relay-ində də sessiya bitir:
// tab istifadəçinin özünündür, onu silib yenidən açmaq gözlənilməz olardı.
export async function onTabClosed(
  tabId: number,
  { isWindowClosing }: { isWindowClosing?: boolean } = {},
): Promise<void> {
  const session = await readSession();
  if (!session || tabId !== session.relayTabId) return;
  // Relay reyestrdən silinibsə (köhnə sessiya) tabı yenidən açmağın mənası yoxdur
  const known = RELAY.has(session.relayId as string);
  if (isWindowClosing || !known || adoptsActiveTab(RELAY.get(session.relayId as string))) {
    ++commandGeneration;
    addressRequest?.abort();
    await clearSession();
    await stopWatching();
    await writeStatus(StatusLevel.info, isWindowClosing
      ? "Pəncərə bağlandı, sessiya bitdi"
      : known ? "Tab bağlandı, sessiya bitdi" : "Tab bağlandı — relay saytı artıq mövcud deyil, sessiya bitdi");
    return;
  }
  enqueue(() => reopenRelay(session));
}

// Relay tabı: adi relay üçün yeni tab öndə açılır; "bu sayt" relay-ində isə istifadəçinin
// AKTİV TABI mənimsənilir (heç nə açılmır). Temp mail tabı YALNIZ səhifə rejimində lazımdır —
// API ilə işləyən sayt üçün tab açılmır (brauzerdə iz qalmır, iş saniyənin onda birində bitir).
async function start(
  temp: TempMailDescriptor,
  relay: RelayDescriptor,
  values: OptionValues,
  tabId: number | null | undefined,
  generation: number,
): Promise<void> {
  let relayTab: chrome.tabs.Tab | null = null;
  let relaySite: string | null = null;
  if (adoptsActiveTab(relay)) {
    // URL-i worker özü oxuyur: mənimsənilən sayt popup-dan gələn sətirə görə seçilməməlidir
    if (!Number.isInteger(tabId)) throw new ExpectedError(`${relay.name}: aktiv tab tapılmadı`);
    let tab: chrome.tabs.Tab | null = null;
    try { tab = await chrome.tabs.get(tabId as number); } catch { throw new ExpectedError("aktiv tab tapılmadı (bağlanmış ola bilər)"); }
    if (generation !== commandGeneration) return;
    const plan = tabCleanupPlan(tab?.url);
    if (!plan) throw new ExpectedError("aktiv tab adi sayt deyil — yalnız http/https saytlarında işləyir");
    relayTab = tab;
    relaySite = new URL(tab.url as string).origin;
  } else {
    relayTab = await openTab({ url: relay.url as string, active: true });
  }
  if (generation !== commandGeneration) return;

  const needsTab = acquireMode(temp) === AcquireMode.page;
  const tempTab = needsTab ? await openTab({ url: temp.url, active: false, windowId: relayTab.windowId }) : null;
  if (generation !== commandGeneration) return;
  // Sessiya saxlanc forması: bəzi sahələr null saxlanılır (ünvan, relaySite, istifadəçi
  // adı, parol, profil). Session tipi onları `string | undefined` kimi göstərir — `as`
  // yalnız tip səviyyəsindədir, runtime-da orijinal null dəyərlər yazılır.
  const session: Session = {
    id: crypto.randomUUID(),
    tempId: temp.id,
    relayId: relay.id,
    relaySite: relaySite as unknown as string | undefined,
    tempTabId: tempTab?.id ?? null,
    relayTabId: relayTab.id,
    windowId: relayTab.windowId,
    options: values,
    address: null,
    username: null as unknown as string | undefined,
    password: null as unknown as string | undefined,
    identity: null as unknown as Identity | undefined,
    started: Date.now(),
  };
  await writeSession(session);
  if (generation !== commandGeneration || !await isLiveSession(session)) return;
  const target = relaySite ? new URL(relaySite).host : relay.name;
  await writeStatus(StatusLevel.info, `Başladı: ${temp.name} + ${target}, ünvan yaradılır…`);
  if (tempTab) await waitForLoad(tempTab.id, temp.url);
  await renew(session);
}

// Relay tabı bağlanıb: saytın bütün məlumatı silinir, tab yenidən açılır, yeni ünvan alınır.
// Hər uzun addımdan sonra sessiyanın hələ aktiv və EYNİ sessiya olduğu yoxlanılır — bu arada
// Dayandır basılıbsa və ya yeni Başlat olubsa, köhnə axın tab açmağı dayandırır.
async function reopenRelay(session: Session): Promise<void> {
  const relay = resolveRelay(session);
  await stopWatching();
  if (!await isLiveSession(session)) return;
  await writeStatus(StatusLevel.info, `${relay.name} tabı bağlandı, məlumat silinir…`);
  const { cookies } = await clearRelayData(relay);
  if (!await isLiveSession(session)) return;
  const tab = await openTab({ url: relay.url as string, active: true, windowId: session.windowId });
  if (!await updateSession(session, { relayTabId: tab.id, windowId: tab.windowId })) return;
  await writeStatus(StatusLevel.info, `${relay.name}: ${cookies} cookie silindi, tab yenidən açıldı; yeni ünvan yaradılır…`);
  await renew(session);
}

// Seçimi sessiyaya yazıb yeni ünvanı alır. Sessiya bu arada silinibsə və ya yenilənibsə
// heç nə yazılmır (köhnə axın yeni sessiyanın parametrlərini pozmur).
async function renewWith(session: Session, values: OptionValues): Promise<void> {
  if (!(await updateSession(session, { options: values }))) return;
  await renew(session);
}

// forms.ts-in openSignup nəticəsinin orchestrator-un işlətdiyi sahələri
interface OpenResult {
  opened?: string | null;
  navigated?: boolean;
  navigatedTo?: string;
  ready?: boolean;
  error?: string;
  blocked?: boolean;
}

// Ünvanı alır, qeydiyyat formasını doldurur və poçt izləməsini işə salır.
// null — sessiya bu arada dayandırılıb; xəta deyil, sadəcə axın sakitcə bitir.
async function renew(session: Session): Promise<void> {
  if (!await isLiveSession(session)) return;
  await stopWatching();
  if (!await isLiveSession(session)) return;
  const relay = resolveRelay(session);
  const generic = !supportsSignup(relay, SignupPhase.afterAddress);
  // Formanı açmaq üçün ünvan lazım deyil. Provayderin şəbəkə cavabı və
  // clipboard davam edərkən səhifə/modal hazırlaşır; dəyərlər yalnız sonra yazılır.
  const opening: Promise<OpenResult> | null = generic
    ? openSignup(session).catch((e) => ({ error: String((e as { message?: unknown })?.message ?? e) }))
    : null;
  const controller = new AbortController();
  const addressSince = Date.now();
  addressRequest = controller;
  let address: string | null;
  try {
    address = await acquireAddress(session, { signal: controller.signal });
  } finally {
    if (addressRequest === controller) addressRequest = null;
  }
  if (address === null) return;
  // Ünvan sessiyaya yazılır: popup onu göstərir (yanındakı ⟳ düyməsi yenisini gətirir)
  if (!await updateSession(session, { address, addressSince })) return;
  await writeStatus(StatusLevel.info, `Ünvan hazırdır: ${address} — forma hazırlanır…`);
  // Clipboard və sistem bildirişi forma üçün ilkin şərt deyil. Bəzi sistemlərdə
  // onların cavabı gecikir; dəyərlər hazır olduğu halda doldurmanı saxlamamalıdır.
  // Task aşağıda inbox-dan ƏVVƏL tamamlanır ki, ünvan sonradan OTP-ni əvəz etməsin.
  const copying = (async () => {
    if (!await isLiveSession(session)) return;
    try {
      await copyText(address, { windowId: session.windowId });
      if (await isLiveSession(session)) await notify("Ünvan kopyalandı", address);
    } catch (e) {
      console.warn("ünvan kopyalanmadı:", (e as { message?: unknown })?.message ?? e);
      if (await isLiveSession(session)) await notify("Ünvan kopyalanmadı", "Ünvan hazırdır; paneldən kopyalaya bilərsiniz.");
    }
  })().catch((e) => logFailure("clipboard nəticəsi göstərilmədi:", e));

  // Parol, istifadəçi adı və bütöv şəxs profili hər qeydiyyat üçün yenidən yaradılır: eyni
  // dəyər bütün hesablarda təkrarlanmasın. Profil ünvandan DETERMİNİST törədilir, ona görə
  // kod fazasında (worker sönsə də) eyni şəxs alınır. Sessiyaya yazılır ki, popup göstərsin.
  const patch: { password?: string; username?: string; identity?: Identity } = {};
  if (usesPassword(relay) || generic) patch.password = generatePassword(relay.signup?.password?.length ?? PASSWORD_LENGTH);
  if (usesSlot(relay, "username") || generic) patch.username = usernameFromAddress(address);
  if (generic) {
    const identity = buildIdentity(address);
    patch.identity = identity;
    patch.username = identity.username;
  }
  if (Object.keys(patch).length && !await updateSession(session, patch)) return;

  // Faza 1: addımlar varsa dəqiq ardıcıllıq (metodu seç, ünvanı yaz, "Send code" bas),
  // yoxsa naməlum saytda tam qeydiyyat: forma açılır → bütün xanalar doldurulur →
  // razılıq xanaları işarələnir → qeydiyyat düyməsi basılır. Uğursuzluq axını qırmır:
  // istifadəçi formanı əl ilə tamamlaya bilər, izləmə isə onsuz da işə düşür.
  if (generic) {
    await signupOnUnknownSite(session, relay, address, opening);
  } else {
    const result = await runSignup(session, relay, SignupPhase.afterAddress, {
      address,
      username: session.username,
      password: session.password,
    });
    if (!await isLiveSession(session)) return;
    if (result.done) await writeStatus(StatusLevel.info, `${relay.name}: forma doldurulub, kod istənildi — məktub gözlənilir…`);
    else await reportFailure(new ExpectedError(`${relay.name}: qeydiyyat addımı alınmadı — ${result.reason}`));
  }

  // İzləmə növbəyə QOYULMUR və gözlənilmir: dəqiqələrlə davam edən döngü növbəni tutardı və
  // "Yeni ünvan" əmri onun bitməsini gözləyərdi. Nəticə status, bildiriş və popup panelindədir.
  // Sayt poçtu oxumağa imkan vermirsə watchInbox özü sakitcə çıxır.
  await copying;
  if (await isLiveSession(session)) {
    watchInbox(session, address).catch((e) => logFailure("poçt izləməsi işə düşmədi:", e));
  }
}

// NAMƏLUM saytda qeydiyyat — dörd addım. Heç biri məcburi deyil: biri alınmasa qalanı işləyir və
// istifadəçi formanı əl ilə tamamlaya bilər (ünvan, ad, parol onsuz da popup-da və clipboard-da).
//
//   1) qeydiyyat forması AÇILIR — səhifədə parol xanası yoxdursa "Sign up / Register / Qeydiyyat"
//      linki, düyməsi, tabı və ya metod seçimindəki "Continue with email" basılır; heç nə
//      tapılmasa saytın öz qeydiyyat ÜNVANINA keçilir (/signup, /register…);
//   2) forma DOLDURULUR və göndərilir — bütün tanınan xanalar + razılıq xanaları;
//   3) forma TAPILMASA bir dəfə TƏKRAR axtarılır: səhifədə qeydiyyat qutusu olmaya bilər
//      (məs. yalnız bülletenə abunə qutusu var — o, qəsdən bloklanır), belə halda qeydiyyat
//      səhifəsi tapılıb doldurma yenidən sınanır;
//   4) ÇOXMƏRHƏLƏLİ forma üçün ikinci keçid: göndərdikdən sonra yeni xanalar çıxa bilər
//      (profil addımı). O keçid YALNIZ doldurur — nə olduğu bilinmədiyi üçün göndərmir.
async function signupOnUnknownSite(
  session: Session,
  relay: RelayDescriptor,
  address: string,
  opening: Promise<OpenResult> | null = null,
): Promise<void> {
  const open: OpenResult = await (opening ?? openSignup(session));
  if (!await isLiveSession(session)) return;
  await reportOpen(relay, open);
  if (!await isLiveSession(session)) return;

  const values = signupValues(session, { email: address });
  let result = await fillForm(session, values);
  if (!await isLiveSession(session)) return;

  // Forma tapılmadı və hələ keçid etməmişik → qeydiyyat səhifəsi axtarılır və BİR DƏFƏ
  // təkrar cəhd edilir. Bu, "ana səhifədə Başlat basıldı" halının düzgün cavabıdır.
  if (!result.done && !result.blocked && !open.navigatedTo) {
    const again = await openSignup(session);
    if (!await isLiveSession(session)) return;
    if (again.navigatedTo || again.opened) {
      await reportOpen(relay, again);
      if (!await isLiveSession(session)) return;
      result = await fillForm(session, values);
      if (!await isLiveSession(session)) return;
    }
  }

  if (!result.done) {
    // İcazə problemi istifadəçidən asılıdır → görünən xəbərdarlıq. Sahə tapılmaması isə adi
    // haldır (səhifədə forma yoxdur, kod başqa hesab üçündür) → yalnız console.
    if (result.blocked) await writeStatus(StatusLevel.warn, `${relay.name}: forma doldurulmadı — ${result.reason}`);
    else console.warn("forma doldurulmadı:", result.reason);
    return;
  }
  await writeStatus(StatusLevel.info, `${relay.name}: ${fillNote(result)} — məktub gözlənilir…`);
  if (!result.submitted) return;

  // Göndərmədən sonra səhifə dəyişir: ya növbəti mərhələ, ya təsdiq ekranı, ya da başqa sayt.
  // Naviqasiya olarsa tabın yüklənməsi gözlənilir — yoxsa skript ölməkdə olan sənədə düşür.
  await new Promise((resolve) => setTimeout(resolve, NEXT_STEP_DELAY_MS));
  await settleTab(session.relayTabId);
  if (!await isLiveSession(session)) return;
  const second = await fillForm(session, values, { submit: false, timeoutMs: NEXT_STEP_FIND_MS, onlyEmpty: true });
  if (second.done && await isLiveSession(session)) {
    await writeStatus(StatusLevel.info, `${relay.name}: növbəti mərhələ də dolduruldu (${fillNote(second)})`);
  }
}

// Formanın açılması/keçidin nəticəsi istifadəçiyə çatdırılır: hansı düymə basıldı, hansı
// ünvana keçildi (təxmin idisə bu da deyilir — sayt 404 verə bilər).
async function reportOpen(relay: RelayDescriptor, open: OpenResult): Promise<void> {
  if (open.error) {
    // Forma səhifədə onsuz da ola bilər — axını dayandırmırıq, sadəcə səbəbi yazırıq
    if (open.blocked) await writeStatus(StatusLevel.warn, `${relay.name}: ${open.error}`);
    else console.warn("qeydiyyat forması açılmadı:", open.error);
    return;
  }
  if (open.navigatedTo) {
    await writeStatus(StatusLevel.info,
      `${relay.name}: qeydiyyat səhifəsinə keçildi — ${open.navigatedTo}`);
    return;
  }
  if (open.opened) await writeStatus(StatusLevel.info, `${relay.name}: "${open.opened}" açıldı, forma doldurulur…`);
}
// Göndərmədən sonra səhifənin dəyişməsinə verilən vaxt və ikinci keçidin qısa axtarış limiti
const NEXT_STEP_DELAY_MS = 2500;
const NEXT_STEP_FIND_MS = 3000;

async function stop(): Promise<void> {
  ++commandGeneration;
  addressRequest?.abort();
  await clearSession();
  await stopWatching();
  await writeStatus(StatusLevel.info, "Dayandırıldı (tablar açıq qalır)");
}

// "Bu saytın məlumatını sil" — relay axınından tam müstəqildir: plan tabın URL-indən
// törədilir, ona görə istənilən sayt üçün işləyir. Ardıcıllıq vacibdir:
//   1) səhifə saxlancı (sessionStorage tab yenilənəndə də qalır, ona görə ƏVVƏL);
//   2) cookie + browsingData;
//   3) tab yenilənir — səhifənin yaddaşındaki vəziyyət də getsin.
//
// Silmənin dərinliyi host icazəsindən asılıdır (bax: shared/permissions.ts): icazə yoxsa
// browsingData yenə işləyir, amma partitioned cookie-lər və sessionStorage kənarda qalır.
// Belə halda sayt "gözləyən" kimi yazılır: istifadəçi icazə verən kimi (popup icazəni eyni
// klikdə istəyir) silmə TAM şəkildə təkrarlanır — bax: onPermissionsGranted.
async function wipe(plan: CleanupPlan, tabId?: number | null): Promise<void> {
  const full = await hasOriginAccess(plan.domain);
  const entries = full && tabId ? await clearPageStorage(tabId, plan.storageOrigins) : 0;
  // İcazə yoxsa cookie-ləri sadalamaq mümkün deyil; browsingData onları origin üzrə onsuz da
  // silir, ona görə yalnız sayğac və partitioned cookie-lər itir.
  const { cookies } = await clearData(full ? plan : { storageOrigins: plan.storageOrigins });
  let reloaded = false;
  if (tabId) {
    try {
      const current = await chrome.tabs.get(tabId);
      if (new URL(current.url as string).hostname === plan.host) {
        await chrome.tabs.reload(tabId, { bypassCache: true });
        reloaded = true;
      }
    } catch (e) {
      console.warn("tab yenilənmədi:", (e as { message?: unknown })?.message ?? e);
    }
  }

  if (full) await clearPendingWipe();
  // Saxlanc forması tabId-ə null yazır (gözləyən silmə tab bağlanandan sonra da qalır);
  // PendingWipe tipi onu `number` göstərir — `as` yalnız tip səviyyəsindədir.
  else await writePendingWipe({ tabId: tabId ?? null, domain: plan.domain, at: Date.now() } as unknown as PendingWipe);

  const done = full
    ? `${cookies} əlçatan cookie (partitioned daxil), ${entries} saxlanc açarı və keş silindi`
    : "cookie, saxlanc və keş silindi (icazədən sonra partitioned cookie və sessionStorage də silinir)";
  // Ailə genişlənməsi istifadəçiyə DEYİLİR: "niyə Microsoft-un başqa domenləri də silindi"
  // sualı yaranmasın və silmənin həqiqətən hesabı unutdurduğu görünsün.
  const family = plan.familyName ? ` · ${plan.familyName}: ${plan.cookieDomains.length} əlaqəli domen` : "";
  await writeStatus(StatusLevel.info, `${plan.domain}: ${done}${family}${reloaded ? ", tab yeniləndi" : ""}`);
}

async function clearTab(tabId: number | null | undefined): Promise<void> {
  if (!Number.isInteger(tabId)) throw new ExpectedError("tab seçilməyib");
  // URL-i worker özü oxuyur: silmə ünvanı popup-dan gələn sətirə görə seçilməməlidir
  let tab: chrome.tabs.Tab | null = null;
  try { tab = await chrome.tabs.get(tabId as number); } catch { throw new ExpectedError("tab tapılmadı (bağlanmış ola bilər)"); }

  const plan = tabCleanupPlan(tab?.url);
  if (!plan) throw new ExpectedError("bu tabın məlumatı silinə bilməz — yalnız http/https saytları");
  await wipe(plan, tabId);
}

// İstifadəçi host icazəsini verəndə çağrılır (background.ts → chrome.permissions.onAdded).
// Gözləyən silmə varsa və icazə MƏHZ onun hostuna aiddirsə silmə tam şəkildə təkrarlanır:
// beləliklə istifadəçi bir dəfə düyməyə basır, icazəni verir və nəticə tam olur.
export async function onPermissionsGranted(
  permissions: chrome.permissions.Permissions | null | undefined,
): Promise<void> {
  const pending = await readPendingWipe();
  if (!pending?.domain) return;
  if (!(permissions?.origins ?? []).includes(originPattern(pending.domain))) return;
  await clearPendingWipe();

  // Tab hələ yerindədirsə onun öz origin-i ilə, bağlanıbsa yalnız domen üzrə silinir
  let plan: CleanupPlan | null = null;
  let tabId: number | null = null;
  if (Number.isInteger(pending.tabId)) {
    try {
      const tab = await chrome.tabs.get(pending.tabId);
      plan = tabCleanupPlan(tab?.url);
      if (plan?.domain === pending.domain) tabId = pending.tabId;
      else plan = null;
    } catch { /* tab bağlanıb — aşağıdaki ehtiyat plan işləyir */ }
  }
  await wipe(plan ?? tabCleanupPlan(`https://${pending.domain}`) as CleanupPlan, tabId);
}
