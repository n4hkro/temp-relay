// Clipboard qatı.
//
// Service worker-in DOM-u yoxdur, fokusda olmayan tabdan isə navigator.clipboard işləmir.
// Ona görə yazma işi offscreen sənədə həvalə olunur (manifest-dəki "clipboardWrite"
// icazəsi fokussuz və istifadəçi jesti olmadan yazmağa imkan verir).
//
// Offscreen sənəd Chrome tərəfindən təxminən 30 s hərəkətsizlikdən sonra bağlana bilir və
// hasDocument() ilə sendMessage arasında da ölə bilər. Ona görə cəhd təkrarlanır: uğursuz
// cavabda sənəd yenidən yaradılıb bir də sınanır.

import { ExpectedError } from "../shared/errors";
import { Message } from "../shared/messages";

export const OFFSCREEN_URL = "src/offscreen/clipboard.html";
const CLIPBOARD_JUSTIFICATION = "Yeni temp mail ünvanını clipboard-a yazmaq";
const ATTEMPTS = 3;
const RETRY_DELAY_MS = 150;
const FOCUS_DELAY_MS = 400;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function ensureDocument(): Promise<void> {
  if (await chrome.offscreen.hasDocument()) return;
  await chrome.offscreen.createDocument({
    url: OFFSCREEN_URL,
    reasons: ["CLIPBOARD"],
    justification: CLIPBOARD_JUSTIFICATION,
  }).catch((e: unknown) => {
    // paralel cəhd artıq yaradıbsa bu, xəta deyil
    if (!/already|Only one offscreen/i.test(((e as { message?: string })?.message ?? ""))) throw e;
  });
}

interface OffscreenReply {
  ok?: boolean;
  how?: string;
  error?: string;
}

// Offscreen sənədə yazmağı həvalə edir; uğursuzluqda sənədi təzələyib təkrarlayır.
// Uğurda istifadə olunan üsul qaytarılır ("execCommand" və ya "clipboard.writeText").
async function deliver(text: string): Promise<string | undefined> {
  let lastError = "offscreen sənəd cavab vermədi";
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    await ensureDocument();
    const reply = (await chrome.runtime.sendMessage(Message.copy(text))
      .catch((e: unknown) => ({ ok: false, error: (e as { message?: unknown })?.message }))) as unknown as OffscreenReply | null | undefined;
    if (reply?.ok) return reply.how;
    lastError = reply?.error ?? lastError;
    if (attempt < ATTEMPTS) await sleep(RETRY_DELAY_MS);
  }
  throw new Error(lastError);
}

// Clipboard-a yazmaq yalnız sənəd fokusda olanda mümkündür. Ona görə ilk cəhd alınmasa
// pəncərə önə gətirilib bir dəfə də sınanır.
export async function copyText(
  text: string,
  { windowId }: { windowId?: number | null } = {},
): Promise<string | undefined> {
  try {
    return await deliver(text);
  } catch (firstError) {
    // Clipboard-a yaza bilməmək proqram qüsuru deyil: brauzer fokussuz pəncərədən yazmağa
    // imkan vermir. Mesaj istifadəçiyə aydın çatır → ExpectedError (console.warn).
    // `as Error` yalnız tip üçündür: runtime-da orijinal `firstError.message` ifadəsidir.
    if (windowId == null) throw new ExpectedError("clipboard-a yazılmadı — " + (firstError as Error).message);
    await chrome.windows.update(windowId, { focused: true, drawAttention: true }).catch(() => {});
    await sleep(FOCUS_DELAY_MS);
    try {
      return await deliver(text);
    } catch {
      throw new ExpectedError("clipboard-a yazılmadı — " + (firstError as Error).message);
    }
  }
}
