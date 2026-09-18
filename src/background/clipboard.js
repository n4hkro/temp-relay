// Clipboard qatı.
//
// Service worker-in DOM-u yoxdur, fokusda olmayan tabdan isə navigator.clipboard işləmir.
// Ona görə yazma işi offscreen sənədə həvalə olunur (manifest-dəki "clipboardWrite"
// icazəsi fokussuz və istifadəçi jesti olmadan yazmağa imkan verir).
//
// Offscreen sənəd Chrome tərəfindən təxminən 30 s hərəkətsizlikdən sonra bağlana bilir və
// hasDocument() ilə sendMessage arasında da ölə bilər. Ona görə cəhd təkrarlanır: uğursuz
// cavabda sənəd yenidən yaradılıb bir də sınanır.

import { ExpectedError } from "../shared/errors.js";
import { Message } from "../shared/messages.js";

export const OFFSCREEN_URL = "src/offscreen/clipboard.html";
const CLIPBOARD_JUSTIFICATION = "Yeni temp mail ünvanını clipboard-a yazmaq";
const ATTEMPTS = 3;
const RETRY_DELAY_MS = 150;
const FOCUS_DELAY_MS = 400;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function ensureDocument() {
  if (await chrome.offscreen.hasDocument()) return;
  await chrome.offscreen.createDocument({
    url: OFFSCREEN_URL,
    reasons: ["CLIPBOARD"],
    justification: CLIPBOARD_JUSTIFICATION,
  }).catch((e) => {
    // paralel cəhd artıq yaradıbsa bu, xəta deyil
    if (!/already|Only one offscreen/i.test(e?.message ?? "")) throw e;
  });
}

// Offscreen sənədə yazmağı həvalə edir; uğursuzluqda sənədi təzələyib təkrarlayır.
// Uğurda istifadə olunan üsul qaytarılır ("execCommand" və ya "clipboard.writeText").
async function deliver(text) {
  let lastError = "offscreen sənəd cavab vermədi";
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    await ensureDocument();
    const reply = await chrome.runtime.sendMessage(Message.copy(text)).catch((e) => ({ ok: false, error: e?.message }));
    if (reply?.ok) return reply.how;
    lastError = reply?.error ?? lastError;
    if (attempt < ATTEMPTS) await sleep(RETRY_DELAY_MS);
  }
  throw new Error(lastError);
}

// Clipboard-a yazmaq yalnız sənəd fokusda olanda mümkündür. Ona görə ilk cəhd alınmasa
// pəncərə önə gətirilib bir dəfə də sınanır.
export async function copyText(text, { windowId } = {}) {
  try {
    return await deliver(text);
  } catch (firstError) {
    // Clipboard-a yaza bilməmək proqram qüsuru deyil: brauzer fokussuz pəncərədən yazmağa
    // imkan vermir. Mesaj istifadəçiyə aydın çatır → ExpectedError (console.warn).
    if (windowId == null) throw new ExpectedError("clipboard-a yazılmadı — " + firstError.message);
    await chrome.windows.update(windowId, { focused: true, drawAttention: true }).catch(() => {});
    await sleep(FOCUS_DELAY_MS);
    try {
      return await deliver(text);
    } catch {
      throw new ExpectedError("clipboard-a yazılmadı — " + firstError.message);
    }
  }
}
