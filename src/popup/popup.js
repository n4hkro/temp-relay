// Popup: seçim və idarəetmə səthi.
// Burada iş görülmür — bütün iş service worker-dədir (src/background). Popup yalnız
// provider reyestrini və seçilmiş saytın parametrlərini göstərir, əmr göndərir və
// chrome.storage.session-dakı vəziyyəti əks etdirir. Ona görə popup istənilən vaxt bağlana
// bilər: axınlar worker-də davam edir.
//
// Səth qəsdən yığcamdır: sayt seçimləri yanaşı, saytın öz parametrləri poçt kartının içində
// (açılan), başlat/dayandır TƏK düymədə (ikon vəziyyətə görə dəyişir), yeni ünvan isə
// ünvanın yanındaki ⟳ ikonundadır.

import { RELAY } from "../providers/relay/index.js";
import { adoptsActiveTab } from "../providers/contract.js";
import { TEMP_MAIL } from "../providers/temp-mail/index.js";
import { tabCleanupPlan } from "../shared/cleanup.js";
import { clearBadge } from "../shared/badge.js";
import { ExpectedError, isExpected } from "../shared/errors.js";
import { InboxPhase, inboxDetail, inboxLabel, inboxPayload, inboxSummary } from "../shared/inbox.js";
import { Message, send } from "../shared/messages.js";
import { hasOptions, rememberValues, resolveValues, storedValues, validateValues } from "../shared/options.js";
import { hasAllSitesAccess, hasOriginAccess, missingOrigins, requestAllSitesAccess, requestOriginAccess } from "../shared/permissions.js";
import {
  readChoice, readInbox, readSession, readStatus, readTheme,
  readActiveProxy, readProxies, readShield,
  StatusLevel, subscribeToLocalArea, subscribeToSessionArea, writeChoice, writeTheme,
} from "../shared/state.js";
import { formatPing, isRouting, orderProxies, proxyKey, proxyLabel, readProxyControl } from "../shared/proxy.js";
import { formatStatusText, statusLevel, statusTimeLeft } from "./format.js";
import { Icon } from "./icons.js";
import { renderOptions } from "./options-ui.js";

const $ = (id) => document.getElementById(id);
const setIcon = (id, icon) => { $(id).innerHTML = icon; };

// --- tema ------------------------------------------------------------------------------
// Saxlancda dəyər yoxsa sistemin seçimi işlədilir; düymə onu "light" / "dark" kimi sabitləyir.
const systemTheme = () => (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
let theme = systemTheme();

function applyTheme(next) {
  theme = next === "dark" ? "dark" : "light";
  document.documentElement.dataset.theme = theme;
  // İkon HƏDƏFİ göstərir: qaranlıqdaykən günəş (işığa keç), işıqdaykən ay
  setIcon("theme", theme === "dark" ? Icon.sun : Icon.moon);
  $("theme").title = theme === "dark" ? "İşıqlı temaya keç" : "Qaranlıq temaya keç";
}

$("theme").onclick = () => {
  applyTheme(theme === "dark" ? "light" : "dark");
  writeTheme(theme).catch((e) => console.warn("tema saxlanılmadı:", e?.message ?? e));
};

// --- sabit ikonlar ---------------------------------------------------------------------
setIcon("renew", Icon.refresh);
setIcon("copy-address", Icon.copy);
setIcon("inbox-copy", Icon.copy);
setIcon("inbox-open", Icon.open);
setIcon("signup-copy", Icon.copy);
setIcon("signup-username-copy", Icon.copy);
setIcon("signup-name-copy", Icon.copy);
setIcon("wipe", Icon.trash);
setIcon("shield", Icon.shield);
setIcon("proxy-toggle", Icon.globe);
setIcon("proxy-off", Icon.plug);
setIcon("proxy-file", Icon.upload);
setIcon("proxy-add", Icon.plus);
setIcon("proxy-copy", Icon.copy);
setIcon("proxy-drop-selected", Icon.trash);

// --- provider siyahıları ---------------------------------------------------------------
const fill = (select, registry) => { for (const p of registry.all()) select.add(new Option(p.name, p.id)); };
fill($("temp"), TEMP_MAIL);
fill($("relay"), RELAY);

// Reyestrə düşməyən provider varsa gizlətmirik: səbəb həm burada, həm worker console-ındadır
const problems = [...TEMP_MAIL.problems, ...RELAY.problems];
if (problems.length) {
  $("problems").hidden = false;
  $("problems").textContent = "Reyestrə düşməyən provider: " + problems.join("; ");
}
const registriesReady = Boolean(TEMP_MAIL.all().length && RELAY.all().length);

// status null ola bilər (storage hələ boşdur) — göstərmə qaydaları format.js-dədir.
// Status bildiriş kimidir: görünür, ömrü bitəndə öz-özünə yoxa çıxır (qutu da gizlənir,
// ona görə səth boş vaxt yer tutmur).
let statusTimer = null;
function setStatusBox(status) {
  clearTimeout(statusTimer);
  const box = $("status");
  const left = statusTimeLeft(status);
  box.hidden = left === 0;
  if (box.hidden) return;
  box.textContent = formatStatusText(status);
  box.classList.toggle("warn", statusLevel(status) === StatusLevel.warn);
  box.classList.toggle("err", statusLevel(status) === StatusLevel.error);
  statusTimer = setTimeout(() => { box.hidden = true; }, left);
}
const showError = (message) => setStatusBox({ level: StatusLevel.error, text: message, time: Date.now() });
const showWarn = (message) => setStatusBox({ level: StatusLevel.warn, text: message, time: Date.now() });
// Səviyyəni xətanın növü seçir (shared/errors.js): saytın limiti, cavabsız sorğu və ya
// istifadəçinin yanlış seçimi sarı xəbərdarlıqdır; qırmızı yalnız extension-ın öz qüsurudur.
const showFailure = (e) => (isExpected(e) ? showWarn : showError)(e?.message ?? String(e));

const providerName = (registry, id) => (registry.has(id) ? registry.get(id).name : `${id} (reyestrdə yoxdur)`);

// --- aktiv tab -------------------------------------------------------------------------
// İki yerdə lazımdır: "bu sayt" relay-i onun saytını mənimsəyir, 🗑 düyməsi onun məlumatını
// silir. Popup açıq olduğu müddətdə tab dəyişmir, ona görə bir dəfə oxunur.
// `null` — tab adi sayt deyil (chrome://, extension səhifəsi, file://).
let activeTab = null;

async function readActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const plan = tabCleanupPlan(tab?.url);
  activeTab = plan ? { id: tab.id, plan } : null;
}

