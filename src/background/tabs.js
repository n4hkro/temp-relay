// Tab qatı: tab açmaq və yüklənməni gözləmək.
// Qayda: uğursuzluq = atılmış, istifadəçiyə göstərilə bilən aydın xəta mətni (ExpectedError —
// sayt açılmayıbsa bu, extension-ın qüsuru deyil, ona görə səhvlər səhifəsinə düşmür).

import { ExpectedError } from "../shared/errors.js";

export const DEFAULT_LOAD_TIMEOUT_MS = 30000;

// Tab açır. windowId verilibsə və o pəncərə artıq bağlanıbsa, yeni pəncərədə açılır
// (sessiya pəncərə ilə birgə bitdiyindən bu, adətən artıq baş verməmiş olur).
export async function openTab({ url, active = false, windowId }) {
  if (windowId != null) {
    const tab = await chrome.tabs.create({ url, active, windowId }).catch(() => null);
    if (tab) return tab;
  }
  return chrome.tabs.create({ url, active });
}

// Tabı qaytarır; bağlanıbsa və ya id yanlışdırsa null (xəta atmır)
export async function getTab(tabId) {
  if (tabId == null) return null;
  return chrome.tabs.get(tabId).catch(() => null);
}

// chrome.tabs.status=complete şəkil və iframe-ləri də gözləyir. Formaya yazmaq
// üçün yeni sənədin DOM-u kifayətdir. documentId köhnə səhifəni/SPA hash dəyişməsini
// yeni sənədlə qarışdırmamağa imkan verir. Bu probe yalnız oxuyur.
export async function readDocument(tabId, timeoutMs = 500) {
  if (tabId == null) return null;
  let timer;
  try {
    const frames = await Promise.race([
      chrome.scripting.executeScript({
        target: { tabId }, injectImmediately: true,
        func: function pageState() { return { url: location.href, readyState: document.readyState }; },
      }),
      new Promise((resolve) => { timer = setTimeout(() => resolve([]), timeoutMs); }),
    ]);
    const frame = frames?.[0];
    if (!frame?.documentId || !frame.result?.url || !frame.result.readyState) return null;
    return { documentId: frame.documentId, ...frame.result };
  } catch { return null; }
  finally { clearTimeout(timer); }
}

export function waitForDocument(tabId, {
  previousDocumentId = null, url = null, timeoutMs = DEFAULT_LOAD_TIMEOUT_MS, signal,
} = {}) {
  return new Promise((resolve) => {
    let done = false;
    let busy = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      clearInterval(ticker);
      chrome.tabs.onUpdated?.removeListener(onUpdated);
      signal?.removeEventListener("abort", abort);
      resolve(value);
    };
    const check = async () => {
      if (done || busy) return;
      busy = true;
      const state = await readDocument(tabId, Math.min(500, timeoutMs));
      busy = false;
      if (done || !state || !["interactive", "complete"].includes(state.readyState)) return;
      if (previousDocumentId ? state.documentId === previousDocumentId : !url || state.url !== url) return;
      finish(state);
    };
    const abort = () => finish(null);
    const onUpdated = (id) => { if (id === tabId) void check(); };
    const timer = setTimeout(() => finish(null), timeoutMs);
    const ticker = setInterval(check, 100);
    chrome.tabs.onUpdated?.addListener(onUpdated);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) finish(null);
    else void check();
  });
}

// Tab verilmiş URL-i tam yükləyənə qədər gözləyir. Yeni yaradılan tab əvvəlcə
// about:blank-dadır, ona görə səhifə skriptini erkən yeritmək olmaz.
export function waitForLoad(tabId, urlPrefix, timeoutMs = DEFAULT_LOAD_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      chrome.tabs.onUpdated.removeListener(onUpdated);
      clearTimeout(timer);
      if (ok) resolve(); else reject(new ExpectedError("tab yüklənmədi: " + urlPrefix));
    };
    const loaded = (tab) => Boolean(tab) && tab.status === "complete" && (tab.url ?? "").startsWith(urlPrefix);
    const onUpdated = (id, info, tab) => { if (id === tabId && info.status === "complete" && loaded(tab)) finish(true); };

    chrome.tabs.onUpdated.addListener(onUpdated);
    const timer = setTimeout(() => finish(false), timeoutMs);
    getTab(tabId).then((tab) => {
      if (!tab) return finish(false);   // tab yoxdur — gözləməyin mənası yoxdur
      if (loaded(tab)) finish(true);    // artıq yüklüdür
    });
  });
}


// Tabın yüklənməsini gözləyir — URL-dən ASILI OLMADAN. `waitForLoad`-dan fərqi: burada hansı
// ünvana keçdiyi əhəmiyyətsizdir (saytın "Sign up" linki bizi haraya aparsa, ora).
// Xəta atmır: uğur/uğursuzluq boolean-dır, çünki çağıran axın bundan asılı olmamalıdır.
export function waitForIdle(tabId, timeoutMs = DEFAULT_LOAD_TIMEOUT_MS) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      chrome.tabs.onUpdated.removeListener(onUpdated);
      clearTimeout(timer);
      resolve(ok);
    };
    const onUpdated = (id, info) => { if (id === tabId && info.status === "complete") finish(true); };

    chrome.tabs.onUpdated.addListener(onUpdated);
    const timer = setTimeout(() => finish(false), timeoutMs);
    getTab(tabId).then((tab) => {
      if (!tab) return finish(false);
      if (tab.status === "complete") finish(true);
    });
  });
}


// Tabın "sakitləşməsini" gözləyir: klikdən sonra naviqasiya BİR AZ SONRA başlaya bilər, ona
// görə əvvəl qısa müddət gözlənilir və `loading` görünərsə yüklənmənin sonu gözlənilir.
//
// Niyə lazımdır: naviqasiya başlayan kimi köhnə sənəd ölür. Yoxlamasız davam etsək skript
// ölməkdə olan səhifəyə yeridilər və "sahə tapılmadı" alardıq (real brauzer yoxlamasında
// məhz bu baş verdi: "Sign up" linki basılırdı, forma isə boş qalırdı).
export async function settleTab(tabId, { watchMs = 1200, timeoutMs = DEFAULT_LOAD_TIMEOUT_MS } = {}) {
  const deadline = Date.now() + watchMs;
  while (Date.now() < deadline) {
    const tab = await getTab(tabId);
    if (!tab) return false;
    if (tab.status === "loading") return waitForIdle(tabId, timeoutMs);
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  return true;
}
