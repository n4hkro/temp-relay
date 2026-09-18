// Proxy qatı: ŞƏXSİ proxy-lərin siyahısı, qoşulma/ayrılma və çıxış IP-nin yoxlanması.
//
// Bölgü: sətirin NECƏ oxunduğu — `shared/proxy.js` (saf, testlənir); chrome ilə iş buradadır.
//
// Açıq (ictimai) proxy siyahıları QƏSDƏN YOXDUR. Onlar tanımadığın maşınlardır, şifrələnməmiş
// trafiki oxuya bilər və dəqiqələr içində sönür — yəni siyahı ya ölü olur, ya təhlükəli.
// Siyahını yalnız istifadəçi özü doldurur: `addProxy()`.
//
// Chrome-un proxy parametri BRAUZER SƏVİYYƏSİNDƏDİR: qoşulanda bütün tablar, o cümlədən
// extension-ın öz sorğuları həmin proxy-dən keçir. Ona görə:
//   • yerli ünvanlar bypass siyahısındadır (shared/proxy.js → BYPASS);
//   • parametr qalıcıdır — brauzer bağlanıb açılsa da qalır, o səbəbdən aktiv proxy
//     saxlanca yazılır və popup vəziyyəti göstərir.
//
// ⚠ ƏN VACİB QAYDA — İŞLƏMƏYƏN PROXY BRAUZERDƏ QALMAMALIDIR.
// Parametr qalıcı olduğu üçün cavab verməyən proxy qoşulu qalsa BÜTÜN saytlar açılmır və bu
// vəziyyət brauzer yenidən başladıqdan sonra da davam edir (extension hər aktivləşəndə
// parametri yenidən tətbiq edir). Real brauzerdə məhz belə oldu: istifadəçi saytları açmaq üçün
// extension-ı söndürmək məcburiyyətində qaldı, popup isə "proxy qoşulu deyil" yazırdı — çünki
// saxlancdaki qeyd silinmişdi, brauzerin parametri isə qalmışdı. Ona görə üç yerdə eyni qayda
// işləyir: yoxlama batsa (`connectProxy`, `resumeProxy`) və ayrılanda (`disconnectProxy`)
// parametr MƏCBURİ buraxılır və buraxılmanın baş tutduğu YOXLANILIR (`releaseProxy`).
//
// Şəxsi proxy-lərin istifadəçi adı/parolu: Chrome autentifikasiya pəncərəsi açır, biz onu
// `webRequest.onAuthRequired` ilə cavablandırırıq (manifest-də `webRequestAuthProvider`
// icazəsi məhz bunun üçündür — MV3-də bloklayan webRequest yalnız bu halda mümkündür).

import { ExpectedError } from "../shared/errors.js";
import {
  isRouting, isIpv4, MAX_PROXIES, mergeProxies, parseProxyLines, proxyConfig, proxyKey, proxyLabel, proxyProblem,
  pruneImported, readProxyControl,
} from "../shared/proxy.js";
import {
  clearActiveProxy, readActiveProxy, readProxies, StatusLevel, writeActiveProxy, writeProxies,
  writeStatus,
} from "../shared/state.js";

// Çıxış IP yoxlaması: proxy ölü olsa bu sorğu cavabsız qalır
const CHECK_TIMEOUT_MS = 10000;
// Çıxış IP-ni deyən ən sadə xidmət (cavab: yalnız IP mətni)
export const IP_CHECK_URL = "https://api.ipify.org/?format=text";

// Chrome proxy parametri və ona bağlı local storage qeydləri bir vəziyyət maşınıdır. Bütün
// read-modify-write addımları bu növbədən keçir; şəbəkə yoxlaması isə növbəni saxlamır.
let proxyMutations = Promise.resolve();
function mutateProxy(job) {
  const result = proxyMutations.then(job);
  proxyMutations = result.catch(() => {});
  return result;
}