// --- sayt seçimləri -------------------------------------------------------------------
// Forma seçilmiş temp mail saytının SXEMİNDƏN qurulur (options-ui.js): popup heç bir saytı
// tanımır, ona görə yeni sayt əlavə olunanda bura heç nə yazılmır.
let form = { read: () => ({}) };

function buildOptions(choice) {
  const tempId = $("temp").value;
  const provider = TEMP_MAIL.has(tempId) ? TEMP_MAIL.get(tempId) : null;
  form = renderOptions($("options"), provider, resolveValues(provider, storedValues(choice, tempId)), persist);
  // Düymə ikondur: seçilmiş sayt tooltip-də və panelin içində görünür
  setIcon("mail-toggle", Icon.mail);
  $("mail-toggle").title = `Poçt saytı: ${provider ? provider.name : "yoxdur"}`
    + (hasOptions(provider) ? " (parametrləri də burada)" : "");
}

function buildRelay() {
  const relayId = $("relay").value;
  const relay = RELAY.has(relayId) ? RELAY.get(relayId) : null;
  const adopting = adoptsActiveTab(relay);
  setIcon("relay-toggle", Icon.link);
  // "Bu sayt" relay-ində mənimsəniləcək domen tooltip-də yazılır: Başlat basmazdan əvvəl
  // hansı sayt üçün kod axtarılacağı görünməlidir.
  $("relay-toggle").title = adopting
    ? `Bu sayt: ${activeTab?.plan.domain ?? "aktiv tab adi sayt deyil"}`
    : `Relay saytı: ${relay ? relay.name : "yoxdur"}`;
  $("relay-url").textContent = adopting
    ? (activeTab
      ? `Kod ${activeTab.plan.domain} üçün axtarılacaq. Tab açılmır; qeydiyyat forması özü açılıb doldurulur (ad, ünvan, parol, telefon…), razılıq xanalarının hamısı (görünməyənlər daxil) işarələnir və mərhələyə uyğun düymə basılır — kod hələ yoxdursa "Send code / kodu göndər", kod gələndən sonra isə təsdiq/qeydiyyat düyməsi.`
      : "Aktiv tab adi sayt deyil (yalnız http/https).")
    : (relay?.url ?? "");
}

// Panellər: eyni anda yalnız biri açıq qalır ki, səth yığcam olsun. Panel açıq olanda
// SESSİYAYA aid bloklar (ünvan, kod, hesab, sessiya sətri) gizlədilir: proxy siyahısı ilə
// işləyərkən poçt/parol kartları qarışıqlıq yaradır. Onlar extension-ın ana səthinə aiddir.
function openPanel(id) {
  let opened = false;
  for (const [panel, toggle] of [["mail-panel", "mail-toggle"], ["relay-panel", "relay-toggle"], ["proxy-panel", "proxy-toggle"]]) {
    const open = panel === id && $(panel).hidden;
    $(panel).hidden = !open;
    $(toggle).setAttribute("aria-expanded", String(open));
    opened = opened || open;
  }
  document.body.classList.toggle("panel-open", opened);
}
$("mail-toggle").onclick = () => openPanel("mail-panel");
$("relay-toggle").onclick = () => openPanel("relay-panel");
$("proxy-toggle").onclick = () => openPanel("proxy-panel");

