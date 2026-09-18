# Yeni sayt əlavə etmək

Extension-ın mexanikası (tab açmaq, cookie silmək, clipboard-a yazmaq, status göstərmək)
bütün saytlar üçün eynidir və `src/background/`-dədir. Yeni sayt əlavə edəndə **heç bir
core faylı dəyişmir** — yalnız provider qovluğu, reyestrə bir sətir və `manifest.json`.

Hər iki halda addımlar eynidir:

```
1. src/providers/<növ>/<slug>/      deskriptor (+ temp-mail üçün api.js və ya page.js)
2. src/providers/<növ>/index.js     bir import + massivə bir ad
3. manifest.json → host_permissions hər host üçün "*://*.host/*"
4. rules/provider-origin.json       YALNIZ sayt yad Origin-i rədd edirsə (bax: requestOrigin)
5. npm run verify                   yoxlama
6. chrome://extensions → ⟳          extension-ı yenilə
```

`<slug>` qovluq adıdır (məs. `temp-tf`); provider-in əsl açarı deskriptordakı `id`-dir.

---

## Temp mail saytı

Əvvəlcə rejimi seç: saytın API-si cookie/açar tələb etmirsə **API rejimi** (tab açılmır,
daha sürətli və daha sadədir), tələb edirsə **səhifə rejimi**. İkisi bir yerdə ola bilməz —
`contract.js` rədd edir.

| | API rejimi | Səhifə rejimi |
| --- | --- | --- |
| Deskriptorda | `fetchAddress({ values, signal })` | `newAddress({ values, config })` |
| Qaytarır | ünvan sətirini (`throw` — xəta) | `{ address }` və ya `{ error }` |
| Harada işləyir | service worker | saytın səhifəsi |
| Tab | açılmır | arxa planda açılır |
| Fayl | `api.js` (saf modul, node-da test olunur) | `page.js` (serializasiya olunur) |

Üçüncü funksiya rejimdən **asılı deyil**: deskriptorda `fetchMessages({ email, wait, signal })`
varsa saytın poçt qutusu da oxunur və aktivasiya kodu/keçidi avtomatik tapılır (bax: **3c**).

### 1. Qovluq və deskriptor — `src/providers/temp-mail/<slug>/index.js`

```js
import { FieldType } from "../../../shared/options.js";
import { DEFAULT_VALUES, DOMAIN_CHOICES, fetchAddress, fetchMessages, validate } from "./api.js";

export default {
  id: "mail.example",                 // açar; sessiyada və popup seçimində işlənir
  name: "Mail Example",               // popup-da görünən ad
  url: "https://mail.example/",       // saytın ünvanı (https məcburidir)
  hosts: ["mail.example"],            // icazə şablonlarının mənbəyi
  options: {                          // popup formunun sxemi (istəyə bağlı — seçimsiz sayt da olur)
    schema: [
      { key: "domain", label: "Domen", type: FieldType.choice, choices: DOMAIN_CHOICES },
      { key: "dot", label: "Dot", type: FieldType.toggle, hint: "nöqtəli local-part" },
    ],
    defaults: DEFAULT_VALUES,         // hər sahə üçün default (sxem ilə birebir uyğun)
    validate,                         // saytın öz qaydaları → xəta mətni və ya null
  },
  fetchAddress,                       // API rejimi
  fetchMessages,                      // istəyə bağlı: sayt poçtu oxunursa (bax: 3c)
  // requestOrigin: "https://mail.example",  // istəyə bağlı: sayt yad Origin-i 403 ilə rədd edirsə (bax: 5)
};
```

Səhifə rejimində son sətir əvəzinə:

```js
import newAddress from "./page.js";
// ...
  pageConfig: { timeoutMs: 20000 },   // newAddress-ə `config` kimi ötürülür (istəyə bağlı)
  newAddress,                         // SƏHİFƏDƏ icra olunan funksiya
```

