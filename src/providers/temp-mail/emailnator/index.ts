// emailnator.com (Gmailnator) — provider deskriptoru.
//
// Rejim: API. Saytın /api/generate-email, /api/message-list və /api/message/<id>
// endpoint-ləri cookie, CSRF açarı və session tələb etmir, ona görə həm ünvan, həm də poçt
// qutusu service worker-də birbaşa fetch ilə oxunur — emailnator tabı AÇILMIR.
// Protokol api.ts-dədir.
//
// Qeyd: pulsuz ünvanlar PAYLAŞILAN hovuzdandır — yeni alınmış qutuda başqasının köhnə
// məktubları ola bilər (24 saatdan köhnələri sayt `locked` kimi qaytarır və oxunmur).
// Ona görə aktivasiya məktubunun seçilməsi shared/extract.ts-in relay ipuçlarına söykənir:
// qutudakı hər kod deyil, yalnız işlədilən relay saytına aid olan tapılır.
import { FieldType } from "../../../shared/options";
import { DEFAULT_VALUES, fetchAddress, fetchMessages, TYPE_CHOICES } from "./api";
import { type TempMailDescriptor } from "../../contract";

export default {
  // id — sessiyada və popup seçimində işlənən açardır (dəyişməməlidir)
  id: "emailnator.com",
  name: "emailnator.com",
  url: "https://www.emailnator.com/",
  // manifest.json → host_permissions üçün şablon mənbəyi: "*://*.emailnator.com/*".
  // Apex də, www da işləyir; API rejimində bu icazə fetch-in CORS-u keçməsi üçün lazımdır.
  hosts: ["emailnator.com"],

  // Saytın API-si YALNIZ öz origin-indən çağrıla bilər: yad Origin başlığı ilə gələn sorğuya
  // 403 `{"status":"error","message":"Forbidden"}` qaytarır. Worker-in fetch-i isə
  // `Origin: chrome-extension://<id>` göndərir. Ona görə başlıq declarativeNetRequest ilə
  // saytın öz origin-i ilə əvəz olunur (bax: shared/net.ts, rules/provider-origin.json).
  requestOrigin: "https://www.emailnator.com",

  options: {
    schema: [
      {
        key: "types",
        label: "Ünvan növü",
        type: FieldType.flags,
        choices: TYPE_CHOICES,
        min: 1,
        hint: "saytın öz chip-ləri; bir neçəsi işarələnsə növü sayt özü seçir",
      },
    ],
    defaults: DEFAULT_VALUES,
    // Saytın ayrıca qaydası yoxdur: yeganə tələb "ən azı bir növ" idi, onu sxemdəki min:1
    // tutur (server də 403 NO_ACCESSIBLE_TYPES qaytarır).
  },

  // API rejimi: worker-də çağrılır, ünvanı sətir kimi qaytarır, uğursuzluqda throw edir
  fetchAddress,

  // Poçt qutusu: siyahı + hər məktubun HTML gövdəsi (keşlənir). Sayt long-poll vermir,
  // ona görə `wait` api.ts-də emulyasiya olunur — döngü fasiləsiz sorğu göndərmir.
  fetchMessages,
} satisfies TempMailDescriptor;