// Son seçimi qalıcı saxlancdan oxuyub formadakı cari dəyərlərlə təzələyir
async function persist() {
  const tempId = $("temp").value;
  const prev = (await readChoice()) ?? {};
  await writeChoice({ ...rememberValues(prev, tempId, form.read()), tempId, relayId: $("relay").value });
}

// Formadakı dəyərlər saytın qaydalarına uyğundur? Xəta mətni istifadəçiyə göstərilir.
// Eyni yoxlamanı worker də təkrarlayır — popup tək etibarlı mənbə deyil.
function checkedValues(temp) {
  const values = form.read();
  const error = validateValues(temp, values);
  if (error) showWarn(`${temp.name}: ${error}`);
  return error ? null : values;
}

// --- vəziyyətin göstərilməsi -----------------------------------------------------------
let addressValue = null;   // ⧉ düyməsinin dəyəri
let inboxValue = null;     // poçt kartındaki "Kopyala" dəyəri
let passwordValue = null;  // parol kartındaki "Kopyala" dəyəri
let usernameValue = null;  // hesab kartındaki istifadəçi adı
let nameValue = null;      // hesab kartındaki tam ad

async function render() {
  const [status, session, inbox] = await Promise.all([readStatus(), readSession(), readInbox()]);
  setStatusBox(status);

  const live = Boolean(session);
  // TƏK düymə: sessiya yoxdursa başladır (▶), varsa dayandırır (■). Rəng vəziyyəti deyir:
  // işləyir → yaşıl (hover qırmızı, çünki basanda dayanacaq); dayanıb → qırmızı (hover yaşıl).
  $("run").innerHTML = live ? Icon.stop : Icon.play;
  $("run").classList.toggle("state-on", live);
  $("run").classList.toggle("state-off", !live);
  $("run").disabled = !registriesReady;
  $("run").title = live ? "Dayandır" : "Başlat";

  addressValue = typeof session?.address === "string" && session.address ? session.address : null;
  $("address").textContent = addressValue ?? (live ? "ünvan alınır…" : "ünvan hələ yoxdur");
  $("address").classList.toggle("muted", !addressValue);
  $("renew").disabled = !live;
  $("copy-address").disabled = !addressValue;

  $("session").textContent = live
    ? `Aktiv: ${providerName(TEMP_MAIL, session.tempId)} + ${session.relaySite ? new URL(session.relaySite).host : providerName(RELAY, session.relayId)}`
    : "Aktiv sessiya yoxdur";

  renderSignup(session);
  renderInbox(inbox, live);
}

// Parol, istifadəçi adı və şəxs profili worker-də yaranır (shared/password.js,
// shared/username.js, shared/identity.js) və sessiyaya yazılır: extension onları formaya özü
// yazır, amma Chrome-un "Save password" təklifi rədd olunarsa (və ya sayt sonra əlavə məlumat
// soruşarsa) dəyər itməməlidir — hesaba sonra məhz bunlarla girilir.
function renderSignup(session) {
  passwordValue = typeof session?.password === "string" && session.password ? session.password : null;
  usernameValue = typeof session?.username === "string" && session.username ? session.username : null;
  const identity = session?.identity ?? null;
  nameValue = identity?.fullName ?? null;

  $("signup").hidden = !passwordValue && !usernameValue && !nameValue;
  $("signup-name-line").hidden = !nameValue;
  $("signup-name").textContent = nameValue ?? "";
  $("signup-username-line").hidden = !usernameValue;
  $("signup-username").textContent = usernameValue ?? "";
  $("signup-password").textContent = passwordValue ?? "";

  // Qalan profil bir sətirdə: formaya bunlar yazılıb, sayt təkrar soruşarsa lazım olacaq
  const note = $("signup-profile");
  const parts = identity
    ? [identity.phoneNational, identity.birthIso, [identity.city, identity.stateCode, identity.postal].filter(Boolean).join(" ")]
      .filter(Boolean)
    : [];
  note.hidden = !parts.length;
  note.textContent = parts.join(" · ");
}