// Uzun şəbəkə yoxlamasının nəticəsi yalnız onu başladan son seçimə aiddir. Yeni qoşulma və
// ayrılma köhnə yoxlamanı həm ləğv edir, həm də fetch ləğvi qəbul etməsə nəticəsini etibarsız
// sayır. Beləcə növbə fetch gözləmir və Ayrıl düyməsi dərhal işləyir.
let lifecycleVersion = 0;
let pendingCheck = null;
function beginLifecycle() {
  lifecycleVersion += 1;
  pendingCheck?.controller.abort();
  pendingCheck = null;
  return lifecycleVersion;
}
const isCurrentLifecycle = (version) => version === lifecycleVersion;
const cancelledExit = () => ({ ok: false, cancelled: true, error: "yoxlama ləğv edildi" });

// --- əlavə etmə -----------------------------------------------------------------------------
// TOPLU əlavə: mətn bir sətir də, yüzlərlə sətir də ola bilər (fayldan oxunmuş `.txt`/JSON
// bloku popup-dan həmin mətn kimi gəlir). Tanınmayan sətirlər ATILMIR — səbəbi ilə statusda
// deyilir, çünki 200 sətirdən 3-ünün niyə düşmədiyini başqa yolla görmək mümkün deyil.
//
// Nəticə: { added, duplicates, invalid: [{ line, reason }], total }
export async function addProxies(text) {
  const { proxies, invalid, duplicates } = parseProxyLines(text, { max: MAX_PROXIES });
  if (!proxies.length) {
    const reason = invalid[0]?.reason ?? "ünvan tapılmadı";
    throw new ExpectedError(invalid.length
      ? `heç bir ünvan tanınmadı (${invalid.length} sətir) — ${reason}`
      : reason);
  }

  return mutateProxy(async () => {
    const { list } = await readProxies();
    const before = new Set(list.map(proxyKey));
    // Yeni qeydlər ÖNDƏ: təkrar əlavə köhnə qeydi əvəz edir (parol dəyişmiş ola bilər)
    const merged = mergeProxies(proxies, list, { max: MAX_PROXIES });
    const added = merged.filter((proxy) => !before.has(proxyKey(proxy))).length;
    const replaced = proxies.length - added;
    await writeProxies(merged);

    const parts = [`${added} proxy əlavə olundu`];
    if (replaced) parts.push(`${replaced} təzələndi`);
    if (duplicates) parts.push(`${duplicates} təkrar`);
    if (invalid.length) parts.push(`${invalid.length} sətir tanınmadı (${invalid[0].reason})`);
    if (merged.length >= MAX_PROXIES) parts.push(`tavan ${MAX_PROXIES}`);
    await writeStatus(invalid.length ? StatusLevel.warn : StatusLevel.info,
      `${parts.join(", ")} · siyahıda ${merged.length}`);
    return { added, replaced, duplicates, invalid, total: merged.length };
  });
}

// Bir və ya BİR NEÇƏ qeyd silinir (toplu seçim). Qoşulu proxy silinənlər arasındadırsa
// bağlantı da kəsilir — əks halda siyahıda olmayan proxy-dən trafik keçməyə davam edərdi.
export async function removeProxy(keys) {
  const doomed = new Set(Array.isArray(keys) ? keys : [keys]);
  return mutateProxy(async () => {
    const { list } = await readProxies();
    const kept = list.filter((proxy) => !doomed.has(proxyKey(proxy)));
    const removed = list.length - kept.length;
    await writeProxies(kept);

    const active = await readActiveProxy();
    if (active && doomed.has(proxyKey(active))) {
      if (pendingCheck?.key === proxyKey(active)) beginLifecycle();
      await disconnectProxyNow();
    } else if (removed > 1) {
      await writeStatus(StatusLevel.info, `${removed} proxy silindi · siyahıda ${kept.length}`);
    }
    return { removed, total: kept.length };
  });
}

// --- brauzerin parametri --------------------------------------------------------------------
// Saxlancdaki qeyd ilə brauzerin həqiqi parametri ayrı şeylərdir (bax: shared/proxy.js →
// readProxyControl). Aşağıdaki iki funksiya həmin fərqi görmək və aradan qaldırmaq üçündür.