`url` API rejimində tab açmaq üçün deyil, popup-dakı sayt adının mənbəyi və host yoxlaması
üçündür — yenə də https olmalıdır və `hosts` tərəfindən əhatə olunmalıdır.

### 2. Seçim sxemi — `options`

Popup formanı bu sxemdən qurur: yeni sayt üçün popup-a heç nə yazmır. Sahə tipləri:

| Sahə | Nədir | Hansı tiplərdə |
| --- | --- | --- |
| `key` | dəyərin adı (`values` obyektindəki açar) | hamısında |
| `label` | istifadəçiyə göstərilən ad, həm də xəta mətnində | hamısında |
| `type` | `flags` / `toggle` / `choice` (`shared/options.js` → `FieldType`) | hamısında |
| `hint` | boz izah: `flags`/`choice` sahənin altında, `toggle` çipin öz xanasında | istəyə bağlı |
| `choices` | `[{ value, label }]` — təkrarsız | `flags`, `choice` |
| `min` | ən azı neçə seçim işarələnməlidir | `flags` |

`flags` və `toggle` çipləri popup-da EYNİ siyahıda (iki sütunlu tor) düzülür: provider
çipləri ilə açarlar eyni hizda dayanır — sahə sırası yalnız başlığın yerini müəyyən edir.
Sahə tipi dəyişən yerdə (`flags` → `toggle`) araya incə ayırıcı xətt düşür: qruplar bir-birinə
qarışmır, amma hiza pozulmur.

Dəyər forması: `flags` → `{ [choice]: boolean }`, `toggle` → `boolean`, `choice` → sətir.
`defaults` sxemlə birebir uyğun olmalıdır (hər sahə var, artıq açar yoxdur) — `validateSchema`
yoxlayır, pozuntuda provider reyestrə düşmür.

`validate(values)` saytın öz qaydalarıdır (məsələn "dot yalnız Gmail ilə"). Xəta mətni və ya
`null` qaytarır; həm popup (erkən xəbərdarlıq), həm worker (icradan əvvəl) çağırır. Qayda
serverdə də yoxlanırsa belə yaz — sorğunu göndərməmək daha yaxşıdır.

### 3a. API protokolu — `src/providers/temp-mail/<slug>/api.js`

Saf modul: `chrome` yoxdur, DOM yoxdur, yalnız saytın protokolu. Buna görə node-da test olunur.

```js
export const API_BASE = "https://mail.example/api";
export const DOMAIN_CHOICES = Object.freeze([/* { value, label } */]);
export const DEFAULT_VALUES = Object.freeze({ domain: "a.example", dot: false });
export function validate(values) { /* xəta mətni və ya null */ }

// Sorğunu qurur və cavabı ünvana (və ya aydın xəta mətninə) çevirir.
// `fetchImpl` testdə stub-lanır — production-da `fetch`-dir.
export async function requestAccount(values, { signal, fetchImpl = fetch } = {}) {
  const response = await fetchImpl(url, { signal, headers: { Accept: "application/json" } });
  const body = await response.json().catch(() => ({}));   // server HTML qaytarsa da düşməsin
  if (response.status === 429) throw new Error("çox sorğu göndərilib, bir az gözləyin");
  if (!response.ok) throw new Error(body?.error ?? `server ${response.status} cavabı qaytardı`);
  // ... ünvanı oxu, "@" yoxdursa throw
  return email;
}

export const fetchAddress = ({ values, signal }) => requestAccount(values, { signal });
```

Qaydalar:

- **`chrome.*` işlətmə** — `contract.js` rədd edir (API rejimi node-da test oluna bilməlidir).
- **`signal`-ı `fetch`-ə ötür** — worker 20 saniyədən sonra sorğunu dayandırır və "Dayandır"
  axını da bu signal ilə kəsilir.
- **Xəta mesajı istifadəçiyə göstərilir**: serverin öz mesajı varsa onu saxla, limit (429) və
  gözləmə müddəti kimi halları ayrıca aydınlaşdır. Worker mesajın əvvəlinə saytın adını yazır.