// İzləmə worker-dədir (background/inbox.js), vəziyyət isə saxlancdadır: popup onu yalnız
// göstərir. Mətnlərin hamısı shared/inbox.js-də qurulur — burada nə sayt adı, nə sayt
// qaydası var, ona görə yeni provider əlavə olunanda popup-a heç nə yazılmır.
function renderInbox(inbox, live) {
  const panel = $("inbox");
  // Sessiya bitəndə panel gizlənir: köhnə ünvanın kodu yeninin kimi görünməməlidir
  panel.hidden = !live || !inbox;
  if (panel.hidden) { inboxValue = null; return; }

  const found = inbox.phase === InboxPhase.found;
  const payload = inboxPayload(inbox);
  panel.classList.toggle("found", found);
  panel.classList.toggle("err", inbox.phase === InboxPhase.error);

  $("inbox-label").textContent = inboxLabel(inbox) ?? "Poçt qutusu";
  $("inbox-value").hidden = !found;
  $("inbox-code").textContent = payload ?? "";
  // Keçid varsa "Aç" da görünür; kodu açmağın mənası yoxdur
  $("inbox-open").hidden = !inbox.link;
  if (inbox.link) $("inbox-open").href = inbox.link;
  $("inbox-copy").disabled = !payload;
  inboxValue = found ? payload : null;

  // Tapıntıda dəyər öz qutusunda görünür — eyni mətni sətirlə təkrarlamırıq
  $("inbox-note").textContent = found ? "" : inboxSummary(inbox);
  $("inbox-detail").textContent = inboxDetail(inbox) ?? "";
}

subscribeToSessionArea(render);
// Alət vəziyyəti local sahədədir (proxy siyahısı, aktiv proxy, qalxan) — idxal worker-də
// arxada bitir, ona görə popup dəyişikliyi dinləyir.
subscribeToLocalArea(renderTools);

// Popup açılanda nişan silinir: istifadəçi kodu artıq gördü, ikonun üstündə ✓ qalmamalıdır
clearBadge().catch((e) => console.warn("nişan silinmədi:", e?.message ?? e));

// --- başlanğıc -------------------------------------------------------------------------
applyTheme((await readTheme()) ?? systemTheme());
// Aktiv tab hər iki səthdən əvvəl oxunur: relay düyməsi və 🗑 onu işlədir
await readActiveTab();

// Son seçim yadda saxlanır; provider sonradan silinibsə siyahıdakı ilk dəyər göstərilir
const choice = await readChoice();
if (choice?.tempId && TEMP_MAIL.has(choice.tempId)) $("temp").value = choice.tempId;
if (choice?.relayId && RELAY.has(choice.relayId)) $("relay").value = choice.relayId;
buildOptions(choice);
buildRelay();
await render();

// --- handler-lar -----------------------------------------------------------------------
// Xəta tutulub status qutusuna yazılır (console-da itmir). Hadisə obyekti ÖTÜRÜLÜR: `drop`
// kimi handler-lər `dataTransfer`-ə baxır (event olmadan `preventDefault` da mümkün deyil).
const onClick = (handler) => async (...args) => {
  try { await handler(...args); } catch (e) { showFailure(e); }
};

// Kopyalamaq popup-ın öz işidir: popup fokuslu sənəddir, klik jesti var və "clipboardWrite"
// icazəsi manifest-də yazılıb. Worker-dəki offscreen yolu (Message.copy) burada işləmir —
// o mesaj worker→offscreen üçündür.
const copyFrom = (id, value) => onClick(async () => {
  if (!value()) return;
  await navigator.clipboard.writeText(value());
  const button = $(id);
  setIcon(id, Icon.check);
  setTimeout(() => setIcon(id, Icon.copy), 1100);
  button.blur();
});

$("temp").onchange = onClick(async () => {
  buildOptions(await readChoice());
  await persist();
});
$("relay").onchange = onClick(async () => {
  buildRelay();
  await persist();
});

// Başlat / Dayandır — vəziyyətə görə
$("run").onclick = onClick(async () => {
  if (await readSession()) {
    await send(Message.stop());
    return;
  }
  const tempId = $("temp").value;
  const relayId = $("relay").value;
  const temp = TEMP_MAIL.get(tempId);
  const relay = RELAY.get(relayId);

  const values = checkedValues(temp);
  if (!values) return;

  // "Bu sayt" relay-i aktiv tabın saytını mənimsəyir: tabın id-si göndərilir, URL-i worker
  // özü oxuyur. Adi relay üçün tabId nəzərə alınmır.
  if (adoptsActiveTab(relay) && !activeTab) {
    showWarn("Bu sayt: aktiv tab adi sayt deyil — http/https saytında Başlat basın");
    return;
  }

  // Sayt reyestrə əlavə olunub, manifest-ə host icazəsi yazılmayıbsa səssiz uğursuzluq
  // əvəzinə burada deyilir (API rejimində də lazımdır: worker-in fetch-i CORS-dan keçməlidir).
  const missing = await missingOrigins(temp, relay);
  if (missing.length) {
    showError("manifest.json → host_permissions-a bunları əlavə edib extension-ı yenilə: " + missing.join("  "));
    return;
  }

  await persist();
  await send(Message.start(tempId, relayId, values, activeTab?.id ?? null));
});

