# Arxitektura

## Ümumi baxış

Extension dörd icra mühitində (context) işləyir və hər birinin öz məhdudiyyəti var.
Bütün arxitektura bu məhdudiyyətlərin ətrafında qurulub:

| Mühit | Nədir | Məhdudiyyəti |
| --- | --- | --- |
| **Service worker** | `src/background/` | DOM yoxdur, ~30 s boşluqdan sonra söndürülür → vəziyyət saxlanıla bilməz |
| **Popup** | `src/popup/` | İstənilən vaxt bağlana bilər → uzun iş görməməlidir |
| **Offscreen sənəd** | `src/offscreen/` | Yalnız clipboard üçün; özü də ~30 s sonra bağlanır |
| **Saytın səhifəsi** | provider-in `page.js` faylı (yalnız səhifə rejimində) | Extension API-ləri yoxdur, skript `toString` ilə köçürülür |

İş bölgüsü: **popup soruşur, worker işləyir, offscreen yazır, provider saytı tanıyır.**

```
                 ┌── API rejimi ──▶ fetch (worker-in özündə, tab açılmır)
 popup ──əmr──▶  worker ─┤
   ▲                     └── səhifə rejimi ──skript──▶ saytın səhifəsi (page.js)
   │                 │    │
   └──status─────────┘    └──mətn──▶ offscreen (clipboard)
      (chrome.storage)
```

## Qovluq xəritəsi

```
manifest.json              icazələr, host şablonları, DNR ruleset-i, giriş nöqtələri
package.json               ESM rejimi + npm skriptləri (check / test / verify)
assets/                    ikonlar
docs/                      bu sənəd + ADDING-A-PROVIDER.md
rules/provider-origin.json declarativeNetRequest statik qaydası: provider-in `requestOrigin`
                           sahəsindən törədilir (shared/net.js), `npm run check` uyğunluğu yoxlayır
rules/trackers.json        izləyici qalxanının qaydaları: analitika, reklam, sosial piksellər və
                           seans yazıcıları (yalnız üçüncü tərəf, manifest-də default SÖNÜLÜ)
src/
  shared/                  HƏM worker, HƏM popup işlədir (chrome-a import anında toxunmur)
    messages.js            mesaj kontraktı: tiplər, qurucular, send()
    errors.js              xəta növləri və console səviyyəsi: ExpectedError (saytın və ya
                           istifadəçinin xətası) → warn, proqram qüsuru → error
    permissions.js         host → icazə şablonları (+ tab silməsi üçün istəyə bağlı icazə)
    badge.js               ikonun üstündəki nişan və tooltip (worker qoyur, popup silir)
    net.js                 host → declarativeNetRequest qaydaları (Origin başlığının əvəzlənməsi)
    password.js            qeydiyyat üçün güclü parol (crypto, saf modul)
    username.js            qeydiyyat üçün istifadəçi adı: ünvandan törədilir (saf modul)
    proxy.js               şəxsi proxy qeydləri: TOPLU mətn/JSON ayrıştırması (parseProxyLines),
                           yoxlanması, göstərmə sırası, chrome.proxy konfiqurasiyası, brauzerin
                           cari parametrinin oxunuşu (readProxyControl / isRouting) və köhnə
                           idxal qeydlərinin süzgəci (pruneImported)
                           (açıq proxy mənbələri YOXDUR — bax: qərarlar bölməsi)
    identity.js            bütöv şəxs profili: ad, telefon, ünvan, doğum tarixi… ünvandan
                           DETERMİNİST törədilir, dəyərlər bir-biri ilə uzlaşır (saf modul)
    cleanup.js             URL → silmə planı (hansı cookie domeni, hansı origin-lər) +
                           EYNİ HESABIN arxasındaki əlaqəli domenlər: identity ailələri
                           (IDENTITY_FAMILIES — Microsoft, Google, Apple, Facebook), çünki
                           giriş vəziyyəti bir domendə saxlanılmır
    state.js               storage açarları + session/status/inbox/choice oxu-yazı və sessiya
                           "hələ canlıdır?" yoxlamaları (isLiveSession / updateSession)
    options.js             seçim qatı: sxem yoxlaması, normallaşdırma, xəta mətnləri,
                           sayt başına son seçimin yaddaşı
    extract.js             məktubdan aktivasiya kodu / keçidinin çıxarılması və "bu məktub
                           bizim sayta aiddir?" qiymətləndirilməsi (saf modul, test olunur)
    inbox.js               poçt izləməsinin vəziyyət modeli: mərhələlər, müddət siyasəti,
                           popup və bildiriş mətnləri (saf modul, test olunur)
  providers/               SAYT MƏLUMATI — extension mexanikasından tam ayrı
    contract.js            deskriptor yoxlaması + createRegistry() + rejim seçimi (api/page)
                           + imkan sorğuları (supportsInbox)
    temp-mail/index.js     temp mail reyestri
    temp-mail/<slug>/index.js   deskriptor (id, url, hosts, options, fetchAddress | newAddress,
                                istəyə bağlı fetchMessages)
    temp-mail/<slug>/api.js     API rejimi: sorğu + cavabın ünvana (və poçt siyahısına)
                                çevrilməsi (saf modul)
    temp-mail/<slug>/page.js    səhifə rejimi: SƏHİFƏDƏ icra olunan skript
    relay/index.js         relay reyestri
    relay/<slug>/index.js       deskriptor (id, url, hosts, cleanup, istəyə bağlı mail ipuçları
                                və qeydiyyat addımları); `adoptActiveTab` relay-i sayt
                                məlumatı DAŞIMIR — onu aktiv tab verir
  background/              service worker
    background.js          giriş: yalnız dinləyici qeydiyyatı + yönləndirmə + izləmənin
                           davam etdirilməsi (resumeWatching)
    orchestrator.js        iş axınları, əmr növbəsi, seçimlərin yoxlanması
    address.js             ünvanın alınması: rejimi seçir, yoxlayır, clipboard-a yazır
    address-api.js         API rejimi: vaxt limiti (AbortController) + xəta mətni
    address-page.js        səhifə rejimi: tab → executeScript
    inbox.js               poçt izləmə döngüsü: sorğu, nəbz, tapıntının çatdırılması
    signup.js              relay qeydiyyat addımlarının icrası: metod seçimi, ünvan, kod,
                           parol, "hesab yarat" (addımlar deskriptordan, mexanika buradan)
    forms.js               NAMƏLUM saytda tam qeydiyyat: "Sign up" linkinin tapılıb açılması,
                           bütün tanınan xanaların doldurulması (mətn, seçim, checkbox, radio,
                           tarix), razılıq və "robot deyiləm" xanaları, sonda qeydiyyat
                           düyməsinin basılması. Doldurma və klik AYRI yeridilir (klik səhifəni
                           dəyişə bilər — o halda cavab gəlmir, vaxt limiti ilə tutulur).
                           Həm də DİAQNOSTİKA: describePage səhifəni oxuyub xanaların,
                           valideyn zəncirlərinin və klikləniləsi mətnlərin hesabatını verir
                           (heç nə dəyişdirmir — qüsur təxminlə deyil, faktla axtarılır)
    cleanup.js             sayt izlərinin silinməsi: səhifə saxlancı + cookie + browsingData
                           (relay axını üçün deskriptordan, düymə üçün tabın URL-indən)
    relay.js               relay-in işləmə anındaki forması: adi relay deskriptorun özü,
                           "bu sayt" relay-i isə aktiv tabdan törədilir (resolveRelay)
    clipboard.js           offscreen sənəd vasitəsilə yazma
    tabs.js                tab açmaq / yüklənməni gözləmək / klikdən sonra sakitləşməni gözləmək
    trackers.js            izləyici qalxanı: statik DNR ruleset-inin açılıb-söndürülməsi
    proxy.js               şəxsi proxy-lər: TOPLU əlavə (addProxies — mətn/JSON/bir neçə fayl),
                           sil, qoşulma/ayrılma, çıxış IP yoxlaması (ping də buradan ölçülür),
                           BRAUZERİN parametri ilə saxlancın uzlaşdırılması (resumeProxy) və
                           parametrin YOXLANMIŞ buraxılması (releaseProxy — işləməyən proxy
                           brauzerdə qalsa heç bir sayt açılmır),
                           proxy autentifikasiyasının cavablanması, köhnə idxal siyahısının
                           saxlancdan silinməsi (migrateProxies)
    tools.js               alət əmrlərinin kiçik router-i (qalxan, proxy) — sessiyadan müstəqil
    notify.js              status + bildiriş + console səviyyəsi (warn/error — növə görə)
  popup/                   seçim və idarəetmə səthi
    popup.html / popup.css markup və üslub (tema dəyişənləri: light/dark bir düymə ilə)
    popup.js               reyestrləri göstərir, əmr göndərir, statusu və poçt nəticəsini
                           əks etdirir; başlat/dayandır TƏK ikon düyməsidir, yeni ünvan
                           ünvanın yanındaki ⟳ ikonudur, sayt seçimləri isə panellərdədir.
                           Panel açıq olanda sessiya blokları gizlənir (body.panel-open);
                           proxy siyahısında toplu seçim vəziyyəti burada saxlanılır (Set)
    icons.js               inline SVG ikonlar (vəziyyətə görə dəyişir: play ↔ stop, gün ↔ ay)
    options-ui.js          sxemdən forma qurur (sayt dəyişəndə yenilənir)
    format.js              status → mətn/rəng/ömür çevirməsi (chrome-sız, testlənir)
  offscreen/               clipboard.html / clipboard.js
tests/                     node:test — contract, options, extract, inbox, temp-tf, emailnator,
                           signup, forms, identity, username, proxy, tools, net,
                           session, permissions, module-graph, format, errors
tools/check.mjs            statik yoxlama: provider ↔ manifest uyğunluğu, rejimlər,
                           poçt qutusu imkanı, DNR qayda faylı
```

## Asılılıq qaydası

Oxlar "idxal edir" mənasındadır. Yuxarıdan aşağıya doğru gedir, əksinə heç vaxt:

```
popup ─┐
       ├─▶ providers ─▶ contract ─▶ shared/options
worker ┘        │
   │            └─▶ shared ◀── popup, offscreen, tools/check.mjs
   └─▶ shared
```

- `shared/` kənardan heç nə idxal etmir (öz aralarında dövrsüz olar: `cleanup → extract`);
  `providers/` yalnız `shared/`-i (`contract → options`).
