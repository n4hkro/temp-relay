// TEMP MAIL REYESTRİ
//
// Yeni sayt əlavə etmək üçün yalnız iki sətir bəs edir:
//   1) bu qovluqda yeni qovluq yarat: <slug>/index.js (deskriptor)
//      + saytın API-si ilə işləyirsə <slug>/api.js, səhifə skripti lazımdırsa <slug>/page.js
//   2) aşağıya bir import və massivə bir ad yaz
// Qalan hər şey (popup siyahısı, popup-dakı seçim formu, icazə yoxlaması, ünvan axını)
// deskriptordan avtomatik törədilir.
// manifest.json → host_permissions-a saytın hostlarını da əlavə etmək lazımdır;
// unudulsa `npm run check` və popup-dakı Başlat düyməsi xəbərdarlıq edir.
//
// İki rejim var (biri seçilir):
//   api  — fetchAddress({ values, signal }) worker-də işləyir, tab açılmır (üstün tutulur)
//   page — newAddress({ values, config }) saytın öz səhifəsinə köçürülür, tab açılır
//          (yalnız API-si olmayan saytlar üçün)
//
// Deskriptorun sahələri: docs/ADDING-A-PROVIDER.md
import emailnator from "./emailnator/index.js";
import tempTf from "./temp-tf/index.js";

import { createRegistry, validateTempMail } from "../contract.js";

export const TEMP_MAIL = createRegistry("temp-mail", [
  tempTf,
  emailnator,
], validateTempMail);
