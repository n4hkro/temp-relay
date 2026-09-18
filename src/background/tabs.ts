// Tab qatı: tab açmaq və yüklənməni gözləmək.
// Qayda: uğursuzluq = atılmış, istifadəçiyə göstərilə bilən aydın xəta mətni (ExpectedError —
// sayt açılmayıbsa bu, extension-ın qüsuru deyil, ona görə səhvlər səhifəsinə düşmür).

import { ExpectedError } from "../shared/errors";

export const DEFAULT_LOAD_TIMEOUT_MS = 30000;

export interface DocumentState {
  documentId: string;
  url: string;
  readyState: string;
}

// Tab açır. windowId verilibsə və o pəncərə artıq bağlanıbsa, yeni pəncərədə açılır
// (sessiya pəncərə ilə birgə bitdiyindən bu, adətən artıq baş verməmiş olur).
export async function openTab(
  { url, active = false, windowId }: { url: string; active?: boolean; windowId?: number | null },
): Promise<chrome.tabs.Tab> {
  if (windowId != null) {
    const tab = await chrome.tabs.create({ url, active, windowId }).catch(() => null);
    if (tab) return tab;
  }
  return chrome.tabs.create({ url, active });
}

// Tabı qaytarır; bağlanıbsa və ya id yanlışdırsa null (xəta atmır)
export async function getTab(tabId: number | null | undefined): Promise<chrome.tabs.Tab | null> {
  if (tabId == null) return null;
  return chrome.tabs.get(tabId).catch(() => null);
}

// chrome.tabs.status=complete şəkil və iframe-ləri də gözləyir. Formaya yazmaq
// üçün yeni sənədin DOM-u kifayətdir. documentId köhnə səhifəni/SPA hash dəyişməsini
// yeni sənədlə qarışdırmamağa imkan verir. Bu probe yalnız oxuyur.
export async function readDocument(
  tabId: number | null | undefined,
  timeoutMs = 500,
): Promise<DocumentState | null> {
  if (tabId == null) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const frames = (await Promise.race([
      chrome.scripting.executeScript({
        target: { tabId }, injectImmediately: true,
        func: function pageState(): { url: string; readyState: string } {
          return { url: location.href, readyState: document.readyState };
        },
      }),
      new Promise<never[]>((resolve) => { timer = setTimeout(() => resolve([]), timeoutMs); }),
    ])) as { documentId?: string; result?: Record<string, unknown> }[] | null | undefined;
    const frame = frames?.[0];
    if (!frame?.documentId || !frame.result?.url || !frame.result.readyState) return null;
    return { documentId: frame.documentId, ...frame.result } as DocumentState;
  } catch { return null; }
  finally { clearTimeout(timer); }
}

export interface WaitForDocumentOptions {
  previousDocumentId?: string | null;
  url?: string | null;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export function waitForDocument(
  tabId: number | null | undefined,
  {
    previousDocumentId = null, url = null, timeoutMs = DEFAULT_LOAD_TIMEOUT_MS, signal,
  }: WaitForDocumentOptions = {},
): Promise<DocumentState | null> {
  return new Promise((resolve) => {
    let done = false;
    let busy = false;
    const finish = (value: DocumentState | null): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      clearInterval(ticker);
      chrome.tabs.onUpdated?.removeListener(onUpdated);
      signal?.removeEventListener("abort", abort);
      resolve(value);
    };
    const check = async (): Promise<void> => {
      if (done || busy) return;
      busy = true;
      const state = await readDocument(tabId, Math.min(500, timeoutMs));
      busy = false;
      if (done || !state || !["interactive", "complete"].includes(state.readyState)) return;
      if (previousDocumentId ? state.documentId === previousDocumentId : !url || state.url !== url) return;
      finish(state);
    };
    const abort = (): void => finish(null);
    const onUpdated = (id: number): void => { if (id === tabId) void check(); };
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
export function waitForLoad(
  tabId: number | null | undefined,
  urlPrefix: string,
  timeoutMs: number = DEFAULT_LOAD_TIMEOUT_MS,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (ok: boolean): void => {
      if (done) return;
      done = true;
      chrome.tabs.onUpdated.removeListener(onUpdated);
      clearTimeout(timer);
      if (ok) resolve(); else reject(new ExpectedError("tab yüklənmədi: " + urlPrefix));
    };
    const loaded = (tab: chrome.tabs.Tab | null): boolean =>
      Boolean(tab) && (tab as chrome.tabs.Tab).status === "complete" && ((tab as chrome.tabs.Tab).url ?? "").startsWith(urlPrefix);
    const onUpdated = (id: number, info: chrome.tabs.OnUpdatedInfo, tab: chrome.tabs.Tab): void => {
      if (id === tabId && info.status === "complete" && loaded(tab)) finish(true);
    };

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
export function waitForIdle(
  tabId: number | null | undefined,
  timeoutMs: number = DEFAULT_LOAD_TIMEOUT_MS,
): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (ok: boolean): void => {
      if (done) return;
      done = true;
      chrome.tabs.onUpdated.removeListener(onUpdated);
      clearTimeout(timer);
      resolve(ok);
    };
    const onUpdated = (id: number, info: chrome.tabs.OnUpdatedInfo): void => {
      if (id === tabId && info.status === "complete") finish(true);
    };

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
export async function settleTab(
  tabId: number | null | undefined,
  { watchMs = 1200, timeoutMs = DEFAULT_LOAD_TIMEOUT_MS }: { watchMs?: number; timeoutMs?: number } = {},
): Promise<boolean> {
  const deadline = Date.now() + watchMs;
  while (Date.now() < deadline) {
    const tab = await getTab(tabId);
    if (!tab) return false;
    if (tab.status === "loading") return waitForIdle(tabId, timeoutMs);
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  return true;
}
