// Mesaj kontraktı: popup ↔ service worker ↔ offscreen sənəd arasında gedən bütün mesajlar
// buradakı tiplərlə qurulur. Hər üç tərəf eyni faylı import edir, ona görə "sehrli sətirlər"
// fayllara səpələnmir və dəyişəndə bir yerdə dəyişir.
//
// Cavab forması həmişə { ok: true, ... } və ya { ok: false, error, expected } şəklindədir.

import { ExpectedError } from "./errors";
import type { OptionValues } from "./options";

// offscreen sənədə ünvanlanan mesajları ayıran nişan (service worker bu mesajları ötürür)
export const OFFSCREEN_TARGET = "offscreen";

export const MessageType = Object.freeze({
  START: "start",              // popup → worker: sessiyanı başlat
  STOP: "stop",                // popup → worker: izləməni dayandır
  NEW_ADDRESS: "newAddress",   // popup → worker: tabı bağlamadan növbəti ünvan
  RETRY_INBOX: "retryInbox",   // mövcud ünvanı saxlayıb poçt izləməsini təzələ
  CLEAR_TAB: "clearTab",       // popup → worker: bu tabın saytına aid hər şeyi sil
  COPY: "copy",                // worker → offscreen: mətni clipboard-a yaz
  // Alətlər (sessiyadan asılı deyil)
  SET_SHIELD: "setShield",           // izləyici qalxanını aç/söndür
  PROXY_ADD: "proxyAdd",             // proxy əlavə et (bir və ya yüzlərlə sətir / fayl mətni)
  PROXY_REMOVE: "proxyRemove",       // siyahıdan sil (bir və ya bir neçə qeyd)
  PROXY_CONNECT: "proxyConnect",     // seçilmiş proxy-ə qoşul
  PROXY_DISCONNECT: "proxyDisconnect", // birbaşa bağlantıya qayıt
  DESCRIBE_PAGE: "describePage",     // diaqnostika: aktiv tabın səhifəsini təsvir et
} as const);
export type MessageTypeValue = (typeof MessageType)[keyof typeof MessageType];

export const Message = Object.freeze({
  // options — popup-dan gələn, sxemə görə yoxlanmış sayt seçimləri (provider.options.schema).
  // Worker onları yenidən normallaşdırır: mesaj xarici sərhəddir, etibar etməyimiz doğru deyil.
  // tabId — yalnız "bu sayt" relay-i üçün: hansı tabın saytı mənimsənilməlidir. URL-i worker
  // özü chrome.tabs.get ilə oxuyur, popup yalnız id göndərir.
  start: (tempId: string, relayId: string, options?: OptionValues, tabId: number | null = null) =>
    ({ type: MessageType.START, tempId, relayId, options, tabId }),
  stop: () => ({ type: MessageType.STOP }),
  // options — popup-dakı formanın CARI dəyərləri: seçim dəyişibsə "Yeni ünvan" onu tətbiq edir.
  // Göndərilməsə worker sessiyadakı dəyərləri saxlayır.
  newAddress: (options?: OptionValues) => ({ type: MessageType.NEW_ADDRESS, options }),
  retryInbox: () => ({ type: MessageType.RETRY_INBOX }),
  // Yalnız tabın id-si göndərilir: URL-i worker özü chrome.tabs.get ilə oxuyur — silmə
  // ünvanı popup-dan gələn sətirə görə seçilməməlidir.
  clearTab: (tabId: number) => ({ type: MessageType.CLEAR_TAB, tabId }),
  copy: (text: string) => ({ target: OFFSCREEN_TARGET, type: MessageType.COPY, text }),

  // --- alətlər ---
  setShield: (on: boolean) => ({ type: MessageType.SET_SHIELD, on: on === true }),
  // text — istifadəçinin yazdığı və ya fayldan oxunmuş MƏTN: bir sətir də, yüzlərlə sətir də
  // ola bilər (JSON da). Bir neçə fayl seçilibsə MASSİV gedir — hər fayl ayrı oxunur.
  // Ayrıştırma və yoxlama worker-dədir.
  proxyAdd: (text: string | string[]) => ({ type: MessageType.PROXY_ADD, text }),
  // key(lər) — "sxem://host:port". Toplu silmə üçün massiv göndərilir; worker proxy-ləri
  // siyahıdan özü tapır (popup-dan gələn obyektə etibar etmirik).
  proxyRemove: (keys: string | string[]) => ({ type: MessageType.PROXY_REMOVE, keys: Array.isArray(keys) ? keys : [keys] }),
  proxyConnect: (key: string) => ({ type: MessageType.PROXY_CONNECT, key }),
  proxyDisconnect: () => ({ type: MessageType.PROXY_DISCONNECT }),
  // Diaqnostika: yalnız tab id-si gedir, səhifəni worker özü oxuyur
  describePage: (tabId: number) => ({ type: MessageType.DESCRIBE_PAGE, tabId }),
});

// Message fabriklərinin qaytardığı bütün mesajların birliyi
export type ExtensionMessage = ReturnType<(typeof Message)[keyof typeof Message]>;

export interface MessageReply {
  ok: boolean;
  error?: string;
  expected?: boolean;
  [key: string]: unknown;
}

export const isForOffscreen = (
  message: { target?: string } | null | undefined,
): boolean => message?.target === OFFSCREEN_TARGET;

// Worker-ə əmr göndərir; uğursuz cavabı xəta kimi qaytarır ki, çağıran tərəf gözləyə bilsin.
// Xətanın növü itmir: worker-in göndərdiyi `expected` nişanı ExpectedError-a çevrilir, popup
// isə onu qırmızı xəta kimi yox, sarı xəbərdarlıq kimi göstərir (bax: shared/errors.ts).
export async function send(message: ExtensionMessage): Promise<MessageReply> {
  const reply = (await chrome.runtime.sendMessage(message)) as MessageReply | null | undefined;
  if (reply?.ok) return reply;
  const text = reply?.error ?? "service worker cavab vermədi";
  throw reply?.expected ? new ExpectedError(text) : new Error(text);
}