- **Adi `Error` at, növü worker seçir**: `address-api.js` buradan gələn hər xətanı `ExpectedError`
  kimi qablaşdırır, çünki səbəb saytın cavabıdır, extension-ın kodu deyil. Nəticədə saytın limiti
  popup-da sarı zolaq, console-da `warn` kimi görünür və `chrome://extensions` səhvlər səhifəsinə
  DÜŞMÜR — orada yalnız extension-ın öz qüsurları qalır (bax: `shared/errors.js`).
- **Vaxt limiti və "üzr istəmə" provider-in işi deyil** — onu `address-api.js` qoyur.
- Sorğunu saytın öz client kodundan (bundle-dakı fetch çağırışlarından) oxu və `curl` ilə
  yoxla: hansı parametrlər, hansı cavab forması, cookie lazımdırmı. temp.tf-də nümunə var.

### 3b. Səhifə skripti — `src/providers/temp-mail/<slug>/page.js`

```js
export default async ({ values, config }) => {
  try {
    // ... DOM ilə iş: düyməni tap, kliklə, ünvanı oxu
    return { address };               // uğur
  } catch (e) {
    return { error: e.message };      // xəta — throw ETMƏ
  }
};
```

Bu funksiya `chrome.scripting.executeScript({ func })` ilə saytın öz səhifəsinə
**köçürülür** (mənbəyi `toString` ilə serializasiya olunur). Ona görə:

| Qadağandır | Səbəb |
| --- | --- |
| `import` / `require` | səhifədə modul əhatəsi yoxdur |
| modul səviyyəsindəki dəyişənlər | köçürülən yalnız funksiyanın mətnidir |
| `chrome.*` / `browser.*` | saytın dünyasında extension API yoxdur |
| `throw` | nəticə həmişə `{ address }` və ya `{ error }` olmalıdır |
| metod qısa yazılışı (`newAddress() {}`) | serializasiyada sınır; arrow/function ifadəsi lazımdır |

Bu qaydaların hamısını `contract.js` avtomatik yoxlayır — pozulsa provider reyestrə
düşmür, popup-da xəbərdarlıq görünür və `npm run check` uğursuz olur.

**Praktik məsləhətlər** (temp.tf-də sınanıb):

- Arxa plandakı tabda `setTimeout` güclü məhdudlaşdırılır (5 dəqiqədən sonra dəqiqədə
  bir dəfə). Gözləmək üçün `MutationObserver` işlət, `setTimeout`-u yalnız vaxt bitəndə
  xəta vermək üçün saxla.
- React ilə idarə olunan sahələrdə `element.checked = true` state-ə çatmır; `.click()`
  `onChange`-i işə salır. Klikdən sonra vəziyyəti yenidən yoxla — React qəbul etməsə
  işarəni geri qaytarır.
- Səhifə hazır olana qədər düymələr `disabled` olur; gözləməni konkret şərtə bağla
  (məs. "New address düyməsi aktivdir"), sabit `sleep`-ə yox.
- Ünvanı oxuyanda "köhnədən fərqli və `@` olan mətn" şərti qoy — yüklənmə vaxtı
  orada skeleton placeholder olur.

### 3c. Poçt qutusu — `fetchMessages` (istəyə bağlı)

Rejimdən asılı deyil: həm `api`, həm `page` rejimli sayt poçtunu göstərə bilər. Deskriptorda
`fetchMessages` varsa (`supportsInbox`) worker ünvan alındıqdan sonra məktubları izləyir,
relay saytına aid olanı tapır və aktivasiya kodunu/keçidini özü çıxarır. Funksiya yoxdursa
heç nə dəyişmir — ünvan alınır, yalnız izləmə açılmır.