- `providers/` worker-in mexanikasını tanımır; worker də saytların DOM-unu tanımır.
- `background.js` (giriş) yeganə yerdir ki, `chrome.*` dinləyicilərini qeydiyyata alır.
- Nəticə: yeni sayt əlavə etmək üçün **yalnız `src/providers/` və `manifest.json`** dəyişir.

## Ünvanın alınma rejimləri

Hər temp mail saytının imkanı fərqlidir: birinin API-si cookie və açar tələb etmir, ona görə
ünvanı worker-dən birbaşa `fetch` ilə almaq olur; digəri yalnız səhifədə düymə basanda ünvan
verir. Kontrakt hər ikisini tanıyır və rejim deskriptorun hansı funksiyanı daşımasından seçilir:

| Rejim | Deskriptorda | Harada işləyir | Tab | Modul |
| --- | --- | --- | --- | --- |
| `api` | `fetchAddress({ values, signal })` → ünvan sətri | service worker | AÇILMIR | `address-api.js` |
| `page` | `newAddress({ values, config })` → `{ address }` | saytın səhifəsi | açılır | `address-page.js` |

Qaydalar: iki funksiya bir yerdə ola bilməz (hansı işləyəcək birmənalı deyil); `fetchAddress`
`chrome.*` işlədə bilməz (node-da test olunmalıdır); `newAddress` serializasiya olunduğu üçün
arrow/function ifadəsi olmalı və heç nə idxal etməməlidir. `address.js` yalnız rejimi seçir —
hər iki yolun sonunda ünvan eyni yoxlamadan keçir (`@` olmalıdır) və clipboard-a yazılır.

Üçüncü funksiya rejimdən **asılı deyil**: `fetchMessages({ email, wait, signal })` poçt
siyahısını oxumaq üçün istəyə bağlı imkandır və onu həm `api`, həm `page` rejimli sayt daşıya
bilər (bax: "Poçt qutusu"). `supportsInbox(provider)` imkanı yoxlayır; yoxdursa ünvan alınır,
izləmə açılmır və popup-da panel görünmür.

## Seçim qatı (options)

Saytın imkanları (hansı domenlər, hansı sintaksis) kodla deyil, **sxemlə** təsvir olunur.
Deskriptor `options: { schema, defaults, validate? }` daşıyır; popup sxemi oxuyub formanı özü
qurur, worker isə eyni sxemlə dəyərləri normallaşdırıb yoxlayır. Yeni sayt əlavə olunanda
popup-a heç nə yazılmır.

Sahə tipləri (`shared/options.js` → `FieldType`):

| Tip | Dəyər | Formada |
| --- | --- | --- |
| `flags` | `{ [choice]: boolean }` | çip sırası; `min` ilə "ən azı N seçim" qaydası |
| `toggle` | `boolean` | tək çip; `hint` ilə izah |
| `choice` | sətir (`choices` içindən) | açılan siyahı |

Axın: popup formanı oxuyur → `validateValues` ilə erkən yoxlayır → `Message.start(tempId, relayId, values)`
→ worker `resolveValues` ilə **yenidən** normallaşdırır və `validateValues` ilə yenidən yoxlayır
→ dəyərlər `session.options`-a yazılır → provider onları sorğuya çevirir.

Normallaşdırma məqsədli olaraq iki dəfə aparılır: popup etibarlı mənbə deyil (mesaj xarici
sərhəddir), saxlancdakı dəyər isə köhnə versiyadan qala bilər. `resolveValues` naməlum açarları
atır, çatışmayanları default ilə doldurur, tipi pozulanı default-a qaytarır. Saytın öz qaydaları
(məsələn "dot yalnız Gmail ilə") `options.validate` funksiyasındadır — həm popup, həm worker
onu çağırır, server də eynisini yoxlayır.

## Poçt qutusu (inbox)

Ünvan alındıqdan sonra extension relay saytından gələn məktubu gözləyir və ondan yalnız lazım
olanı çıxarır: **aktivasiya kodu** və ya **aktivasiya keçidi**. İş üç qata bölünüb:

| Qat | Modul | Nə edir |
| --- | --- | --- |
| Protokol | `providers/temp-mail/<id>/api.js` → `fetchMessages({ email, wait, signal })` | saytın poçt siyahısını xam məktub siyahısı kimi qaytarır |
| Məna | `shared/extract.js` | məktub bu relay saytına aiddir? içində kod və ya keçid var? |
| Mexanika | `shared/inbox.js` (vəziyyət) + `background/inbox.js` (döngü) | fazalar, müddət siyasəti, nəbz, çatdırılma |

**İstəyə bağlı imkan.** `fetchMessages` ünvanın alınma rejimindən asılı deyil: `api` rejimli
sayt poçtunu göstərməyə bilər, `page` rejimli sayt isə göstərə bilər. `supportsInbox(provider)`
bunu yoxlayır; imkan yoxsa ünvan alınır, izləmə açılmır və popup-da panel görünmür.

**İpuçları deskriptordan törədilir.** `mailHints(relay)` axtarış açarlarını relay
deskriptorundan qurur: `mail.fromDomains` üstəgəl `url`-in qeydiyyatdan keçən domeni
(`relaysite.example`), onlardan və `name`-dən alınan tokenlər, üstəgəl `mail.keywords`. Yeni relay
saytı əlavə olunanda `mail` bloku yazılmasa belə onun domeni ipucu kimi işləyir; blok isə
dəqiqləşdirmək üçündür (məsələn sayt məktubu başqa domendən göndərirsə).

**İki mərhələli qiymətləndirmə.** Hər məktub üçün aidiyyət xalı yığılır — göndərən domeni 60,
məktubdakı keçidin domeni 45, mövzuda ipucu sözü 45, mətndə 20, kod açar sözü 15 (mövzu) və
10 (mətn); xal `MIN_RELEVANCE`-dən aşağıdırsa məktub ümumiyyətlə işlənmir. Aidiyyəti keçən
məktubda sonra kod namizədləri xallanır (`MIN_CODE_SCORE`): uzunluq, ətrafındakı açar sözlər,
il və telefon nömrəsi kimi saxta halların süzülməsi. HTML əvvəl mətndə çevrilir, keçidlər isə
kod axtarışından əvvəl bərabər uzunluqlu boşluqla örtülür ki, sətirdəki indekslər pozulmasın.

**MV3-ə uyğunlaşma.** Worker ~30 saniyə işsiz qalanda sönür, döngü isə dəqiqələrlə davam edir.
Buna görə: izləmə müddətində `INBOX_KEEPALIVE_MS` aralığında nəbz göndərilir; son müddət
`inbox.started`-dan hesablanır və heç vaxt yenilənmir; `inbox.updated` köhnəlirsə popup
`inboxStale` ilə "izləmə dayandı" yazır; worker yenidən işə düşəndə `resumeWatching()` hələ
`watching` olan qutunu köhnə başlanğıc vaxtı ilə davam etdirir. İlk sorğu həmişə `wait:false`-dur
— worker ölü ikən gələn məktub dərhal tapılsın; sonrakılar long-poll-dur (`wait:true`).

**Pauza provider-dən gəlir.** Uğurlu sorğudan sonra döngü gözləmir: nəticə boşdursa dərhal
növbəti sorğunu göndərir. Pauzanın mənbəyi `wait:true`-dur — sayt cavabı saxlayırsa onun
long-poll-u (temp.tf ≈ 8 s), saxlamırsa provider-in özünün emulyasiyası (emailnator: siyahı
`WAIT_GAP_MS`-də bir yenidən oxunur, yeni `id` görünəndə dərhal qaytarılır). Ona görə
`fetchMessages` yazanda pəncərə `INBOX_POLL_TIMEOUT_MS`-dən kiçik seçilməlidir.

**Çatdırılma.** Tapıntı altı yerdə görünür: **relay forması doldurulur** (sayt
`signup.afterCode` addımları veribsə — kod və parol yazılır, "hesab yarat" basılır), dəyər
clipboard-a yazılır, status yenilənir, bildiriş göndərilir, **ikonun üstündə yaşıl ✓ nişanı
çıxır** (popup bağlı olanda da görünür və sistem bildirişləri söndürülsə də işləyir),
popup-da panel açılır — dəyər, "Kopyala" düyməsi, keçiddirsə "Aç", altında məktubun mövzusu və
göndərəni. Heç biri məcburi deyil: biri alınmasa qalanları işləyir və status nəyin baş
tutduğunu yazır. Nişan popup açılanda silinir; izləmə kodsuz bitsə narıncı **!** olur.
Bütün mətnlər `shared/inbox.js`-də qurulur (`inboxLabel` / `inboxSummary` /
`inboxNotification` / `deliveryNote`), ona görə eyni söz bir neçə yerdə təkrar yazılmır və
popup nə sayt adı, nə sayt qaydası bilir.

## İş axınları

**Başlat** — `popup → handleCommand(START) → orchestrator.start()`
1. seçimlər sxemlə yoxlanılır (pozuntuda axın başlamır, xəta popup-a qayıdır);
2. köhnə sessiya silinir;
3. relay tabı müəyyən olunur: adi relay üçün yeni tab öndə açılır, `adoptActiveTab` relay-i
   üçün isə AKTİV TAB mənimsənilir (heç nə açılmır, sayt `relaySite`-a yazılır);
4. temp mail tabı **yalnız səhifə rejimində** relay tabının pəncərəsində arxa planda açılır;
5. sessiya (`options` daxil) `storage.session`-a yazılır;
6. tab açılıbsa yüklənməsi gözlənilir → `address.acquireAddress()`.

**Yeni ünvan** — `handleCommand(NEW_ADDRESS) → acquireAddress(session)`
Popup formadakı CARI dəyərləri göndərir; seçim dəyişibsə yeni ünvan onu tətbiq edir. Sessiya
başqa saytla işləyirsə popup bunu xəta kimi göstərir (yeni saytı tətbiq etmək üçün Başlat
lazımdır). API rejimində heç bir tab açılmır; səhifə rejimində tab yerindədirsə skript birbaşa
yeridilir, bağlanıbsa/discard olubsa/başqa sayta gedibsə əvvəl yenidən açılır və yüklənilir.
Ünvan alınandan sonra qeydiyyat aparılır: relay-in `signup.afterAddress` addımları varsa onlar
icra olunur (`signup.js`), yoxsa naməlum saytda üç addım işləyir (`forms.js`) — qeydiyyat forması
açılır, bütün tanınan xanalar + razılıq xanaları doldurulur, qeydiyyat düyməsi basılır, sonra
çoxmərhələli formanın ikinci addımı da doldurulur (göndərilmir). Parol, istifadəçi adı və şəxs
profili hər dəfə yenidən yaradılır və sessiyaya yazılır. Ünvan alınıb saytda poçt oxumaq imkanı
varsa (`supportsInbox`) arxada izləmə işə salınır.