// Brauzerin cari proxy parametri: { mode, level, ours, routed }. Oxuna bilməsə "yönləndirmə
// yoxdur" sayılır — bu halda heç nə etməmək düzgün davranışdır.
export async function browserProxy() {
  try {
    return readProxyControl(await chrome.proxy.settings.get({ incognito: false }));
  } catch (e) {
    console.warn("brauzerin proxy parametri oxunmadı:", e?.message ?? e);
    return readProxyControl(null);
  }
}

const sameEndpoint = (left, right) => Boolean(left && right)
  && String(left.scheme ?? "").toLowerCase() === String(right.scheme ?? "").toLowerCase()
  && String(left.host ?? "").toLowerCase() === String(right.host ?? "").toLowerCase()
  && Number(left.port) === Number(right.port);

const effectiveSingleProxy = (details) => details?.value?.mode === "fixed_servers"
  ? details.value.rules?.singleProxy ?? null
  : null;

const ownsEffectiveProxy = (details, selected) =>
  details?.levelOfControl === "controlled_by_this_extension"
  && sameEndpoint(effectiveSingleProxy(details), selected);

async function readProxyDetails() {
  return chrome.proxy.settings.get({ incognito: false });
}

async function verifyAppliedProxy(selected) {
  let details;
  try {
    details = await readProxyDetails();
  } catch (e) {
    throw new ExpectedError(`Chrome proxy parametrini yoxlamaq mümkün olmadı: ${e?.message ?? e}`);
  }
  if (ownsEffectiveProxy(details, selected)) return details;

  const control = readProxyControl(details);
  if (!control.ours) {
    throw new ExpectedError("Chrome proxy parametri başqa mənbə tərəfindən idarə olunur; seçilmiş proxy tətbiq edilmədi");
  }
  throw new ExpectedError("Chrome seçilmiş proxy host/port/sxem parametrini tətbiq etmədi");
}

// Parametri buraxır və BURAXILDIĞINI YOXLAYIR.
//
// `clear()` tək başına kifayət etmir: cavabı gözlənilməz ola bilər (extension söndürülürsə,
// parametr başqa scope-dan gəlirsə, sorğu itirsə) və nəticədə brauzer ölü proxy ilə qalır.
// Ona görə buraxmadan sonra parametr yenidən oxunur; hələ də bizdən keçirsə BİRBAŞA bağlantı
// məcbur edilir. Saytların açılması parametrin kimə aid olmasından vacibdir.
async function releaseProxyNow() {
  const clear = async () => {
    try { await chrome.proxy.settings.clear({ scope: "regular" }); return true; } catch (e) {
      console.warn("proxy parametri buraxılmadı:", e?.message ?? e);
      return false;
    }
  };

  await clear();
  let control = await browserProxy();
  if (!isRouting(control)) return control;

  // Buraxma tutmadı: əvvəlcə trafik birbaşa bağlantıya qaytarılır (saytlar dərhal açılsın),
  // sonra parametri tam buraxmaq bir daha sınanır.
  try {
    await chrome.proxy.settings.set({ value: { mode: "direct" }, scope: "regular" });
  } catch (e) {
    console.warn("birbaşa bağlantı məcbur edilmədi:", e?.message ?? e);
  }
  await clear();
  control = await browserProxy();
  if (isRouting(control)) {
    console.error("brauzerin proxy parametri buraxıla bilmədi:", control.mode, control.level);
  }
  return control;
}

export function releaseProxy() {
  return mutateProxy(releaseProxyNow);
}

// --- qoşulma --------------------------------------------------------------------------------
const findProxy = async (key) => {
  const { list } = await readProxies();
  return list.find((proxy) => proxyKey(proxy) === key) ?? null;
};

