// Service worker girişi.
//
// Bu faylın vəzifəsi yalnız wiring-dir: dinləyiciləri qeydiyyata almaq və əmrləri
// orchestrator-a ötürmək. İş məntiqi orchestrator.js-də, mexanika qonşu modullarda,
// sayt məlumatı isə src/providers-dədir.
//
// MV3 qaydası: worker hər hadisədə yenidən işə salına və təxminən 30 s boşluqdan sonra
// söndürülə bilər, ona görə dinləyicilər modul işə düşən kimi SİNXRON qeydiyyatdan
// keçməlidir (async gözləmənin içində addListener etmək olmaz). Bütün vəziyyət
// shared/state.js-dədir; worker-in yaddaşında heç nə saxlanılmır.

import { isExpected } from "../shared/errors.js";
import { isForOffscreen } from "../shared/messages.js";
import { resumeWatching } from "./inbox.js";
import { handleCommand, onPermissionsGranted, onTabClosed } from "./orchestrator.js";
import { answerProxyAuth, migrateProxies, resumeProxy } from "./proxy.js";
import { handleToolCommand, isToolCommand } from "./tools.js";
import { resumeShield } from "./trackers.js";

chrome.tabs.onRemoved.addListener((tabId, info) => {
  onTabClosed(tabId, info).catch((e) => console.error("tab bağlanması işlənə bilmədi:", e));
});

// İstifadəçi "sayt məlumatını sil" düyməsində host icazəsini verəndə silmə tam şəkildə
// təkrarlanır (partitioned cookie + sessionStorage). Popup icazə pəncərəsi açılan kimi
// bağlanır, ona görə bu işi worker tamamlayır — istifadəçi üçün bir klik kifayətdir.
chrome.permissions.onAdded.addListener((permissions) => {
  onPermissionsGranted(permissions).catch((e) => console.error("icazədən sonra silmə tamamlanmadı:", e));
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (isForOffscreen(message)) return;   // bu mesaj offscreen sənədə aiddir, worker onu ötürür
  // Alət əmrləri (qalxan, proxy) sessiya axınından müstəqildir və növbəyə qoyulmur
  const work = isToolCommand(message) ? handleToolCommand(message) : handleCommand(message);
  Promise.resolve(work).then(
    (result) => sendResponse({ ok: true, ...(result && typeof result === "object" ? { result } : {}) }),
    // `expected` nişanı xətanın növünü popup-a çatdırır: sinif mesaj sərhədini keçə bilmir,
    // ona görə popup səviyyəni bu nişandan bilir (sayt/istifadəçi xətası → sarı, qüsur → qırmızı).
    (e) => sendResponse({ ok: false, error: e?.message ?? String(e), expected: isExpected(e) }),
  );
  return true;                           // cavab async gəlir: mesaj kanalı açıq qalmalıdır
});

// Şəxsi proxy-nin istifadəçi adı/parolu: Chrome pəncərə açmaq yerinə bizdən soruşur.
// `asyncBlocking` — cavab saxlancdan oxunur, yəni async gəlir (manifest: webRequestAuthProvider).
if (chrome.webRequest?.onAuthRequired) {
  chrome.webRequest.onAuthRequired.addListener(answerProxyAuth, { urls: ["<all_urls>"] }, ["asyncBlocking"]);
}

// Poçt izləməsi dəqiqələrlə davam edir, worker isə söndürülə bilər. Dinləyicilər
// qeydiyyatdan keçəndən SONRA saxlancdakı vəziyyət oxunur: izləmə yarımçıq qalıbsa və son
// müddət keçməyibsə döngü davam etdirilir (gözləmə async olduğu üçün qeydiyyatı gecikdirmir).
resumeWatching().catch((e) => console.error("poçt izləməsi davam etdirilə bilmədi:", e));

// Alətlərin vəziyyəti də saxlancdadır: qalxan və proxy brauzer açılışları arasında qalır.
resumeShield().catch((e) => console.error("izləyici qalxanı bərpa olunmadı:", e));

// Proxy addımları ARDICIL gedir və sıra vacibdir: miqrasiya köhnə (idxal olunmuş) aktiv
// proxy-ni buraxır, `resumeProxy` isə saxlancda qalan qeydi tətbiq edir. Paralel işləsəydilər
// buraxma ilə tətbiq bir-birini üstələyə bilərdi və brauzer siyahıda olmayan proxy ilə qalardı.
//
// `resumeProxy` həm də ƏKS istiqaməti düzəldir: saxlancda proxy yoxdursa, amma brauzerin
// parametri hələ bizdəndirsə (tutmayan ayrılmadan qalan hal — bütün saytlar açılmır), parametr
// buraxılır. Ona görə bu addım hər worker açılışında işləyir, yalnız brauzer başlayanda deyil.
migrateProxies()
  .catch((e) => console.error("köhnə proxy siyahısı təmizlənmədi:", e))
  .then(() => resumeProxy())
  .catch((e) => console.error("proxy bərpa olunmadı:", e));