**Poçtun izlənməsi** — `background/inbox.js → watchInbox(session, address)`
1. köhnə izləmə dayandırılır (`stopWatching` — köhnə ünvanın kodu popup-da qalmamalıdır);
2. `watching` vəziyyəti yazılır və döngü qurulur: son müddət mütləq vaxtdır (`started`),
   nəbz worker-i oyaq saxlayır;
3. hər addımda saytın poçt siyahısı sorğulanır — ilk sorğu `wait:false` (worker ölü ikən gələn
   məktub dərhal tapılsın), sonrakılar long-poll (`wait:true`);
4. `extract.js` məktubları relay ipuçlarına görə süzür. Kod və ya keçid tapılan kimi döngü
   bitir: forma doldurulur (addımlar varsa `signup.js` → kod, parol, "hesab yarat"; yoxsa
   `forms.js` → kod xanası + təsdiq düyməsi), dəyər clipboard-a yazılır, status yenilənir,
   bildiriş göndərilir, `found` vəziyyəti saxlanca düşür;
5. tapıntı yoxdursa müddət bitənə qədər təkrar sorğu; müddət bitəndə `empty`, sorğu xətası
   davam edərsə `error` yazılır. Sessiya bu arada dayandırılıbsa heç nə yazılmır.

**Sayt məlumatını sil** — `popup → handleCommand(CLEAR_TAB) → clearTab(tabId) → wipe(plan, tabId)`
Sessiyadan tam müstəqildir: aktiv tabın URL-indən plan törədilir (`shared/cleanup.js`), ona
görə istənilən sayt üçün işləyir və növbəyə qoyulmur. Ardıcıllıq: səhifə saxlancı
(sessionStorage tab yenilənəndə də qalır, ona görə əvvəl) → cookie + `browsingData` → tabın
yenilənməsi. URL-i worker `chrome.tabs.get` ilə özü oxuyur; popup yalnız tab id-si göndərir.

Plan tabın domeni ilə BİTMİR: sayt tanınmış identity ailəsinə (Microsoft, Google, Apple,
Facebook) aiddirsə ailənin bütün domenləri də silinir. Səbəb: giriş vəziyyəti bir domendə
saxlanılmır — Microsoft-da `login.microsoftonline.com` (ESTSAUTH*) və `login.live.com`
(MSPAuth/RPSSecAuth) ayrı qeydə alınabilən domenlərdir, ona görə yalnız birini silmək saytın
hesabı unutmasına kifayət etmir. Ailə YALNIZ silinən sayt onun üzvüdürsə tətbiq olunur.
Ailə domenləri üçün host icazəsi olmasa da işləyir: `browsingData.remove({ origins })`
cookie-ləri origin-in bütün qeydə alınabilən domeni üzrə silir və icazə tələb etmir —
icazəsiz yalnız partitioned cookie-lər və sayğac itir.

İstifadəçi üçün bu, TƏK klikdir. Host icazəsi yoxdursa silmə browsingData ilə aparılır və sayt
`pendingWipe` kimi saxlanca yazılır; popup eyni klikdə icazəni istəyir (ilk dəfə pəncərə açılır
və popup bağlana bilər — heç nə itmir, çünki silmə artıq göndərilib). İcazə verilən kimi
`chrome.permissions.onAdded → onPermissionsGranted()` gözləyən silməni TAM şəkildə təkrarlayır
(partitioned cookie + sessionStorage). Şərt dardır: icazə məhz gözləyən saytın şablonuna uyğun
olmalıdır, tab bu arada başqa sayta gedibsə yalnız domen üzrə silinir və tab yenilənmir.

**Relay tabı bağlananda** — `chrome.tabs.onRemoved → onTabClosed()`
1. `stopWatching()` — köhnə ünvanın izləməsi kəsilir;
2. `cleanup.clearRelayData()` — cookie-lər (alt-domenlər + partitioned) və saxlanc silinir;
3. relay tabı yenidən açılır, yeni tab id sessiyaya yazılır;
4. yeni ünvan alınır.

Pəncərə bütövlükdə bağlanırsa (`isWindowClosing`) sessiya bitir, heç nə yenidən açılmır.
"Dayandır" da eyni qaydada əvvəl izləməni kəsir, sonra sessiyanı silir.

**Ünvanın alınması** — `address.js`
```
acquireMode(provider)                api  → fetchFromApi(provider, values)   [vaxt limiti 20 s]
                                     page → acquireFromPage(session, provider, values)
                                              ├ ensureLoadedTab()  tabı tapır / açır / reload edir
                                              └ runInPage()        executeScript({ func: newAddress })
checkAddress(provider, address)      ünvan sətirdir və "@" var?
copyText(address, { windowId })      offscreen sənəd → execCommand, alınmasa clipboard.writeText
```

## Vəziyyət modeli

Worker-in yaddaşında heç nə saxlanılmır — hər addımda storage-dan oxunur
(worker istənilən vaxt söndürülə bilər).

| Açar | Sahə | Məzmun | Ömür |
| --- | --- | --- | --- |
| `session` | `storage.session` | `{ tempId, relayId, relaySite, tempTabId, relayTabId, windowId, options, address, username, password, identity, started }` | brauzer bağlanana qədər |
| `status` | `storage.session` | `{ level, text, time }` — popup-da göstərilir | brauzer bağlanana qədər |
| `inbox` | `storage.session` | `shared/inbox.js` forması: `{ phase, address, code, link, subject, from, seen, checked, started, updated, message }` — poçt izləməsinin vəziyyəti | brauzer bağlanana qədər |
| `choice` | `storage.local` | `{ tempId, relayId, options: { [tempId]: values } }` — son seçim | qalıcı |
| `proxies` | `storage.local` | `{ list: [{ scheme, host, port, username?, password?, ping?, checked?, dead? }], updated }` — hamısı istifadəçinin verdiyi qeydlərdir; `ping`/`dead` qoşulma yoxlamasından gəlir. Oxu qatı köhnə idxal qeydlərini süzür (pruneImported) | qalıcı |
| `activeProxy` | `storage.local` | qoşulu proxy + `exitIp`/`checked` (Chrome-un öz parametri də qalıcıdır) | qalıcı |
| `shield` | `storage.local` | `true`/`false` — izləyici qalxanının vəziyyəti | qalıcı |
| `theme` | `storage.local` | `"light"` / `"dark"` — popup teması (yoxdursa sistemin seçimi) | qalıcı |
| `pendingWipe` | `storage.session` | `{ tabId, domain, at }` — host icazəsi gözləyən yarımçıq silmə | brauzer bağlanana qədər |

`session.options` — sessiyanın işlədiyi sayt parametrləri. `choice.options` isə sayt başına
ayrı saxlanılır: istifadəçi temp.tf-də Gmail seçib başqa sayta keçəndə ora öz default-ları ilə
açılır, geri qayıdanda Gmail yenə işarəli olur.

`tempTabId` API rejimində `null`-dur — tab açılmadığı üçün sessiyada izi də yoxdur.
`address` popup-da göstərilir (yanındaki ⟳ yenisini gətirir), `password` isə qeydiyyat
addımları parol tələb edəndə yaradılır — ikisi də hər yeni ünvanda təzələnir.

Statusun `level` sahəsi (`info` / `warn` / `error`) rəngi müəyyən edir. Əvvəllər popup mətnin
"Xəta" ilə başlanğıcına baxırdı; indi mətn saf saxlanılır, prefiks göstərmə zamanı əlavə olunur.

Səviyyəni xətanın növü seçir (`shared/errors.js`):

| Səbəb | Növ | Status | Bildiriş | Console |
| --- | --- | --- | --- | --- |
| saytın limiti, cavabsız sorğu, pozulmuş cavab, yüklənməyən tab, yanlış seçim | `ExpectedError` | sarı `warn` | "xəbərdarlıq" | `console.warn` |
| extension-ın öz qüsuru (TypeError, naməlum id, pozulmuş kontrakt) | adi `Error` | qırmızı `error` | "xəta" | `console.error` |

Fərq yalnız ağırlıq dərəcəsidir — mesaj hər iki halda eyni aydınlıqda çatır. Amma `console.error`
`chrome://extensions` səhvlər səhifəsinə düşür və orada extension yenilənəndə də qalır; ona görə
saytın xətası ora yazılmır: əsl qüsurlar 429 sətirlərinin altında gizlənmir.

## Dəyişməz qaydalar (invariantlar)

1. **Dinləyicilər sinxron qeydiyyatdan keçir.** `background.js`-də heç bir `await`-dən
   sonra `addListener` yoxdur — əks halda worker oyandıqda hadisə qaçır.
2. **Eyni anda bir axın.** `orchestrator.js`-dəki növbə (`enqueue`) əmrləri ardıcıllaşdırır:
   üst-üstə düşən "Yeni ünvan" + "tab bağlandı" iki tab açardı.
3. **Popup etibarlı mənbə deyil.** Mesajla gələn hər dəyər worker-də `resolveValues` ilə
   normallaşdırılır və `validateValues` ilə yoxlanılır — provider-ə yalnız sxemə uyğun təmiz
   dəyər çatır.
4. **Səhifə rejimində `page.js` öz-özlüyündə işləyir.** Funksiya `toString` ilə səhifəyə
   köçürüldüyü üçün import, modul dəyişəni və `chrome.*` işlədə bilməz. `contract.js` bunu
   avtomatik yoxlayır.
5. **`page.js` heç vaxt throw etmir** — `{ address }` və ya `{ error }` qaytarır. API rejimində
   isə əksinə: `fetchAddress` uğursuzluqda **throw edir** və mesajı istifadəçiyə göstəriləcək
   dildə olmalıdır. Xətanın statusa çevrilməsi hər iki halda worker-in işidir.