// Chrome-un proxy parametrini qurur və çıxış IP-ni yoxlayır. Yoxlama batsa qoşulma
// SAXLANILMIR: parametr buraxılır, qeyd siyahıda "ölü" nişanlanır və status səbəbi yazır.
//
// Niyə saxlanılmır: parametr brauzer səviyyəsindədir və qalıcıdır — cavab verməyən proxy
// qoşulu qalsa istifadəçi heç bir sayta girə bilmir və bunu ancaq extension-ı söndürərək
// düzəldir (bax: faylın başındaki qayda).
//
// Ping də buradan gəlir: bu sorğunun müddəti bizim şəbəkəmizdən ölçülmüş əsl gecikmədir.
export async function connectProxy(key) {
  const version = beginLifecycle();
  const setup = await mutateProxy(async () => {
    if (!isCurrentLifecycle(version)) return null;
    const selected = await findProxy(key);
    if (!selected) throw new ExpectedError("proxy siyahıda yoxdur (yenidən əlavə et)");
    const problem = proxyProblem(selected);
    if (problem) throw new ExpectedError(problem);
    if (!isCurrentLifecycle(version)) return { proxy: selected, cancelled: true };

    await chrome.proxy.settings.set({ value: proxyConfig(selected), scope: "regular" });
    let details;
    try {
      details = await verifyAppliedProxy(selected);
    } catch (e) {
      // Başqa extension-ın parametrinə toxunmuruq. Bizim parametr yanlış qalıbsa isə
      // istifadəçinin bütün brauzer trafikini yanlış ünvanda saxlamamaq üçün buraxırıq.
      try {
        const current = await readProxyDetails();
        if (readProxyControl(current).ours) await releaseProxyNow();
        await clearActiveProxy();
      } catch { /* əsas, istifadəçiyə yararlı xəta aşağıda ötürülür */ }
      throw e;
    }
    if (!isCurrentLifecycle(version)) return { proxy: selected, cancelled: true };

    await writeActiveProxy(selected);
    await writeStatus(StatusLevel.info, `Proxy qoşuldu: ${proxyLabel(selected)} (${selected.scheme}), yoxlanılır…`);
    const controller = new AbortController();
    pendingCheck = { version, controller, key };
    return { proxy: selected, controller, details };
  });

  if (!setup || setup.cancelled) return { proxy: setup?.proxy ?? null, exit: cancelledExit() };

  const started = Date.now();
  let exit = await checkExit(setup.controller.signal);
  const ping = Date.now() - started;
  await mutateProxy(async () => {
    if (!isCurrentLifecycle(version)) return;
    if (pendingCheck?.version === version) pendingCheck = null;

    const active = await readActiveProxy();
    if (!active || proxyKey(active) !== key) return;

    // Yoxlama vaxtı Chrome-un effektiv parametri dəyişə bilər. Uğur statusu yazmazdan əvvəl
    // onun hələ də məhz seçilmiş və bizə aid parametr olduğunu bir daha təsdiqləyirik.
    try {
      await verifyAppliedProxy(setup.proxy);
    } catch (e) {
      exit = { ok: false, error: e?.message ?? String(e) };
      await clearActiveProxy();
      if ((await browserProxy()).ours) await releaseProxyNow();
      await writeStatus(StatusLevel.warn, `Proxy qoşulmadı: ${exit.error}`);
      return;
    }

    if (exit.ok) {
      await markProxyNow(key, { ping, dead: false });
      await writeActiveProxy({ ...setup.proxy, ping, exitIp: exit.ip, checked: Date.now() });
      await writeStatus(StatusLevel.info,
        `Proxy işləyir: ${proxyLabel(setup.proxy)} → çıxış IP ${exit.ip}, cavab ${ping} ms`);
    } else if (!exit.cancelled) {
      await markProxyNow(key, { dead: true });
      await clearActiveProxy();
      const control = await releaseProxyNow();
      await writeStatus(StatusLevel.warn, isRouting(control)
        ? `Proxy cavab vermir: ${proxyLabel(setup.proxy)} — ${exit.error}. Brauzerin parametri buraxıla bilmədi (${control.mode}) — Chrome-u yenidən başlat.`
        : `Proxy cavab vermir: ${proxyLabel(setup.proxy)} — ${exit.error}. Bağlantı kəsildi (birbaşa), qeyd "ölü" nişanlandı.`);
    }
  });
  return { proxy: setup.proxy, exit };
}