```js
import { normalizeMessages } from "../../../shared/extract.js";

// Saytın protokolu: sorğunu qur, xam cavabı normallaşdır. Kod axtarışı burada deyil.
export async function requestMessages(email, { wait = true, signal, fetchImpl = fetch } = {}) {
  const response = await fetchImpl(CHECK_URL, {
    method: "POST",
    signal,
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ email, wait }),
  });
  const body = await readJson(response);
  throwForResponse(response, body);
  return normalizeMessages(body);          // { data: [...] } və ya çılpaq massiv — ikisi də olur
}

// Deskriptorun fetchMessages sahəsi bunu işlədir
export const fetchMessages = ({ email, wait, signal }) => requestMessages(email, { wait, signal });
```

Qaydalar:

- **Normallaşdırmanı `shared/extract.js → normalizeMessages()`-ə burax.** O, xam cavabı
  `{ id, date, from, subject, body, bodyContentType, text }` formasına salır, təkrar `id`-ləri
  atır və təzəni önə sıralayır. `id` yoxdursa `mövzu|tarix` ilə əvəz olunur, amma dedupikasiya
  `id` üzərindədir — sayt sabit `id` verirsə onu saxla.
- **`bodyContentType: "html"` olanda `body` HTML-dir**: `extract.js` onu özü mətndə çevirir və
  keçidləri (`<a href>`) yığır. Provider HTML-i təmizləməyə çalışmasın.
- **`wait` long-poll deməkdir və PAUZANIN MƏNBƏYİDİR**: uğurlu sorğudan sonra worker-in
  döngüsü gözləmir — dərhal növbəti sorğunu göndərir. Sayt long-poll dəstəkləyirsə cavabı
  saxlayır və pauza oradan gəlir (temp.tf-də ~8 saniyə). **Dəstəkləmirsə pauzanı provider
  özü verməlidir**, yoxsa döngü saytı fasiləsiz sorğu ilə doldurar. Nümunə:
  `emailnator/api.js` `wait: true` olanda siyahını hər `WAIT_GAP_MS`-də yenidən oxuyur,
  yeni `id` görünəndə dərhal, görünməsə `WAIT_WINDOW_MS`-dən sonra qaytarır. Pəncərə
  `INBOX_POLL_TIMEOUT_MS`-dən (25 s) kiçik olmalıdır — worker sorğunu ondan sonra kəsir.
- **Sayt gövdəni siyahıda vermirsə** onu provider özü tamamlayır: `emailnator/api.js`
  siyahını oxuyur, sonra hər məktubun HTML-i üçün ayrıca sorğu göndərir və nəticəni modul
  səviyyəsindəki keşdə saxlayır (eyni məktub bir dəfə oxunur). Keş worker sönəndə itir və
  bu, doğru davranışdır — yenidən qalxanda qutu olduğu kimi oxunur.
- **`signal`-ı `fetch`-ə ötür** — "Dayandır" və yeni ünvan gözləyən sorğunu dərhal kəsməlidir.
- **`chrome.*` işlətmə** — `contract.js` rədd edir; modul `fetchImpl` ilə node-da test olunur
  (nümunə: `tests/temp-tf.test.mjs`).
- Cookie və ya açar tələb olunursa `credentials: "include"` əlavə et: host icazəsi olduğu üçün
  brauzer cookie-ləri göndərir. Alınmırsa sayt poçtu API ilə oxunmur deməkdir — `fetchMessages`
  yazma, extension onsuz da işləyir.
- Endpoint-i saytın öz client kodundan oxu və `curl` ilə yoxla. temp.tf-də: `POST /api/check`,
  bədəndə `{"email": ..., "wait": ...}`, cavab `{"data": [...], "totalReceived": N}`.
  `totalReceived` saytın ÜMUMİ sayğacıdır — onu "yeni məktub gəldi" siqnalı kimi işlətmə.

### 4. Reyestrə yazmaq — `src/providers/temp-mail/index.js`

```js
import tempTf from "./temp-tf/index.js";
import mailExample from "./mail-example/index.js";   // ← yeni sətir

export const TEMP_MAIL = createRegistry("temp-mail", [
  tempTf,
  mailExample,                                        // ← yeni sətir
], validateTempMail);
```