6. **`shared/` və `providers/` import anında `chrome`-a toxunmur.** Buna görə eyni modullar
   node-da (`tests/`, `tools/check.mjs`) import oluna bilir — sayt protokolu brauzersiz test olunur.
7. **Xəta udulmur, səviyyəsi isə növündən gəlir.** Tutulan hər xəta `reportFailure` ilə
   status + bildiriş + console-a çevrilir; console səviyyəsini `shared/errors.js`-dəki bölgü
   seçir (`ExpectedError` → warn, proqram qüsuru → error). Qayda YALNIZ `notify.js`-də yazılıb:
   axınlar console-a özü yazmır, ona görə heç yerdə unudulmur. Yeganə istisnalar bildirişin
   özünün uğursuzluğudur (əsas işi qırmamalıdır) və `background.js`-dəki wiring xətalarıdır
   (onlar həmişə extension-ın öz qüsuru sayılır → `console.error`).
8. **Provider məlumatı yalnız deskriptordadır.** Host icazə şablonları `hosts`-dan törədilir,
   DNR qaydaları `requestOrigin`-dən (`shared/net.js`), əl ilə ikinci dəfə uyğunlaşdırılmır;
   popup formaları `options.schema`-dan qurulur; uyğunluğu `tools/check.mjs` yoxlayır.
9. **"Dayandır" həmişə qalib gəlir.** Dayandır növbəyə qoyulmur, dərhal sessiyanı silir.
   Növbədəki uzun axın hər uzun addımdan sonra `isLiveSession`/`updateSession` ilə yoxlayır:
   sessiya yoxdursa və ya `started` fərqlidirsə (bu arada yeni Başlat olubsa), axın sakitcə
   dayanır — köhnə sessiyanı diriltmir, tab açmır, clipboard-a yazmır. Buna görə uzun axınlar
   sessiya sahələrini birbaşa `writeSession` ilə YAZMIR.
10. **Poçt izləməsi növbədənkənardır, amma köhnə döngü vəziyyət yaza bilməz.** Hər döngü özünə
    `watcher` nişanı alır; yazmazdan əvvəl `own()` yoxlayır ki, nişan hələ onundurmu. Dayandır,
    yeni ünvan və pəncərənin bağlanması nişanı sıfırlayır və gözləyən sorğunu `AbortController`
    ilə kəsir — köhnə döngü nə clipboard-a yazır, nə popup-ı pozur.
11. **Tapıntı ya kod, ya keçiddir.** `extractFromMessage` aidiyyəti keçməyən və ya dəyəri olmayan
    məktubu `null` qaytarır; döngü belə məktubu `seen`-ə alıb davam edir. Popup və bildiriş
    heç vaxt boş dəyər göstərmir.
12. **İzləmənin son müddəti mütləq vaxtdır.** `inbox.started` heç vaxt yenilənmir: worker sönsə
    və `resumeWatching()` döngünü davam etdirsə də son müddət eyni qalır — izləmə sonsuz
    uzanmır. Worker qayıtmasa popup `inboxStale` ilə "izləmə dayandı" yazır.
13. **Proxy parametri QALICIDIR və saxlancla uzlaşdırılır.** `chrome.proxy` brauzer
    səviyyəsindədir və brauzer bağlanıb açılsa da qalır. Ona görə qoşulu proxy `activeProxy`
    açarına yazılır, worker qalxanda `resumeProxy()` parametri yenidən qurur (kənar extension
    və ya siyasət onu dəyişə bilər), "Ayır" isə həm parametri təmizləyir, həm açarı silir.
    Yerli ünvanlar həmişə bypass siyahısındadır.

## Qəbul edilmiş qərarlar

**Niyə build addımı yoxdur?** Chrome MV3 modul service worker-ı (`"type": "module"`)
və extension səhifələrində ESM import-u yerində dəstəkləyir. Bundler olmadan da qovluq
birbaşa `Load unpacked` ilə yüklənir — quraşdırma addımı yoxdur, yoxlama isə node ilə aparılır.

**Niyə provider-lər qovluq şəklindədir?** Hər saytın iki fərqli mühitdə işləyən kodu var
(worker-də deskriptor və protokol, səhifədə skript). Qovluq bu sərhədi fayl səviyyəsində
görünür edir və sayt artdıqca `providers/`-in içi qarışmır.

**Niyə API rejimi əlavə olundu?** Saytın API-si cookie və açar tələb etmirsə tab açmaq artıq
iştir: istifadəçi gözləyir, brauzer tab ilə dolur, yüklənmə gözləməsi axını uzadır. API rejimi
ünvanı worker-də bir sorğuya endirir. Səhifə rejimi isə saxlanılıb — API-si olmayan saytlar
üçün yeganə yoldur; hansı rejimin işləyəcəyini kontrakt avtomatik seçir.

**Niyə sayt parametrləri sxemlə təsvir olunur, forma isə popup-da qurulur?** Parametrlər sayta
məxsusdur, forma isə ümumidir. Sxem olmadan hər yeni sayt popup-a yeni HTML və JS yazmağı
tələb edərdi — yəni "yalnız providers/ dəyişir" qaydası pozulardı.

**Niyə `createRegistry` xarab deskriptoru atmayıb `problems`-ə yazır?** Bir saytın səhvi
qalan saytları işləməz qoymamalıdır: extension açılır, xarab provider siyahıya düşmür,
səbəb console-a yazılır və `npm run check` onu xəta kimi qaytarır.

**Niyə qeydiyyat addımları avtomatlaşdırılır?** İstifadəçiyə lazım olan kodun mətni deyil,
hesabın yaradılmasıdır. Kod clipboard-da olsa da o, popup-ı açıb dəyəri görüb formaya
yerləşdirməli, üstəlik metodu seçib parol düşünməli olurdu — yəni işin yarısı yenə əl ilə
qalırdı. `signup.js` addımları icra edir; saytdan asılı yeganə hissə addımların özüdür və o,
relay deskriptorundadır (`signup.afterAddress` / `signup.afterCode`).

Üç qərar bu axının içindədir:

- **Dəyər prototipdəki native `value` setter-i ilə yazılır** və `input`/`change` hadisələri
  göndərilir. React idarə edən xanada `el.value = kod` DOM-u dəyişir, framework state-i isə
  boş qalır və forma boş dəyər göndərir (real saytlarda ölçülüb). Skript `world: "MAIN"`-də icra
  olunur — saytın öz React nümunəsi ilə eyni dünyada.
- **`waitValue` addımı `enabled`-dən ayrıdır.** bir çox saytda "Send code" düyməsi Turnstile
  token-i gəlməmiş də klikləniləndir, sayt isə sorğunu `Turnstile verification failed` ilə
  kəsir və cəhd itir. Yəni "düymə aktivdir" hazırlıq siqnalı DEYİL; token-in özü siqnaldır və
  o, gizli input-dadır. Ona görə `waitValue` görünmək tələb etmir.
- **Parol extension-da yaranır** (`shared/password.js`): Chrome-un "Suggest strong password"
  pəncərəsi kənardan açıla bilmir. Forma göndəriləndə Chrome-un öz parol menecerinə adi
  qeydiyyat kimi düşür, üstəlik dəyər sessiyaya yazılır və popup-da göstərilir — "Save
  password" təklifi rədd olunsa da parol itmir. Tərkib: 8 simvol, ən azı bir kiçik, bir böyük
  hərf, bir rəqəm və **dəqiq bir xüsusi simvol** (`!@#$%*`). Bir dənə — çünki saytların çoxu
  "ən azı 1 simvol" tələb edir, bəziləri isə simvolları məhdudlaşdırır; simvol İÇƏRİDƏ
  yerləşdirilir, çünki bəzi yoxlayıcılar simvolla başlayan/bitən parolu qəbul etmir.
  Səhv oxunan simvollar (`l/I/1`, `O/0`) siyahıda yoxdur: parol lazım gələndə əl ilə də
  yazıla bilməlidir.

**Niyə serverin cavabı yoxlanılmır?** Addımların icrası ilə hesabın yaradılması ayrı şeylərdir:
sayt limit qoya, kodun vaxtı keçə, promo kodu rədd oluna bilər. Bunların hər birini tanımaq
sayta məxsus qaydalar yığını tələb edərdi və deskriptor "addımlar" olmaqdan çıxıb "biznes
məntiqi" olardı. Ona görə status yalnız "forma dolduruldu" deyir — nəticəni saytın öz
bildirişi göstərir, tab isə istifadəçinin qarşısındadır.

**Niyə NAMƏLUM saytda qeydiyyat evristika ilə aparılır?** Sayta bağlı relay deskriptorları
QƏSDƏN yoxdur (reyestrdə yalnız "bu sayt" relay-i var), yəni qeydiyyat həmişə naməlum saytda
aparılır. Hər sayt üçün ayrı selektor dəsti saxlamaq baxımsız qalan yükdür: sayt dizaynını
dəyişən kimi addımlar sınır və istifadəçi bunu yalnız axın batanda görür. Ona görə güc ÜMUMİ
məntiqə qoyulub. `background/forms.js` boşluğu brauzerin öz autofill mexanizminin üsulu ilə
doldurur: xana `type`, `autocomplete`, `name`, `id`, `placeholder`, `aria-*` və **LABEL mətninə**
görə tanınır (Chromium autofill də məhz bu kontekst əlamətlərinə baxır — bax: modulun
başlığındaki keçidlər). `signup` addımlarının mexanizmi (`background/signup.js`) yerində qalır:
gələcəkdə konkret sayt üçün dəqiq ardıcıllıq lazım olsa deskriptora `signup` yazmaq kifayətdir.

Axın dörd addımlıdır: **formanı aç → doldur → razılıq xanalarını işarələ → doğru düyməni bas**.
Bu, TƏXMİNDİR, ona görə sərhədləri dardır:

- **İki mexanizm üst-üstə düşmür.** Evristika YALNIZ o faza üçün işə düşür ki, relay-in həmin
  fazaya addımı yoxdur (`supportsSignup(relay, phase) === false`).
- **Səhv doldurmaq boş qoymaqdan pisdir.** Mənfi siyahılar var: promo/kupon/referral kodu, poçt
  indeksi (`pin code` kod xanası deyil!), axtarış, məbləğ və `current-password` (giriş forması)
  kənarda qalır; saytın/istifadəçinin özünün yazdığı dəyər üzərindən yazılmır (yalnız ünvan, ad,
  parol və kod bizimdir); marketinq/abunə xanaları məcburi deyilsə işarələnmir.
