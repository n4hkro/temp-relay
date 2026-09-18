// Offscreen sənəd: service worker-in adından clipboard-a yazır (worker-in DOM-u yoxdur).
//
// Sənəd heç vaxt fokusda olmur, ona görə əvvəl execCommand("copy") sınanır — manifest-dəki
// "clipboardWrite" icazəsi bunu fokussuz və istifadəçi jesti olmadan etməyə imkan verir.
// Alınmasa navigator.clipboard.writeText yedək yoldur.
//
// Diqqət: bu sənəd module skriptdir, yəni dinləyici sənəd oxunandan sonra qeydiyyatdan
// keçir. Worker tərəfi (background/clipboard.js) ilk mesaj alınmasa təkrar göndərir,
// ona görə bu gecikmə problem yaratmır.

import { isForOffscreen, MessageType } from "../shared/messages.js";

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!isForOffscreen(message) || message.type !== MessageType.COPY) return;
  copy(message.text).then(
    (how) => sendResponse({ ok: true, how }),
    (e) => sendResponse({ ok: false, error: e?.message ?? String(e) }),
  );
  return true;   // cavab async gəlir: mesaj kanalı açıq qalmalıdır
});

// Uğurda istifadə olunan üsulun adını qaytarır, uğursuzluqda hər iki cəhdin səbəbini verir
async function copy(text) {
  const area = document.getElementById("text");
  area.value = text;
  area.focus();
  area.select();

  let execError = "";
  try {
    if (document.execCommand("copy")) return "execCommand";
    execError = "execCommand false qaytardı";
  } catch (e) {
    execError = `execCommand: ${e.name} ${e.message}`;
  }

  try {
    await navigator.clipboard.writeText(text);
    return "clipboard.writeText";
  } catch (e) {
    throw new Error(`${execError}; writeText: ${e.name} ${e.message}`);
  }
}