---

## Relay saytı

Relay tərəfində səhifə skripti yoxdur: saytın rolu "qeydiyyat səhifəsi + tabı bağlananda
silinəcək izlər"dir. Silmə mexanikası hamı üçün eynidir (`src/background/cleanup.js`).

**İstisna: `adoptActiveTab`.** Sabit saytı olmayan relay də var — `bu sayt (aktiv tab)`.
O, Başlat anında aktiv tabın saytını mənimsəyir, ona görə deskriptorunda `url`, `hosts`,
`cleanup`, `mail`, `signup` və `requestOrigin` OLA BİLMƏZ (kontrakt rədd edir):

```js
export default { id: "active-tab", name: "bu sayt (aktiv tab)", adoptActiveTab: true };
```

Sayt məlumatını `background/relay.js → resolveRelay(session)` tabın URL-indən törədir. Belə
relay üçün tab açılmır və tab bağlananda sayt məlumatı silinmir. Qeydiyyat isə tam avtomatikdir —
amma dəqiq addımlarla deyil, `background/forms.js` evristikası ilə (aşağıda). Yeni belə relay
yazmağa ehtiyac yoxdur — biri kifayətdir.

### 1. Deskriptor — `src/providers/relay/<slug>/index.js`

```js
export default {
  id: "relay.example",
  name: "Relay Example",
  url: "https://relay.example/register",
  // saytın özü + silinməli olan üçüncü tərəf hostlar (məs. Cloudflare Turnstile frame-i)
  hosts: ["relay.example", "challenges.cloudflare.com"],
  cleanup: {
    // chrome.cookies.getAll({ domain }) — alt-domenlərin cookie-ləri də düşür
    cookieDomains: ["relay.example"],
    // bu sayt birinci tərəf olanda yazılmış partitioned (CHIPS) cookie-lər
    partitionTopLevelSites: ["https://relay.example"],
    // chrome.browsingData.remove({ origins }) — localStorage, IndexedDB, cacheStorage,
    // serviceWorkers, fileSystems. Yol OLMADAN, yalnız origin
    storageOrigins: ["https://relay.example"],
  },
};
```

Sahələr haqqında qeydlər:

- `hosts` həm icazə şablonlarının mənbəyidir, həm də "nə silinəcək" siyahısına aid olan
  üçüncü tərəf hostları ehtiva edir. `url`-in hostu mütləq `hosts`-da əhatə olunmalıdır —
  `contract.js` yoxlayır.
- `partitionTopLevelSites` istəyə bağlıdır: sayt Cloudflare Turnstile kimi CHIPS
  cookie-ləri yazırsa lazımdır.
- Saytın `www` versiyası işləmirsə (bəzi Cloudflare saytları 520 qaytarır) onu
  `storageOrigins`-ə yazma — artıq origin xəta vermir, amma yanıltıcıdır.
- `mail` **istəyə bağlıdır** və poçt axtarışının ipuçlarını dəqiqləşdirir. Yazılmasa belə
  `url`-in qeydiyyatdan keçən domeni (`relay.example`) və `name`-in tokenləri avtomatik
  ipucu olur; `shared/extract.js → mailHints()` bunu qurur.

```js
  mail: {
    // məktub bu domenlərdən gəlirsə aidiyyət xalı artır (host adı, https:// OLMADAN)
    fromDomains: ["relay.example", "mail-relay.example"],
    // mövzuda və mətndə axtarılan əlavə sözlər (ən azı 3 hərf, hamısı kiçik yazılır)
    keywords: ["relay", "aktivasiya"],
  },
```

Qaydalar: `mail` ya `fromDomains`, ya `keywords` daşımalıdır (boş obyekt `contract.js`-də
xətadır — lazım deyilsə sahəni sil); `fromDomains` host adları massividir (sxem və yol olmaz);
`keywords` sətir massividir. Bu sahələr yalnız axtarışı dəqiqləşdirir: poçt oxunmasa belə
deskriptor işləkdir.