// Yeni ünvan: ünvanın yanındaki ⟳. Formadakı CARI dəyərləri tətbiq edir — Gmail-dən Outlook-a
// keçib basa bilərsən. Amma sayt dəyişibsə sessiya köhnə saytla işləyir: bu halda Başlat
// lazımdır, əks halda seçimlər səssizcə yanlış sxemə görə normallaşardı.
$("renew").onclick = onClick(async () => {
  const session = await readSession();
  if (!session) throw new ExpectedError("aktiv sessiya yoxdur, əvvəlcə Başlat");
  if (session.tempId !== $("temp").value) {
    showWarn(`Sessiya ${providerName(TEMP_MAIL, session.tempId)} ilə işləyir — yeni saytı tətbiq etmək üçün Başlat basın`);
    return;
  }
  const values = checkedValues(TEMP_MAIL.get(session.tempId));
  if (!values) return;
  $("renew").classList.add("spin");
  setTimeout(() => $("renew").classList.remove("spin"), 700);
  await persist();
  await send(Message.newAddress(values));
});

$("copy-address").onclick = copyFrom("copy-address", () => addressValue);
$("inbox-copy").onclick = copyFrom("inbox-copy", () => inboxValue);
$("inbox-retry").onclick = onClick(async () => {
  const button = $("inbox-retry");
  button.disabled = true;
  try { await send(Message.retryInbox()); }
  finally { button.disabled = false; }
});
$("signup-copy").onclick = copyFrom("signup-copy", () => passwordValue);
$("signup-username-copy").onclick = copyFrom("signup-username-copy", () => usernameValue);
$("signup-name-copy").onclick = copyFrom("signup-name-copy", () => nameValue);

// --- "Sayt məlumatını sil" --------------------------------------------------------------
// TƏK klik: silmə dərhal göndərilir, host icazəsi isə eyni klikdə (ilk dəfə) istənilir.
// İcazə pəncərəsi popup-ı bağlaya bilər — heç nə itmir, çünki silmə artıq göndərilib və
// icazə verilən kimi worker onu tam şəkildə təkrarlayır (background.js → permissions.onAdded).
$("wipe").disabled = !activeTab;
$("wipe").title = activeTab
  ? activeTab.plan.familyName
    ? `${activeTab.plan.domain} + ${activeTab.plan.familyName} (${activeTab.plan.cookieDomains.length} domen) — cookie, saxlanc və keşi sil (tab yenilənir)`
    : `${activeTab.plan.domain} — cookie, saxlanc və keşi sil (tab yenilənir)`
  : "Yalnız http/https saytlarının məlumatı silinə bilər";

$("wipe").onclick = onClick(async () => {
  if (!activeTab) return;
  const { domain } = activeTab.plan;
  // Əvvəl silmə: heç bir icazə pəncərəsi bu axını kəsməməlidir
  await send(Message.clearTab(activeTab.id));
  setIcon("wipe", Icon.check);
  setTimeout(() => setIcon("wipe", Icon.trash), 1100);
  // Sonra icazə (yalnız ilk dəfə pəncərə açılır). Verilən kimi worker silməni tamamlayır.
  if (!await hasOriginAccess(domain).catch(() => false)) await requestOriginAccess(domain);
});


// --- alətlər: izləyici qalxanı və proxy ------------------------------------------------
// Vəziyyət saxlancdadır, popup yalnız göstərir. Proxy siyahısı YALNIZ istifadəçinin verdiyi
// ünvanlardan ibarətdir — açıq mənbələrdən idxal yoxdur, ona görə nə süzgəc, nə sıralama
// lazımdır. Toplu əlavədən sonra yüzlərlə sətir ola bilər: hamısını DOM-a yazmaq popup-ı
// ləngidər, ona görə görünən hissə məhduddur (qalanı qeyddə sayılır).
const VISIBLE_ROWS = 120;
let visibleRows = VISIBLE_ROWS;
// Toplu əməliyyat üçün seçilmiş açarlar. Yalnız popup açıq olduğu müddətdə yaşayır:
// seçim vəziyyətdir, məlumat deyil — saxlanca yazmağın mənası yoxdur.
const selected = new Set();

// Brauzerin HƏQİQİ proxy parametri. Saxlancdaki qeyddən ayrıdır və ayrı oxunmalıdır: parametr
// qalıcıdır, ona görə qeyd silinmiş halda da qüvvədə qala bilər (məhz bu halda bütün saytlar
// açılmır və istifadəçi səbəbini heç yerdə görmür). Popup-ın işi onu GÖSTƏRMƏK və buraxmaq
// üçün düymə verməkdir.
async function browserProxyControl() {
  try {
    return readProxyControl(await chrome.proxy.settings.get({ incognito: false }));
  } catch {
    return readProxyControl(null);
  }
}

