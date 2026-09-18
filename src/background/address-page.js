// Səhifə rejimi: provider-in skripti saytın ÖZ səhifəsində icra olunur. Yalnız API-si
// olmayan saytlar üçündür — tab açmaq, yüklənməsini gözləmək və DOM-la işləmək lazımdır.
//
// Burada yalnız mexanika var: tabı hazır vəziyyətə gətir, skripti yerit, nəticəni qaytar.
// Saytın DOM detalları provider-in öz page.js faylındadır, ona görə yeni sayt əlavə edəndə
// bu modul dəyişmir.
//
// Qeyd: session obyekti orchestrator-dan gələn canlı istinaddır. Tab id-si dəyişəndə dərhal
// storage-a yazılır — skript sonradan xəta versə belə açılmış tab itirilmir və növbəti
// cəhd onu təkrar istifadə edir.

import { ExpectedError } from "../shared/errors.js";
import { isLiveSession, updateSession } from "../shared/state.js";
import { getTab, openTab, waitForLoad } from "./tabs.js";

// Yeni ünvanı qaytarır. null — sessiya bu arada Dayandır ilə silinib: axın öz-özünə dayanır,
// xəta sayılmır.
export async function acquireFromPage(session, provider, values) {
  const tab = await ensureLoadedTab(session, provider);
  if (!tab) return null;
  // Tabın yüklənməsi 20+ saniyə çəkə bilər — bu arada Dayandır basılıbsa skripti işə
  // salmırıq.
  if (!await isLiveSession(session)) return null;
  return runInPage(tab.id, provider, values);
}

// Tab bağlanıbsa, başqa sayta gedibsə və ya yaddaşdan boşaldılıbsa (discarded) yenidən
// hazır vəziyyətə gətirir. Temp mail tabı həmişə arxa planda açılır.
// Yeni tab id-sini updateSession ilə yazır: Dayandır bu arada sessiyanı silibsə, sessiya
// dirilmir və null qaytarılır (istifadəçi "dayandır" deyibsə, tab izləməsi davam etməməlidir).
async function ensureLoadedTab(session, provider) {
  const existing = await getTab(session.tempTabId);
  const onSite = Boolean(existing) && (existing.url ?? "").startsWith(provider.url);

  if (!onSite) {
    const tab = await openTab({ url: provider.url, active: false, windowId: session.windowId });
    if (!(await updateSession(session, { tempTabId: tab.id, windowId: tab.windowId }))) return null;
    await waitForLoad(tab.id, provider.url);
    return tab;
  }
  if (existing.discarded || existing.status !== "complete") {
    await chrome.tabs.reload(existing.id);
    await waitForLoad(existing.id, provider.url);
  }
  return existing;
}

// Provider-in page skriptini saytın öz səhifəsində icra edir. Skript heç vaxt throw etmir:
// ya { address }, ya da { error } qaytarır. Səhifə heç nə qaytarmasa (tab bağlanıbsa, frame
// yoxdur) bu, "səhifə cavab vermədi" kimi şərh olunur.
// Ünvanın özünün etibarlılığı yuxarıda (address.js) yoxlanılır — hər iki rejim üçün eyni qayda.
async function runInPage(tabId, provider, values) {
  const frames = await chrome.scripting.executeScript({
    target: { tabId },
    func: provider.newAddress,
    // config — sayt xüsusi sabit parametrlər (selektorlar, gözləmə müddətləri); pageConfig-dən gəlir
    args: [{ values, config: provider.pageConfig }],
  });
  const result = frames?.[0]?.result;
  // Səhifənin öz xətası (DOM dəyişib, düymə tapılmayıb) extension-ın qüsuru deyil → ExpectedError
  if (!result || result.error) throw new ExpectedError(provider.name + ": " + (result?.error ?? "səhifə cavab vermədi"));
  return result.address;
}