### 1b. Qeydiyyat addımları — `signup` (istəyə bağlı)

Tapılan kod clipboard-a düşür, amma istifadəçi yenə formanı açır, metodu seçir, ünvanı yazır,
"kod göndər" basır, kodu yerləşdirir, parol düşünür və "hesab yarat" basır. Bu addımların
hamısı mexanikidir — `signup` yazılıbsa extension onları özü yerinə yetirir:

```js
  signup: {
    password: { length: 16 },              // istəyə bağlı (default 16)
    // Ünvan alınan kimi: metodu seç, ünvanı yaz, token-i gözlə, kodu istə
    afterAddress: [
      { click: 'button[aria-label="Continue with email"]' },
      { fill: 'input[name="username"]', value: "address" },
      { waitValue: 'input[name="cf-turnstile-response"]', timeoutMs: 25000 },
      { click: "button", text: "Send code", enabled: true },
    ],
    // Aktivasiya kodu tapılan kimi: kodu və parolu yaz, hesabı yarat
    afterCode: [
      { fill: "#registration-verification-code", value: "code" },
      { fill: 'input[name="password"]', value: "password" },
      { click: 'button[type="submit"]', enabled: true },
    ],
  },
```

Mexanika `src/background/signup.js`-dədir və bütün saytlar üçün eynidir. Addımın üç növü var
(hər addımda yalnız biri):

| Addım | Nə edir | Əlavə sahələr |
| --- | --- | --- |
| `click: "sel"` | elementi kliklər (görünən olmalı) | `text`, `enabled`, `timeoutMs` |
| `fill: "sel"` | xanaya dəyər yazır | `value` (məcburi), `text`, `timeoutMs` |
| `waitValue: "sel"` | selektorun `value`-su dolana qədər gözləyir | `timeoutMs` |

- **`value` yalnız dörd addan biri olur**: `address`, `username`, `code`, `password`. Dəyəri
  worker verir — kod poçtdan gəlir, parol `shared/password.js`-də, istifadəçi adı isə
  `shared/username.js`-də (ünvandan) yaranır, ona görə deskriptorda sirr olmur.
  `code` yalnız `afterCode` fazasında mövcuddur (kontrakt bunu yoxlayır).
- **`text`** — sabit atributu olmayan düymələr üçün: selektora uyğun elementlər arasından
  yazısına görə seçilir (əvvəl dəqiq uyğunluq, sonra "içində var"). `{ click: "button", text: "Send code" }`.
- **`enabled: true`** — düymənin aktivləşməsini gözləyir (`disabled` və `aria-disabled`).
  Sabit `sleep` işlətmə: React düymələri məlumat hazır olanda açır.
- **`waitValue` — saytın gizli hazırlıq siqnalı üçün.** tipik nümunə Cloudflare Turnstile
  token-idir: düymə token gəlməmiş də klikləniləndir, amma sayt sorğunu
  `Turnstile verification failed` ilə kəsir və cəhd itir (real yoxlamada məhz bu baş verdi).
  Token `type="hidden"` input-da olduğu üçün `waitValue` görünmək tələb ETMİR.
- **Sıra pozulmaz və uğursuzluqda dayanır**: bir addım alınmasa sonrakılar icra olunmur
  (yarım forma göndərilməsin), nəticə `{ done: false, at, reason }` olur. Kod yenə
  clipboard-a düşür, status səbəbi yazır.
- **Sabit selektor seç**: `id`, `name`, `aria-label`, `type` — Tailwind class adları
  (`class="border-input …"`) build-dən build-ə dəyişir.
- **React/Vue idarə edən xana da işləyir**: dəyər prototipdəki native setter ilə yazılır.
  `el.value = kod` yolu DOM-u dəyişir, framework state-i isə boş qalır və forma boş dəyər
  göndərir — bu, real saytlarda belədir (bax: `tests/signup.test.mjs`).