- **RAZILIQ XANALARI bütün sənəddən yığılır və GÖRÜNMƏK tələb olunmur.** İki səbəb: (1) razılıq
  xanası çox vaxt `<form>`-un kənarındadır (React modal, footer bloku); (2) müasir dizayn
  sistemləri (Tailwind `sr-only`/`appearance-none`, shadcn, MUI, Ant Design) əsl
  `<input type="checkbox">`-u gizlədib yanında öz elementini çəkir. Görünmə şərti qoyulanda belə
  xanalar ümumiyyətlə nəzərə alınmır və forma "şərtləri qəbul et" yoxlamasından keçmir. Gizli
  xana üçün klik ona bağlı `<label>`-a göndərilir (framework hadisəni ondan alır); işarələnmiş
  vəziyyət `checked`, `aria-checked` və `data-state="checked"` (Radix/shadcn) formalarında
  oxunur. Qərar MƏTNƏ görə verilir — razılıq/yaş/"robot deyiləm" işarələnir, marketinq yalnız
  məcburidirsə, mətni tanınmayan xana isə yalnız məcburi VƏ formanın içində/görünəndirsə.
- **YAD FORMALAR bloklanır — bu, ən çox ziyan verən qüsur sinfi idi.** Poçt xanası olan hər
  forma qeydiyyat forması deyil: `coinmarketcap.com` ana səhifəsində ünvan **bülletenə abunə**
  xanasına yazıldı, çünki forma seçimi yalnız "hansı rollar var" çəkisi ilə aparılırdı və tək
  poçt xanası olan abunə forması 2 xal alıb qalib gəlirdi. İndi formalar ƏVVƏLCƏ təsnif olunur:
  abunə (düymə/imza/`action` nişanı), giriş, parolun bərpası, axtarış, əlaqə/şərh, ödəniş —
  hamısı bloklanır. Düymədə qeydiyyat sözü varsa bloklar ləğv olunur. Abunə nişanı formanın
  BÜTÜN mətnindən oxunmur (orada "Send me the newsletter" razılıq xanası ola bilər), yalnız
  xananın öz imzasından, düymə yazısından və `action`-dan.
- **Düymə MƏRHƏLƏYƏ görə seçilir.** Kod hələ gəlməyibsə kodu poçta göndərən düymə ("Send code",
  "Get code", "Send verification code", "Email me a code", "kodu göndər", "получить код"…) BÜTÜN
  digərlərindən üstündür — əks halda səhifədəki "Create account" basılır və kod heç vaxt
  göndərilmir. Kod ƏLİMİZDƏDİRSƏ eyni düymə tam kənarda qalır: yeni kod istəmək əlimizdəkini
  köhnəldir. Kod düymələrinin yazısı birmənalı olduğu üçün onlar `<form>` tapılmayan səhifədə də
  (sənəd kökü) qəbul olunur, halbuki "Continue/Next" orada qəsdən rədd edilir. `Resend` qadağan
  siyahısındadır. Aşkarlanan kod düymələri nəticədə (`codeButtons`) və statusda görünür.
- **Forma seçimi çəki ilədir**: parol 3, kod 4, ünvan 2 xal, qalan rollar 0.5 — beləliklə
  çoxsahəli "əlaqə" forması qeydiyyat formasını üstələmir. `<form>` HƏMİŞƏ sənəd kökündən
  üstündür: əks halda giriş və qeydiyyat formasının xanaları birləşib "daha yaxşı" görünərdi.
  Sıra belədir: `<form>` kökləri → PANEL kökləri (`tightest`) → sənəd kökü.
- **Çoxmərhələli forma üçün ikinci keçid** var (`onlyEmpty`): yalnız BOŞ xanalar sayılır, ünvan
  və istifadəçi adı isə ümumiyyətlə sayılmır — səhifədə qalan giriş forması məhz onlarla tanınır
  və yanlışlıqla seçilərdi (real brauzer yoxlamasında məhz bu oldu).
- **Dəyər xananın məhdudiyyətinə uyğunlaşır**: `maxlength`, `minlength` və `pattern` yoxlanılır,
  hər rol üçün bir neçə forma var (telefon: `5122087412` / `+15122087412` / `(512) 208-7412`).
  Kəsilməsi ziyanlı rollar (poçt, parol, kod, indeks, tarix) uyğun forma yoxdursa YAZILMIR —
  yarım dəyər saytın yoxlamasını onsuz da keçmir.
- **Gözləmə MutationObserver ilədir**, `setTimeout` sorğusu ilə deyil: forma çox vaxt React ilə
  sonra qurulur, arxa plandaki tabda isə timer boğulur. Düymə də gözlənilir (8 s): "Send code"
  adətən poçt xanası doldurulandan və ya CAPTCHA token-i gələndən sonra aktivləşir.
- **Metod seçimi və AUTH MODALI da açılır.** "Google / Apple / Email" cərgəsində poçt yolu
  ("Continue with email") basılır. Qeydiyyat düyməsi ümumiyyətlə yoxsa auth səthi açılır
  ("Log In") və modalın içindəki "Sign Up" TABI basılır — `coinmarketcap.com`-un real qurğusu
  belədir. Tablar `<button>`/`<a>`/`role="tab"` olmaya bilər (CMC-də klik hadisəsi olan
  `<div>`-lərdir), ona görə açıq modalın içində qısa mətnli ən daxili elementlər də daranır.
- **GİRİŞ ↔ QEYDİYYAT paneli PANELİN MƏZMUNUNDAN ayrılır, tab yazısından DEYİL.** Modalda hər
  iki tabın yazısı ("Log In" və "Sign Up") görünür, `aria-selected`/`data-state` nişanları isə
  hər saytda olmur; üstəlik modalda `<form>`, `role="dialog"` və tanınan class DA olmaya bilər
  (`coinmarketcap.com` styled-components işlədir). Ona görə panel **valideyn zənciri** ilə
  tapılır — xanadan `PANEL_DEPTH` = 12 səviyyəyə qədər yuxarı (struktur elementlərində
  dayanılır: BODY, HTML, MAIN, HEADER, FOOTER, NAV, ASIDE) — və yalnız GÖRÜNƏN elementlərin
  **öz mətni** oxunur (bax: növbəti bənd). Nişanlar: `Forgot password?` / `Remember me` /
  `current-password` → giriş; razılıq xanası / parol təsdiqi / `new-password` / ad xanası /
  `Create an account` → qeydiyyat. Qərarı ƏN DAXİLİ qəti cavab verir: yuxarı qatlar hər iki
  paneli əhatə edə bilər (yanaşı "Login | Register" səhifələri). Giriş paneli görünürsə ora
  HEÇ NƏ yazılmır və səbəb statusda yazılır ("2 xana giriş panelindədir").
  Bu qüsur real brauzerdə İKİ DƏFƏ tutuldu: birinci dəfə modal tapılmadı, ikinci dəfə tapıldı,
  amma nişansız olduğu üçün panel tanınmadı və ünvan/parol giriş formasına yazıldı.
- **Mətn elementin ÖZ mətn qovşaqlarından oxunur, "yarpaq element" qaydası ilə DEYİL**
  (`ownText`). Əvvəl yalnız alt elementi olmayan elementlər sayılırdı — yəni `textContent`
  valideyn zəncirində təkrarlanmasın deyə. Real DOM bunu pozur: CMC-nin tabları
  `<div>Sign Up<div class="underline"></div></div>` şəklindədir, yəni alt elementi VAR (bəzək)
  və yarpaq sayılmır. Nəticə: diaqnostika hesabatında klikləniləsi elementlər arasında
  "Sign Up" ÜMUMİYYƏTLƏ görünmədi, halbuki ekranda idi — "qeydiyyat bölməsini tapa bilmir"
  qüsurunun əsl səbəbi bu idi. `ownText` yalnız `nodeType === 3` alt qovşaqlarını yığır: bəzək
  nə qədər dərin olsa da etiketi DAŞIYAN element tapılır, valideyn qatlarında isə mətn
  təkrarlanmır. Qayda üç yerdə birdən işləyir — tab axtarışı (`collectLoose`), panelin məzmunu
  (`visibleText`) və diaqnostika hesabatı. Bu, framework-dən asılı deyil: React, Vue və
  styled-components da etiketi mətn qovşağı kimi yazır. Mühafizənin işlədiyi **mutasiya ilə**
  yoxlanılıb: qayda söndürüləndə bəzəkli tab testi düşür.
- **`<form>` olmayan səhifədə sənəd kökü QEYDİYYAT ƏLAMƏTİ tələb edir** (`signupContext`).
  CMC modalında heç bir `<form>` yoxdur (diaqnostika: `"forms": []`), ona görə xanalar sənədin
  kökündən yığılır. Bu isə bloklanmış bülleten qüsurunu ARXA QAPIDAN qaytarır: giriş paneli
  bloklandıqda səhifənin altındaki abunə xanası YEGANƏ namizəd qalır və ünvan ora yazılır.
  Ona görə sənəd kökü seçiləndə tək poçt xanası kifayət etmir — ən azı bir qeydiyyat əlaməti
  lazımdır: parol, parol təsdiqi, kod, istifadəçi adı, ad/soyad, telefon xanası, razılıq
  xanası, qeydiyyat yazılı düymə, ya da ünvanın özünün qeydiyyat yolunda olması. `<form>`
  kökləri bu şərtdən AZADDIR — orada formanın öz növü onsuz da təsnif olunur (abunə/giriş/…).
  Səbəb statusda `skipCount.context` ilə görünür.