async function renderTools() {
  const [shield, active, { list }, control] = await Promise.all([
    readShield(), readActiveProxy(), readProxies(), browserProxyControl(),
  ]);
  // Qeyd yoxdur, trafik isə hələ bizdən keçir: parametr brauzerdə qalıb
  const stuck = !active && isRouting(control);

  // Vəziyyət rəngi: açıq alət yaşıl, sönülü qırmızı (hover əksinə — bax: popup.css)
  const setState = (id, on) => {
    $(id).classList.toggle("state-on", on);
    $(id).classList.toggle("state-off", !on);
  };
  setState("shield", shield);
  $("shield").title = shield
    ? "İzləyici qalxanı AÇIQ — analitika, reklam və seans yazıcıları bloklanır (söndürmək üçün bas)"
    : "İzləyici qalxanı sönülüdür — açmaq üçün bas";

  const activeKey = active ? proxyKey(active) : null;
  setState("proxy-toggle", Boolean(active) || stuck);
  $("proxy-toggle").title = active
    ? `Proxy: ${proxyLabel(active)} (${active.scheme})${active.exitIp ? " → " + active.exitIp : ""}`
    : stuck
      ? "Brauzerdə proxy parametri qalıb — bütün trafik ondan keçir (buraxmaq üçün paneli aç)"
      : "Proxy qoşulu deyil";

  $("proxy-state").textContent = active
    ? `Qoşulu: ${proxyLabel(active)} · ${active.scheme}${active.exitIp ? " · çıxış " + active.exitIp : ""}`
    : stuck
      ? `⚠ Brauzerdə proxy parametri qalıb (${control.mode}) — bütün trafik ondan keçir. Sağdaki düymə birbaşa bağlantıya qaytarır.`
      : "Proxy qoşulu deyil (birbaşa bağlantı)";
  // Düymə qeyd olmadıqda da görünür: parametr qalıbsa istifadəçinin onu buraxmaq yolu olmalıdır
  $("proxy-off").hidden = !active && !stuck;
  $("proxy-off").title = stuck ? "Brauzerin proxy parametrini buraxın (birbaşa bağlantı)" : "Ayır";

  // Silinmiş qeydlər seçimdə qalmasın
  const keys = new Set(list.map(proxyKey));
  for (const key of [...selected]) if (!keys.has(key)) selected.delete(key);

  const box = $("proxy-list");
  box.textContent = "";
  const fragment = document.createDocumentFragment();
  const shown = orderProxies(list);
  for (const proxy of shown.slice(0, visibleRows)) {
    const key = proxyKey(proxy);
    const on = key === activeKey;
    const row = document.createElement("div");
    row.className = "row" + (on ? " on" : "") + (proxy.dead ? " dead" : "");
    row.title = [proxyLabel(proxy), proxy.scheme,
      proxy.username ? `giriş: ${proxy.username}` : null,
      typeof proxy.ping === "number" ? `son cavab ${formatPing(proxy)}` : "hələ yoxlanmadı",
      proxy.dead ? "son yoxlamada cavab vermədi" : null]
      .filter(Boolean).join(" · ");

    // Toplu seçim üçün xana
    const mark = document.createElement("input");
    mark.type = "checkbox";
    mark.className = "mark";
    mark.checked = selected.has(key);
    mark.title = "Toplu əməliyyat üçün seç";
    mark.onchange = () => {
      if (mark.checked) selected.add(key); else selected.delete(key);
      renderBulk(list);
    };
    row.append(mark);

    // Ünvan sətirdə görünür: siyahı istifadəçinin özünün ünvanlarıdır, tanıması lazımdır
    const addr = document.createElement("span");
    addr.className = "addr";
    addr.textContent = proxyLabel(proxy);
    row.append(addr);

    const scheme = document.createElement("span");
    scheme.className = "tag";
    scheme.textContent = proxy.scheme;
    row.append(scheme);

    // Parol tələb edən proxy görünsün: giriş məlumatı olan qeyd ayrı nişan alır
    if (proxy.username) {
      const auth = document.createElement("span");
      auth.className = "tag auth";
      auth.textContent = "giriş";
      row.append(auth);
    }

    // Ölçü: qoşulma yoxlamasında ölçülmüş gecikmə (hələ qoşulmamışsa "—")
    const metric = document.createElement("span");
    metric.className = "metric";
    metric.textContent = formatPing(proxy);
    row.append(metric);

    // TƏK ikon düymə: qoşulu proxy yaşıldır (basanda ayrılır), qalanları qırmızıdır
    // (basanda qoşulur). Hover rəngi klikin nəticəsini deyir — bax: popup.css.
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "icon " + (on ? "state-on" : "state-off");
    toggle.title = on ? "Ayır" : "Qoşul";
    toggle.innerHTML = Icon.plug;
    toggle.onclick = onClick(async () => {
      toggle.disabled = true;
      try {
        await send(on ? Message.proxyDisconnect() : Message.proxyConnect(key));
        await renderTools();
      } finally { toggle.disabled = false; }
    });
    row.append(toggle);

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "icon danger";
    remove.title = "Siyahıdan sil";
    remove.innerHTML = Icon.x;
    remove.onclick = onClick(async () => {
      await send(Message.proxyRemove(key));
      await renderTools();
    });
    row.append(remove);

    fragment.append(row);
  }
  box.append(fragment);

  const dead = list.filter((proxy) => proxy.dead).length;
  const hidden = Math.max(0, shown.length - visibleRows);
  $("proxy-more").hidden = hidden === 0;
  $("proxy-note").textContent = list.length
    ? `${list.length} proxy${hidden ? ` (ilk ${visibleRows} göstərilir)` : ""}${dead ? `, ${dead} son yoxlamada cavab vermədi` : ""}. Ölçülən gecikmə qoşulma anında bu maşından alınır. Yerli ünvanlar (localhost, 127.0.0.1) həmişə proxy-dən kənarda qalır.`
    : "Siyahı boşdur — proxy-ləri yuxarıdaki xanaya yaz (hər sətirdə biri) və ya faylı üstünə at. Formatlar: 1.2.3.4:8080 · socks5://1.2.3.4:1080 · user:pass@1.2.3.4:8080 · 1.2.3.4:8080:user:pass · proxy.example.com:3128";

  renderBulk(list);

  // Parol tələb edən proxy varsa geniş host icazəsi lazımdır: onsuz Chrome hər proxy sorğusunda
  // autentifikasiya pəncərəsi açır. İcazə yalnız AYRI klikdə istənilə bilər (jest qaydası).
  const withAuth = list.filter((proxy) => proxy.username).length;
  const granted = withAuth ? await hasAllSitesAccess().catch(() => false) : true;
  $("proxy-auth").hidden = granted;
  if (!granted) {
    $("proxy-auth-note").textContent =
      `${withAuth} proxy parol tələb edir. İcazə verməsən Chrome parolu hər dəfə özü soruşacaq.`;
  }
}