// Siyahıdaki qeydin ölçmə sahələrini təzələyir (ölü nişanı, ölçülmüş ping)
async function markProxyNow(key, patch) {
  const { list } = await readProxies();
  let changed = false;
  const next = list.map((proxy) => {
    if (proxyKey(proxy) !== key) return proxy;
    changed = true;
    const updated = { ...proxy, ...patch, checked: Date.now() };
    if (patch.dead === false) delete updated.dead;
    return updated;
  });
  if (changed) await writeProxies(next);
}

async function disconnectProxyNow() {
  // Bizim qeyd ƏVVƏL silinir: parametrin buraxılması batsa da popup "qoşulu" göstərməməlidir,
  // üstəlik növbəti açılışda `resumeProxy` qeydin yoxluğunu görüb parametri buraxır.
  await clearActiveProxy();
  const control = await releaseProxyNow();
  const stuck = isRouting(control);
  await writeStatus(stuck ? StatusLevel.warn : StatusLevel.info, stuck
    ? `Proxy ayrıldı, amma brauzerin parametri hələ qüvvədədir (${control.mode}) — Chrome-u yenidən başlat`
    : "Proxy ayrıldı (birbaşa bağlantı)");
  return control;
}

export function disconnectProxy() {
  beginLifecycle();
  return mutateProxy(disconnectProxyNow);
}

// Sorğu brauzerin cari proxy parametrindən keçir — yəni bu, tunelin işlədiyini yoxlayır.
export async function checkExit(cancellation = null) {
  const controller = new AbortController();
  const forward = () => controller.abort(cancellation.reason);
  if (cancellation?.aborted) forward();
  else cancellation?.addEventListener("abort", forward, { once: true });
  const timer = setTimeout(() => controller.abort(new DOMException("vaxt bitdi", "TimeoutError")), CHECK_TIMEOUT_MS);
  const signal = controller.signal;
  let onAbort;
  try {
    if (signal.aborted) throw signal.reason;
    const request = (async () => {
      const response = await fetch(IP_CHECK_URL, { signal, cache: "no-store", credentials: "omit" });
      if (!response.ok) return { ok: false, error: `xidmət ${response.status} qaytardı` };
      const ip = (await response.text()).trim();
      let valid = isIpv4(ip);
      if (!valid && /^[\da-f:]+$/i.test(ip) && ip.includes(":")) {
        try { valid = Boolean(new URL(`http://[${ip}]/`).hostname); } catch { /* yararsız IPv6 */ }
      }
      return valid ? { ok: true, ip } : { ok: false, error: ip ? "cavab etibarlı IP ünvanı deyil" : "cavab boş gəldi" };
    })();
    // Bəzi fetch saxtaları və köhnə şəbəkə qatları abort-u gec qəbul edə bilər. Yarışı ayrıca
    // gözləmək köhnə yoxlamanın növbəti əmri və onun cavabını saxlamamasını təmin edir.
    const aborted = new Promise((_, reject) => {
      onAbort = () => reject(signal.reason);
      if (signal.aborted) onAbort();
      else signal.addEventListener("abort", onAbort, { once: true });
    });
    return await Promise.race([request, aborted]);
  } catch (e) {
    if (cancellation?.aborted) return cancelledExit();
    return { ok: false, error: e?.name === "TimeoutError" ? "vaxt bitdi" : (e?.message ?? String(e)) };
  } finally {
    clearTimeout(timer);
    cancellation?.removeEventListener("abort", forward);
    if (onAbort) signal.removeEventListener("abort", onAbort);
  }
}