- **Sənədin BÜTÜN xanaları bir forma DEYİL — panel kökləri ayrıca qiymətləndirilir**
  (`tightest`). `<form>` olmayan səhifədə xanalar sənəd kökündən yığılır və `assign` rolu
  SƏNƏD SIRASINDA birinci gələnə verir. Real hesabatda coinmarketcap.com-un bülleten xanası
  (`fields[0]`, "Enter your e-mail address") modalın ünvan xanasından (12-ci) ƏVVƏL gəlir —
  yəni `email` bülletenə düşürdü, modalın öz xanası isə atılırdı: parol modala, ünvan
  bülletenə yazılırdı. Diqqət: bu, əvvəlki iki düzəlişdən SONRA da qalan qüsurdur (panel
  tanınırdı, tab basılırdı — sıra qaydası isə heç yerdə yoxlanmırdı). İndi sənəd kökünə
  keçməzdən əvvəl hər xananın valideyn zənciri namizəd kök sayılır, hər kök forma kimi
  qiymətləndirilir və ƏN DAXİLİ ən yüksək ballı kök seçilir (valideyn övladın balını miras
  aldığı üçün maksimum bir neçə qatda təkrarlanır). Üç şərt bunu təhlükəsiz saxlayır:
  (1) namizəd kök də `signupContext`-dən keçir — nişanlar KÖKÜN İÇİNDƏN oxunur, əks halda
  səhifənin bir yerindəki "Create an account" düyməsi uzaqdaki bülleten qutusunu "qeydiyyat"
  edərdi; (2) dar kök yalnız sənəd kökü qədər çox şey izah edirsə seçilir — dərin, iki qola
  ayrılmış səhifədə (ortaq valideyn `containersOf` dərinliyindən uzaqda) yarım forma
  seçilməməlidir; (3) köklərin müqayisəsi TƏSDİQ xanalarını saymayan "əsas bal" (`core`) ilə
  aparılır. Sonuncu şərt təsadüfi deyil: ilk versiyada müqayisə adi balla idi və iki paneli
  birləşdirən kök ikinci panelin ünvan xanasını `emailConfirm` kimi sayıb balı 5→6 qaldırırdı,
  yəni doğru dar kök "daha az izah edir" deyə rədd olunurdu. Formaların öz sıralanmasında isə
  təsdiq xanası SAYILIR (`points`) — orada o, güclü qeydiyyat nişanıdır.
- **İkinci poçt/parol xanası yalnız BİRİNCİSİNİN YANINDA "təsdiq" sayılır** (`nearBy`: birinci
  xananın 4 valideyn qabından biri ikincini əhatə edirsə). Əvvəl yaxınlıq şərti yox idi və
  səhifənin uzağındaki bülleten xanası da `type=email` daşıdığı üçün `emailConfirm` kimi
  doldurulurdu — real məlumatda məhz belə oldu. Bu qayda parol təsdiqinə də şamildir: yanaşı
  duran giriş formasının parol xanası "təsdiq" sayılmamalıdır.
- **Ünvan TƏXMİN EDİLMİR.** Bir versiyada link tapılmayanda `/signup`, `/register` kimi standart
  yollar sınanırdı — `coinmarketcap.com`-da bu, mövcud olmayan səhifəni açdı. Naviqasiya yalnız
  səhifənin ÖZ `href`-lərindən oxunan, eyni origin-dəki ünvana olur (gizli menyudakı linklər də
  sayılır, çünki `href` görünmədən də mövcuddur). Fərqli origin qəsdən kənardadır: `activeTab`
  icazəsi orada itərdi.
- **İcazə `activeTab`-dandır.** Naməlum sayta skript yeritmək host icazəsi istəyir;
  `host_permissions: ["*://*/*"]` yazmaq quraşdırmada "bütün saytlardaki məlumatınızı oxu"
  xəbərdarlığı verərdi. `activeTab` icazəni istifadəçi ikonaya basanda verir və tab başqa
  ORIGIN-ə keçənə qədər saxlayır — axının özü (ikona bas → Başlat) icazəni gətirir.

**Niyə "Səhifəni təsvir et" düyməsi var?** Qeydiyyat səthinin tapılması təxmindir və səhv
təxmini KƏNARDAN görmək mümkün deyil: istifadəçi yalnız "işləmədi" görür, tərtibatçı isə səhvi
təxminlə axtarır. Bu, bir dəfə bahalı çıxdı — CMC üçün ardıcıl ÜÇ evristika quruldu (nişanlara
görə tab seçimi, `role="dialog"`/class-a görə panel, standart `/signup` yolu) və hər üçü səhvin
yerini bilmədən yazıldığı üçün batdı, sonuncusu isə mövcud olmayan səhifə açdı. Ona görə güc
guess-dən FAKTA keçirildi: `describePageInPage` aktiv tabın DOM-unu oxuyur (heç nə dəyişdirmir,
heç nəyə klikləmir) və hesabatı clipboard-a yazır — bütün xanalar (`type`, `name`, `id`,
`autocomplete`, `placeholder`, `aria-label`, görünürmü, `<form>` içindədirmi) hər birinin
**valideyn zənciri** ilə (paneli tapan məntiq məhz onu gəzir), qeydiyyat/giriş sözü daşıyan
bütün klikləniləsi mətnlər (düymə olmayan `<div>` tablar da, `aria-selected`/`data-state`
nişanları ilə), formaların `action`-ı və düymə yazıları. İlk iki real hesabat dərhal üç səbəbi
göstərdi: `"forms": []`, klikləniləsilər arasında "Sign Up" YOX (yarpaq qaydası), və səhifədə
ayrıca bülleten xanası. Hesabat həm də `world: "MAIN"` sərhədini yoxlayır: gördüyümüz DOM
istifadəçinin gördüyü DOM-dur.

**Niyə doldurma və klik AYRI-AYRI yeridilir?** Çünki klik səhifəni dəyişə bilər və o zaman
`chrome.scripting.executeScript` promise-i HEÇ VAXT yekunlaşmır — sənəd ölür, nə nəticə, nə xəta
gəlir. Bir yeridilmədə etsək: (a) worker növbəsi əbədi kilidlənir, (b) doldurmanın nəticəsi də
itir. İndi hər addımın öz vaxt limiti var (`ANSWER_GRACE_MS`); limit bitəndə bu, "səhifə keçid
etdi" kimi yozulur, tabın sakitləşməsi gözlənilir (`tabs.js → settleTab`) və axın davam edir.
Bu qüsur real brauzer yoxlamasında tapıldı: "Sign up" linki basılırdı, forma isə boş qalırdı.

