// Offscreen sənəd: service worker-in adından clipboard-a yazır (worker-in DOM-u yoxdur).
//
// Sənəd heç vaxt fokusda olmur, ona görə əvvəl execCommand("copy") sınanır — manifest-dəki
// "clipboardWrite" icazəsi bunu fokussuz və istifadəçi jesti olmadan etməyə imkan verir.
// Alınmasa navigator.clipboard.writeText yedək yoldur.
//
// Diqqət: bu sənəd module skriptdir, yəni dinləyici sənəd oxunandan sonra qeydiyyatdan
// keçir. Worker tərəfi (background/clipboard.ts) ilk mesaj alınmasa təkrar göndərir,
// ona görə bu gecikmə problem yaratmır.

import { isForOffscreen, MessageType } from "../shared/messages";

interface CopyMessage {
  type: string;
  text: string;
}

// Naməlum xəta dəyərindən mesaj mətni — orijinaldakı `e?.message ?? String(e)` ilə eyni sıra:
// message varsa (null/undefined deyilsə) o, yoxdursa String(e).
function errorText(e: unknown): string {
  const message = (e as { message?: unknown } | null | undefined)?.message;
  return String(message ?? e);
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!isForOffscreen(message) || (message as CopyMessage).type !== MessageType.COPY) return;
  copy((message as CopyMessage).text).then(
    (how) => sendResponse({ ok: true, how }),
    (e) => sendResponse({ ok: false, error: errorText(e) }),
  );
  return true;   // cavab async gəlir: mesaj kanalı açıq qalmalıdır
});

// Uğurda istifadə olunan üsulun adını qaytarır, uğursuzluqda hər iki cəhdin səbəbini verir
async function copy(text: string): Promise<string> {
  const area = document.querySelector<HTMLTextAreaElement>("#text")!;
  area.value = text;
  area.focus();
  area.select();

  let execError = "";
  try {
    if (document.execCommand("copy")) return "execCommand";
    execError = "execCommand false qaytardı";
  } catch (e) {
    execError = `execCommand: ${(e as Error).name} ${(e as Error).message}`;
  }

  try {
    await navigator.clipboard.writeText(text);
    return "clipboard.writeText";
  } catch (e) {
    throw new Error(`${execError}; writeText: ${(e as Error).name} ${(e as Error).message}`);
  }
}