// Worker qalxanda saxlancdaki qeyd ilə brauzerin HƏQİQİ parametrini uzlaşdırır. İki istiqamət
// var və ikincisi məhz o qüsuru bağlayır ki, istifadəçinin brauzerini yararsız qoymuşdu:
//
//   1) saxlancda proxy var → parametr tətbiq olunur, sonra İŞLƏDİYİ yoxlanılır; cavab
//      vermirsə bağlantı kəsilir (bütün saytların bağlanmasından yaxşıdır);
//   2) saxlancda proxy YOXDUR, brauzerin parametri isə hələ bizimdirsə → parametr BURAXILIR.
//
// (2) olmadan bir dəfə "tutmayan" ayrılma əbədi qalır: popup "qoşulu deyil" yazır, trafik isə
// köhnə proxy-dən keçməyə davam edir və saytlar yalnız extension söndürüləndə açılır. Bu
// hal real brauzerdə yaşandı, ona görə uzlaşdırma hər açılışda təkrarlanır.
export async function resumeProxy() {
  const requestedVersion = lifecycleVersion;
  const setup = await mutateProxy(async () => {
    if (!isCurrentLifecycle(requestedVersion)) return null;
    const active = await readActiveProxy();
    if (!isCurrentLifecycle(requestedVersion)) return null;

    // Startup bərpası istifadəçinin artıq başlamış qoşulma yoxlamasını üstələmir; həmin
    // yoxlama eyni seçimi tamamlamaq üzrədir. Bu, migrate().then(resumeProxy) ilə popup
    // əmrinin kəsişməsində istifadəçi seçiminə üstünlük verir.
    if (active && pendingCheck && pendingCheck.key === proxyKey(active)) return null;

    const version = beginLifecycle();
    if (!active) {
      const control = await browserProxy();
      if (!isRouting(control)) return null;            // adi hal: yönləndirmə yoxdur
      console.warn("saxlancda aktiv proxy yoxdur, brauzerin parametri isə qalıb:", control.mode);
      const after = await releaseProxyNow();
      await writeStatus(isRouting(after) ? StatusLevel.warn : StatusLevel.info, isRouting(after)
        ? `Brauzerdə qalmış proxy parametri (${after.mode}) buraxıla bilmədi — Chrome-u yenidən başlat`
        : "Brauzerdə qalmış proxy parametri buraxıldı — birbaşa bağlantı bərpa olundu");
      return null;
    }

    try {
      const problem = proxyProblem(active);
      if (problem) throw new ExpectedError(problem);
      await chrome.proxy.settings.set({ value: proxyConfig(active), scope: "regular" });
      await verifyAppliedProxy(active);
    } catch (e) {
      console.warn("proxy bərpa olunmadı:", e?.message ?? e);
      await clearActiveProxy();
      try {
        const details = await readProxyDetails();
        if (readProxyControl(details).ours) await releaseProxyNow();
      } catch { /* bərpa xətası artıq qeyd olundu */ }
      return null;
    }

    if (!isCurrentLifecycle(version)) return null;

    // Yoxlama HƏR oyanışda edilmir: worker popup açılanda, tab bağlananda və s. tez-tez qalxır,
    // hər dəfə şəbəkə sorğusu göndərmək mənasızdır. Şübhəli qeyd — ölü nişanlı və ya çoxdan
    // yoxlanmamış — isə dərhal yoxlanılır, çünki sönmüş proxy bütün brauzeri kilidləyir.
    const checkedAt = typeof active.checked === "number" ? active.checked : 0;
    if (active.dead !== true && Date.now() - checkedAt < RECHECK_AFTER_MS) return null;

    const controller = new AbortController();
    pendingCheck = { version, controller, key: proxyKey(active) };
    return { active, version, controller };
  });

  if (!setup) return;
  const exit = await checkExit(setup.controller.signal);
  await mutateProxy(async () => {
    if (!isCurrentLifecycle(setup.version)) return;
    if (pendingCheck?.version === setup.version) pendingCheck = null;
    const current = await readActiveProxy();
    if (!current || proxyKey(current) !== proxyKey(setup.active)) return;

    try {
      await verifyAppliedProxy(setup.active);
    } catch (e) {
      await clearActiveProxy();
      if ((await browserProxy()).ours) await releaseProxyNow();
      await writeStatus(StatusLevel.warn, `Proxy bərpa olunmadı: ${e?.message ?? e}`);
      return;
    }

    if (exit.ok) {
      await markProxyNow(proxyKey(setup.active), { dead: false });
      await writeActiveProxy({ ...setup.active, exitIp: exit.ip, checked: Date.now() });
      return;
    }
    if (exit.cancelled) return;
    await markProxyNow(proxyKey(setup.active), { dead: true });
    await clearActiveProxy();
    const control = await releaseProxyNow();
    await writeStatus(StatusLevel.warn, isRouting(control)
      ? `Proxy cavab vermir: ${proxyLabel(setup.active)} — ${exit.error}. Brauzerin parametri buraxıla bilmədi (${control.mode}) — Chrome-u yenidən başlat.`
      : `Proxy cavab vermir: ${proxyLabel(setup.active)} — ${exit.error}. Saytlar bağlanmasın deyə birbaşa bağlantıya qayıdıldı.`);
  });
}

