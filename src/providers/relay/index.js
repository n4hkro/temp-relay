// RELAY REYESTRİ
//
// Hazırda yalnız bir relay var: "bu sayt (aktiv tab)" — sabit saytı yoxdur, istifadəçinin
// açıq tabındaki saytı mənimsəyir və qeydiyyatı evristika ilə aparır (bax: background/forms.js).
// Sayta bağlı relay deskriptorları QƏSDƏN yoxdur: hər sayt üçün ayrı selektor dəsti saxlamaq
// yerinə ümumi məntiq gücləndirilir.
//
// Yeni sayta bağlı relay əlavə etmək üçün yenə iki sətir bəs edir:
//   1) bu qovluqda yeni qovluq yarat: <slug>/index.js (deskriptor)
//   2) aşağıya bir import və massivə bir ad yaz
// Qalan hər şey (popup siyahısı, icazə yoxlaması, təmizləmə axını, `signup` addımlarının
// icrası) avtomatik işləyir. manifest.json → host_permissions-a saytın hostlarını da yazmaq
// lazımdır; unudulsa `npm run check` və popup-dakı Başlat düyməsi xəbərdarlıq edir.
//
// Deskriptorun sahələri: docs/ADDING-A-PROVIDER.md
import activeTab from "./active-tab/index.js";

import { createRegistry, validateRelay } from "../contract.js";

export const RELAY = createRegistry("relay", [
  activeTab,
], validateRelay);
