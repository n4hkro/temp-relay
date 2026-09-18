// temp.tf — provider deskriptoru.
//
// Rejim: API. Saytın /api/account və /api/check endpoint-ləri cookie və açar tələb etmir,
// ona görə həm ünvan, həm də poçt qutusu service worker-də birbaşa fetch ilə oxunur —
// temp.tf tabı AÇILMIR. Protokol api.js-dədir.
//
// `options` popup-da göstərilən formanı təsvir edir: saytın hansı provider-ləri və hansı
// sintaksis (dot / plus) imkanları varsa, burada siyahıya alınır. Popup bu sxemi oxuyub
// formanı özü qurur, ona görə bura yeni seçim əlavə etmək popup kodunu dəyişdirmir.
import { FieldType } from "../../../shared/options.js";
import { DEFAULT_VALUES, fetchAddress, fetchMessages, PROVIDER_CHOICES, validate } from "./api.js";

export default {
  // id — sessiyada və popup seçimində işlənən açardır (dəyişməməlidir)
  id: "temp.tf",
  name: "temp.tf",
  url: "https://temp.tf/",
  // manifest.json → host_permissions üçün şablon mənbəyi: hər host "*://*.host/*" olur.
  // API rejimində bu icazə fetch-in özü üçün lazımdır (CORS-u extension özü keçir).
  hosts: ["temp.tf"],

  options: {
    schema: [
      {
        key: "providers",
        label: "Provider",
        type: FieldType.flags,
        choices: PROVIDER_CHOICES,
        min: 1,
      },
      { key: "dot", label: "Dot", type: FieldType.toggle, hint: "nöqtəli local-part — yalnız Gmail" },
      { key: "plus", label: "Plus", type: FieldType.toggle, hint: "user+alias — Gmail, Outlook, Hotmail" },
    ],
    defaults: DEFAULT_VALUES,
    // Saytın öz qaydaları: dot yalnız Gmail ilə, gmail/outlook/hotmail üçün dot və ya plus
    validate,
  },

  // API rejimi: worker-də çağrılır, ünvanı sətir kimi qaytarır, uğursuzluqda throw edir
  fetchAddress,

  // Poçt qutusu (İSTƏYƏ BAĞLI imkan): bu sahə varsa worker gələn məktubları izləyir və
  // aktivasiya kodunu/keçidini özü tapır. Yoxdursa sayt üçün izləmə açılmır — sessiya
  // yenə də işləyir. Qaytarılan siyahı shared/extract.js-in oxuduğu formada olmalıdır.
  fetchMessages,
};