// Toplu cərgə: seçim sayı və əməliyyat düymələri. Siyahı boşdursa cərgə də görünmür.
function renderBulk(list) {
  const visible = orderProxies(list).slice(0, visibleRows);
  const count = selected.size;
  $("proxy-bulk").hidden = list.length === 0;
  $("proxy-count").textContent = count ? `${count} seçildi` : `${list.length} proxy`;
  $("proxy-all").checked = visible.length > 0 && visible.every((proxy) => selected.has(proxyKey(proxy)));
  $("proxy-all").indeterminate = count > 0 && !$("proxy-all").checked;
  $("proxy-copy").disabled = count === 0;
  $("proxy-drop-selected").disabled = count === 0;
}

// Seçilmiş qeydlərin mətn forması: kopyalama və silmə eyni sıradan gedir
const selectedProxies = (list) => orderProxies(list).filter((proxy) => selected.has(proxyKey(proxy)));

$("proxy-more").onclick = onClick(async () => {
  visibleRows += VISIBLE_ROWS;
  await renderTools();
});

$("proxy-all").onchange = onClick(async () => {
  const { list } = await readProxies();
  const visible = orderProxies(list).slice(0, visibleRows);
  if ($("proxy-all").checked) for (const proxy of visible) selected.add(proxyKey(proxy));
  else selected.clear();
  await renderTools();
});

$("proxy-copy").onclick = onClick(async () => {
  const { list } = await readProxies();
  const lines = selectedProxies(list).map((proxy) =>
    `${proxy.scheme}://${proxy.username ? `${encodeURIComponent(proxy.username)}:${encodeURIComponent(proxy.password ?? "")}@` : ""}${proxyLabel(proxy)}`);
  if (!lines.length) return;
  await navigator.clipboard.writeText(lines.join("\n"));
  setIcon("proxy-copy", Icon.check);
  setTimeout(() => setIcon("proxy-copy", Icon.copy), 1100);
});

$("proxy-drop-selected").onclick = onClick(async () => {
  if (!selected.size) return;
  await send(Message.proxyRemove([...selected]));
  selected.clear();
  await renderTools();
});

$("shield").onclick = onClick(async () => {
  const on = await readShield();
  await send(Message.setShield(!on));
  await renderTools();
});