// Bərpa anında saxlancdaki qeyd bu müddətdən köhnədirsə proxy yenidən yoxlanılır
const RECHECK_AFTER_MS = 5 * 60 * 1000;

// Şəxsi proxy-nin girişi. Chrome pəncərə açmaq yerinə bizdən soruşur (asyncBlocking).
// Yalnız PROXY autentifikasiyasına cavab verilir — saytın öz "login" pəncərəsinə toxunmuruq.
const MAX_AUTH_ATTEMPTS = 2;
const AUTH_ATTEMPT_CACHE = 256;
const authAttempts = new Map();

function authAttemptKey(details, active) {
  const requestId = String(details?.requestId ?? "");
  if (!requestId) return null;
  return `${requestId}|${proxyKey(active)}`;
}

function takeAuthAttempt(key) {
  const count = authAttempts.get(key) ?? 0;
  if (count >= MAX_AUTH_ATTEMPTS) return false;
  authAttempts.delete(key);
  authAttempts.set(key, count + 1);
  while (authAttempts.size > AUTH_ATTEMPT_CACHE) authAttempts.delete(authAttempts.keys().next().value);
  return true;
}

export function answerProxyAuth(details, callback) {
  if (!details?.isProxy) { callback({}); return; }
  mutateProxy(async () => {
    const active = await readActiveProxy();
    if (!active?.username || !["http", "https"].includes(active.scheme)) return {};

    const challenger = details.challenger;
    if (!challenger || !sameEndpoint(
      { scheme: active.scheme, host: challenger.host, port: challenger.port }, active)) return {};

    const effective = await readProxyDetails();
    if (!ownsEffectiveProxy(effective, active)) return {};

    const attemptKey = authAttemptKey(details, active);
    if (!attemptKey || !takeAuthAttempt(attemptKey)) return {};
    return { authCredentials: { username: active.username, password: active.password ?? "" } };
  }).then(callback, () => callback({}));
}

// --- miqrasiya ------------------------------------------------------------------------------
// v1.19.0-a qədər siyahı açıq mənbələrdən idxal olunurdu: saxlancda minlərlə yad qeyd qalıb.
// Kod artıq onları çəkmir, amma köhnə məlumat öz-özünə yox olmur — worker qalxanda bir dəfə
// silinir. `readProxies` onsuz da süzgəcdən keçirir (popup dərhal təmiz görür), bu funksiya
// isə SAXLANCI təmizləyir və idxal olunmuş proxy qoşulu qalıbsa bağlantını kəsir.
export async function migrateProxies() {
  return mutateProxy(async () => {
    const stored = (await readProxies({ raw: true })).list;
    const kept = pruneImported(stored);
    if (kept.length !== stored.length) {
      await writeProxies(kept);
      console.log(`köhnə idxal qeydləri silindi: ${stored.length - kept.length}, qalan ${kept.length}`);
    }
    // Aktiv proxy idxal olunmuşdursa artıq siyahıda yoxdur: bağlantını saxlamağın mənası yoxdur
    const active = await readActiveProxy();
    if (active && !kept.some((proxy) => proxyKey(proxy) === proxyKey(active))) {
      if (pendingCheck?.key === proxyKey(active)) beginLifecycle();
      await clearActiveProxy();
      await releaseProxyNow();
      await writeStatus(StatusLevel.info,
        "Köhnə (idxal olunmuş) proxy siyahısı silindi — birbaşa bağlantıya qayıdıldı. Öz proxy-lərini əlavə et.");
    }
  });
}