- **Extension serverin cavabını yoxlamır**: "forma dolduruldu" o deməkdir ki, addımlar icra
  olundu. Sayt sorğunu rədd etsə (limit, köhnə kod) səbəb saytın öz bildirişində görünür.
- Selektorları saytda tap: DevTools → xanaya sağ klik → **Inspect**.

**Addım yazmasan nə olur?** Faza boş qalırsa (`signup` yoxdur, ya da yalnız `afterCode` var)
extension həmin faza üçün `background/forms.js` evristikasına keçir: qeydiyyat forması özü açılır
("Sign up" linki), bütün tanınan xanalar doldurulur (ünvan, ad, soyad, istifadəçi adı, parol,
telefon, ünvan, şəhər/ştat/indeks, doğum tarixi, cins, şirkət…), şərtlərlə razılıq və "robot
deyiləm" xanaları işarələnir, sonda **qeydiyyat düyməsi basılır** (yazısına görə seçilir).
Dəyərləri `shared/identity.js` verir — uzlaşan, həqiqətə bənzər şəxs profili.

Yəni `signup` yazmaq "formanı doldur" üçün deyil, **dəqiq ardıcıllığı** idarə etmək üçündür
(məs. Turnstile token-i gözlənilməlidir, yoxsa sayt cəhdi rədd edir). Saytın öz
selektorlarını bilirsənsə `signup` yaz — nəticə dəqiq olur; bilmirsənsə evristika onsuz da
işləyir. İkisi birlikdə işləmir: faza üçün addım varsa evristika susur.

### 2. Reyestrə yazmaq — `src/providers/relay/index.js`

```js
import relayExample from "./relay-example/index.js";  // ← yeni sətir
export const RELAY = createRegistry("relay", [activeTab, relayExample], validateRelay);
```

---

## 4. Host icazələri — `manifest.json`

Hər host üçün bir şablon. Masaüstü brauzerində extension-ı yeniləmədən işləmir:

```json
"host_permissions": [
  "*://*.temp.tf/*",
  "*://*.mail.example/*",
  "*://*.relay.example/*",
  "*://*.challenges.cloudflare.com/*"
]
```

Şablonu unutmusansa, iki yerdə tutulur:

- `npm run check` — hansı provider üçün hansı şablonun çatışmadığını yazır;
- popup-dakı **Başlat** — işə salmazdan əvvəl `chrome.permissions.contains` ilə yoxlayır
  və çatışmayan şablonları ekranda göstərir (sessiya səssizcə uğursuz olmur).

Artıq heç bir provider-ə lazım olmayan şablon varsa `check` onu xəbərdarlıq kimi yazır.

## 5. `Origin` başlığı — sayt cross-origin sorğunu rədd edirsə

Bəzi saytların API-si yalnız öz səhifəsindən çağrıla bilər. Service worker-in `fetch`-i isə
cross-origin sayılır və Chrome ona `Origin: chrome-extension://<id>` yazır; belə sayt cavabı
**403** ilə kəsir (emailnator: `{"status":"error","message":"Forbidden"}`). Başlığı `fetch`
seçimlərindən dəyişmək mümkün deyil — `Origin` qadağan olunmuş başlıqdır, brauzer onu atır.
Ona görə əvəzləmə `declarativeNetRequest` ilə aparılır.

Deskriptora bir sətir:

```js
  requestOrigin: "https://www.mail.example",   // saytın ÖZ origin-i (hosts əhatə etməlidir)
```

Sonra qayda faylını `src/shared/net.js → originRules()`-dan törədib `rules/provider-origin.json`-a
yaz (fayl əl ilə saxlanılır, çünki manifest-dəki **statik** ruleset extension yüklənən andan
aktivdir — dinamik qayda quraşdırılana qədər ilk sorğu qorunmasız qalardı):