// Diaqnostika: aktiv tabın səhifəsini təsvir edib clipboard-a kopyalayır. Heç nə dəyişdirmir.
// Niyə var: qeydiyyat səthinin tapılması təxmindir; səhv təxmini kənardan görmək mümkün deyil,
// bu isə səhifənin əsl quruluşunu (xanalar, klikləniləsi mətnlər, valideyn zənciri) verir.
$("diag").onclick = onClick(async () => {
  if (!activeTab) { $("diag-note").textContent = "Aktiv tab adi sayt deyil (yalnız http/https)."; return; }
  $("diag-note").textContent = "Səhifə oxunur…";
  const reply = await send(Message.describePage(activeTab.id));
  const text = JSON.stringify(reply.result ?? null, null, 2);
  await navigator.clipboard.writeText(text);
  const report = reply.result ?? {};
  $("diag-note").textContent = `Kopyalandı (${text.length} simvol): ${report.fields?.length ?? 0} xana, `
    + `${report.clickables?.length ?? 0} klikləniləsi mətn, ${report.forms?.length ?? 0} forma. `
    + "Mətni yapışdırıb göndər.";
});

$("proxy-off").onclick = onClick(async () => {
  await send(Message.proxyDisconnect());
  await renderTools();
});

// Şəxsi proxy-lərin TOPLU əlavəsi. Mətn bir sətir də, fayldan oxunmuş yüzlərlə sətir də ola
// bilər — ayrıştırma worker-dədir (shared/proxy.js → parseProxyLines).
//
// DİQQƏT: burada `chrome.permissions.request` ÇAĞIRILMIR. O funksiya yalnız istifadəçi jestinin
// içində işləyir, fayl oxumaq isə (`await file.text()`) jesti bitirir — yəni əlavə axınında
// icazə istəmək "must be called during a user gesture" xətası ilə batır. Ona görə icazə ayrıca
// düymədən istənilir (bax: #proxy-auth-grant); icazə olmasa proxy yenə işləyir, sadəcə parolu
// Chrome özü soruşur.
async function submitProxyText(input) {
  // Bir mətn və ya bir NEÇƏ mətn (hər fayl ayrı) gələ bilər
  const parts = (Array.isArray(input) ? input : [input])
    .map((part) => String(part ?? "").trim())
    .filter(Boolean);
  if (!parts.length) return;
  await send(Message.proxyAdd(parts.length === 1 ? parts[0] : parts));
  $("proxy-input").value = "";
  await renderTools();
}

const addFromInput = () => submitProxyText($("proxy-input").value);

$("proxy-add").onclick = onClick(addFromInput);
// Enter yeni sətir yazır (çoxsətirli xana), Ctrl/⌘+Enter göndərir
$("proxy-input").onkeydown = (event) => {
  if (event.key !== "Enter" || !(event.ctrlKey || event.metaKey)) return;
  event.preventDefault();
  onClick(addFromInput)();
};

// İcazə sorğusu jestin İÇİNDƏ çağrılmalıdır: bu handler-də ondan əvvəl heç bir `await` yoxdur.
$("proxy-auth-grant").onclick = () => {
  requestAllSitesAccess()
    .then(() => renderTools())
    .catch((e) => showWarn(`icazə alınmadı: ${e?.message ?? e}`));
};

// --- fayldan yükləmə -------------------------------------------------------------------
// İki yol var, çünki popup fokusu itirəndə bağlanır: fayl seçmə pəncərəsi bəzi sistemlərdə
// popup-ı bağlayır. DARTIB-ATMA isə həmişə işləyir — ona görə hər ikisi dəstəklənir.
//
// Fayllar BİRLƏŞDİRİLMİR: hər faylın mətni ayrı gedir, çünki `.txt` və `.json` bir yerdə
// seçilə bilər — birləşdirsək JSON sadəcə tanınmayan sətir olardı.
const filesText = (files) => Promise.all([...files].map((file) => file.text()));

$("proxy-file").onclick = () => $("proxy-file-input").click();
$("proxy-file-input").onchange = onClick(async () => {
  const input = $("proxy-file-input");
  if (!input.files?.length) return;
  const texts = await filesText(input.files);
  input.value = "";                      // eyni faylı təkrar seçmək mümkün olsun
  await submitProxyText(texts);
});

const drop = $("proxy-drop");
for (const type of ["dragenter", "dragover"]) {
  drop.addEventListener(type, (event) => {
    event.preventDefault();
    drop.classList.add("over");
  });
}
drop.addEventListener("dragleave", () => drop.classList.remove("over"));
drop.addEventListener("drop", onClick(async (event) => {
  event.preventDefault();
  drop.classList.remove("over");
  const files = event.dataTransfer?.files;
  // Fayl da, seçilmiş mətn bloku da atıla bilər
  const text = files?.length ? await filesText(files) : event.dataTransfer?.getData("text");
  await submitProxyText(text);
}));

// Alət səthi ƏN SONDA qurulur: sətirlərin düymələri `onClick`-i işlədir, o isə bu fayldan
// yuxarıda deyil, handler bölməsində elan olunub (əvvəl çağırsaq TDZ xətası olardı).
await renderTools();