**Niyə göndərmə düyməsi YAZISINA görə seçilir?** Naməlum saytda `type="submit"` olan hər düyməni
basmaq təhlükəlidir — giriş forması da submit-dir, "Continue with Google" da düymədir, səhifədə
"Delete account" və "Subscribe" də ola bilər. Seçim üç dərəcəlidir: qara siyahı (heç vaxt), güclü
yazı (create/register/sign up/yarat/kaydol/üye ol/зарегистрироваться…), zəif yazı
(davam/göndər/təsdiq). Bərabərlikdə güclü udur, yazısı tanınmayan `type="submit"` isə ən son
ehtimaldır. Forma tapılmayıb bütün sənəd işlədilirsə yalnız GÜCLÜ yazı qəbul olunur.
Uyğunluq söz sərhədi ilə yoxlanılır ("Create **Silver** account" basılır, çünki qadağan "sil"
sözü söz içində sayılmır) və hərflər normallaşdırılır: ayırıcılar boşluğa çevrilir
("first_name" ↔ "firstName" ↔ "first name"), `ə→e`, `ı→i`, diakritika atılır ("Şərtləri qəbul
edirəm" tutulur). Şəkilçili sözlər (şərtləri, qaydalarla, koşullarını) KÖK üzrə tutulur — amma
yalnız razılıq xanalarında: orada səhv müsbət nəticə ziyansızdır (checkbox işarələnir), sahə
adlarında isə söz sərhədi qalır.

**Niyə CAPTCHA həll olunmur?** reCAPTCHA, hCaptcha və Turnstile ayrı origin-dəki iframe-dədir.
Extension yalnız `activeTab` (yəni tabın öz origin-i) üçün icazə alır, `allFrames` ilə yeridilmə
isə həmin üçüncü tərəf origin-inə host icazəsi tələb edərdi. Ona görə yalnız saytın ÖZ DOM-undaki
"mən robot deyiləm" checkbox-u işarələnir; tapmacanı istifadəçi həll edir. Bu, texniki hədddir və
qəsdən belə saxlanılır.

**Niyə şəxs məlumatı təsadüfi deyil?** Təsadüfi simvol yığını saytın yoxlamasını keçmir ("ad
rəqəm ola bilməz", "indeks 5 rəqəmdir", "telefon yanlışdır"), üstəlik uzlaşmayan məlumat
(Bakı + Texas indeksi) şübhə doğurur. `shared/identity.js` HƏQİQİ şəhər ↔ ştat ↔ indeks ↔ telefon
sahə kodu cütləri, adi ad-soyad, 24–38 arası yaş və ayın 28-ni keçməyən doğum günü verir. Profil
ünvandan **determinist** törədilir (FNV-1a toxum + mulberry32): forma iki mərhələdə doldurulur və
worker arada sönə bilər — dəyərlər dəyişsə sayt "məlumat uyğun gəlmir" deyərdi. Ünvan, istifadəçi
adı və parol isə sessiyanın öz sahələrindəndir (həqiqət mənbəyi birdir).

**Niyə "sayt məlumatını sil" düyməsi istəyə bağlı host icazəsi istəyir?** Üç API-nin
imkanı fərqlidir: `chrome.browsingData` origin üzrə cookie, saxlanc və keşi host icazəsi
OLMADAN silir; `chrome.cookies` (partitioned/CHIPS cookie-lərin yeganə yolu) və
`chrome.scripting` (sessionStorage yalnız səhifədə təmizlənə bilər) isə icazə tələb edir.
Bütün saytlar üçün `host_permissions` yazmaq quraşdırma anında "bütün saytlardaki
məlumatınızı oxu" xəbərdarlığı verərdi — halbuki icazə yalnız düyməyə basılanda lazımdır.
Ona görə `optional_host_permissions: ["*://*/*"]` saxlanılır. İcazə silmə klikinin İÇİNDƏ
istənilir, amma silmədən SONRA: `chrome.permissions.request` pəncərəsi popup-ı bağlayır, yəni
ondan sonra yazılan `send(...)` heç vaxt icra olunmur — praktikada düymə "işləmirdi". İndi
əvvəl silmə göndərilir, sonra icazə soruşulur; sayt `pendingWipe` kimi yazılır və icazə
verilən kimi worker (`permissions.onAdded`) silməni tam şəkildə təkrarlayır. Nəticə:
istifadəçi üçün bir klik, rədd halında isə əsas silmə onsuz da baş tutmuş olur.
Silmə `originTypes: { unprotectedWeb, protectedWeb }` ilə aparılır — sayt PWA kimi
quraşdırılıbsa onun məlumatı da düşür; `extension` növü qəsdən kənardadır.

**Niyə parollar silinmir?** Chrome 144-dən `browsingData` üzərindən parol silmək imkanı
extension-lardan geri alınıb (`passwords` dəyəri sadəcə nəzərə alınmır), üstəlik bu növ
origin üzrə də süzülmür — yəni cəhd bütün profilin parollarını silmək olardı. Ona görə
`DATA_TYPES` siyahısında yoxdur və status istifadəçiyə bunu açıq deyir.

**Niyə "bu sayt" relay-i var?** Extension yalnız qoşulu relay saytları üçün işləsəydi
istifadəçi başqa bir saytda (facebook.com, github.com) qeydiyyatdan keçmək istəyəndə Başlat
yad bir sayt açar və kodu onun üçün axtarardı. `adoptActiveTab` relay-i bu boşluğu doldurur:
sayt məlumatı deskriptorda deyil, Başlat anında AKTİV TABDAN alınır.

Qərarın yeri vacibdir: qalan qatlar (poçt ipuçları, təmizləmə, status) fərq görməməlidir, ona
görə `background/relay.js → resolveRelay(session)` hər iki halda EYNİ formada obyekt qaytarır
(`{ id, name, url, hosts, cleanup }`). Bu, təsadüfən mümkün oldu: `tabCleanupPlan()` onsuz da
relay `cleanup` sahəsi ilə eyni formadadır. Nəticədə `mailHints()` və `clearRelayData()`
dəyişmədi.

Üç fərq qəsdəndir: tab AÇILMIR (istifadəçinin öz tabı işlədilir), forma DƏQİQ ADDIMLARLA
doldurulmur (selektor yoxdur — onun yerinə `forms.js` evristikası işləyir), tab bağlananda sayt
məlumatı SİLİNMİR və tab yenidən açılmır. Sonuncu ən vacibidir:
istifadəçinin öz saytını silib yenidən açmaq gözlənilməz
və dağıdıcı olardı — silmək istəsə alət cərgəsindəki 🗑 düyməsi var. Mənimsənilən sayt
sessiyada (`relaySite`) saxlanılır, çünki worker sönə bilər və tab bu arada başqa ünvana keçə
bilər; istifadəçinin Başlat anında seçdiyi sayt dəyişməməlidir.

**Niyə ikonun üstündə nişan var?** Kod tapılanda bildiriş göndərilir, amma sistem
bildirişləri söndürülmüş ola bilər (Windows "focus assist", brauzer ayarları) — belə halda
istifadəçi kodun gəldiyini yalnız popup-ı açanda bilirdi. Nişan (`chrome.action.setBadgeText`)
HƏMİŞƏ görünür və heç bir icazə tələb etmir; tooltip-də dəyərin özü yazılır, ona görə kursoru
ikonun üstünə gətirmək kifayətdir. Nişanı worker qoyur, popup isə açılanda silir — məhz o an
istifadəçi dəyəri görür. Modul `shared/badge.js`-dədir, çünki hər iki tərəf işlədir.

**Niyə popup səthi bu qədər yığcamdır?** Popup 328 piksel enindədir və orada dörd fərqli
məlumat var: sayt seçimi, saytın parametrləri, ünvan/kod və silmə aləti. Hamısı bir sütunda
düzülsəydi ekran dolar, əsas əməliyyat aşağı düşərdi. Ona görə alət cərgəsindəki BÜTÜN
düymələr eyni ölçüdə (30×30), rəngsiz və konturlu ikonlardır — solda poçt saytı, relay saytı
və başlat/dayandır, sağda silmə və tema. Başlat düyməsi əvvəl dolğun mavi idi: ölçü eyni olsa
da fon onu ağır göstərirdi və cərgə səliqəsiz görünürdü. İndi rəng yalnız hover-də gəlir
(başlat mavi, dayandır və silmə qırmızı), vəziyyəti isə ikonun forması deyir (▷ / □).
Sayt adları düymələrin üstündə yazılmır (uzun domenlər cərgəni pozurdu): onlar tooltip-də və
düymənin açdığı paneldə görünür. Eyni anda yalnız bir panel açıq qalır, yeni ünvan isə
ünvanın yanındaki ⟳ ikonundadır. Boş halda səth ~120 piksel hündürlükdədir.
Status bildiriş kimi davranır: `format.js → STATUS_TTL_MS` ömrü bitəndə qutu gizlənir
(səviyyəyə görə 7/20/45 saniyə) — saxlancdan silinmir, ona görə popup bağlı olanda gələn
hadisə itmir, amma köhnə mesaj ekranda durmur.
Rənglər CSS dəyişənlərindədir, ona görə light/dark bir atributla (`html[data-theme]`) dəyişir
və `color-scheme` native elementləri (select, scrollbar) də uyğunlaşdırır. Seçim
`storage.local`-da qalır; yoxdursa sistemin seçimi işlədilir.

**Niyə host icazələri `optional_host_permissions`-da deyil?** İstənilən halda yeni sayt
üçün `manifest.json`-a sətir əlavə edib extension-ı yeniləmək lazımdır — yəni optional
variant əlavə yük azaltmır, yalnız hər istifadədə icazə pəncərəsi açır. Ona görə
`host_permissions` saxlanılır, unudulma riski isə `tools/check.mjs` və popup-dakı
Başlat yoxlaması ilə örtülür. API rejimində bu icazə həm də `fetch`-in CORS-u keçməsi üçün
lazımdır — worker saytın domeninə icazəsiz sorğu göndərə bilməz.

**Niyə `Origin` başlığı declarativeNetRequest ilə əvəzlənir?** Worker-dən gedən `fetch`
cross-origin sayılır və Chrome ona `Origin: chrome-extension://<id>` yazır. Saytın API-si
yalnız öz səhifəsindən çağrılmağı gözləyirsə bu sorğunu 403 ilə kəsir (emailnator:
`{"status":"error","message":"Forbidden"}` — real brauzerdə qayda sönülü ikən 403, açıq ikən
200 olduğu yoxlanılıb). Başlığı `fetch` seçimlərindən dəyişmək mümkün deyil: `Origin`
qadağan olunmuş başlıqdır və brauzer onu atır. DNR isə başlığı sorğu göndərilməzdən əvvəl
şəbəkə qatında əvəz edir. Qaydalar **statik** ruleset-dədir (`rules/provider-origin.json`),
çünki statik qaydalar extension yüklənən andan aktivdir — dinamik qayda quraşdırılana qədər
worker-in ilk sorğusu qorunmasız qalardı. Fayl əl ilə saxlanılır, amma məzmunu
`shared/net.js → originRules()`-dan törədilir və `npm run check` fərqi xəta kimi göstərir:
bu, `host_permissions` ilə eyni prinsipdir (mənbə deskriptor, manifest surət, check hakim).

**Niyə clipboard offscreen sənədlə yazılır?** Service worker-in DOM-u yoxdur,
`navigator.clipboard` isə yalnız fokusda olan sənəddə işləyir. Offscreen sənəd
`clipboardWrite` icazəsi ilə `document.execCommand("copy")`-ni fokussuz icra edə bilir.

**Niyə poçt qutusu izlənir?** Aktivasiya üçün istifadəçiyə məktubun özü yox, içindəki dəyər
lazımdır. Saytın API-si poçt siyahısını verirsə (`fetchMessages`) məktubu açmağa, gözləməyə və
HTML-i əl ilə süzməyə ehtiyac qalmır: extension dəyəri özü tapır, clipboard-a yazır və bildirir.
Bu, API rejiminin təbii davamıdır — tab açılmırsa poçt qutusu da tab-da oxunmamalıdır.

**Niyə izləmə növbəyə qoyulmur?** `enqueue`-yə atılsaydı döngü son müddətə qədər növbəni
tutardı və "Yeni ünvan" əmri onun bitməsini gözləyərdi. Döngü buna görə `await` olunmadan işə
salınır; əvəzində iki qoruyucu var — vəziyyət yalnız `watching` fazasında yazılır və modul
səviyyəsindəki `watcher` nişanı + `own()` köhnə döngünün yeni döngünün yerinə yazmasının
qarşısını alır.

**Niyə aidiyyət və kod ayrıca qiymətləndirilir?** Poçt qutusunda tək məktub yoxdur: endirim
kodları, bülletenlər, köhnə saytın məktubları da gəlir. Yalnız kod axtarmaq "6 rəqəm" tapardı,
yalnız sayta baxmaq isə kodu olmayan məktubda dayanardı. Ona görə iki mərhələ var: əvvəl "bu
məktub relay saytına aiddir?" (`MIN_RELEVANCE`), sonra "içində aktivasiya kodu və ya keçidi
varmı?" (`MIN_CODE_SCORE`). İkisi də doğrulanmasa tapıntı yoxdur — döngü davam edir.


**Niyə izləyici qalxanı declarativeNetRequest ilədir və niyə TAM icazə lazımdır?** Qayda şəbəkə
qatında işləyir: sorğu heç vaxt getmir, skript yeridilmir, səhifə gecikmir — `webRequest` ilə
bloklamaq MV3-də onsuz da mümkün deyil. Amma icazə seçimi vacibdir:
`declarativeNetRequestWithHostAccess` qaydaları YALNIZ host icazəsi olan saytlara tətbiq edir,
bizim host icazələrimiz isə yalnız provider saytlarıdır — yəni qalxan heç bir adi saytda
işləməzdi. Real brauzer yoxlamasında məhz bu baş verdi: `getEnabledRulesets()` "trackers" qaytarır,
sorğular isə yerli proxy loqunda görünürdü. Tam `declarativeNetRequest` icazəsi ilə `block`
qaydaları hər saytda işləyir, `modifyHeaders` (Origin əvəzlənməsi) isə yenə host icazəsi tələb
edir — o, provider saytları üçün onsuz da var.

Qaydaların iki qəsdən məhdudiyyəti var: yalnız `domainType: "thirdParty"` (saytın öz sorğuları
toxunulmur) və CAPTCHA/fingerprint kitabxanaları siyahıya SALINMIR — onlar çox vaxt saytın giriş
müdafiəsidir, bloklamaq səhifəni sındırır. Qalxanın işi izlənməni azaltmaqdır, müdafiəni aşmaq
deyil. Qaydalar `requestDomains` ilə yazılır (domen + alt-domenlər); yol daşıyan yazı
("bing.com/bat.js") Chrome tərəfindən ləğv olunur — `npm run check` və `tests/tools.test.mjs`
formatı yoxlayır.

**Niyə proxy Chrome-un `proxy` API-si ilədir?** Alternativ yoxdur: extension sorğuları tək-tək
yönləndirə bilməz (MV3-də bloklayan `webRequest` yoxdur), `chrome.proxy` isə brauzerin öz
parametrini qurur — bütün tablar, bütün sxemlər bir proxy-dən keçir. Bunun iki nəticəsi var və
ikisi də qəsdən belədir: (1) parametr QALICIDIR — brauzer bağlanıb açılsa da qalır, ona görə aktiv
proxy saxlanca yazılır və `resumeProxy()` uzlaşdırır; (2) yerli ünvanlar bypass siyahısındadır —
əks halda extension-ın öz `localhost` sorğuları və istifadəçinin yerli serverləri proxy-ə düşərdi.

Şəxsi proxy-nin parolu konfiqurasiyaya YAZILMIR (Chrome onu qəbul etmir): Chrome autentifikasiya
soruşur, biz `webRequest.onAuthRequired` ilə cavab veririk (`webRequestAuthProvider` icazəsi məhz
bu hal üçündür — MV3-də bloklayan webRequest-in yeganə icazəli istifadəsi). Sorğuları görmək üçün
geniş host icazəsi lazımdır, ona görə o, YALNIZ giriş məlumatı olan proxy əlavə edilən klikdə
istənilir; verilməsə proxy yenə işləyir, sadəcə parolu Chrome özü soruşur.

**Niyə AÇIQ (ictimai) proxy siyahıları YOXDUR?** Bir müddət var idi və üç mərhələ keçdi: əvvəl
14 mətn siyahısı (`ip:port` sətirləri, 3000 ünvan — əksəri ölü), sonra yalnız metadata verən
4 JSON mənbəsi (ProxyScrape, monosans, Geonode, jetkai — ölkə, uptime, "canlı" nişanı ilə), ən
sonda isə hər namizədin `chrome.proxy` PAC skripti ilə PARALEL yoxlanması (probe URL-indəki
`__p=<sıra>` işarəsi hər sorğunu öz proxy-sinə yönləndirirdi; `no-cors` fetch-in opaque cavabı
"işləyir" deməkdi). Texniki olaraq hamısı işlədi — real brauzer sınağında ölçmə də düzgün alınırdı.

Buna baxmayaraq mexanizm TAM SİLİNDİ, çünki problem texniki deyildi:

- açıq proxy tanımadığın maşındır — şifrələnməmiş (`http://`) trafiki oxuya və dəyişə bilər,
  bir hissəsi sındırılmış serverlərdir; hesab yaratmaq üçün işlədiləndə risk özünə qalır;
- ömrü dəqiqələrlədir: yoxlamadan keçən ünvan bir saat sonra yenə ölü olur, yəni "işlək siyahı"
  təsəvvürü özü aldadıcıdır;
- qiyməti kiçik deyildi: 4 xarici mənbə (format dəyişikliyinə həssas), 6 host icazəsi, siyahı
  formatlarının ayrıştırılması, ölkə cədvəli, süzgəc/sıralama səthi və PAC yoxlama qatı.

Ona görə siyahını YALNIZ istifadəçi doldurur (`addProxy`): proxy-nin kimə aid olduğunu bilmək
təhlükəsizliyin bir hissəsidir. Silinənlər: `src/providers/proxy-list/` (bütün növ),
`background/verify.js`, `shared/countries.js`, `shared/proxy.js`-dəki mənbə/metadata/PAC funksiyaları
(`parseProxyList`, `liveEntries`, `isLive`, `buildPacScript`, `pickCandidates`, `selectProxies`,
`facets`…), `PROXY_IMPORT` əmri, popup-dakı "İdxal" düyməsi və süzgəc cərgəsi, mənbə hostlarının
icazələri. Qalan yeganə xarici host `api.ipify.org`-dur — qoşulan proxy-nin çıxış IP-sini deyir.

Ölçmə yenə var, sadəcə bir yerdə: QOŞULMA anında. `api.ipify.org` sorğusunun müddəti `ping`
kimi qeydə yazılır, cavab gəlməsə qeyd `dead` nişanlanır (silinmir — proxy müvəqqəti sönmüş ola
bilər) və göstərmə sırasında sona keçir.

Köhnə məlumat öz-özünə yox olmur: `storage.local`-da minlərlə idxal qeydi qala bilər (istifadəçi
ekranında 1910 ünvan görürdü). İki qat işləyir: **oxu qatı** (`readProxies` → `pruneImported`)
onları dərhal süzür, yəni nə popup, nə worker köhnə qeydləri görür; **`migrateProxies()`** isə
worker qalxanda saxlancın özünü təmizləyir və idxal olunmuş proxy qoşulu qalıbsa bağlantını
kəsir. Nişan: idxal qeydləri mənbə metadatası daşıyır (`source`, `cc`, `uptime`, `speed`,
`verified`, `alive`) — istifadəçinin verdiyi qeyddə bu sahələr heç vaxt olmur.

**Niyə toplu əlavə bir MƏTN sərhədindən keçir?** Satıcı yüzlərlə proxy verir və format hər dəfə
fərqlidir: `.txt` blok, JSON massivi, zərfli JSON, kopyalanmış sətirlər. Ayrıştırma tək yerdədir
(`shared/proxy.js → proxyLines` + `parseProxyLines`), UI isə yalnız MƏTN toplayır — hansı
mənbədən gəldiyi (xana, fayl seçimi, dartıb-atma) fərq etmir. Üç nəticə:

- **bir neçə fayl BİRLƏŞDİRİLMİR**, massiv kimi ötürülür: `.txt` + `.json` bir yerdə seçilsə,
  birləşdirilmiş mətn artıq JSON olmazdı və bütün JSON bloku "tanınmayan sətir" sayılardı;
- **pozulmuş sətir səssiz atılmır** — səbəbi ilə qaytarılır (`invalid`), status onu yazır:
  200 sətirdən 3-ünün niyə düşmədiyini başqa yolla görmək mümkün deyil;
- **fayl POPUP-da oxunur** (`file.text()`), worker-ə mətn gedir: `File` obyekti mesaj
  sərhədindən keçmir.

**Niyə host icazəsi əlavə anında istənilmir?** `chrome.permissions.request` YALNIZ istifadəçi
jestinin içində işləyir, `await file.text()` isə jesti bitirir — fayl oxuduqdan sonra sorğu
"must be called during a user gesture" ilə batır (real brauzer sınağında məhz bu baş verdi).
Ona görə icazə ayrı düymədədir (`#proxy-auth-grant`) və handler-də ondan əvvəl heç bir `await`
yoxdur. İcazə olmasa proxy yenə işləyir — sadəcə parolu Chrome özü soruşur.

**Niyə düymə rəngi yaşıl/qırmızıdır və niyə YALNIZ rəng?** Alət cərgəsində üç vəziyyətli düymə
var (başlat, qalxan, proxy) və hansının işlədiyini bilmək üçün əvvəl tooltip açmaq lazım gəlirdi.
Rəng iki şeyi birdən deyir: **ikonun rəngi VƏZİYYƏTİ** (yaşıl = işləyir, qırmızı = sönülü), hover
rəngi isə **KLİKİN NƏTİCƏSİNİ** (aktivin üstündə qırmızı — "sönəcək", sönülünün üstündə yaşıl —
"işə düşəcək").

İlk versiyada vəziyyət kontur + solğun fonla verilirdi. Nəticə səhv oxundu: düymələr **hover
edilmiş kimi** görünürdü ("kənarlarında dairə var"), yəni bəzəkli hal ilə interaktiv hal
qarışırdı. İndi `.icon`-un çərçivəsi və fonu YOXDUR (`border: 0`, şəffaf fon) — dəyişən yeganə
şey `color`-dur. Vəziyyəti olmayan düymələr (silmə, tema) solğun qalır, panel açan düymələr
(poçt, relay) isə açıq vəziyyətdə yalnız aksent rəngi alır — onlar vəziyyət deyil, açılış
düyməsidir.

Eyni qayda **proxy sətirlərinə** də keçirildi: "Qoşul"/"Ayır"/"Aktiv" sözləri getdi, yerinə tək
⏻ ikonu qaldı — qoşulu sətir yaşıl (basanda ayrılır), qalanları qırmızı (basanda qoşulur).
Səbəb yalnız estetika deyil: sətirdə seçim xanası, ünvan, sxem, `giriş` nişanı və ölçü var,
348 piksellik popup-da mətn düymələri ünvanı sıxışdırırdı. Sətir ikonları 22 pikseldir (cərgə
ikonları 30) — sətir yığcam qalır.

**Niyə panel açıq olanda sessiya blokları gizlənir?** Popup həm sessiya səthi (ünvan, kod, hesab),
həm alət səthidir (poçt/relay seçimi, proxy). İkisi bir ekranda olanda proxy siyahısı ilə işləmək
mümkün olmurdu: yüzlərlə sətrin altında poçt ünvanı, aktivasiya kodu və parol kartları qalırdı,
səth uzanıb qarışırdı. İndi `body.panel-open` sinfi CSS ilə `#mail`, `#inbox`, `#signup` və
`#session`-u gizlədir — JS-in `hidden` məntiqi ilə mübahisə etmir, çünki qat fərqlidir. Status
QALIR: panel əməliyyatlarının nəticəsi (əlavə olundu / qoşuldu / silindi) məhz orada yazılır.

**Niyə "antidetect" (barmaq izi dəyişdirmə) YOXDUR?** İstənilib, amma qəsdən edilməyib. İki səbəb:
(1) extension bunu ardıcıl edə bilmir — TLS/HTTP2 səviyyəsi əlçatmazdır, worker kontekstləri
yamanmır, yarım spoof isə uyğunsuzluq yaradıb aşkarlanma ehtimalını ARTIRIR (Tor/Brave bu işi
brauzerin içində, "az məlumat + hər yerdə eyni cavab" prinsipi ilə edir); (2) məqsəd saytların
sui-istifadə müdafiəsini aşmaq olardı. İzləyici qalxanı və proxy isə fərqli işlərdir: biri
üçüncü tərəf izləməsini azaldır, digəri şəbəkə çıxışını dəyişir — heç biri brauzeri olmadığı
şey kimi göstərmir.