```
node -e "const p=await import('./src/providers/temp-mail/index.js');const r=await import('./src/providers/relay/index.js');const n=await import('./src/shared/net.js');console.log(JSON.stringify(n.originRules(...p.TEMP_MAIL.all(),...r.RELAY.all()),null,2));" --input-type=module
```

`manifest.json`-da isə icazə və ruleset olmalıdır (bir dəfə yazılır, sonra dəyişmir):

```json
"permissions": ["…", "declarativeNetRequestWithHostAccess"],
"declarative_net_request": {
  "rule_resources": [{ "id": "provider-origin", "enabled": true, "path": "rules/provider-origin.json" }]
}
```

Uyğunsuzluq `npm run check` (bölmə 3b) və `tests/net.test.mjs` tərəfindən tutulur: fayl
deskriptorlardan törədilən qayda ilə birebir üst-üstə düşməlidir. Əksər saytlarda bu addım
LAZIM DEYİL — `requestOrigin` yazılmasa nə qayda, nə icazə tələb olunur.

## 6. Yoxlama

```
npm run verify     # = npm run check + npm test
```

Sonra `chrome://extensions` → extension-ın ⟳ düyməsi → popup-ı aç: yeni sayt hər iki
siyahıda görünməlidir. Görünmürsə popup-dakı sarı zolağa və service worker console-una
bax (`chrome://extensions` → "service worker" linki) — səbəb orada yazılıb.

## Yoxlama siyahısı

- [ ] deskriptorda `id`, `name`, `url`, `hosts` var; `url` https-dir
- [ ] `url`-in hostu `hosts` siyahısında əhatə olunub
- [ ] temp-mail: rejim seçilib — `fetchAddress` (API) **və ya** `newAddress` (səhifə), ikisi bir yerdə yox
- [ ] temp-mail API: `api.js` `chrome.*` işlətmir, `signal`-ı `fetch`-ə ötürür, `429`/`400` üçün aydın mesaj atır
      (mesaj istifadəçi dilindədir — saytın xətası xəbərdarlıq kimi görünür, extension qüsuru sayılmır)
- [ ] temp-mail səhifə: `page.js` import-suzdur, `chrome.*` işlətmir, `{ address }` / `{ error }` qaytarır (throw yox)
- [ ] temp-mail seçimləri: `options.schema` ilə `options.defaults` birebir uyğundur; `validate` saytın qaydalarını yazır
- [ ] temp-mail poçt (istəyə bağlı): `fetchMessages({ email, wait, signal })` XAM məktub siyahısını qaytarır,
      `chrome.*` işlətmir, `signal`-ı ötürür; sayt long-poll dəstəkləmirsə pauzanı provider özü verir
      (worker uğurlu sorğudan sonra gözləmir)
- [ ] relay: `cleanup.storageOrigins` origin formatındadır (yol yoxdur)
- [ ] relay poçt ipuçları (istəyə bağlı): sayt məktubu başqa domendən göndərirsə `mail.fromDomains`,
      adı/terminologiyası domaindən fərqlidirsə `mail.keywords` yazılıb (yazılmasa `url`-in domeni və `name` kifayətdir)
- [ ] relay qeydiyyat addımları (istəyə bağlı): `signup.afterAddress` / `signup.afterCode` sabit
      selektorlardır (id / name / aria-label, utility class adları YOX); saytın gizli hazırlıq
      siqnalı varsa (Turnstile token-i) klikdən əvvəl `waitValue` yazılıb; yazılmasa kod yalnız
      clipboard-a düşür
- [ ] hər host üçün `manifest.json`-da `*://*.host/*` var
- [ ] sayt yad `Origin`-i 403 ilə rədd edirsə: deskriptorda `requestOrigin` var və
      `rules/provider-origin.json` yenidən törədilib (əksər saytlarda lazım deyil)
- [ ] reyestr `index.js`-inə import + ad əlavə olunub
- [ ] `npm run verify` yaşıldır

