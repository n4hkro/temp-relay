// NAMƏLUM saytda qeydiyyatın avtomatlaşdırılması — evristika. EXTENSION-IN ANA MƏNTİQİ BUDUR.
//
// Sayta bağlı relay deskriptorları yoxdur: "bu sayt" relay-i istənilən sayta işləyir və orada
// hazır selektor olmur. Bu modul həmin boşluğu doldurur və dörd işi görür:
//   1) qeydiyyat formasını AÇIR — "Sign up / Register / Qeydiyyat" linki, düyməsi, tabı, həm də
//      metod seçimindəki "Continue with email" (panel açılmasa poçt xanası görünmür);
//   2) tapdığı bütün xanaları DOLDURUR — ünvan, ad, soyad, istifadəçi adı, parol, telefon,
//      ünvan sətri, şəhər, ştat, ölkə, poçt indeksi, doğum tarixi, şirkət, sahə…;
//   3) RAZILIQ xanalarını işarələyir — şərtlər, məxfilik, 18 yaş, "robot deyiləm". Xanalar
//      bütün sənəddən yığılır və GÖRÜNMƏYƏNLƏR də işarələnir (sr-only/appearance-none
//      checkbox-lar real saytlarda ən çox rast gəlinən haldır);
//   4) doğru düyməni BASIR — mərhələyə görə: kod hələ yoxdursa "Send code / Get code / kodu
//      göndər" (poçta kod göndərən düymə hər şeydən üstündür), kod əlimizdədirsə "Verify /
//      Create account / Register".
//
// Yanaşma sınanmış üsuldur: brauzerin öz autofill mexanizmi də sahəni `type`, `name`, `id`,
// `placeholder`, `aria-*` və LABEL mətninə görə təxmin edir (Chromium → "Form Autofill" dizayn
// sənədi: https://chromium.org/developers/design-documents/form-autofill), form doldurma
// extension-ları da eyni əlamətlər dəstini işlədir (Fake Filler sənədləri:
// https://github.com/FakeFiller/fake-filler-extension/wiki). Kod bizimdir, ideya oradandır.
//
// QAYDALAR (qəsdəndir):
//   • `signup` addımları olan relay üçün İŞLƏMİR — iki mexanizm eyni xananı doldurmasın;
//   • dəyərlər TƏSADÜFİ DEYİL: `shared/identity.ts` bütöv, uzlaşan şəxs profili verir
//     (şəhər ↔ ştat ↔ indeks ↔ telefonun sahə kodu eyni yerə aiddir);
//   • istifadəçinin/saytın yazdığı dəyər ÜZƏRİNDƏN YAZILMIR (yalnız ünvan, ad, parol və kod
//     bizimdir — onlar həmişə yenilənir);
//   • marketinq/abunə xanaları məcburi deyilsə İŞARƏLƏNMİR (istifadəçi spam istəmir);
//   • kod ƏLİMİZDƏ olanda "Send code" BASILMIR — yeni kod istəmək əlimizdəkini köhnəldərdi;
//   • üçüncü tərəf CAPTCHA-sı (reCAPTCHA, hCaptcha, Turnstile) HƏLL OLUNMUR — o, ayrı
//     origin-dəki iframe-dədir və extension oraya skript yeridə bilmir. Yalnız saytın ÖZ
//     DOM-undaki "mən robot deyiləm" checkbox-u işarələnir.
//
// İCAZƏ: naməlum sayta skript yeritmək host icazəsi tələb edir. Bunun üçün manifest-də
// `activeTab` var: istifadəçi extension ikonuna basanda AKTİV tab üçün icazə verilir və tab
// başqa ORIGIN-ə keçənə qədər qalır. Yəni "bu sayt" axını (ikona bas → Başlat) icazəni özü
// gətirir; istifadəçi 🗑 üçün "*://*/*" icazəsini veribsə onsuz da hər şey açıqdır.
//
// Səhifəyə köçürülən funksiyalar `page.js` ilə eyni məhdudiyyətlərə tabedir (import yoxdur,
// modul dəyişəni yoxdur, chrome.* yoxdur), çünki mənbələri `toString` ilə serializasiya olunur.
// Ona görə kiçik köməkçilər (norm, has, usable) hər iki funksiyada təkrarlanır.

import { ExpectedError } from "../shared/errors";
import { identityFamily } from "../shared/cleanup";
import { isLocalHost, registrableDomain } from "../shared/domains";
import { isLiveSession, type Session } from "../shared/state";
import { getTab, readDocument, settleTab, waitForDocument, type DocumentState } from "./tabs";

// Səhifə yüklənməkdə ola bilər: sahələrin görünməsi bu qədər gözlənilir
export const FIND_TIMEOUT_MS = 8000;
// Göndərmə düyməsi React yoxlamasından və ya CAPTCHA token-indən sonra aktivləşir —
// bu qədər gözlənilir ("Send code" düymələri adətən poçt xanası doldurulanda açılır)
export const SUBMIT_TIMEOUT_MS = 8000;
// "Sign up" basıldıqdan sonra formanın görünməsi
export const OPEN_TIMEOUT_MS = 6000;
// Qeydiyyat səhifəsinə keçid: səhifənin yüklənməsinə verilən vaxt
export const NAVIGATE_TIMEOUT_MS = 15000;
// MV3 worker-i ~30 s boşluqdan sonra sönür (eyni üsul: background/inbox.ts → pulse)
const KEEPALIVE_MS = 15000;

// Səhifədə icra olunan funksiyaların DOM elementi tipi: formaya aid xassələr istəyə
// bağlıdır, `Element`-dən gələnlər isə olduğu kimi miras alınır. Yalnız tip üçündür.
interface PageEl extends Element {
  disabled?: boolean;
  readOnly?: boolean;
  required?: boolean;
  checked?: boolean;
  value?: string;
  name?: string;
  placeholder?: string;
  type?: string;
  maxLength?: number;
  minLength?: number;
  form?: HTMLFormElement | null;
  offsetParent?: Element | null;
  offsetWidth?: number;
  offsetHeight?: number;
  validity?: ValidityState;
  options?: HTMLOptionsCollection;
  click?(): void;
  focus?(options?: FocusOptions): void;
  blur?(): void;
}

// Səhifə funksiyalarına ötürülən seçimlər (serializasiya olunur — yalnız sadə dəyərlər).
export interface OpenSignupOptions {
  navigate?: boolean;
  allowedOrigin?: string;
  allowedOrigins?: string[];
}

// openSignupInPage nəticəsi (səhifə tərəfi):
// { already } | { opened, ready } | { navigate, guessed? } | { none }. Throw etmir.
export interface OpenSignupPageResult {
  already?: boolean;
  opened?: string | null;
  ready?: boolean;
  navigate?: string;
  guessed?: boolean;
  none?: boolean;
}

// fillFormInPage seçimləri (səhifə tərəfi).
export interface FillFormPageOptions {
  timeoutMs?: number;
  submitMs?: number;
  mode?: "fill" | "submit";
  onlyEmpty?: boolean;
  allowedOrigin?: string;
  allowedOrigins?: string[];
}

// fillFormInPage nəticəsi (səhifə tərəfi). Worker da eyni formanı qaytarır — üstəlik
// göndərmə mərhələsinin sahələri (submitted, codeRequested, codeButtons, navigated).
export interface FillFormResult {
  done: boolean;
  filled: string[];
  failed?: string[];
  checked: number;
  chosen?: number;
  skipped?: string[];
  submitted?: string;
  codeRequested?: boolean;
  codeButtons?: string[];
  navigated?: boolean;
  reason?: string;
  blocked?: boolean;
}

// `run` seçimləri: frame hədəfləmə + naviqasiya izləmə. Hamısı istəyə bağlıdır.
export interface RunOptions {
  frameIds?: number[] | null;
  documentId?: string | null;
  origin?: string | null;
  allFrames?: boolean;
  pick?: ((item: unknown) => boolean) | null;
  watchNavigation?: boolean;
}

// `run` nəticəsi: həmişə obyektdir. Uğurda { result, frameId, documentId, origin },
// xətada { error, blocked?, timeout?, previousDocument? }, keçiddə { navigated }.
export interface RunOutcome<T = unknown> {
  result?: T;
  frameId?: number;
  documentId?: string | null;
  origin?: string | null;
  error?: string;
  blocked?: boolean;
  timeout?: boolean;
  navigated?: boolean;
  previousDocument?: unknown;
}

// openSignup seçimləri (worker tərəfi).
export interface OpenSignupWorkerOptions {
  timeoutMs?: number;
  graceMs?: number;
  allowNavigate?: boolean;
}

// openSignup nəticəsi (worker tərəfi):
// { already } | { opened, navigated } | { navigatedTo, opened?, ready } |
// { none } | { error, blocked? }.
export interface OpenSignupResult {
  already?: boolean;
  opened?: string | null;
  ready?: boolean;
  navigated?: boolean;
  navigatedTo?: string;
  none?: boolean;
  error?: string;
  blocked?: boolean;
}

// fillForm seçimləri (worker tərəfi).
export interface FillFormOptions {
  timeoutMs?: number;
  submit?: boolean;
  submitMs?: number;
  graceMs?: number;
  onlyEmpty?: boolean;
}

// Diaqnostika hesabatı (describePageInPage → describePage).
export interface PageFormReport {
  action: string;
  role: string | null;
  fields: number;
  buttons: string;
}

export interface PageFieldReport {
  tag: string;
  type: string;
  visible: boolean;
  name: string;
  id: string;
  autocomplete: string | null;
  placeholder: string;
  aria: string;
  inForm: boolean;
  chain: string;
}

export interface PageClickableReport {
  tag: string;
  role: string | null;
  text: string;
  href: string;
  visible: boolean;
  kids: number;
  ariaSelected: string | null;
  dataState: string | null;
  cls: string;
  chain: string;
}

export interface PageReport {
  url: string;
  title: string;
  forms: PageFormReport[];
  fields: PageFieldReport[];
  clickables: PageClickableReport[];
  note: string[];
}


// ===========================================================================================
// 1. QEYDİYYAT SƏHİFƏSİNİN/FORMASININ TAPILMASI (səhifədə icra olunur)
// ===========================================================================================
// Nəticə: { already } | { opened, ready } | { navigate, guessed? } | { none }. Throw etmir.
//
// ⚠ BURADAKI ƏSAS MƏSƏLƏ "poçt xanası var" ≠ "qeydiyyat forması var" AYRIMIDIR.
// Əvvəlki versiya səhifədə görünən HƏR HANSI poçt xanasını + hər hansı "Sign up" düyməsini
// qeydiyyat forması sayırdı. Nəticədə coinmarketcap.com ana səhifəsində ünvan **bülletenə
// abunə** xanasına yazılırdı: xana orada idi, başlıqda isə "Sign up" düyməsi var idi.
// Ona görə indi qutu TƏSNİF olunur (abunə / giriş / axtarış / qeydiyyat) və yalnız qeydiyyat
// qutusu qəbul edilir. Şübhə olanda "forma açıq deyil" seçilir: yanlış "açıqdır" cavabı yad
// formaya yazmaq deməkdir, yanlış "açıq deyil" isə sadəcə bir klik artıq deməkdir.
//
// `export` yalnız test üçündür.
export const openSignupInPage = async (
  timeoutMs: number,
  options?: OpenSignupOptions | null,
): Promise<OpenSignupPageResult> => {
  if (options?.allowedOrigins ? !options.allowedOrigins.includes(location.origin)
    : options?.allowedOrigin && location.origin !== options.allowedOrigin) return { none: true };
  // Naviqasiya YALNIZ birinci cəhddə olur: keçiddən sonra worker bu funksiyanı bir daha
  // çağırır və o zaman yalnız klik axtarılır (əks halda dövrə yaranardı).
  const allowNavigate = options?.navigate !== false;

  // Ayırıcılar boşluğa çevrilir, diakritika atılır — "sign-up" ↔ "sign up" ↔ "Sign Up"
  const norm = (value: unknown): string => String(value ?? "").toLowerCase()
    .replace(/ə/g, "e").replace(/ı/g, "i").replace(/ø/g, "o").replace(/ß/g, "ss")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9\u0400-\u04ff]+/g, " ").trim();
  // Eyni sözlər minlərlə DOM elementi üçün yenidən normallaşdırılıb compile olunmasın.
  const words = new Map<string, string>();
  const patterns = new Map<string, RegExp>();
  const word = (value: string): string => {
    if (!words.has(value)) words.set(value, norm(value));
    return words.get(value) as string;
  };
  const has = (haystack: string, list: string[]): boolean => list.some((w) => {
    if (!patterns.has(w)) patterns.set(w, new RegExp(`(^| )${word(w)}( |$)`));
    return word(w) !== "" && (patterns.get(w) as RegExp).test(haystack);
  });
  // Kök üzrə uyğunluq: "subscribe/subscription", "abunə/abunəlik", "рассылка/рассылки"
  const hasStem = (haystack: string, list: string[]): boolean => list.some((w) => haystack.includes(word(w)));
  const attr = (el: PageEl | null | undefined, name: string): string | null => el?.getAttribute?.(name) ?? null;
  const usable = (el: PageEl | null | undefined): boolean => !!(el && !el.disabled && (el.offsetParent || el.offsetWidth || el.offsetHeight));
  const label = (el: PageEl): string => ((el.textContent ?? "") || el.value || attr(el, "aria-label") || "")
    .replace(/\s+/g, " ").trim();

  // Elementin ÖZ mətni: yalnız birbaşa mətn qovşaqları, alt elementlərin mətni SAYILMIR.
  //
  // ⚠ BU, ƏSAS DÜZƏLİŞDİR. coinmarketcap.com-un tabları belədir:
  //     <div class="tab">Log In<div class="underline"></div></div>
  // Yəni tabın alt elementi var (bəzəkli alt xətt) və "yalnız yarpaq elementlər" qaydası onu
  // ATIRDI — diaqnostika hesabatında "Sign Up" ümumiyyətlə görünmədi, halbuki ekranda idi.
  // "Öz mətn" yanaşması bəzəkdən asılı deyil: etiketi DAŞIYAN elementi tapır. Bu, hər
  // framework-də işləyir, çünki React/Vue/styled-components da etiketi mətn qovşağı kimi yazır.
  const ownText = (el: PageEl): string => {
    let out = "";
    try {
      for (const node of el.childNodes ?? []) {
        if (node.nodeType === 3) out += node.nodeValue ?? "";      // TEXT_NODE
      }
    } catch { return ""; }
    return out.replace(/\s+/g, " ").trim();
  };

  const OPEN = ["sign up", "signup", "sign-up", "register", "registration", "create account",
    "create an account", "create free account", "join", "join now", "get started", "yarat",
    "hesab yarat", "qeydiyyat", "qeydiyyatdan kec", "kaydol", "kayit ol", "uye ol", "olustur",
    "hesap olustur", "registracia", "регистрация", "зарегистрироваться", "создать аккаунт",
    // Metod seçimi: "Google / Apple / Email" cərgəsində poçt yolu. Panel açılmasa poçt xanası
    // ümumiyyətlə görünmür (sosial düymələr BANNED siyahısı ilə kənarda qalır).
    "continue with email", "sign up with email", "continue with e mail", "use email",
    "email ile", "e poct ile", "eposta ile", "по электронной почте"];
  const BANNED = ["sign in", "signin", "log in", "login", "giris", "daxil ol", "oturum ac",
    "forgot", "google", "apple", "facebook", "github", "twitter", "discord", "microsoft",
    "already", "wallet", "metamask", "sso"];
  // HEÇ VAXT basılmayanlar: sosial giriş, pul kisəsi, parolun bərpası, "artıq hesabım var".
  // Bunlar nə qeydiyyat elementi, nə də auth səthini açan element kimi işlədilə bilər —
  // sosial düymə basılsa istifadəçi başqa saytın icazə ekranına aparılardı.
  const HARD_BANNED = ["google", "apple", "facebook", "github", "gitlab", "twitter", "discord",
    "microsoft", "binance", "telegram", "wallet", "metamask", "sso", "okta", "forgot",
    "already", "unsubscribe"];

  // ABUNƏ (bülleten) qutusu — ünvanı ORA yazmaq yanlışdır
  const SUBSCRIBE = ["stay updated", "stay in the loop", "stay informed", "get updates",
    "email alerts", "email updates", "notify me", "keep me posted", "market updates",
    "daily brief", "weekly digest", "mailing list", "join our list", "be the first",
    "waitlist", "early access", "no spam", "unsubscribe"];
  const SUBSCRIBE_STEMS = ["subscri", "newsletter", "abune", "bulten", "рассылк", "подпис",
    "digest", "haber bulteni"];
  // Formanın `action`-ı birbaşa abunə xidmətinə gedirsə şübhə qalmır
  const ESP = /list-manage|mailchimp|hubspot|klaviyo|mailerlite|substack|beehiiv|convertkit|sendinblue|brevo|activecampaign|getresponse|aweber|omnisend|drip|campaign-archive|feedburner/;
  const LOGIN_STEMS = ["log in", "login", "sign in", "signin", "giris", "daxil ol", "oturum",
    "remember me", "forgot", "вход", "войти", "sifremi", "parolu unut"];
  const CODE_WORDS = ["code", "kod", "otp", "one time code", "verification", "verify"];

  // Yol nişanları YALNIZ tam seqment kimi tutulur: "/blog/how-to-join-a-webinar" qeydiyyat
  // səhifəsi deyil, halbuki defislə ayrılmış "join" sözü orada da var.
  const SIGNUP_PATH = /(^|\/)(sign[-_]?up|signup|register|registration|create[-_]?account|new[-_]?account|join|uye[-_]?ol|kayit[-_]?ol|qeydiyyat)(\/|$|\?|#)/i;
  const LOGIN_PATH = /(^|\/)(sign[-_]?in|signin|log[-_]?in|login|forgot[-_]?password|reset[-_]?password)(\/|$|\?|#)/i;

  const BUTTONS = 'button, input[type="submit"], input[type="button"], [role="button"], [role="tab"]';
  const FIELDS = "input, select, textarea";

  const here = (): URL | null => { try { return new URL(location.href); } catch { return null; } };
  const routeOf = (url: URL | null): string => (url ? (url.pathname + url.search + url.hash).toLowerCase() : "");
  const onSignupRoute = (): boolean => SIGNUP_PATH.test(routeOf(here()));

  // --- qutunun (konteynerin) təsnifi -------------------------------------------------------
  // Xananın ən yaxın MƏNALI qutusu: forma və ya dialoq, yoxsa bir neçə səviyyə valideyn.
  // Mətn MƏHDUD oxunur (500 simvol): bütün səhifənin mətni heç nə demir.
  const boxOf = (el: PageEl): Element | null => {
    try {
      const holder = el.closest?.("form, [role='dialog'], [aria-modal='true'], .modal");
      if (holder) return holder;
    } catch { /* seçici pozula bilər */ }
    let node: Element | null = el;
    for (let depth = 0; depth < 4 && node?.parentElement; depth += 1) node = node.parentElement;
    return node ?? null;
  };
  const textOf = (root: Element | null | undefined): string => {
    try { return norm((root?.textContent ?? "").replace(/\s+/g, " ").slice(0, 500)); } catch { return ""; }
  };
  const namesIn = (root: Element | Document): string => {
    try { return norm([...root.querySelectorAll(BUTTONS)].map(label).join(" ")).slice(0, 300); } catch { return ""; }
  };
  const fieldsIn = (root: Element): PageEl[] => {
    try { return [...root.querySelectorAll(FIELDS)]; } catch { return []; }
  };
  const sigOf = (el: PageEl): string => norm([attr(el, "autocomplete"), el.name, el.id, el.placeholder,
    attr(el, "aria-label"), attr(el, "title")].filter(Boolean).join(" "));

  const subscribeish = (text: string): boolean => hasStem(text, SUBSCRIBE_STEMS) || has(text, SUBSCRIBE);
  const isPassword = (el: PageEl): boolean => norm(el.type) === "password";
  const isCodeField = (el: PageEl): boolean => has(sigOf(el), CODE_WORDS);
  const isProfileField = (el: PageEl): boolean => has(sigOf(el), ["username", "user name", "nickname", "first name",
    "last name", "full name", "name", "phone", "telefon", "istifadeci"]);

  // Qutuda qeydiyyat əlaməti var? (parol, kod, ad/istifadəçi adı xanası)
  const boxHasSignupField = (box: Element): boolean => fieldsIn(box).some((el) => isPassword(el) || isCodeField(el) || isProfileField(el));

  // --- GİRİŞ ↔ QEYDİYYAT PANELİNİN AYRILMASI ------------------------------------------------
  // ⚠ REAL QÜSUR (coinmarketcap.com, ekran görüntüsü ilə təsdiqlənib): modal açıldı, GİRİŞ tabı
  // aktiv idi və ünvan/parol GİRİŞ formasına yazıldı. Səbəb: modalda hər iki tabın yazısı
  // ("Log In" və "Sign Up") görünür, ona görə "düymələrdə qeydiyyat sözü var" şərti giriş
  // panelini də qeydiyyat kimi göstərirdi. Tab nişanları (`aria-selected`, class) isə hər
  // saytda olmur — bəziləri yalnız CSS işlədir.
  //
  // HƏLL: qərar TAB YAZISINDAN DEYİL, panelin ÖZ MƏZMUNUNDAN çıxarılır. Bu nişanlar
  // framework-dan asılı deyil və hər iki tab yazısı göründüyü üçün onlar nəticəyə təsir etmir:
  //   GİRİŞ paneli   → "Forgot password?" keçidi, "Remember me", `autocomplete=current-password`
  //   QEYDİYYAT paneli → razılıq/marketinq xanası, parol təsdiqi, `autocomplete=new-password`,
  //                      ad/istifadəçi adı xanası, "Create an account" düyməsi
  // Yalnız GÖRÜNƏN yarpaq elementlərin mətni oxunur: gizli panelin sözləri qərara qarışmasın.
  const LOGIN_ONLY = ["forgot password", "forgot your password", "remember me",
    "keep me signed in", "keep me logged in", "stay signed in", "sifremi unuttum",
    "parolu unutdum", "sifremi", "забыли пароль", "запомнить меня"];
  // Tab yazısı ola BİLMƏYƏN qeydiyyat düymələri ("Sign Up" qəsdən yoxdur — o, tab adıdır)
  const SIGNUP_ONLY = ["create account", "create an account", "create free account",
    "create your account", "get started", "hesab yarat", "hesap olustur", "kayit ol",
    "зарегистрироваться", "создать аккаунт"];

  // Webshare kimi saytlar qeydiyyat paroluna da current-password yaza bilir.
  // Formanın öz qeydiyyat submit-i bu ipucundan güclüdür; tab/sosial düymə sayılmır.
  const signupSubmit = (root: Element | null | undefined): boolean => {
    if ((root?.tagName ?? "").toUpperCase() !== "FORM") return false;
    try {
      return [...(root as Element).querySelectorAll(BUTTONS)].some((el: PageEl) => (el.offsetParent || el.offsetWidth || el.offsetHeight)
        && norm(el.type) === "submit" && attr(el, "role") !== "tab"
        && has(norm(label(el)), OPEN) && !has(norm(label(el)), BANNED));
    } catch { return false; }
  };

  const visibleText = (root: Element, limit = 600): string => {
    let out = "";
    try {
      for (const el of root.querySelectorAll("*")) {
        if (out.length > limit) break;
        const text = ownText(el);                          // bəzəkli etiketlər də oxunur
        if (text && usable(el)) out += " " + norm(text);
      }
    } catch { /* seçici pozula bilər */ }
    return out.trim();
  };

  // "login" | "signup" | "" (qərar vermək üçün nişan yoxdur)
  const panelKind = (box: Element | null | undefined): string => {
    if (!box) return "";
    if (signupSubmit(box)) return "signup";
    const fields = fieldsIn(box).filter(usable);
    if (!fields.length) return "";
    const text = visibleText(box);
    let login = 0;
    let signup = 0;
    if (hasStem(text, LOGIN_ONLY)) login += 2;
    if (has(text, SIGNUP_ONLY)) signup += 2;
    if (fields.some((el) => has(sigOf(el), ["current password"]))) login += 2;
    if (fields.some((el) => has(sigOf(el), ["new password"]))) signup += 2;
    if (fields.filter(isPassword).length > 1) signup += 2;
    if (fields.some(isProfileField)) signup += 1;
    // Razılıq/marketinq xanası qeydiyyat panelinin nişanıdır; "Remember me" isə girişin
    if (fields.some((el) => norm(el.type) === "checkbox"
      && !hasStem(sigOf(el) + " " + textOf(el.closest?.("label")), LOGIN_ONLY))) signup += 2;
    if (login >= 2 && login > signup) return "login";
    return signup > login ? "signup" : "";
  };

  // Xananın ətrafındaki qutular: valideynlərə doğru addım-addım.
  //
  // ⚠ NİYƏ `role="dialog"` / `.modal` AXTARILMIR: coinmarketcap.com-un modalı
  // styled-components ilə qurulub — nə ARIA rolu, nə tanınan class adı var. Əvvəlki versiya
  // modalı bu nişanlarla axtarırdı, tapa bilmirdi və nəticədə nə giriş panelini tanıyırdı, nə
  // də içindəki "Sign Up" tabını görürdü. İndi qutu SADƏCƏ valideyn zənciridir: auth paneli
  // xanadan bir neçə səviyyə yuxarıdadır və tab cərgəsi ilə "Forgot password?" keçidi məhz
  // orada olur. Səhifənin özünə qədər qalxmamaq üçün struktur elementlərində dayanılır.
  const STOP_TAGS = ["BODY", "HTML", "MAIN", "HEADER", "FOOTER", "NAV", "ASIDE"];
  const PANEL_DEPTH = 12;
  const panelsOf = (el: PageEl): Element[] => {
    const out: Element[] = [];
    try { const form = el.closest?.("form"); if (form) out.push(form); } catch { /* yoxdur */ }
    let node: Element | null = el;
    for (let depth = 0; depth < PANEL_DEPTH && node?.parentElement; depth += 1) {
      node = node.parentElement;
      if (STOP_TAGS.includes((node.tagName ?? "").toUpperCase())) break;
      if (!out.includes(node)) out.push(node);
    }
    return out;
  };
  // Ən DAXİLİ QƏTİ cavab qərar verir: xananın öz paneli, kənar qatlar deyil. Səbəb — yuxarı
  // qatlar hər iki paneli (giriş + qeydiyyat) əhatə edə bilər və qarışıq nişanlar yanlış
  // nəticə verərdi (məs. yanaşı duran "Login | Register" formaları olan səhifələr).
  const inLoginPanel = (el: PageEl): boolean => {
    for (const box of panelsOf(el)) {
      const kind = panelKind(box);
      if (kind) return kind === "login";
    }
    return false;
  };

  // Görünən auth xanalarının (poçt/parol) ətrafı — tab axtarışının əhatəsi
  const authScopes = (): Element[] => {
    let inputs: PageEl[] = [];
    try { inputs = [...document.querySelectorAll(FIELDS)].filter(usable); } catch { return []; }
    const fields = inputs.filter((el) => isPassword(el) || norm(el.type) === "email"
      || has(sigOf(el), ["email", "e mail", "mail"]) || isCodeField(el));
    const out: Element[] = [];
    for (const field of fields) for (const box of panelsOf(field)) if (!out.includes(box)) out.push(box);
    return out;
  };

  // ABUNƏ qutusu: qeydiyyat xanası yoxdur, mətn/düymə/imza abunədən danışır, ya da forma
  // birbaşa abunə xidmətinə göndərilir.
  const inSubscribeBox = (el: PageEl): boolean => {
    if (subscribeish(sigOf(el))) return true;
    const box = boxOf(el);
    if (!box) return false;
    // `action` normallaşdırılmır: `norm()` defisi boşluğa çevirir və "list-manage" itir
    const action = String(attr(box, "action") ?? "").toLowerCase();
    if (ESP.test(action) || /subscribe|newsletter/.test(action)) return true;
    if (!subscribeish(textOf(box) + " " + namesIn(box))) return false;
    return !boxHasSignupField(box);
  };

  // GİRİŞ qutusu: düymələri girişdən danışır və qeydiyyat sözü yoxdur.
  // Yalnız DÜYMƏ yazıları oxunur — qeydiyyat modallarında "Already have an account? Log in"
  // linki olur, o isə düymə deyil.
  const inLoginBox = (el: PageEl): boolean => {
    const box = boxOf(el);
    if (!box) return false;
    const names = namesIn(box);
    if (!names || has(names, OPEN)) return false;
    return hasStem(names, LOGIN_STEMS);
  };

  // Konteynerdə GİRİŞ ↔ QEYDİYYAT keçidi (tab) varsa: qeydiyyat tabı seçilibmi?
  //
  // ⚠ REAL HAL (coinmarketcap.com): başlıqda YALNIZ "Log In" düyməsi var. O basılanda JS ilə
  // modal açılır və modalın içində "Log In | Sign Up" tabları olur. Modal açılanda GİRİŞ tabı
  // aktiv olur, yəni səhifədə poçt + parol xanası görünür. Əgər buna "qeydiyyat forması
  // açıqdır" desək, ünvan GİRİŞ formasına yazılardı. Ona görə tab seçimi yoxlanılır: qeydiyyat
  // tabı var və seçilməyibsə forma HƏLƏ açıq sayılmır — əvvəl həmin tab basılmalıdır.
  const TABS = '[role="tab"], button, a, [role="button"]';
  const isSelected = (el: PageEl): boolean => attr(el, "aria-selected") === "true"
    || attr(el, "data-state") === "active"
    || attr(el, "data-active") === "true"
    || /(^| )(active|selected|current)( |$)/.test(norm(attr(el, "class")));

  // Basılmalı olan qeydiyyat tabı (və ya null)
  const pendingSignupTab = (box: Element | null): PageEl | null => {
    if (!box || onSignupRoute() || signupSubmit(box)) return null;
    let items: PageEl[] = [];
    try { items = [...box.querySelectorAll(TABS)].filter(usable); } catch { return null; }
    const signup = items.filter((el) => {
      const name = norm(label(el));
      return name && has(name, OPEN) && !has(name, BANNED) && !subscribeish(name);
    });
    if (!signup.length || signup.some(isSelected)) return null;
    // Cütlük şərti: yanında GİRİŞ keçidi də olmalıdır, yoxsa bu, adi "Sign up" düyməsidir
    const login = items.some((el) => {
      const name = norm(label(el));
      return name && hasStem(name, LOGIN_STEMS);
    });
    return login ? signup[0] : null;
  };

  // Qeydiyyat forması onsuz da açıqdırsa heç nə edilmir. Şərtlər sıra ilə güclüdən zəifə:
  //   1) kod xanası      — axının ortasındayıq;
  //   2) parol xanası    — AMMA giriş forması da parol daşıyır, ona görə əlavə əlamət lazımdır;
  //   3) poçt xanası     — yalnız abunə/giriş qutusundan KƏNARDA və qeydiyyat kontekstində.
  // Hər üç halda basılmamış qeydiyyat tabı varsa cavab "açıq deyil"dir.
  const signupFormOpen = (): boolean => {
    let inputs: PageEl[] = [];
    try { inputs = [...document.querySelectorAll(FIELDS)].filter(usable); } catch { return false; }
    if (!inputs.length) return false;

    // Görünən panel GİRİŞ panelidirsə forma açıq SAYILMIR — əvvəl qeydiyyat tabı basılmalıdır
    const settled = (el: PageEl): boolean => !inLoginPanel(el) && !pendingSignupTab(boxOf(el));

    const code = inputs.find(isCodeField);
    if (code) return settled(code);

    const passwords = inputs.filter(isPassword);
    if (passwords.length > 1) return settled(passwords[0]);       // parol + təsdiq = qeydiyyat
    for (const el of passwords) {
      if (!settled(el)) return false;
      if (has(sigOf(el), ["new password"])) return true;
      const box = boxOf(el);
      if (box && has(namesIn(box), OPEN)) return true;           // formanın düyməsi "Sign up" deyir
      if (box && fieldsIn(box).some(isProfileField)) return true; // ad/istifadəçi adı xanası var
      if (onSignupRoute()) return true;                          // /signup səhifəsindəyik
    }

    const mail = inputs.find((el) => norm(el.type) === "email" || has(sigOf(el), ["email", "e mail", "mail"]));
    if (!mail) return false;
    if (inSubscribeBox(mail) || inLoginBox(mail)) return false;
    if (!settled(mail)) return false;
    if (onSignupRoute()) return true;
    const box = boxOf(mail);
    return Boolean(box) && has(namesIn(box as Element), OPEN);
  };

  // --- qeydiyyat ünvanına keçid -----------------------------------------------------------
  // Səhifədə basılası element olmaya bilər: menyu gizlidir, düymə JS ilə sonra qurulur, ya da
  // qeydiyyat ümumiyyətlə ayrı səhifədədir. Belə halda saytın ÖZ linkinə keçilir.
  //
  // ⚠ ÜNVAN TƏXMİN EDİLMİR. Əvvəlki versiya link tapmayanda "/signup", "/register" kimi
  // standart yolları sınayırdı — coinmarketcap.com-da bu, mövcud olmayan `/signup` səhifəsini
  // açdı və istifadəçi xəta səhifəsi ilə qarşılaşdı. Uydurma ünvan HEÇ VAXT açılmır: ünvan
  // yalnız səhifənin öz `href`-lərindən gəlir (gizli menyudakı linklər də oxunur).
  const signupLinks = (): string[] => {
    const url = here();
    if (!url) return [];
    let links: Element[] = [];
    try { links = [...document.querySelectorAll("a[href]")]; } catch { return []; }
    const seen = new Set<string>();
    const out: string[] = [];
    for (const link of links) {
      let target: URL | null = null;
      try { target = new URL(attr(link, "href") as string, url.href); } catch { continue; }
      if (target.origin !== url.origin) continue;
      const route = routeOf(target);
      if (LOGIN_PATH.test(route) || !SIGNUP_PATH.test(route)) continue;
      if (target.href === url.href || seen.has(target.href)) continue;
      seen.add(target.href);
      out.push(target.href);
    }
    // Ən qısa yol üstündür: "/signup" "/en/help/how-to-signup"-dan daha çox ehtimal olunandır
    out.sort((a, b) => a.length - b.length);
    return out;
  };

  const navigation = (): { navigate: string } | null => {
    if (!allowNavigate || onSignupRoute()) return null;
    const url = here();
    if (!url) return null;
    const found = signupLinks()[0];
    return found ? { navigate: found } : null;
  };

  // --- basılası elementlər ------------------------------------------------------------------
  // İki dərəcə var:
  //   3-4 xal — QEYDİYYAT elementi: "Sign up / Register / Create account", modal içindəkilər
  //             daha dəqiq hədəfdir (+1);
  //   1 xal   — AUTH SƏTHİNİ açan element: "Log In / Sign in / Account". Bu, son ehtimaldır və
  //             yalnız qeydiyyat elementi TAPILMAYANDA işlədilir.
  //
  // ⚠ NİYƏ "Log In" da basılır: coinmarketcap.com-un başlığında qeydiyyat düyməsi YOXDUR —
  // yalnız "Log In" var və qeydiyyat tabı onun açdığı modalın içindədir. Belə saytlar çoxdur,
  // ona görə axtarış ADDIM-ADDIM aparılır: auth səthi açılır → içindəki "Sign Up" tabı basılır.
  const AUTH = ["log in", "login", "sign in", "signin", "account", "my account", "giris",
    "daxil ol", "hesabim", "oturum ac", "войти", "вход", "аккаунт"];

  // Sahəli formanın submit-i açılış düyməsi deyil. Daxilindəki span/ikon da
  // namizəd sayılmır: klik həmin submit-ə ötürülüb boş forma göndərə bilər.
  const isFormSubmit = (el: PageEl): boolean => {
    try {
      const control: PageEl | null | undefined = ["BUTTON", "INPUT"].includes((el.tagName ?? "").toUpperCase())
        ? el : el.closest?.('button, input[type="submit"]');
      if (!control) return false;
      const owner = control.form ?? control.closest?.("form");
      if (!owner) return false;
      const fields = fieldsIn(owner);
      if (norm(control.type) === "submit") return fields.some((field) => !["hidden", "submit", "button"].includes(norm(field.type)));
      // JS ilə göndərilən login formalarında düymə type=button ola bilər.
      return attr(control, "role") !== "tab" && fields.some(isPassword) && has(norm(label(control)), AUTH);
    } catch { return false; }
  };

  const wasClicked = (el: PageEl, skip: Set<PageEl>): boolean => [...skip].some((clicked) => clicked === el
    || clicked.contains?.(el) || el.contains?.(clicked));

  interface Candidate {
    el: PageEl;
    points: number;
  }

  const candidates = (skip: Set<PageEl>): Candidate[] => {
    let all: PageEl[] = [];
    try {
      all = [...document.querySelectorAll('a, button, [role="button"], [role="tab"], input[type="button"], input[type="submit"]')];
    } catch { return []; }
    const rank = (el: PageEl): number => {
      const name = norm(label(el));
      const href = norm(attr(el, "href") ?? "");
      const opens = name && has(name, OPEN);
      const auth = name && has(name, AUTH);
      const signupHref = /sign-?up|regist|create-?account|join/.test(href) && !/log-?in|sign-?in/.test(href);
      const authHref = /log-?in|sign-?in|\/auth|account/.test(href);
      // Əvvəl ucuz mətn yoxlaması: minlərlə əlaqəsiz link üçün layout/forma oxunmur.
      if (!(opens || auth || signupHref || authHref) || !usable(el) || isFormSubmit(el)) return 0;
      // "Sign up for our newsletter" QEYDİYYAT deyil: abunə qutusunun öz düyməsidir
      if (subscribeish(name)) return 0;
      try {
        const owner = el.closest?.("form");
        if (owner && subscribeish(namesIn(owner) + " " + textOf(owner)) && !boxHasSignupField(owner)) return 0;
      } catch { /* forma yoxdur */ }
      if (name && has(name, BANNED)) {
        // Giriş sözü qadağan siyahısındadır, amma AUTH səthini açan element kimi son
        // ehtimalda yenə lazımdır — sosial/pul kisəsi düymələri isə tam kənarda qalır.
        return auth && !has(name, HARD_BANNED) ? 1 : 0;
      }
      let points = 0;
      if (opens) points += 3;
      if (signupHref) points += 1;
      if (points) {
        // Dialoq/modal içindəki "Sign Up" tabı ən dəqiq hədəfdir (giriş/qeydiyyat keçidi)
        try { if (el.closest?.("[role='dialog'], [aria-modal='true'], .modal")) points += 1; } catch { /* yoxdur */ }
        return points;
      }
      if (auth || authHref) return 1;
      return 0;
    };
    return all.filter((el) => !wasClicked(el, skip))
      .map((el) => ({ el, points: rank(el) }))
      .filter((item) => item.points > 0)
      .sort((a, b) => b.points - a.points);
  };

  // Tab ADİ ELEMENT ola bilər. coinmarketcap.com-un "Log In | Sign Up" keçidləri `<button>`,
  // `<a>` və ya `role="tab"` DEYİL — sadəcə klik hadisəsi olan mətn blokudur.
  //
  // ⚠ ƏHATƏDƏN ASILI OLMAMAQ: əvvəlki versiya belə elementləri yalnız "modalın içində", sonra
  // "auth xanalarının ətrafında" axtarırdı. Hər iki halda ƏHATƏNİ DOĞRU TAPMAQ şərti var idi və
  // styled-components ilə qurulmuş dərin ağacda bu şərt pozulurdu (tab cərgəsi xanadan çox
  // yuxarıda qalırdı). İndi əhatə tapılmasa BÜTÜN SƏNƏD daranır: "Sign Up" / "Register" /
  // "Create account" kimi QISA və birmənalı mətn üçün bu təhlükəsizdir — abunə qutusunun öz
  // düyməsi `subscribeish` ilə, sosial düymələr `HARD_BANNED` ilə onsuz da kənarda qalır.
  const collectLoose = (scope: Element, skip: Set<PageEl>, seen: Set<PageEl>, out: Candidate[]): void => {
    let all: PageEl[] = [];
    try { all = [...scope.querySelectorAll("*")]; } catch { return; }
    for (const el of all) {
      if (skip.has(el) || seen.has(el)) continue;
      seen.add(el); // iç-içə scope-larda eyni elementi yalnız bir dəfə yoxla
      // Elementin ÖZ mətni: bəzəkli tab (`<div>Sign Up<div class="underline"/></div>`) də tutulur
      const text = ownText(el);
      if (!text || text.length > 30) continue;
      const name = norm(text);
      if (!has(name, OPEN) || has(name, HARD_BANNED) || subscribeish(name)) continue;
      if (!usable(el) || isFormSubmit(el) || wasClicked(el, skip)) continue;
      out.push({ el, points: 3 });
    }
  };

  const looseTabs = (skip: Set<PageEl>): Candidate[] => {
    const out: Candidate[] = [];
    const seen = new Set<PageEl>();
    // Əvvəl DAR əhatə (auth xanalarının ətrafı) — orada tapılan daha dəqiqdir
    for (const scope of authScopes()) collectLoose(scope, skip, seen, out);
    if (out.length) return out;
    // Sonra bütün sənəd: əhatəni tapmaq şərtini tamam aradan qaldırır
    try {
      const root = document.body ?? document.documentElement;
      if (root) collectLoose(root, skip, seen, out);
    } catch { /* sənəd oxunmadı */ }
    return out;
  };

  const allCandidates = (skip: Set<PageEl>): Candidate[] => {
    const list = candidates(skip);
    // Standart seçicilər qeydiyyat elementi tapmadıqda modalın içi daranır
    if (list.some((item) => item.points >= 3)) return list;
    return [...looseTabs(skip), ...list];
  };

  if (signupFormOpen()) return { already: true };

  // Forma və ya YENİ mərhələ görünən kimi davam et. "Sign up" → "Continue with email"
  // eyni dərəcədə ola bilər; dərəcənin artmasını gözləmək hər klikə 2 s əlavə edirdi.
  const waitForStep = <T>(limit: number, read: () => T | null): Promise<T | null> => new Promise((resolve) => {
    const initial = read();
    if (initial) { resolve(initial); return; }
    if (limit <= 0) { resolve(null); return; }
    let settled = false;
    let scheduled: ReturnType<typeof setTimeout> | null = null;
    const finish = (value: T | null): void => {
      if (settled) return;
      settled = true;
      observer.disconnect();
      clearInterval(ticker);
      clearTimeout(timer);
      clearTimeout(scheduled as ReturnType<typeof setTimeout>);
      resolve(value);
    };
    const check = (): void => {
      clearTimeout(scheduled as ReturnType<typeof setTimeout>);
      scheduled = null;
      const next = read();
      if (next) finish(next);
    };
    // Canlı qiymət/taymer dəyişiklikləri bütün səhifəni hər mutasiyada daramasın.
    const observer = new MutationObserver(() => {
      if (scheduled === null) scheduled = setTimeout(check, 40);
    });
    observer.observe(document.documentElement ?? document, { childList: true, subtree: true,
      attributes: true, attributeFilter: ["class", "style", "hidden", "disabled", "aria-hidden", "aria-selected", "data-state"] });
    const ticker = setInterval(check, 200);
    const timer = setTimeout(() => finish(read()), limit);
  });

  // Ən çoxu üç klik: "Log In" (auth səthi) → "Sign Up" (tab) → ehtiyat üçün bir addım.
  // Klik naviqasiyaya səbəb olarsa bu skript ölür — worker tabın yüklənməsini gözləyib
  // doldurmaya keçir (bax: openSignup).
  //
  // AUTH səthi (1 xal) YALNIZ qeydiyyat elementi tapılmayanda basılır. Bir dəfə qeydiyyat
  // elementi basıldıqdan sonra giriş düyməsinə keçmək olmaz: istifadəçini giriş ekranında
  // qoyardı.
  const clicked = new Set<PageEl>();
  const tried: string[] = [];
  const deadline = Date.now() + Math.max(0, timeoutMs);
  const remaining = (): number => Math.max(0, deadline - Date.now());
  const readStep = (): { ready: boolean; list: Candidate[] } => {
    if (signupFormOpen()) return { ready: true, list: [] };
    return { ready: false, list: allCandidates(clicked) };
  };
  let state = readStep();
  if (!state.list.length) {
    const destination = navigation();
    if (destination) return destination;
    // Hydration-dan sonra yaranan düyməni elə açılışda tut: boş doldurma axtarışına keçmə.
    state = await waitForStep(remaining(), () => {
      const next = readStep();
      return next.ready || next.list.length ? next : null;
    }) ?? state;
    if (state.ready) return { already: true };
  }
  let usedSignup = false;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const list = state.list.filter((item) => item.points >= (usedSignup ? 3 : 1));
    if (!list.length) break;
    const { el, points } = list[0];
    const before = new Set(state.list.map((item) => item.el));
    clicked.add(el);
    if (points >= 3) usedSignup = true;
    const name = label(el);
    if (name) tried.push(name);
    try { el.click!(); } catch { state = readStep(); continue; }
    // Tək yol varsa gec modal üçün bütün vaxtı saxla. Alternativ artıq görünürsə
    // cavabsız/işləməyən ilk element bütün büdcəni sərf etməsin.
    const hasAlternative = list.slice(1).some((item) => !wasClicked(item.el, clicked)
      && item.points >= (usedSignup ? 3 : 1));
    const stepBudget = hasAlternative ? Math.floor(remaining() / (3 - attempt)) : remaining();
    state = await waitForStep(stepBudget, () => {
      const next = readStep();
      return next.ready || next.list.some((item) => item.points >= (usedSignup ? 3 : 1)
        && (!before.has(item.el) || item.points > points)) ? next : null;
    }) ?? readStep();
    if (state.ready) return { opened: tried.join(" → ") || null, ready: true };
    if (!remaining()) break;
  }

  if (!tried.length) return navigation() ?? { none: true };
  // Kliklər forma açmadı. Saytın ÖZ qeydiyyat linki varsa ona keçilir (uydurma ünvan yoxdur).
  return navigation() ?? { opened: tried.join(" → "), ready: false };
};

// ===========================================================================================
// 2. FORMANI DOLDURAN SKRIPT (səhifədə icra olunur)
// ===========================================================================================
// `values` — hazır dəyərlər (rol → sətir). `options` = { timeoutMs, submitMs, mode }.
//   mode "fill"   — yalnız doldurur (düyməyə toxunmur);
//   mode "submit" — yalnız göndərmə düyməsini tapıb basır.
// İki rejim AYRI-AYRI yeridilir, çünki düymə səhifəni dəyişə bilər və o halda cavab gəlmir —
// doldurmanın nəticəsi isə hər halda bilinməlidir (bax: fillForm).
// Nəticə: { done, filled, failed, checked, chosen, submitted?, reason? }. Throw etmir.
// `export` yalnız test üçündür (tests/forms.test.mjs saxta DOM ilə çağırır).
export const fillFormInPage = async (
  values: Record<string, string>,
  options?: FillFormPageOptions | null,
): Promise<FillFormResult> => {
  if (options?.allowedOrigins ? !options.allowedOrigins.includes(location.origin)
    : options?.allowedOrigin && location.origin !== options.allowedOrigin) {
    return { done: false, filled: [], checked: 0, reason: "səhifənin origin-i dəyişdi" };
  }
  const timeoutMs = options?.timeoutMs ?? 8000;
  const submitMs = options?.submitMs ?? 0;
  const mode = options?.mode ?? "fill";
  // `onlyEmpty` — çoxmərhələli forma üçün: birinci mərhələ artıq doludur, ona görə YALNIZ boş
  // xanalar sayılır və doldurulur. Əks halda köhnə forma yenidən seçilər (o, daha çox rol
  // daşıyır) və ikinci mərhələnin xanaları boş qalardı.
  const onlyEmpty = options?.onlyEmpty === true;

  // --- ümumi köməkçilər -----------------------------------------------------------------
  // Üç iş görür: kiçik hərfə salır, diakritikaları ATIR və AYIRICILARI boşluğa çevirir.
  //   • böyük "İ" JS-də kiçildəndə "i" + birləşən nöqtə olur → "istifadəçi" tutmurdu;
  //   • "first_name", "first-name", "firstName" hamısı "first name" olur, yəni bir söz
  //     siyahısı bütün yazılış formalarını tutur (brauzerin autofill-i də belə normallaşdırır).
  const norm = (value: unknown): string => String(value ?? "").toLowerCase()
    // Latın hərfləri ilə yazılan, amma NFD-də parçalanmayan hərflər: Azərbaycan "ə", türk "ı"
    .replace(/ə/g, "e").replace(/ı/g, "i").replace(/ø/g, "o").replace(/ß/g, "ss")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/([a-z])([0-9])/g, "$1 $2")
    .replace(/[^a-z0-9\u0400-\u04ff]+/g, " ")
    .trim();
  // Söz sərhədi ilə uyğunluq (mətn artıq boşluqla ayrılmışdır)
  const has = (haystack: string, list: string[]): boolean => list.some((w) => {
    const needle = norm(w);
    return needle !== "" && new RegExp(`(^| )${needle}( |$)`).test(haystack);
  });
  // Kök üzrə uyğunluq: "şərtləri", "qaydalarla", "koşullarını" kimi şəkilçili sözlər üçün.
  // Yalnız RAZILIQ xanalarında işlədilir — orada səhv müsbət nəticə ziyanlı deyil (nəticə
  // işarələnmiş checkbox olur), sahə adlarında isə söz sərhədi qalır.
  const hasStem = (haystack: string, list: string[]): boolean => list.some((w) => haystack.includes(norm(w)));
  const attr = (el: PageEl, name: string): string | null => el.getAttribute?.(name) ?? null;

  // Elementin ÖZ mətni: yalnız birbaşa mətn qovşaqları (bax: openSignupInPage → ownText).
  // Bəzəkli etiketlər üçün lazımdır — `<div>Sign Up<div class="underline"/></div>`.
  const ownText = (el: PageEl): string => {
    let out = "";
    try {
      for (const node of el.childNodes ?? []) {
        if (node.nodeType === 3) out += node.nodeValue ?? "";      // TEXT_NODE
      }
    } catch { return ""; }
    return out.replace(/\s+/g, " ").trim();
  };

  const visible = (el: PageEl | null | undefined): boolean => !!(el && (el.offsetParent || el.offsetWidth || el.offsetHeight));
  const usable = (el: PageEl | null | undefined): boolean => !!el && !el.disabled && !el.readOnly && visible(el);

  // Label mətni: adı və placeholder-i olmayan xananın YEGANƏ əlamətidir. Dörd yol yoxlanılır:
  // label[for], əhatələyən <label>, aria-labelledby və qısa əhatələyən blokun mətni
  // (uzun blok bütün formanın mətnini gətirər, ona görə 120 simvol həddi var).
  //
  // `box: false` — radio qrupları üçün: orada əhatələyən blok BÜTÜN variantların mətnini
  // daşıyır ("Gender Male Female Prefer not to say") və hər variant hamısına uyğun görünərdi.
  const labelOf = (el: PageEl, { box = true } = {}): string => {
    const parts: unknown[] = [];
    try {
      if (el.id) {
        const escaped = typeof CSS !== "undefined" && CSS.escape ? CSS.escape(el.id) : el.id.replace(/"/g, '\\"');
        for (const tag of document.querySelectorAll(`label[for="${escaped}"]`)) parts.push(tag.textContent);
      }
      const wrap = el.closest?.("label");
      if (wrap) parts.push(wrap.textContent);
      const by = attr(el, "aria-labelledby");
      if (by) for (const id of by.split(/\s+/)) parts.push(document.getElementById(id)?.textContent);
      if (box) {
        const holder = el.closest?.(".form-group, .form-field, .field, .input-group, td, th, li, fieldset, div");
        const text = (holder?.textContent ?? "").replace(/\s+/g, " ").trim();
        if (text && text.length <= 120) parts.push(text);
      }
    } catch { /* seçici pozula bilər — label olmadan da davam edirik */ }
    return parts.filter(Boolean).join(" ");
  };

  // Xananın "imzası": bütün əlamətlər bir sətirdə
  const sig = (el: PageEl, options?: { box?: boolean }): string => norm([
    attr(el, "autocomplete"), el.name, el.id, el.placeholder, attr(el, "aria-label"),
    attr(el, "title"), attr(el, "data-testid"), attr(el, "data-test"), labelOf(el, options),
  ].filter(Boolean).join(" "));

  // --- söz siyahıları -------------------------------------------------------------------
  const CONFIRM = ["confirm", "confirmation", "repeat", "again", "retype", "re-enter", "reenter",
    "verify", "match", "second", "2", "tekrar", "yeniden", "povtor", "подтверждение"];
  // "poct" TƏK BAŞINA poçt ünvanı demək deyil: "poçt indeksi" də var, ona görə yalnız
  // birləşmələr sayılır ("e-poçt", "poçt ünvanı").
  const EMAIL = ["email", "e mail", "mail", "eposta", "e posta", "e poct", "poct unvani", "почта"];
  const USER = ["username", "user", "userid", "user-name", "nickname", "nick", "handle",
    "screenname", "displayname", "login", "kullanici", "istifadeci", "логин"];
  const NOT_FIELD = ["search", "query", "captcha", "coupon", "promo", "referral", "refer",
    "invite", "invitation", "discount", "voucher", "gift", "aff", "quantity", "amount", "price"];
  const NOT_CODE = [...NOT_FIELD, "zip", "postal", "postcode", "post", "pincode", "pin code",
    "indeks", "area", "country", "phone", "tel", "iso", "currency", "lang", "language"];
  const FIRST_NAME = ["first name", "firstname", "first-name", "fname", "given name", "givenname",
    "given-name", "forename", "ad", "isim", "имя"];
  const LAST_NAME = ["last name", "lastname", "last-name", "lname", "surname", "family name",
    "familyname", "family-name", "soyad", "soyadi", "soyisim", "фамилия"];
  const MIDDLE_NAME = ["middle name", "middlename", "middle-name", "mname", "additional name"];
  const FULL_NAME = ["name", "full name", "fullname", "full-name", "your name", "display name",
    "displayname", "contact name", "ad soyad", "isim soyisim", "имя фамилия", "фио"];
  const NOT_FULL_NAME = [...USER, ...FIRST_NAME, ...LAST_NAME, ...MIDDLE_NAME, "company",
    "organization", "organisation", "business", "card", "product", "domain", "file", "pet",
    "project", "team", "site", "server", "device", "city", "country", "state", "street", "bank"];
  const PHONE = ["phone", "telephone", "tel", "mobile", "cell", "cellphone", "msisdn", "whatsapp",
    "telefon", "gsm", "телефон"];
  const PHONE_CC = ["country code", "countrycode", "dial code", "dialcode", "phone code", "prefix code"];
  const POSTAL = ["zip", "zipcode", "zip code", "postal", "postal code", "postcode", "post code",
    "pincode", "pin code", "posta kodu", "poct kodu", "poct indeksi", "indeks", "индекс"];
  const CITY = ["city", "town", "locality", "suburb", "sehir", "ilce", "seher", "город"];
  const STATE = ["state", "province", "region", "county", "prefecture", "eyalet", "vilayet", "область"];
  const COUNTRY = ["country", "nation", "olke", "ulke", "страна"];
  const STREET2 = ["address 2", "address2", "address line 2", "addressline2", "addr2", "apt",
    "apartment", "suite", "unit", "floor", "building", "line 2", "daire"];
  const STREET = ["address", "address 1", "address1", "address line 1", "addressline1", "addr1",
    "street", "street address", "streetaddress", "adres", "unvan", "улица", "адрес"];
  const BIRTH = ["birth", "birthday", "birthdate", "birth date", "date of birth", "dob", "bday",
    "dogum", "dogum tarihi", "рождения"];
  const DAY = ["day", "dd", "gun", "день"];
  const MONTH = ["month", "mm", "ay", "месяц"];
  const YEAR = ["year", "yyyy", "yy", "il", "yil", "год"];
  const AGE = ["age", "yas", "возраст"];
  const COMPANY = ["company", "organization", "organisation", "employer", "business", "firm",
    "sirket", "firma", "компания"];
  const JOB = ["job title", "jobtitle", "occupation", "position", "profession", "role",
    "vezife", "meslek", "должность"];
  const PREFIX = ["title", "prefix", "salutation", "honorific"];
  const WEBSITE = ["website", "web site", "url", "homepage", "home page", "site", "blog", "link"];
  const BIO = ["bio", "about", "about you", "about me", "description", "message", "comment",
    "comments", "notes", "summary", "haqqinda", "hakkinda"];
  const GENDER = ["gender", "sex", "cinsiyet", "cins", "пол"];

  const CONSENT = ["18", "over 18", "18 or older", "age", "adult", "tos", "tou", "eula", "gdpr",
    "kvkk", "n a", "i am", "i have", "i confirm", "i understand", "read and", "read the",
    "i agree", "i accept"];
  // Şəkilçi qəbul edən sözlər kök üzrə tutulur ("şərtləri", "qaydalarla", "koşullarını").
  // Siyahı GENİŞDİR: razılıq xanası işarələnməsə forma ümumiyyətlə göndərilmir, ona görə
  // burada səhv müsbət nəticənin ziyanı yoxdur (nəticə işarələnmiş razılıq xanasıdır).
  const CONSENT_STEMS = ["term", "privac", "polic", "agree", "accept", "consent", "licen",
    "condition", "rule", "disclaimer", "confirm", "acknowledg", "understand", "understood",
    "cookie", "data process", "user agreement", "legal",
    "sert", "qayda", "qebul", "razi", "razilas", "oxudum", "mexfilik", "istifade sertler",
    "kabul", "onay", "kosul", "okudum", "gizlilik", "sozlesme",
    "soglas", "prinima", "oznakoml", "услови", "правил", "политик", "соглаш", "принима"];
  const MARKETING = ["newsletter", "marketing", "offers", "deals", "updates", "news", "tips",
    "partner", "third party", "email me", "sms"];
  const MARKETING_STEMS = ["promot", "subscri", "advertis", "bulten", "reklam", "рассылк", "новост"];
  const ROBOT = ["robot", "not a robot", "im not a robot", "human", "i am human", "captcha",
    "verify you are human", "bot deyil", "insan"];
  const AFFIRM = ["yes", "yeah", "true", "agree", "accept", "confirm", "male female", "beli",
    "evet", "da", "да", "1", "y", "on"];
  const NEGATIVE = ["no", "nope", "false", "decline", "reject", "disagree", "xeyr", "hayir", "нет"];
  const GENDER_NEUTRAL = ["prefer not to say", "prefer not", "rather not say", "not specified",
    "unspecified", "undisclosed", "other", "none", "n/a"];

  const PLACEHOLDER_OPTION = ["select", "choose", "pick", "please", "none", "--", "---", "seciniz",
    "secin", "seciminiz", "выберите", "не выбрано", "any"];

  // --- düymə yazıları -------------------------------------------------------------------
  // Həm formanın TƏSNİFİNDƏ (giriş/abunə formasını tanımaq), həm də sonda düymənin
  // seçilməsində işlədilir, ona görə burada — sahə siyahıları ilə bir yerdə — saxlanılır.
  const BANNED = ["sign in", "signin", "log in", "login", "giris", "daxil ol",
    "oturum", "forgot", "reset", "cancel", "close", "back", "geri", "legv", "iptal",
    "google", "apple", "facebook", "github", "gitlab", "twitter", "discord", "microsoft",
    "sso", "wallet", "metamask", "resend", "subscribe", "buy", "pay", "checkout", "upgrade",
    "donate", "delete", "remove", "sil", "decline", "reject", "already", "skip"];
  const STRONG = ["create account", "create an account", "create", "register", "registration",
    "sign up", "signup", "join", "get started", "yarat", "hesab yarat", "qeydiyyat",
    "qeydiyyatdan kec", "kaydol", "kayit ol", "uye ol", "olustur", "hesap olustur",
    "зарегистрироваться", "регистрация", "создать"];
  // KODU POÇTA GÖNDƏRƏN düymələr. Yazıları birmənalıdır (naviqasiya ilə qarışmır), ona görə
  // formasız səhifədə də (looseRoot) qəbul olunur — çox saytda "e-poçtu yaz → kod al" mərhələsi
  // heç bir <form> içində olmur.
  const CODE_SEND = ["send code", "send the code", "send a code", "send me a code", "send my code",
    "email code", "email me a code", "email me the code", "mail code", "send email code",
    "get code", "get a code", "get the code", "request code", "request a code",
    "send verification", "send verification code", "verification code", "send confirmation code",
    "send otp", "get otp", "send pin", "send link", "email me a link", "send magic link",
    "continue with email", "kod gonder", "kodu gonder", "kod al",
    "kodu al", "dogrulama kodu", "tesdiq kodu", "kod isteyin", "kod gonderin",
    "отправить код", "получить код", "выслать код", "код подтверждения", "прислать код"];
  const WEAK = ["continue", "next", "submit", "confirm", "verify", "send", "done", "finish",
    "davam", "tesdiq", "gonder", "ireli", "devam", "ileri", "onayla", "bitir",
    "продолжить", "далее", "подтвердить", "готово"];

  // --- yad formaların tanınması ---------------------------------------------------------
  // ⚠ BU BÖLMƏ REAL QÜSURDAN YARANDI: coinmarketcap.com ana səhifəsində ünvan **bülletenə
  // abunə** xanasına yazılırdı. Səbəb — formanın seçimi yalnız "hansı rollar var" çəkisi ilə
  // aparılırdı və tək poçt xanası olan abunə forması 2 xal alıb qalib gəlirdi.
  // İndi formalar ƏVVƏLCƏ təsnif olunur: abunə, giriş və axtarış formaları BLOKLANIR — nə
  // seçilir, nə də sənəd kökündə onların xanaları sayılır.
  const SUBSCRIBE = ["stay updated", "stay in the loop", "stay informed", "get updates",
    "email alerts", "email updates", "notify me", "keep me posted", "market updates",
    "daily brief", "weekly digest", "mailing list", "join our list", "be the first",
    "waitlist", "early access", "no spam", "unsubscribe"];
  const SUBSCRIBE_STEMS = ["subscri", "newsletter", "abune", "bulten", "рассылк", "подпис",
    "digest", "haber bulteni"];
  const ESP = /list-manage|mailchimp|hubspot|klaviyo|mailerlite|substack|beehiiv|convertkit|sendinblue|brevo|activecampaign|getresponse|aweber|omnisend|drip|campaign-archive|feedburner/;
  const LOGIN_STEMS = ["log in", "login", "sign in", "signin", "giris", "daxil ol", "oturum",
    "remember me", "forgot", "вход", "войти", "sifremi", "parolu unut"];
  // Parolun bərpası: yalnız poçt xanası olur, düymə isə "Reset password / Send reset link".
  // "reset" tək başına da sayılır: bu qayda YALNIZ parolsuz formalara və qeydiyyat sözü
  // olmayan düymələrə tətbiq olunur, yəni "Reset filters" kimi hallar buraya düşmür.
  const RESET_STEMS = ["reset", "forgot", "recover", "parolu", "sifre sifirla",
    "восстанов", "сброс парол", "berpa"];
  // ƏLAQƏ / şərh forması: poçt + mesaj xanası. Qeydiyyat deyil, ora yazmaq istifadəçinin
  // adından saytla "əlaqə saxlamaq" olardı.
  const MESSAGE_STEMS = ["message", "mesaj", "comment", "serh", "yorum", "inquiry", "enquiry",
    "feedback", "support request", "how can we help", "сообщени", "комментар", "обратн"];
  const CONTACT_BUTTONS = ["send message", "send us a message", "post comment", "add comment",
    "submit ticket", "contact us", "mesaj gonder", "serh yaz", "отправить сообщение"];
  // Ticarət: səbət, ödəniş, sifariş. Poçt xanası burada da olur (qonaq kimi alış).
  const COMMERCE_STEMS = ["checkout", "place order", "pay now", "payment", "add to cart",
    "buy now", "donate", "odenis", "sepete", "siparis", "оплат", "заказ"];

  const BUTTON_SELECTOR = 'button, input[type="submit"], input[type="button"], [role="button"]';
  const FIELD_SELECTOR = "input, select, textarea";

  // Səhifənin marşrutu qeydiyyata aiddirsə (/signup, /register…) bu, özü-özlüyündə qeydiyyat
  // kontekstidir. Yol nişanı yalnız TAM SEQMENT kimi tutulur.
  const SIGNUP_PATH = /(^|\/)(sign[-_]?up|signup|register|registration|create[-_]?account|new[-_]?account|join|uye[-_]?ol|kayit[-_]?ol|qeydiyyat)(\/|$|\?|#)/i;
  const onSignupRoute = (): boolean => {
    try { return SIGNUP_PATH.test((location.pathname + location.search + location.hash).toLowerCase()); }
    catch { return false; }
  };

  const textOf = (root: Element | null | undefined): string => {
    try { return norm((root?.textContent ?? "").replace(/\s+/g, " ").slice(0, 500)); } catch { return ""; }
  };
  const buttonText = (el: PageEl): string => (((el.value && (el.tagName ?? "").toUpperCase() === "INPUT" ? el.value : el.textContent) ?? "")
    .replace(/\s+/g, " ").trim() || (attr(el, "aria-label") ?? "")).toLowerCase();
  const namesIn = (root: Element | Document): string => {
    try { return norm([...root.querySelectorAll(BUTTON_SELECTOR)].map(buttonText).join(" ")).slice(0, 300); } catch { return ""; }
  };
  const fieldsIn = (root: Element | Document): PageEl[] => {
    try { return [...root.querySelectorAll(FIELD_SELECTOR)]; } catch { return []; }
  };
  const ownerForm = (el: PageEl): Element | null => { try { return el.closest?.("form") ?? null; } catch { return null; } };
  const subscribeish = (text: string): boolean => hasStem(text, SUBSCRIBE_STEMS) || has(text, SUBSCRIBE);

  // --- GİRİŞ PANELİ (auth modalı) ------------------------------------------------------------
  // ⚠ REAL QÜSUR (coinmarketcap.com): modal açıldı, GİRİŞ tabı aktiv idi və ünvan/parol GİRİŞ
  // formasına yazıldı. `formKind` yalnız `<form>` elementlərini təsnif edir, modalda isə forma
  // ola bilməz (React); üstəlik modalda hər iki tabın yazısı ("Log In" / "Sign Up") göründüyü
  // üçün "düymələrdə qeydiyyat sözü var" şərti giriş panelini də qeydiyyat kimi göstərirdi.
  //
  // HƏLL: qərar panelin ÖZ MƏZMUNUNDAN çıxarılır və yalnız GÖRÜNƏN yarpaq elementlərin mətni
  // oxunur (gizli panelin sözləri qarışmasın). Tab yazıları hər iki halda göründüyü üçün
  // nişan kimi İŞLƏDİLMİR — "Sign Up" sözü qəsdən SIGNUP_ONLY siyahısında yoxdur.
  const LOGIN_ONLY = ["forgot password", "forgot your password", "remember me",
    "keep me signed in", "keep me logged in", "stay signed in", "sifremi unuttum",
    "parolu unutdum", "sifremi", "забыли пароль", "запомнить меня"];
  const SIGNUP_ONLY = ["create account", "create an account", "create free account",
    "create your account", "get started", "hesab yarat", "hesap olustur", "kayit ol",
    "зарегистрироваться", "создать аккаунт"];

  const visibleText = (root: Element, limit = 600): string => {
    let out = "";
    try {
      for (const el of root.querySelectorAll("*")) {
        if (out.length > limit) break;
        if (!visible(el)) continue;
        const text = ownText(el);                          // bəzəkli etiketlər də oxunur
        if (text) out += " " + norm(text);
      }
    } catch { /* seçici pozula bilər */ }
    return out.trim();
  };

  // Nəticə hər AXTARIŞ KEÇİDİ üçün keşlənir: `isBlockedField` hər xana üçün çağrılır, `visibleText`
  // isə DOM oxumasıdır. Keş `best()`-in başında təmizlənir — səhifə gözləmə müddətində dəyişə bilər.
  const panelCache = new Map<Element, string>();
  const panelKind = (box: Element | null | undefined): string => {
    if (!box) return "";
    if (panelCache.has(box)) return panelCache.get(box) as string;
    const kind = computePanelKind(box);
    panelCache.set(box, kind);
    return kind;
  };

  const computePanelKind = (box: Element): string => {
    if (signupSubmit(box)) return "signup";
    const fields = fieldsIn(box).filter((el) => !el.disabled && visible(el));
    if (!fields.length) return "";
    const text = visibleText(box);
    let login = 0;
    let signup = 0;
    if (hasStem(text, LOGIN_ONLY)) login += 2;
    if (has(text, SIGNUP_ONLY)) signup += 2;
    if (fields.some((el) => has(sig(el), ["current password"]))) login += 2;
    if (fields.some((el) => has(sig(el), ["new password"]))) signup += 2;
    if (fields.filter((el) => norm(el.type) === "password").length > 1) signup += 2;
    if (fields.some((el) => {
      const t = sig(el);
      return has(t, USER) || has(t, FIRST_NAME) || has(t, LAST_NAME)
        || (has(t, FULL_NAME) && !has(t, NOT_FULL_NAME));
    })) signup += 1;
    // Razılıq/marketinq xanası qeydiyyat panelinin nişanıdır; "Remember me" isə girişin
    if (fields.some((el) => norm(el.type) === "checkbox" && !hasStem(sig(el), LOGIN_ONLY))) signup += 2;
    if (login >= 2 && login > signup) return "login";
    return signup > login ? "signup" : "";
  };

  // Yanlış autocomplete ipucunu yalnız formanın öz qeydiyyat submit-i üstələyir.
  // "Log in | Sign up" tab cərgəsi giriş formasını qeydiyyata çevirmir.
  const signupSubmit = (root: Element | null | undefined): boolean => {
    if ((root?.tagName ?? "").toUpperCase() !== "FORM") return false;
    try {
      return [...(root as Element).querySelectorAll(BUTTON_SELECTOR)].some((el: PageEl) => visible(el)
        && norm(el.type) === "submit" && attr(el, "role") !== "tab"
        && has(norm(buttonText(el)), STRONG) && !has(norm(buttonText(el)), BANNED));
    } catch { return false; }
  };

  // Xananın ətrafındaki qutular: valideynlərə doğru addım-addım.
  //
  // ⚠ NİYƏ `role="dialog"` / `.modal` AXTARILMIR: coinmarketcap.com-un auth modalı
  // styled-components ilə qurulub — nə ARIA rolu, nə tanınan class adı, nə də `<form>` var.
  // Əvvəlki versiya paneli bu nişanlarla axtarırdı, tapa bilmirdi və ünvan/parol GİRİŞ
  // formasına yazılırdı. İndi qutu sadəcə valideyn zənciridir; səhifənin özünə qədər
  // qalxmamaq üçün struktur elementlərində dayanılır.
  const STOP_TAGS = ["BODY", "HTML", "MAIN", "HEADER", "FOOTER", "NAV", "ASIDE"];
  const containersOf = (el: PageEl): Element[] => {
    const out: Element[] = [];
    const form = ownerForm(el);
    if (form) out.push(form);
    let node: Element | null = el;
    for (let depth = 0; depth < 8 && node?.parentElement; depth += 1) {
      node = node.parentElement;
      if (STOP_TAGS.includes((node.tagName ?? "").toUpperCase())) break;
      if (!out.includes(node)) out.push(node);
    }
    return out;
  };
  // Ən DAXİLİ QƏTİ cavab qərar verir: xananın öz paneli, kənar qatlar deyil. Səbəb — yuxarı
  // qatlar hər iki paneli (giriş + qeydiyyat) əhatə edə bilər və qarışıq nişanlar yanlış
  // nəticə verərdi (məs. yanaşı duran "Login | Register" formaları olan səhifələr).
  const inLoginPanel = (el: PageEl): boolean => {
    for (const box of containersOf(el)) {
      const kind = panelKind(box);
      if (kind) return kind === "login";
    }
    return false;
  };

  // Formanın növü: "" (qeydiyyat ola bilər) | "newsletter" | "login" | "search" | "contact" |
  // "commerce". Boş olmayan hər nəticə BLOKLANMA deməkdir.
  const formKind = (root: Element): string => {
    const fields = fieldsIn(root);
    if (!fields.length) return "";
    if (attr(root, "role") === "search" || fields.some((el) => norm(el.type) === "search")) return "search";

    const names = namesIn(root);
    const strongish = Boolean(names) && has(names, STRONG);
    const passwords = fields.filter((el) => norm(el.type) === "password");
    const codes = fields.filter((el) => isCode(el, sig(el)));
    const profile = fields.filter((el) => {
      const t = sig(el);
      return has(t, USER) || has(t, FIRST_NAME) || has(t, LAST_NAME) || has(t, PHONE)
        || (has(t, FULL_NAME) && !has(t, NOT_FULL_NAME));
    }).length;

    // Sıra VACİBDİR: parol/kod xanası ən güclü QEYDİYYAT əlamətidir, ona görə əvvəl o
    // yoxlanılır. Əks halda "email + parol + Pay now" forması ticarət sayılıb bloklanardı,
    // halbuki ödəniş səhifəsində hesab yaradılması adi haldır.
    //
    // GİRİŞ forması: parol var, amma təsdiq/kod/profil xanası yoxdur və düymələr girişdən
    // danışır (qeydiyyat sözü yoxdur). Qeydiyyat forması ilə qarışmır: orada ya təsdiq
    // xanası, ya ad, ya da "Sign up" düyməsi olur. Giriş formasını doldurmaq mənasızdır —
    // düzgün davranış qeydiyyat səhifəsini tapmaqdır (bax: openSignupInPage).
    if (passwords.length) {
      const loginish = passwords.length === 1 && !codes.length && !profile
        && names && hasStem(names, LOGIN_STEMS) && !strongish;
      return loginish ? "login" : "";
    }
    if (codes.length) return "";

    // Buradan aşağı: parol/kod xanası OLMAYAN formalar. Onlar ya "poçtla qeydiyyat" ola bilər,
    // ya da tamam başqa bir iş görür — aşağıdaki nişanlar məhz onları ayırır.

    // TİCARƏT: səbət/ödəniş forması. Qonaq kimi alışda poçt xanası da olur.
    if (!strongish && names && hasStem(names, COMMERCE_STEMS)) return "commerce";

    // PAROLUN BƏRPASI: yalnız poçt xanası, düymə "Reset password / Forgot password"
    if (!strongish && names && hasStem(names, RESET_STEMS)) return "login";

    // ƏLAQƏ / ŞƏRH forması: mesaj xanası var və ya düymə "Send message / Post comment" deyir
    const messageField = fields.some((el) => {
      const kind = kindOf(el);
      return (kind === "textarea" || kind === "text") && hasStem(sig(el), MESSAGE_STEMS);
    });
    if (!strongish && messageField) return "contact";
    if (!strongish && names && (has(names, CONTACT_BUTTONS) || hasStem(names, MESSAGE_STEMS))) return "contact";

    // ABUNƏ forması: parol/kod/profil xanası yoxdur — yalnız poçt (bəlkə ad) var — VƏ nişan
    // ya `action`-dadır, ya XANANIN ÖZ imzasında, ya da düymə yazısında.
    //
    // Formanın BÜTÜN mətni QƏSDƏN oxunmur: qeydiyyat formasında "Send me the newsletter"
    // razılıq xanası ola bilər və onun mətni bütün formanı "abunə" kimi damğalayardı
    // (testlərdə məhz bu hal tutuldu). Xananın imzası isə `labelOf` vasitəsilə onsuz da
    // yaxın qutunun mətnini (≤120 simvol) daşıyır — yəni "Subscribe to our newsletter"
    // başlığı xananın öz nişanı kimi görünür.
    //
    // `action` NORMALLAŞDIRILMIR: `norm()` defisi boşluğa çevirir və "list-manage" nişanı itir.
    const action = String(attr(root, "action") ?? "").toLowerCase();
    if (ESP.test(action) || /subscribe|newsletter/.test(action)) return "newsletter";
    if (profile) return "";
    const values = fields.filter((el) => !["checkbox", "radio"].includes(kindOf(el)));
    if (values.some((el) => subscribeish(sig(el)))) return "newsletter";
    if (names && subscribeish(names) && !strongish) return "newsletter";
    return "";
  };

  // Bloklanmış formalar `fieldsOf`-dan əvvəl hesablanır (bax: aşağı) — təsnif `isCode`
  // funksiyasına söykənir, o isə rol təyinində elan olunur.

  // --- rolun təyini ---------------------------------------------------------------------
  // Ardıcıllıq VACİBDİR: dar sözlər əvvəl, geniş sözlər (ad, ünvan) sonra yoxlanılır.
  const kindOf = (el: PageEl): string => {
    const tag = (el.tagName ?? "").toUpperCase();
    if (tag === "SELECT") return "select";
    if (tag === "TEXTAREA") return "textarea";
    const type = norm(el.type || "text");
    if (["checkbox", "radio"].includes(type)) return type;
    if (["hidden", "submit", "button", "reset", "image", "file", "range", "color"].includes(type)) return "skip";
    return "text";
  };

  const isConsent = (t: string): boolean => has(t, CONSENT) || hasStem(t, CONSENT_STEMS);
  const isMarketing = (t: string): boolean => has(t, MARKETING) || hasStem(t, MARKETING_STEMS);

  const isCode = (el: PageEl, t: string): boolean => {
    if (has(t, NOT_CODE)) return false;
    if (has(t, ["one time code"])) return true;
    if (!has(t, ["code", "kod", "otp", "pin", "verification", "verify", "verif", "token", "confirmation"])) return false;
    const max = Number(el.maxLength);
    return !(Number.isFinite(max) && max > 0 && max > 12);   // uzun mətn sahəsi kod deyil
  };

  const roleOf = (el: PageEl, kind: string): string | null => {
    const t = sig(el);
    const type = norm(el.type || "text");
    // Birmənalı qeydiyyat formalarında səhv autocomplete ipucu maneə deyil.
    if (kind === "text" && type === "password") {
      if (has(t, ["current password"]) && !signupSubmit(ownerForm(el))) return null;
      return has(t, CONFIRM) ? "passwordConfirm" : "password";
    }
    // Düymənin "Send code" yazısı qonşu email/telefon xanasının rolunu dəyişməməlidir.
    if (type === "email" || has(norm(attr(el, "autocomplete")), ["email"])) {
      return has(sig(el, { box: false }), CONFIRM) ? "emailConfirm" : "email";
    }
    if (kind === "text" && isCode(el, sig(el, { box: false }))) return "code";
    if (has(t, NOT_FIELD)) return null;              // axtarış, promo kodu, məbləğ…

    // Poçt sözü hər şeydən üstündür: "user_email" ünvandır, "username" isə addır
    if (type === "email" || has(t, EMAIL)) return has(t, CONFIRM) ? "emailConfirm" : "email";
    if (has(t, PHONE_CC)) return "phoneCountryCode";
    if (type === "tel" || has(t, PHONE)) return "phone";
    if (has(t, USER)) return "username";

    if (has(t, FIRST_NAME)) return "firstName";
    if (has(t, LAST_NAME)) return "lastName";
    if (has(t, MIDDLE_NAME)) return "middleName";

    if (has(t, POSTAL)) return "postal";
    if (has(t, CITY)) return "city";
    if (has(t, COUNTRY)) return "country";
    if (has(t, STATE)) return "state";
    if (has(t, STREET2)) return "street2";
    if (has(t, STREET)) return "street";

    if (type === "date") return "birthIso";          // tarix xanası: qeydiyyatda doğum tarixidir
    if (has(t, BIRTH) || has(t, AGE)) {
      if (has(t, DAY)) return "birthDay";
      if (has(t, MONTH)) return "birthMonth";
      if (has(t, YEAR)) return "birthYear";
      if (has(t, AGE)) return "age";
      return "birthIso";
    }
    // Yalnız gün/ay/il yazılmış üçlük (adətən doğum tarixi seçiciləri)
    if (kind === "select" && has(t, DAY)) return "birthDay";
    if (kind === "select" && has(t, MONTH)) return "birthMonth";
    if (kind === "select" && has(t, YEAR)) return "birthYear";

    if (has(t, GENDER)) return "gender";
    if (has(t, COMPANY)) return "company";
    if (has(t, JOB)) return "jobTitle";
    if (kind === "select" && has(t, PREFIX)) return "prefix";
    if (has(t, WEBSITE)) return "website";
    // "How did you hear about us?" haqqında sahəsi DEYİL — o, seçim siyahısıdır.
    // Seçim siyahısına heç vaxt mətn yazmırıq.
    if (kind !== "select" && has(t, BIO) && !has(t, ["about us", "hear about", "how did you"])) return "bio";
    if (kind === "textarea") return null;
    if (has(t, FULL_NAME) && !has(t, NOT_FULL_NAME)) return "fullName";
    return null;
  };

  // --- dəyər variantları ---------------------------------------------------------------
  // Hər rol üçün bir neçə forma: xananın `maxlength`/`pattern`/`type` məhdudiyyətinə UYĞUN
  // olan birincisi seçilir. Beləliklə "10 rəqəmli telefon" da, "+1…" da, "(512) …" da işləyir.
  const variants = (role: string, kind: string): string[] => {
    const v = values;
    switch (role) {
      case "email": case "emailConfirm": return [v.email];
      case "username": return [v.username];
      case "password": case "passwordConfirm": return [v.password];
      case "code": return [v.code];
      case "phone": return [v.phoneDigits, v.phone, v.phoneNational];
      case "phoneCountryCode": return [v.phoneCountryCode, v.countryCode, v.country];
      case "country": return [v.country, v.countryCode];
      case "state": return [v.state, v.stateCode];
      case "birthIso": return [v.birthIso];
      case "birthDay": return [v.birthDay, String(Number(v.birthDay))];
      case "birthMonth": return [v.birthMonth, v.birthMonthName, String(Number(v.birthMonth))];
      case "birthYear": return [v.birthYear];
      case "prefix": return [v.gender === "female" ? "Ms" : "Mr", v.gender === "female" ? "Mrs" : "Mr.", "Mx"];
      // Siyahıda neytral variant üstün tutulur (məcbur deyilsə şəxsi məlumat verməyək);
      // mətn xanasında isə profilin öz dəyəri yazılır.
      case "gender": return kind === "select" ? [...GENDER_NEUTRAL, v.gender] : [v.gender];
      default: return [v[role]];
    }
  };

  // Kəsilməsi ZİYANLI olan rollar: yarım poçt ünvanı, yarım parol və ya yarım indeks
  // saytın yoxlamasını keçmir, üstəlik dəyər yanlış olur.
  const EXACT = ["email", "emailConfirm", "password", "passwordConfirm", "code", "postal",
    "phone", "phoneCountryCode", "birthIso", "birthDay", "birthMonth", "birthYear", "age"];

  const fits = (el: PageEl, value: string): boolean => {
    if (typeof value !== "string" || value === "") return false;
    const max = Number(el.maxLength);
    if (Number.isFinite(max) && max > 0 && value.length > max) return false;
    const min = Number(el.minLength);
    if (Number.isFinite(min) && min > 0 && value.length < min) return false;
    const pattern = attr(el, "pattern");
    if (pattern) {
      try { if (!new RegExp(`^(?:${pattern})$`, "u").test(value)) return false; } catch { /* pozulmuş pattern */ }
    }
    if (norm(el.type) === "number" && !/^-?\d+([.,]\d+)?$/.test(value)) return false;
    return true;
  };

  const valueFor = (el: PageEl, role: string, kind: string): string | null => {
    const list = variants(role, kind).filter((item) => typeof item === "string" && item !== "");
    if (!list.length) return null;
    const good = list.find((item) => fits(el, item));
    if (good) return good;
    if (EXACT.includes(role)) return null;           // uyğun forma yoxdursa yazmırıq
    const max = Number(el.maxLength);
    return Number.isFinite(max) && max > 0 ? list[0].slice(0, max) : list[0];
  };

  // --- yazma ---------------------------------------------------------------------------
  // React/Vue idarə edən xanada `el.value = x` state-ə ÇATMIR: dəyər prototipdəki native
  // setter ilə yazılır və hadisələr özümüz göndərilir.
  const write = (el: PageEl, value: string): boolean => {
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value")?.set;
    try {
      el.focus?.();
      if (setter) setter.call(el, value);
      else el.value = value;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      el.blur?.();
    } catch {
      return false;
    }
    return el.value === value;
  };

  const optionText = (option: HTMLOptionElement): string => norm(((option.textContent ?? "") + " " + (option.value ?? "")).replace(/\s+/g, " ").trim());
  const optionsOf = (el: PageEl): HTMLOptionElement[] => { try { return [...(el.options as HTMLOptionsCollection)]; } catch { return []; } };
  const isRequired = (el: PageEl): boolean => el.required === true || attr(el, "aria-required") === "true";
  const realOption = (option: HTMLOptionElement): boolean => {
    const value = String(option.value ?? "");
    if (value === "" || option.disabled) return false;
    const text = norm(option.textContent ?? "");
    return !PLACEHOLDER_OPTION.some((word) => text === norm(word) || text.startsWith(norm(word) + " "));
  };

  // Seçim siyahısı: dəyər variantları sıra ilə sınanır — əvvəl tam uyğunluq, sonra "içində var"
  const chooseOption = (el: PageEl, list: (string | undefined)[]): HTMLOptionElement | null => {
    const usableOptions = optionsOf(el).filter(realOption);
    for (const wanted of list) {
      const needle = norm(wanted);
      if (!needle) continue;
      const exact = usableOptions.find((option) => norm(option.value) === needle || norm(option.textContent).trim() === needle);
      if (exact) return exact;
      const partial = usableOptions.find((option) => optionText(option).includes(needle));
      if (partial) return partial;
    }
    return null;
  };

  const selectOption = (el: PageEl, option: HTMLOptionElement): boolean => {
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value")?.set;
    try {
      if (setter) setter.call(el, option.value);
      else el.value = option.value;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    } catch {
      return false;
    }
    return el.value === option.value;
  };

  // İşarələnmiş vəziyyətin BÜTÜN yazılış formaları: native `checked`, ARIA və Radix/shadcn
  // kimi kitabxanaların `data-state="checked"` atributu. Nişan bəzən elementin özündə deyil,
  // onu əhatələyən düymədə/wrapper-də olur, ona görə yaxın valideynlər də yoxlanılır.
  const isOn = (el: PageEl | null | undefined): boolean => {
    if (!el) return false;
    if (el.checked === true) return true;
    if (attr(el, "aria-checked") === "true" || attr(el, "data-state") === "checked") return true;
    try {
      const holder = el.closest?.('[role="checkbox"], [role="switch"], [data-state]');
      if (holder && holder !== el
        && (attr(holder, "aria-checked") === "true" || attr(holder, "data-state") === "checked")) return true;
    } catch { /* selektor pozula bilər */ }
    return false;
  };

  // Xanaya bağlı <label>: GÖRÜNMƏYƏN checkbox-u işarələməyin yeganə etibarlı yolu.
  // Tailwind (`peer sr-only`), shadcn, MUI, Ant Design və bir çox dizayn sistemi əsl input-u
  // gizlədib yanında öz elementini çəkir; istifadəçi label-a klikləyir, framework hadisəni
  // ondan alır. Input-un özünə click göndərmək bəzi hallarda state-i dəyişmir.
  //
  // İki yol AYRI-AYRI qorunur: biri sınsa (məs. seçici pozulsa) digəri yenə işləyir.
  const labelElement = (el: PageEl): HTMLLabelElement | null => {
    if (el.id) {
      try {
        const escaped = typeof CSS !== "undefined" && CSS.escape ? CSS.escape(el.id) : el.id.replace(/"/g, '\\"');
        const tag = document.querySelector(`label[for="${escaped}"]`);
        if (tag) return tag as HTMLLabelElement;
      } catch { /* aşağıdaki yol qalır */ }
    }
    try { return (el.closest?.("label") as HTMLLabelElement | null) ?? null; } catch { return null; }
  };

  // Checkbox: klik ən təhlükəsiz yoldur (framework öz hadisəsini alır). Alınmasa label,
  // sonra native setter + hadisə sınanır. Gizli (vizual olaraq örtülmüş) xanalar da
  // işarələnir — razılıq xanaları çox vaxt məhz belədir.
  const setChecked = (el: PageEl): boolean => {
    if (isOn(el)) return true;
    try { el.click!(); } catch { /* aşağıda digər cəhdlər var */ }
    if (isOn(el)) return true;

    const tag = labelElement(el);
    if (tag && tag !== el) {
      try { (tag as PageEl).click!(); } catch { /* davam */ }
      if (isOn(el)) return true;
    }

    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "checked")?.set;
    try {
      if (setter) setter.call(el, true);
      else el.checked = true;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    } catch {
      return false;
    }
    return isOn(el);
  };

  // --- formanın seçilməsi ---------------------------------------------------------------
  // Səhifədə bir neçə forma olur (giriş + qeydiyyat + axtarış + abunə). Rollar çəki ilə
  // sayılır: parol və kod qeydiyyatın əsas əlamətidir, ad/şəhər/telefon isə hər formada olur.
  const WEIGHT = { code: 4, password: 3, passwordConfirm: 2, email: 2, emailConfirm: 1, username: 2 };

  interface FieldRef {
    el: PageEl;
    kind: string;
  }

  interface Scored {
    root: Element | Document;
    fields: FieldRef[] | null;
    map: Map<string, FieldRef> | null;
    raw: number;
    core: number;
    points: number;
    tidy: number;
    coherent?: boolean;
  }

  // Yad formalar bir dəfə təsnif olunub bloklanır (bax: "yad formaların tanınması").
  // Bloklanmış formanın xanaları NƏ seçilir, NƏ də sənəd kökündə sayılır — əks halda abunə
  // xanası "tək poçt xanası" kimi yenə qalib gələrdi.
  const blockedForms = new Set<Element>();
  // Bloklanma SƏBƏBLƏRİ sayılır: forma tapılmayanda status nəyin baş verdiyini deyir
  // ("2 xana giriş panelindədir" kimi). Belə olmasa istifadəçi yalnız "sahə tapılmadı" görür
  // və səbəbi tapmaq üçün heç bir ipucu qalmır.
  const skipCount = { login: 0, newsletter: 0, foreign: 0, context: 0 };

  const isBlockedField = (el: PageEl): boolean => {
    const owner = ownerForm(el);
    if (owner && blockedForms.has(owner)) { skipCount.foreign += 1; return true; }
    // Auth modalında görünən panel GİRİŞ panelidirsə ora yazmaq olmaz (forma olmasa da)
    if (inLoginPanel(el)) { skipCount.login += 1; return true; }
    // Forma olmadan qurulmuş abunə qutusu (div + input + düymə) — imza/label ilə tutulur
    if (subscribeish(sig(el))) { skipCount.newsletter += 1; return true; }
    return false;
  };

  const fieldsOf = (root: Element | Document): FieldRef[] | null => {
    if (blockedForms.has(root as Element)) return null;      // abunə/giriş/axtarış forması seçilməsin
    let all: PageEl[] = [];
    try { all = [...root.querySelectorAll("input, select, textarea")] as PageEl[]; } catch { return null; }
    const out: FieldRef[] = [];
    for (const el of all) {
      const kind = kindOf(el);
      if (kind === "skip") continue;
      // Checkbox-lar razılıq keçidində AYRICA yığılır, ona görə burada bloklama tətbiq
      // olunmur; dəyər yazılan xanalar isə yad formadan gəlməməlidir.
      if (kind !== "checkbox" && kind !== "radio" && isBlockedField(el)) continue;
      if (kind === "radio") { if (!el.disabled && visible(el)) out.push({ el, kind }); continue; }
      if (!usable(el)) continue;
      out.push({ el, kind });
    }
    return out;
  };

  // Rol → element təyinatı. Bir rol yalnız bir xanaya düşür; ikinci poçt/parol xanası
  // "təsdiq" kimi tanınır (adında təsdiq sözü olmasa da) — AMMA yalnız BİRİNCİSİNİN YANINDA
  // olduqda. Səbəb: səhifənin uzağındaki bülleten xanası da `type=email` daşıyır və "təsdiq"
  // sayılsaydı ünvan ora da yazılardı (real məlumatda məhz belə oldu: coinmarketcap.com-un
  // footer bülleten xanası modalın ünvan xanasından sonra "emailConfirm" kimi doldu).
  const nearBy = (first: PageEl, second: PageEl): boolean => containersOf(first).slice(0, 4).some((box) => {
    try { return box.contains?.(second) === true; } catch { return false; }
  });

  const assign = (fields: FieldRef[]): Map<string, FieldRef> => {
    const map = new Map<string, FieldRef>();
    for (const { el, kind } of fields) {
      if (kind === "checkbox" || kind === "radio") continue;
      let role = roleOf(el, kind);
      if (!role) continue;
      if (map.has(role)) {
        const first = (map.get(role) as FieldRef).el;
        if (role === "password" && nearBy(first, el)) role = "passwordConfirm";
        else if (role === "email" && nearBy(first, el)) role = "emailConfirm";
        else continue;
        if (map.has(role)) continue;
      }
      map.set(role, { el, kind });
    }
    return map;
  };

  const wanted = new Set(Object.keys(values).filter((key) => typeof values[key] === "string" && values[key] !== ""));
  // "confirm" rolları ayrı açar daşımır — dəyəri əsas roldan gəlir
  if (wanted.has("password")) wanted.add("passwordConfirm");
  if (wanted.has("email")) wanted.add("emailConfirm");
  if (wanted.has("phoneDigits")) wanted.add("phone");
  if (wanted.has("gender")) wanted.add("prefix");
  if (wanted.has("birthDay") || wanted.has("birthIso")) { wanted.add("birthDay"); wanted.add("birthMonth"); wanted.add("birthYear"); }
  // İkinci keçiddə (onlyEmpty) ünvan və istifadəçi adı SAYILMIR: səhifədə qalan GİRİŞ forması
  // məhz onlarla tanınır (boş ünvan xanası + `current-password`) və yanlışlıqla o seçilərdi.
  // Parol və kod isə sayılır — bəzi saytlar onları ikinci mərhələdə soruşur.
  if (onlyEmpty) for (const role of ["email", "emailConfirm", "username"]) wanted.delete(role);

  const score = (map: Map<string, FieldRef> | null, core = false): number => {
    if (!map) return -1;
    let points = 0;
    for (const [role, { el }] of map) {
      if (!wanted.has(role)) continue;
      // "Əsas bal": təsdiq xanaları sayılmır. Səbəb — sənəd kökü iki ayrı paneli birləşdirəndə
      // ikinci panelin ünvan xanası `emailConfirm` kimi sayılıb balı SÜNİ qaldırır və dar kök
      // "daha az izah edir" deyə rədd olunur (real halda məhz belə oldu). Təsdiq xanası yeni
      // məlumat deyil, ona görə köklərin müqayisəsində iştirak etmir.
      if (core && (role === "passwordConfirm" || role === "emailConfirm")) continue;
      if (onlyEmpty && String(el.value ?? "") !== "") continue;
      points += WEIGHT[role as keyof typeof WEIGHT] ?? 0.5;
    }
    return points;
  };

  // Kontekst bonusu: eyni çəkidə olan formalardan hansı daha çox "qeydiyyat"a bənzəyir.
  //   • açıq dialoq/modalın içi — istifadəçinin qarşısındaki AKTİV səth (JS ilə açılan pəncərə);
  //   • formanın düyməsi qeydiyyatdan danışır ("Create account", "Sign up");
  //   • ünvan MƏHZ qeydiyyat sözü ilə yanaşıdır.
  // Bonus kiçikdir: rolların çəkisini əvəz etmir, yalnız bərabər halları həll edir.
  const contextBonus = (root: Element | Document, map: Map<string, FieldRef> | null): number => {
    if (root === document) return 0;
    let bonus = 0;
    try {
      const dialog = (root as Element).closest?.("[role='dialog'], [aria-modal='true'], .modal");
      if (dialog && visible(dialog)) bonus += 2;
    } catch { /* seçici pozula bilər */ }
    const names = namesIn(root);
    if (names && has(names, STRONG)) bonus += 2;
    else if (names && has(names, CODE_SEND)) bonus += 1;
    if (map?.has("code")) bonus += 1;
    return bonus;
  };

  // Sənəd kökündə QEYDİYYAT KONTEKSTİ tələb olunur.
  //
  // ⚠ REAL MƏLUMATDAN ÇIXAN QAYDA: coinmarketcap.com ana səhifəsində `<form>` ÜMUMİYYƏTLƏ
  // yoxdur (diaqnostika: `"forms": []`) və səhifədə görünən bir bülleten xanası var
  // ("Enter your e-mail address"). Auth modalının giriş paneli bloklandıqda həmin bülleten
  // xanası YEGANƏ namizəd qalır və ünvan ora yazılardı — yəni ilk qüsur başqa yoldan qayıdır.
  // Ona görə sənəd kökü seçiləndə tək poçt xanası KİFAYƏT ETMİR: qeydiyyat konteksti lazımdır —
  // parol, kod, istifadəçi adı/ad xanası, razılıq xanası, qeydiyyat yazılı düymə, ya /signup.
  // `<form>` kökləri bu şərtdən azaddır: orada formanın öz növü onsuz da təsnif olunur.
  const CONTEXT_ROLES = ["password", "passwordConfirm", "code", "username",
    "firstName", "lastName", "fullName", "phone"];
  const signupContext = (map: Map<string, FieldRef> | null, fields: FieldRef[], root?: Element | Document): boolean => {
    if (CONTEXT_ROLES.some((role) => map!.has(role))) return true;
    if (fields.some(({ el, kind }) => kind === "checkbox" && isConsent(sig(el)))) return true;
    // Nişanlar KÖKÜN İÇİNDƏN oxunur, bütün sənəddən deyil: səhifənin bir yerində "Create an
    // account" düyməsi olsa, uzaqdaki bülleten qutusu onun sayəsinə "qeydiyyat" sayılardı.
    const names = namesIn(root ?? document);
    if (names && (has(names, STRONG) || has(names, CODE_SEND))) return true;
    return onSignupRoute();
  };

  // PANEL kökləri: hər xananın valideyn zənciri bir namizəd kökdür (`containersOf`).
  // Valideyn övladın balını miras alır, ona görə "ən yüksək bal" tək başına kifayət etmir —
  // maksimum bal bir neçə qatda təkrarlanır və onlardan ƏN DAXİLİ olan seçilir: o, artıq yad
  // xana daşımayan yeganə qatdır. Müqayisə `tidy` ilədir (təsdiq xanaları sayılmır, kontekst
  // bonusu sayılır — "Create an account" düyməsini əhatə edən qat üstün gəlsin), qonşu
  // (iç-içə olmayan) bərabər namizədlərdə isə sənəd sırasında birinci gələn qalır.
  const ROOT_LIMIT = 160;
  const tightest = (fields: FieldRef[], evaluate: (root: Element | Document) => Scored): Scored | null => {
    const roots: Element[] = [];
    for (const { el, kind } of fields) {
      if (kind === "checkbox" || kind === "radio") continue;   // razılıq xanası kök törətmir
      for (const box of containersOf(el)) {
        if ((box as Element | Document) === document || roots.includes(box)) continue;
        if (roots.length >= ROOT_LIMIT) break;
        roots.push(box);
      }
    }
    const scored = roots.map(evaluate)
      .filter((cand) => cand.tidy > 0 && signupContext(cand.map, cand.fields ?? [], cand.root));
    if (!scored.length) return null;
    // Tam auth paneli qonşu formaların əlavə sahələrindən üstün olmalıdır. Ən dar tam
    // panel seçilir; dərin, bölünmüş formalar üçün əvvəlki ümumi bal ehtiyatı qalır.
    const coherent = scored.filter((cand) => {
      const names = namesIn(cand.root);
      return ((cand.map as Map<string, FieldRef>).has("email") || (cand.map as Map<string, FieldRef>).has("code"))
        && (has(names, STRONG) || has(names, CODE_SEND));
    });
    // Açıq dialoq eyni formanın ayrı bloklarda yerləşən sahələrini birləşdirir.
    // İçindəki email+düymə bloku parol/profil bacı bloklarını kənarda qoymamalıdır.
    const dialogs = coherent.filter((cand) => (cand.root as Element).tagName === "DIALOG"
      || (cand.root as Element).getAttribute?.("role") === "dialog" || (cand.root as Element).getAttribute?.("aria-modal") === "true");
    if (dialogs.length) return { ...dialogs.sort((a, b) => b.tidy - a.tidy)[0], coherent: true };
    const nested = coherent.filter((cand) => !coherent.some((other) => other !== cand
      && (cand.root as Element).contains?.(other.root) === true
      && ["password", "passwordConfirm", "code"].every((role) => !(cand.map as Map<string, FieldRef>).has(role) || (other.map as Map<string, FieldRef>).has(role))));
    if (nested.length) {
      const pick = nested.sort((a, b) => b.tidy - a.tidy)[0];
      return { ...pick, coherent: true };
    }
    const top = Math.max(...scored.map((cand) => cand.tidy));
    let pick: Scored | null = null;
    for (const cand of scored) {
      if (cand.tidy !== top) continue;
      if (!pick) { pick = cand; continue; }
      try { if ((pick.root as Element).contains?.(cand.root) === true) pick = cand; } catch { /* keç */ }
    }
    return pick;
  };

  const best = (): Scored | null => {
    // Panel keşi hər keçiddə təzələnir: səhifə gözləmə müddətində dəyişə bilər (modal açılır,
    // tab dəyişir), köhnə qərar isə yanlış formanın seçilməsinə gətirərdi. Sayğaclar da
    // sıfırlanır — əks halda hər keçiddə toplanardı.
    panelCache.clear();
    skipCount.login = 0;
    skipCount.newsletter = 0;
    skipCount.foreign = 0;
    skipCount.context = 0;
    let forms: Element[] = [];
    try { forms = [...document.querySelectorAll("form")]; } catch { /* forma yoxdur */ }
    blockedForms.clear();
    for (const node of forms) if (formKind(node)) blockedForms.add(node);
    const evaluate = (root: Element | Document): Scored => {
      const fields = fieldsOf(root);
      const map = fields ? assign(fields) : null;
      const raw = score(map);
      const core = score(map, true);
      const bonus = raw > 0 ? contextBonus(root, map) : 0;
      // `points` — FORMALARIN sıralanması: `passwordConfirm` burada güclü qeydiyyat nişanıdır.
      // `tidy`   — İÇ-İÇƏ köklərin müqayisəsi: orada təsdiq xanası sayılmır, çünki iki paneli
      //            birləşdirən kök ikinci panelin ünvan xanasını "təsdiq" kimi sayıb balı süni
      //            qaldırır və dar (doğru) kökü üstələyir.
      return { root, fields, map, raw, core, points: raw > 0 ? raw + bonus : raw, tidy: core > 0 ? core + bonus : core };
    };
    const scored = forms.map(evaluate).sort((a, b) => b.points - a.points);
    if (scored[0]?.points > 0) return scored[0];
    // Formasız səhifələr də var (React modal): heç bir <form> uyğun gəlməyəndə bütün sənəd
    // işlədilir. Sənəd kökü HƏMİŞƏ formadan sonra gəlir — əks halda giriş və qeydiyyat
    // formasının xanaları birləşib "daha yaxşı" görünər və yanlış xanalar dolardı.
    const whole = evaluate(document);
    if (!(whole.points > 0)) return null;
    // Sənədin BÜTÜN xanaları bir forma DEYİL.
    //
    // ⚠ REAL MƏLUMATDAN ÇIXAN QAYDA: coinmarketcap.com-da `<form>` yoxdur, ona görə xanalar
    // sənəd kökündən yığılır — və sənəd sırasında səhifənin bülleten xanası modalın ünvan
    // xanasından ƏVVƏL gəlir. `assign` rolu birinci gələnə verdiyi üçün `email` bülletenə
    // düşürdü, modalın öz ünvan xanası isə atılırdı (parol modala, ünvan bülletenə).
    // Ona görə sənəd kökünə keçməzdən əvvəl PANEL kökləri sınanır: hər xananın valideyn
    // zənciri namizəd kökdür, ən yaxşı balı verən ƏN DAXİLİ kök seçilir.
    const tight = tightest(whole.fields ?? [], evaluate);
    // Daha dar kök yalnız sənəd kökü qədər ÇOX şey izah edirsə üstün tutulur (təsdiq xanaları
    // sayılmayan "əsas bal" müqayisə olunur). Əks halda dərin, iki qola ayrılmış səhifədə
    // (ünvan bir qolda, parol digərində, ortaq valideyn 8 səviyyədən uzaqda) yarım forma
    // seçilərdi.
    if (tight && (tight.coherent || tight.core >= whole.core)) return tight;
    // Tək poçt xanası qeydiyyat forması deyil (bax: signupContext)
    if (!signupContext(whole.map, whole.fields ?? [], document)) {
      skipCount.context += 1;
      return null;
    }
    return whole;
  };

  // --- gözləmə --------------------------------------------------------------------------
  // Səhifə hələ yüklənə bilər. Arxa plandaki tabda setTimeout boğulur, MutationObserver yox.
  const watch = <T>(find: () => T | null, limit: number): Promise<T | null> => new Promise((resolve) => {
    const now = find();
    if (now) { resolve(now); return; }
    let settled = false;
    const finish = (value: T | null): void => {
      if (settled) return;
      settled = true;
      observer.disconnect();
      clearInterval(ticker);
      clearTimeout(timer);
      resolve(value);
    };
    const check = (): void => { const hit = find(); if (hit) finish(hit); };
    const observer = new MutationObserver(check);
    observer.observe(document.documentElement ?? document, { childList: true, subtree: true, attributes: true });
    const ticker = setInterval(check, 400);
    const timer = setTimeout(() => finish(null), limit);
  });

  const found = await watch(best, timeoutMs);
  if (!found) {
    // Səbəb mümkün qədər dəqiq yazılır: "sahə tapılmadı" tək başına heç nə izah etmir
    const notes: string[] = [];
    if (skipCount.login) notes.push(`${skipCount.login} xana giriş panelindədir`);
    if (skipCount.newsletter) notes.push(`${skipCount.newsletter} xana abunə qutusundadır`);
    if (skipCount.foreign) notes.push(`${skipCount.foreign} xana yad formadadır`);
    if (skipCount.context) notes.push("yalnız tək poçt xanası var (qeydiyyat konteksti yoxdur)");
    return {
      done: false, filled: [], failed: [], checked: 0,
      reason: "formada uyğun sahə tapılmadı" + (notes.length ? ` (${notes.join(", ")})` : ""),
    };
  }
  const { root, fields, map } = found;

  const filled: string[] = [];
  const failed: string[] = [];
  const skipped: string[] = [];
  let chosen = 0;
  let checked = 0;
  let first: PageEl | null = null;

  // --- doldurma -------------------------------------------------------------------------
  // Bizim dəyərlərimiz həmişə yenilənir (köhnə cəhddən qalan ünvan qalmasın); profil
  // xanasında saytın/istifadəçinin yazdığı dəyər varsa ona TOXUNULMUR.
  const OWNED = ["email", "emailConfirm", "username", "password", "passwordConfirm", "code"];

  // Razılıq formanın yanında ola bilər (Webshare/MUI). Yalnız eyni yaxın panel:
  // başqa forma və ya formadan kənar mətn xanası görünən kimi əhatə dayandırılır.
  const consentScope = (): Element | Document => {
    if (root === document) return root;
    const dialog = (root as Element).closest?.("[role='dialog'], [aria-modal='true'], .modal");
    if (dialog) return dialog;
    let scope: Element | Document = root;
    for (let node = root.parentElement, depth = 0; node && depth < 4; node = node.parentElement, depth += 1) {
      if (STOP_TAGS.includes((node.tagName ?? "").toUpperCase())) break;
      const forms = [...node.querySelectorAll("form")];
      if (forms.some((form) => form !== root && !root.contains?.(form))) break;
      if (fieldsIn(node).some((el) => !root.contains?.(el)
        && !["checkbox", "skip"].includes(kindOf(el)))) break;
      scope = node;
    }
    return scope;
  };

  // --- razılıq, yaş və "robot deyiləm" xanaları ---------------------------------------
  // BURADA `fields` KİFAYƏT ETMİR, iki səbəbə görə:
  //   1) razılıq xanası çox vaxt <form>-un KƏNARINDA olur (React modal, footer bloku) —
  //      seçilmiş forma ilə məhdudlaşsaq işarələnmir və forma göndərilmir;
  //   2) əsl <input type="checkbox"> adətən VİZUAL OLARAQ GİZLƏDİLİR (Tailwind `sr-only`,
  //      `appearance-none`, MUI/shadcn wrapper-ləri) — `usable()` görünmə tələb etdiyi üçün
  //      `fields` onları ümumiyyətlə gətirmir. Real saytlarda ən çox rast gəlinən hal budur.
  // Ona görə xanalar BÜTÜN sənəddən yığılır və görünmə tələb olunmur; qərar isə MƏTNƏ görə
  // verilir (razılıq / yaş / "robot deyiləm" / məcburi), yəni yad xanalar toxunulmaz qalır.
  // Marketinq abunəsi məcburi deyilsə işarələnmir: istifadəçi spam istəmir.
  const consentBoxes = (): PageEl[] => {
    const out: PageEl[] = [];
    const seen = new Set<PageEl>();
    const scope = consentScope();
    const add = (el: PageEl | null | undefined): void => {
      if (!el || seen.has(el) || el.disabled) return;
      const owner = el.form ?? ownerForm(el);
      if (owner && (blockedForms.has(owner)
          || (root !== document && owner !== root && !(root as Element).contains?.(owner)))) return;
      if (root !== document && owner !== root && !(root as Element).contains?.(el)) {
        if (!scope.contains?.(el)) return;
      }
      seen.add(el);
      out.push(el);
    };
    // Sıra: əvvəl seçilmiş forma (ən dəqiq kontekst), sonra sənədin qalanı
    for (const { el, kind } of fields!) if (kind === "checkbox") add(el);
    try { for (const el of document.querySelectorAll('input[type="checkbox"]')) add(el); } catch { /* yoxdur */ }
    try {
      for (const el of document.querySelectorAll('[role="checkbox"], [role="switch"]')) add(el);
    } catch { /* yoxdur */ }
    return out;
  };

  const consentKind = (el: PageEl): string => {
    const native = (el.tagName ?? "").toUpperCase() === "INPUT";
    const t = native ? sig(el) : norm([attr(el, "aria-label"), el.id, attr(el, "data-testid"),
      attr(el, "data-test"), attr(el, "title"), labelOf(el)].filter(Boolean).join(" "));
    const near = visible(el) || (root !== document && (root as Element).contains?.(el) === true);
    const must = isRequired(el) && near;
    if (isMarketing(t)) return must ? "required" : "marketing";
    return isConsent(t) || has(t, ROBOT) || must ? "required" : "other";
  };


  if (mode !== "submit") {
    for (const [role, { el, kind }] of map!) {
      if (!wanted.has(role)) continue;
      const current = String(el.value ?? "");
      if (current !== "" && (onlyEmpty || !OWNED.includes(role))) continue;

      if (kind === "select") {
        const option = chooseOption(el, variants(role, kind).filter(Boolean));
        if (option && selectOption(el, option)) { filled.push(role); first = first ?? el; continue; }
        // Uyğun variant yoxdur (məs. siyahıda bizim ştat yoxdur). MƏCBURİ siyahı boş qalsa
        // forma ümumiyyətlə göndərilmir, ona görə ilk həqiqi variant seçilir.
        if (isRequired(el)) {
          const fallback = optionsOf(el).find(realOption);
          if (fallback && selectOption(el, fallback)) { chosen += 1; continue; }
        }
        failed.push(role);
        continue;
      }
      const value = valueFor(el, role, kind);
      if (value === null) { failed.push(role); continue; }
      if (write(el, value)) { filled.push(role); first = first ?? el; }
      else failed.push(role);
    }

    // Rolu tanınmayan, amma MƏCBURİ seçim siyahıları: "necə tapdınız", "hesab növü" və s.
    // Boş qalsa forma göndərilmir, ona görə ilk həqiqi variant seçilir.
    for (const { el, kind } of fields!) {
      if (kind !== "select") continue;
      if ([...map!.values()].some((item) => item.el === el)) continue;
      if (!isRequired(el) || String(el.value ?? "") !== "") continue;
      const option = optionsOf(el).find(realOption);
      if (option && selectOption(el, option)) chosen += 1;
    }

    for (const el of consentBoxes()) {
      if (isOn(el)) continue;
      const kind = consentKind(el);
      if (kind === "marketing") { skipped.push("marketinq"); continue; }
      if (kind !== "required") continue;
      if (setChecked(el)) checked += 1;
    }

    // Radio qrupları: cins, "18 yaşdan böyükəm", "şəxsi/korporativ hesab"
    const groups = new Map<string, PageEl[]>();
    for (const { el, kind } of fields!) {
      if (kind !== "radio") continue;
      const key = (el.name || attr(el, "aria-labelledby") || "radio") as string;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(el);
    }
    for (const [, items] of groups) {
      if (items.some((el) => el.checked)) continue;
      // Radio variantının öz mətni: əhatələyən blok BÜTÜN variantları daşıyır, ona görə
      // `box: false` (yoxsa hər variant "prefer not to say" mətnini də görər)
      const label = (el: PageEl): string => norm([el.value, attr(el, "aria-label"), labelOf(el, { box: false })].filter(Boolean).join(" "));
      const groupText = norm(items.map(label).join(" ") + " " + sig(items[0]));
      let pickEl: PageEl | null = null;
      if (has(groupText, GENDER) || items.some((el) => has(label(el), ["male", "female", "kisi", "kadin", "qadin"]))) {
        pickEl = items.find((el) => has(label(el), GENDER_NEUTRAL))
          ?? items.find((el) => has(label(el), [values.gender === "female" ? "female" : "male"]))
          ?? null;
      }
      if (!pickEl && (isConsent(groupText) || has(groupText, ROBOT))) {
        pickEl = items.find((el) => has(label(el), AFFIRM)) ?? null;
      }
      if (!pickEl) {
        if (!items.some(isRequired)) continue;
        pickEl = items.find((el) => !has(label(el), NEGATIVE)) ?? items[0];
      }
      if (pickEl && setChecked(pickEl)) checked += 1;
    }

    if (!filled.length && !checked && !chosen) {
      return {
        done: false, filled, failed, checked,
        reason: failed.length ? `xanalar dəyəri qəbul etmədi: ${failed.join(", ")}` : "doldurulacaq sahə tapılmadı",
      };
    }
    first?.scrollIntoView?.({ block: "center" });
  }

  // --- göndərmə -------------------------------------------------------------------------
  // Düymə YAZISINA görə seçilir: naməlum saytda `type="submit"` özü kifayət etmir (giriş
  // forması da submit-dir). Dərəcələr: qadağan → kod istəyi → qeydiyyat → davam/göndər → submit.
  // Söz siyahıları yuxarıdadır (formanın təsnifi də onları işlədir).
  const buttonLabel = buttonText;

  // Sənəd kökü seçilibsə (forma tapılmayıb) yalnız GÜCLÜ və KOD yazısı qəbul olunur:
  // səhifədəki hər hansı "Continue" düyməsini basmaq təhlükəlidir.
  const looseRoot = root === document;

  // Hansı mərhələdəyik? Kod ƏLİMİZDƏDİRSƏ (poçtdan gəlib, xanaya yazılıb) məqsəd onu
  // GÖNDƏRMƏKDİR — belə halda "Send code" basmaq yeni kod istəyər və əlimizdəki kod köhnələr.
  // Kod yoxdursa və poçt xanası varsa məqsəd kodu İSTƏMƏKDİR: kod düyməsi hər şeydən üstündür.
  const haveCode = typeof values.code === "string" && values.code !== "";
  const codeStage = !haveCode && (map as Map<string, FieldRef>).has("email");

  const rank = (el: PageEl): number => {
    const name = norm(buttonLabel(el));
    if (!name) return looseRoot ? 0 : (norm(el.type) === "submit" ? 1 : 0);
    if (has(name, BANNED)) return 0;
    if (has(name, CODE_SEND)) return haveCode ? 0 : (codeStage ? 4 : 2);
    if (has(name, STRONG)) return 3;
    if (looseRoot) return 0;
    if (has(name, WEAK)) return 2;
    // Yazısı tanınmayan (və ya yalnız ikondan ibarət) formanın öz submit düyməsi: son ehtimal
    return norm(el.type) === "submit" ? 1 : 0;
  };

  const enabled = (el: PageEl): boolean => !el.disabled && attr(el, "aria-disabled") !== "true";

  // Səhifədəki BÜTÜN düymələr: kod düymələri ayrıca sadalanır ki, status nəyin tapıldığını
  // desin (istifadəçi düymənin aşkarlandığını görməlidir).
  const allButtons = (): PageEl[] => {
    try {
      return [...root.querySelectorAll('button, input[type="submit"], input[type="button"], [role="button"], a[href="#"]')] as PageEl[];
    } catch { return []; }
  };

  const codeButtons = [...new Set(allButtons()
    .filter((el) => visible(el))
    .map((el) => buttonLabel(el).trim())
    .filter((name) => name && !has(norm(name), BANNED) && has(norm(name), CODE_SEND)))];

  const candidate = (): PageEl | null => {
    const scored = allButtons()
      .filter((el) => visible(el) && enabled(el))
      .map((el) => ({ el, points: rank(el) }))
      .filter((item) => item.points > 0)
      .sort((a, b) => b.points - a.points);
    return scored[0]?.el ?? null;
  };

  const result: FillFormResult = { done: true, filled, failed, checked, chosen, skipped, ...(codeButtons.length ? { codeButtons } : {}) };
  if (!(submitMs > 0)) return result;

  // Düymə yoxlamadan sonra aktivləşə bilər (React formanı yoxlayır, Turnstile token gözləyir) —
  // ona görə gözlənilir: `candidate` yalnız AKTİV düymələri sayır.
  const button = await watch(candidate, submitMs);
  if (!button) return { ...result, reason: "göndərmə düyməsi tapılmadı" };
  const name = buttonLabel(button);
  const sendsCode = has(norm(name), CODE_SEND);

  // Doldurma ayrı yeridilmədə baş verir. Framework həmin vaxt dəyəri silə,
  // dəyişə və ya sahəni yenidən qura bilər; əvvəlki "filled" hesabatı kifayət deyil.
  // Məhz klikdən əvvəl canlı sahələri, məhdudiyyətləri və razılığı yoxlayırıq.
  const invalid = (el: PageEl): boolean => el.validity?.valid === false || attr(el, "aria-invalid") === "true";
  for (const [role, { el, kind }] of map!) {
    if (sendsCode && role === "code" && !haveCode) continue;
    if (!wanted.has(role) && !isRequired(el) && !["email", "password", "passwordConfirm", "code"].includes(role)) continue;
    const current = String(el.value ?? "");
    const expected = wanted.has(role) && OWNED.includes(role) ? valueFor(el, role, kind) : undefined;
    if (el.isConnected === false || !current.trim() || invalid(el)
        || (expected !== undefined && current !== expected)) {
      return { ...result, reason: `göndərilmədi: ${role} xanası boşdur və ya dəyəri qəbul etməyib` };
    }
  }
  for (const { el, kind } of fields!) {
    if (!isRequired(el) || el.disabled || kind === "checkbox") continue;
    if (sendsCode && !haveCode && map!.get("code")?.el === el) continue;
    const radioMissing = kind === "radio" && !fields!.some((item) => item.kind === "radio"
      && item.el.name === el.name && isOn(item.el));
    if (radioMissing || invalid(el) || (kind !== "radio" && !String(el.value ?? "").trim())) {
      return { ...result, reason: "göndərilmədi: məcburi sahə boşdur və ya etibarsızdır" };
    }
  }
  if (consentBoxes().some((el) => consentKind(el) === "required" && !isOn(el))) {
    return { ...result, reason: "göndərilmədi: tələb olunan razılıq tamamlanmayıb" };
  }
  try {
    button.click!();
  } catch (e) {
    return { ...result, reason: "düymə basılmadı: " + ((e as { message?: unknown } | null | undefined)?.message ?? e) };
  }
  return { ...result, submitted: name, ...(sendsCode ? { codeRequested: true } : {}) };

};

// ===========================================================================================
// 4. DİAQNOSTİKA (səhifədə icra olunur)
// ===========================================================================================
// NİYƏ LAZIMDIR: qeydiyyat səthinin tapılması TƏXMİNDİR və səhv təxmini kənardan görmək mümkün
// deyil — istifadəçi yalnız "işləmədi" görür, kod isə hansı elementi niyə seçdiyini demir.
// Bu funksiya səhifəni OLDUĞU KİMİ təsvir edir: hansı xanalar var, hansı klikləniləsi mətnlər
// var, valideyn zənciri necədir, `<form>`/`role` nişanları varmı. Nəticə clipboard-a düşür,
// yəni bir kliklə paylaşıla bilir və düzəliş təxminlə deyil, FAKTLA aparılır.
//
// Heç nə dəyişdirmir: yalnız oxuyur.
export const describePageInPage = (): PageReport => {
  const norm = (value: unknown): string => String(value ?? "").toLowerCase().replace(/\s+/g, " ").trim();
  const visible = (el: PageEl | null | undefined): boolean => !!(el && (el.offsetParent || el.offsetWidth || el.offsetHeight));
  const attr = (el: PageEl | null | undefined, name: string): string | null => el?.getAttribute?.(name) ?? null;
  const cut = (value: unknown, max = 60): string => {
    const text = String(value ?? "").replace(/\s+/g, " ").trim();
    return text.length > max ? text.slice(0, max) + "…" : text;
  };
  // Valideyn zənciri: paneli tapan məntiq məhz bunu gəzir, ona görə hesabatda da budur
  const chain = (el: PageEl | null | undefined, depth = 12): string => {
    const out: string[] = [];
    let node: PageEl | null = el?.parentElement ?? null;
    for (let i = 0; i < depth && node; i += 1) {
      const tag = (node.tagName ?? "?").toLowerCase();
      const role = attr(node, "role");
      const cls = String(node.className ?? "").trim().split(/\s+/)[0] ?? "";
      out.push(tag + (role ? `[${role}]` : "") + (cls ? "." + cut(cls, 18) : ""));
      node = node.parentElement;
    }
    return out.join(" < ");
  };

  const report: PageReport = { url: "", title: "", forms: [], fields: [], clickables: [], note: [] };
  try { report.url = location.href; } catch { report.note.push("location oxunmadı"); }
  try { report.title = cut(document.title, 80); } catch { /* yoxdur */ }

  try {
    report.forms = [...document.querySelectorAll("form")].slice(0, 10).map((el) => ({
      action: cut(attr(el, "action"), 80),
      role: attr(el, "role"),
      fields: el.querySelectorAll("input, select, textarea").length,
      buttons: cut([...el.querySelectorAll('button, input[type="submit"], [role="button"]')]
        .map((b: PageEl) => norm(b.textContent || b.value || attr(b, "aria-label"))).filter(Boolean).join(" | "), 120),
    }));
  } catch { report.note.push("formalar oxunmadı"); }

  try {
    report.fields = [...document.querySelectorAll("input, select, textarea")]
      .filter((el: PageEl) => !["hidden", "submit", "button", "reset", "image"].includes(norm(el.type)))
      .slice(0, 30)
      .map((el: PageEl) => ({
        tag: (el.tagName ?? "").toLowerCase(),
        type: norm(el.type),
        visible: visible(el),
        name: cut(el.name, 30),
        id: cut(el.id, 30),
        autocomplete: attr(el, "autocomplete"),
        placeholder: cut(el.placeholder, 40),
        aria: cut(attr(el, "aria-label"), 40),
        inForm: Boolean(el.closest?.("form")),
        chain: chain(el),
      }));
  } catch { report.note.push("xanalar oxunmadı"); }

  // Klikləniləsi namizədlər: DÜYMƏ OLMAYANLAR da (mətn bloku olan tablar) — məsələ məhz budur.
  // Elementin ÖZ mətni oxunur: bəzəkli tab (`<div>Sign Up<div class="underline"/></div>`) də düşür.
  const ownText = (el: PageEl): string => {
    let out = "";
    try {
      for (const node of el.childNodes ?? []) {
        if (node.nodeType === 3) out += node.nodeValue ?? "";
      }
    } catch { return ""; }
    return out.replace(/\s+/g, " ").trim();
  };
  const WORDS = /sign ?-?up|signup|register|log ?-?in|login|sign ?-?in|create (an )?account|continue with|forgot|remember me|qeydiyyat|kaydol|üye ol|регистрация|войти/i;
  try {
    const all: PageEl[] = [...document.querySelectorAll("*")];
    report.note.push(`sənəddə ${all.length} element`);
    for (const el of all) {
      if (report.clickables.length >= 40) break;
      const text = ownText(el);
      if (!text || text.length > 40 || !WORDS.test(text)) continue;
      report.clickables.push({
        tag: (el.tagName ?? "").toLowerCase(),
        role: attr(el, "role"),
        text: cut(text, 40),
        href: cut(attr(el, "href"), 60),
        visible: visible(el),
        kids: el.children?.length ?? 0,
        ariaSelected: attr(el, "aria-selected"),
        dataState: attr(el, "data-state"),
        cls: cut(String(el.className ?? "").trim().split(/\s+/)[0] ?? "", 24),
        chain: chain(el, 8),
      });
    }
  } catch { report.note.push("klikləniləsi elementlər oxunmadı"); }

  return report;
};

// ===========================================================================================
// 3. WORKER TƏRƏFİ
// ===========================================================================================

const NO_ACCESS = /Cannot access contents|permission to access|Missing host permission|extensions? gallery/i;
const ACCESS_HINT = "sayta giriş icazəsi yoxdur (extension ikonuna basıb Başlat düyməsini yenidən işlət)";
// Skriptin cavabına verilən əlavə möhlət: səhifə funksiyası öz limitini bitirəndən sonra
// cavabın gəlməsi üçün bu qədər gözlənilir.
const ANSWER_GRACE_MS = 4000;

// Skripti relay tabında icra edir. Nəticə həmişə obyektdir; icazə xətası `blocked`, cavabsızlıq
// `timeout` nişanı alır.
//
// `frameIds` / `allFrames` — bəzi saytlar qeydiyyat formasını IFRAME-də verir (hostlanmış auth
// widget-i). Əsas frame-də forma tapılmasa bütün frame-lərə yeridilir və `pick` ilə DOLDURMAĞI
// BACARAN frame seçilir; göndərmə də həmin frame-də aparılır (`frameId` qaytarılır).
// `activeTab` eyni origin-ə giriş verir. Geniş host icazəsi varsa eyni sayta və tanınmış
// hesab ailəsinə aid frame-lər də yoxlanır; yad saytın frame-inə dəyər göndərilmir.
//
// NİYƏ VAXT LİMİTİ VAR: klik (məs. "Sign up" linki və ya "Create account") naviqasiyaya səbəb
// olanda səhifənin sənədi ölür və `executeScript` promise-i HEÇ VAXT yekunlaşmır — nə nəticə,
// nə xəta. Limitsiz halda worker növbəsi əbədi kilidlənir (real brauzer yoxlamasında məhz bu
// oldu: link basılırdı, forma isə boş qalırdı). Limit bitəndə bu, "səhifə keçid etdi" kimi
// yozulur — çağıran tərəf tabın sakitləşməsini gözləyib davam edir.
async function run<T>(
  session: Session | null | undefined,
  func: (...args: never[]) => T | Promise<T>,
  args: unknown[],
  limitMs: number,
  {
    frameIds = null, documentId = null, origin = null, allFrames = false, pick = null, watchNavigation = false,
  }: RunOptions = {},
): Promise<RunOutcome<T>> {
  if (!session?.relayTabId) return { error: "relay tabı yoxdur" };
  // Sessiya bu arada dəyişibsə (Dayandır / yeni Başlat) başqasının tabına toxunmuruq
  if (!await isLiveSession(session)) return { error: "sessiya dəyişdi" };
  let expectedSite: URL | null = null;
  let allowedOrigin: string | null = null;
  const trustedOrigins = new Map<string, string>();
  const sameSite = (candidate: string): boolean => {
    try {
      const url = new URL(candidate);
      const family = identityFamily((expectedSite as URL).hostname);
      return ["http:", "https:"].includes(url.protocol)
        && (registrableDomain(url.hostname) === registrableDomain((expectedSite as URL).hostname)
          || (family != null && identityFamily(url.hostname)?.id === family.id))
        && (!isLocalHost((expectedSite as URL).hostname) || url.origin === (expectedSite as URL).origin);
    } catch { return false; }
  };
  if (session.relaySite) {
    const tab = await getTab(session.relayTabId);
    try {
      expectedSite = new URL(session.relaySite);
      const current = new URL(tab?.url as string);
      if (!sameSite(current.href)) {
        return { error: "tab başqa sayta keçib — yeni saytda Başlat düyməsini işlədin", blocked: true };
      }
      allowedOrigin = current.origin;
      if (documentId && origin) {
        if (!sameSite(origin)) return { error: "frame başqa sayta aiddir", blocked: true };
        allowedOrigin = origin;
      }
    } catch { return { error: "relay tabı tapılmadı", blocked: true }; }
    args = [args[0], { ...(args[1] as Record<string, unknown>), allowedOrigin }];
    if (!await isLiveSession(session)) return { error: "sessiya dəyişdi" };
  }

  const beat = setInterval(() => { chrome.runtime.getPlatformInfo().catch(() => {}); }, KEEPALIVE_MS);
  let timer: ReturnType<typeof setTimeout> | null = null;
  let previousDocument: DocumentState | null = null;
  const navigationController = new AbortController();
  try {
    const target: { tabId: number; documentIds?: string[]; frameIds?: number[]; allFrames?: boolean } =
      { tabId: session.relayTabId };
    if (documentId) target.documentIds = [documentId];
    else if (allFrames && expectedSite) {
      // Əvvəl yalnız origin oxunur; dəyərlər ancaq yoxlanmış sənədlərə göndərilir.
      const frames = await Promise.race([
        chrome.scripting.executeScript({ target: { tabId: session.relayTabId, allFrames: true },
          func: function frameOrigin() { return location.origin; }, injectImmediately: true }),
        new Promise<never[]>((resolve) => { timer = setTimeout(() => resolve([]), limitMs); }),
      ]);
      clearTimeout(timer!);
      for (const frame of frames ?? []) {
        if (frame.documentId && sameSite(frame.result as string)) trustedOrigins.set(frame.documentId, frame.result as string);
      }
      if (!trustedOrigins.size) return { error: "eyni sayta aid əlçatan frame tapılmadı" };
      if (!await isLiveSession(session)) return { error: "sessiya dəyişdi" };
      target.documentIds = [...trustedOrigins.keys()];
      args = [args[0], { ...(args[1] as Record<string, unknown>), allowedOrigins: [...new Set(trustedOrigins.values())] }];
    } else if (allFrames) target.allFrames = true;
    else if (frameIds?.length) target.frameIds = frameIds;
    // Yeni sənəd interactive olanda davam et: üçüncü tərəf iframe-inin
    // complete hadisəsini gözləmək görünən formanı 10–15 saniyə boş saxlayırdı.
    if (watchNavigation) previousDocument = await readDocument(session.relayTabId, Math.min(500, limitMs));
    const navigated: Promise<string> = previousDocument ? waitForDocument(session.relayTabId, {
      previousDocumentId: previousDocument.documentId, timeoutMs: limitMs, signal: navigationController.signal,
    }).then((state) => (state ? "navigated" : new Promise<string>(() => {}))) : new Promise<string>(() => {});
    const injected = chrome.scripting.executeScript({
      target: target as chrome.scripting.InjectionTarget,
      func,
      args: args as never[],
      injectImmediately: true,     // hazır forma şəkil/widget-lərin document_idle vaxtını gözləməsin
      world: "MAIN",              // saytın öz React nümunəsi ilə eyni dünyada olmalıyıq
    });
    const guard = new Promise<string>((resolve) => { timer = setTimeout(() => resolve("timeout"), limitMs); });
    const outcome = await Promise.race([injected, guard, navigated]);
    if (outcome === "navigated") return { navigated: true };
    if (outcome === "timeout") return { timeout: true, error: "səhifə cavab vermədi (keçid ola bilər)", previousDocument };
    const frames = (Array.isArray(outcome) ? outcome : [])
      .filter((item): item is { result: T; frameId: number; documentId: string } => {
        const candidate = item as { result?: unknown } | null | undefined;
        return !!candidate && !!candidate.result && typeof candidate.result === "object";
      });
    if (!frames.length) return { error: "səhifə cavab qaytarmadı", previousDocument };
    const chosen = pick ? frames.find(pick) : frames[0];
    if (!chosen) return { error: "səhifə cavab qaytarmadı" };
    return { result: chosen.result as T, frameId: chosen.frameId ?? 0, documentId: chosen.documentId ?? null,
      origin: trustedOrigins.get(chosen.documentId as string) ?? allowedOrigin };
  } catch (e) {
    const text = (e as { message?: unknown })?.message ?? String(e);
    // Naməlum sayta yazmaq icazə tələb edir. `activeTab` icazəsi extension ikonuna basanda
    // verilir və tab başqa ORIGIN-ə keçənə qədər qalır; ona görə bu xəta əsasən tab bu arada
    // başqa sayta keçəndə çıxır. İstifadəçi nə edəcəyini bilməlidir → `blocked`.
    if (NO_ACCESS.test(text as string)) return { error: ACCESS_HINT, blocked: true };
    return { error: text as string, previousDocument };
  } finally {
    clearInterval(beat);
    if (timer !== null) clearTimeout(timer);
    navigationController.abort();
  }
}

// Qeydiyyat formasını açır (lazımsa) və ya qeydiyyat SƏHİFƏSİNƏ keçir.
// Nəticə: { already } | { opened, navigated } | { navigatedTo, opened?, ready } |
//         { none } | { error, blocked? }.
//
// Klik NAVİQASİYAYA səbəb ola bilər — o zaman cavab gəlmir (bax: run → timeout). Bu, XƏTA
// deyil: tabın sakitləşməsi gözlənilir və doldurma YENİ səhifədə aparılır.
//
// KEÇİD: səhifə funksiyası basılası element tapmasa `{ navigate: url }` qaytarır. Ünvan YALNIZ
// səhifənin öz `href`-lərindən gəlir — standart yol TƏXMİN EDİLMİR (əvvəllər edilirdi və
// coinmarketcap.com-da mövcud olmayan `/signup` açıldı). Keçid yalnız eyni origin-ə olur:
// fərqli origin `activeTab` icazəsini itirərdi.
export async function openSignup(
  session: Session | null | undefined,
  { timeoutMs = OPEN_TIMEOUT_MS, graceMs = ANSWER_GRACE_MS, allowNavigate = true }: OpenSignupWorkerOptions = {},
): Promise<OpenSignupResult> {
  const attempt = (navigate: boolean): Promise<RunOutcome<OpenSignupPageResult>> =>
    run(session, openSignupInPage, [timeoutMs, { navigate }], timeoutMs + graceMs, { watchNavigation: true });
  const before = await getTab(session?.relayTabId);
  const { result, error, blocked, timeout, previousDocument, documentId,
    navigated: completedNavigation } = await attempt(allowNavigate);
  if (completedNavigation) return { opened: null, navigated: true };
  if (blocked) return { error, blocked };
  if (!error && result!.already) return result!;
  if (!error && result!.ready) {
    const after = await getTab(session?.relayTabId);
    return { ...result!, navigated: Boolean(after && before && after.url !== before.url) };
  }
  if (!error && result!.none) return result!;

  // Qeydiyyat ünvanı bilinir → tab ora aparılır və axtarış BİR DƏFƏ təkrarlanır.
  // İkinci cəhddə naviqasiya QADAĞANDIR: əks halda səhifələr arasında dövrə yarana bilər.
  if (!error && result!.navigate) {
    const url = result!.navigate;
    if (!await isLiveSession(session)) return { error: "sessiya dəyişdi" };
    try {
      await chrome.tabs.update(session!.relayTabId as number, { url });
    } catch (e) {
      return { error: `qeydiyyat səhifəsi açılmadı (${url}): ${(e as { message?: unknown })?.message ?? e}` };
    }
    await waitForDocument(session!.relayTabId, { previousDocumentId: documentId, url, timeoutMs: NAVIGATE_TIMEOUT_MS });
    if (!await isLiveSession(session)) return { navigatedTo: url, ready: false };
    const second = await attempt(false);
    if (second.navigated) return { navigatedTo: url, navigated: true, ready: false };
    if (second.blocked) return { error: second.error, blocked: true, navigatedTo: url };
    const ready = !second.error && (second.result!.already === true || second.result!.ready === true);
    const opened = !second.error && second.result!.opened ? second.result!.opened : null;
    return { navigatedTo: url, ready, ...(opened ? { opened } : {}) };
  }

  const current = await getTab(session?.relayTabId);
  const changing = current?.status === "loading" || current?.url !== before?.url;
  if (changing || timeout) {
    await waitForDocument(session?.relayTabId, {
      previousDocumentId: (previousDocument as DocumentState | null | undefined)?.documentId,
      url: current?.url,
      timeoutMs: changing ? NAVIGATE_TIMEOUT_MS : 200,
    });
  }
  const after = await getTab(session?.relayTabId);
  const navigated = Boolean(after && before && after.url !== before.url);

  if (error) return navigated || timeout ? { opened: null, navigated: true } : { error };
  if (result!.opened) return { opened: result!.opened, navigated };
  return result as OpenSignupResult;
}

// Naməlum saytın formasını doldurur (və istənilibsə göndərir).
// Nəticə: { done, filled, checked, chosen, submitted?, navigated?, reason?, blocked? } — heç vaxt
// throw etmir, çünki kodun/ünvanın çatdırılması bundan asılı olmamalıdır.
//
// İki AYRI yeridilmə var: əvvəl doldurma, sonra düymənin basılması. Səbəb — düymə səhifəni
// dəyişə bilər və o halda cavab gəlmir; ayrı olduqları üçün doldurmanın nəticəsi HƏR HALDA
// bilinir (nə doldu, nə işarələndi), göndərmə isə "keçid etdi" kimi yozulur.
export async function fillForm(
  session: Session | null | undefined,
  values: Record<string, string | null | undefined>,
  { timeoutMs = FIND_TIMEOUT_MS, submit = true, submitMs = SUBMIT_TIMEOUT_MS, graceMs = ANSWER_GRACE_MS,
    onlyEmpty = false }: FillFormOptions = {},
): Promise<FillFormResult> {
  const ready = Object.fromEntries(Object.entries(values ?? {}).filter(([, v]) => typeof v === "string" && v !== ""));
  if (!Object.keys(ready).length) return { done: false, filled: [], checked: 0, reason: "yazılacaq dəyər yoxdur" };

  const fillArgs = [ready, { timeoutMs, mode: "fill", onlyEmpty }];
  let filling = await run(session, fillFormInPage, fillArgs, timeoutMs + graceMs);
  let frameId = filling.frameId ?? 0;

  // Əsas frame-də forma tapılmadı → BÜTÜN frame-lər sınanır: bəzi saytlar qeydiyyatı eyni
  // origin-li iframe-də verir. Doldurmağı bacaran frame seçilir və göndərmə də orada aparılır.
  if (!filling.error && filling.result!.done !== true) {
    const wide = await run(session, fillFormInPage, fillArgs, timeoutMs + graceMs, {
      allFrames: true,
      pick: (item) => (item as { result?: { done?: unknown } | null }).result?.done === true,
    });
    if (!wide.error) {
      filling = wide;
      frameId = wide.frameId ?? 0;
    }
  }

  if (filling.error) {
    return {
      done: false, filled: [], checked: 0, reason: filling.error,
      ...(filling.blocked ? { blocked: true } : {}),
    };
  }
  const result = filling.result as FillFormResult;
  if (submit !== true || !result.done) return result;

  const clicking = await run(session, fillFormInPage, [ready, { timeoutMs: 1500, submitMs, mode: "submit" }],
    submitMs + graceMs, filling.documentId ? { documentId: filling.documentId, origin: filling.origin } : frameId ? { frameIds: [frameId] } : {});
  if (clicking.timeout) {
    // Cavab gəlmədi: düymə basılıb və səhifə keçid edib (klik olmadan bu baş vermir)
    await settleTab(session?.relayTabId);
    return { ...result, navigated: true };
  }
  if (clicking.error) return { ...result, reason: clicking.error };
  const { submitted, reason, codeRequested, codeButtons } = clicking.result as FillFormResult;
  return {
    ...result,
    ...(codeButtons ? { codeButtons } : {}),
    ...(submitted ? { submitted } : {}),
    ...(codeRequested ? { codeRequested: true } : {}),
    ...(reason ? { reason } : {}),
  };
}

// Sessiyadaki profil → səhifəyə göndərilən dəyərlər. Ünvan, istifadəçi adı və parol sessiyanın
// öz sahələrindən gəlir (profil onları təkrarlasa da, sessiya həqiqət mənbəyidir).
// Funksiya sessiyanın yalnız bu sahələrini oxuyur, ona görə parametr minimal strukturdur.
export interface SignupValuesSession {
  address?: unknown;
  username?: unknown;
  password?: unknown;
  identity?: unknown;
}
export const signupValues = (
  session: SignupValuesSession | null | undefined,
  extra: Record<string, string> = {},
): Record<string, string> => ({
  ...((session?.identity ?? {}) as Record<string, string>),
  email: (session?.address ?? (session?.identity as Record<string, string> | undefined)?.email ?? "") as string,
  username: (session?.username ?? (session?.identity as Record<string, string> | undefined)?.username ?? "") as string,
  password: (session?.password ?? (session?.identity as Record<string, string> | undefined)?.password ?? "") as string,
  ...extra,
});

// Diaqnostika: verilmiş tabın səhifəsini təsvir edir. SESSİYADAN ASILI DEYİL — istifadəçi
// istənilən vaxt basa bilər, ona görə `run()` işlədilmir (o, sessiya yoxlayır).
// Nəticə obyektdir; icazə yoxsa aydın xəta qaytarılır.
export async function describePage(tabId: number | null | undefined): Promise<PageReport> {
  if (!Number.isInteger(tabId)) throw new ExpectedError("tab seçilməyib");
  let injected: chrome.scripting.InjectionResult[] | null = null;
  try {
    injected = await chrome.scripting.executeScript({
      target: { tabId: tabId as number },
      func: describePageInPage,
      world: "MAIN",
    });
  } catch (e) {
    const text = (e as { message?: unknown })?.message ?? String(e);
    throw new ExpectedError(NO_ACCESS.test(text as string) ? ACCESS_HINT : (text as string));
  }
  const report = injected?.[0]?.result;
  if (!report || typeof report !== "object") throw new ExpectedError("səhifə cavab qaytarmadı");
  return report as PageReport;
}

// --- statusdaki mətn ----------------------------------------------------------------------
const LABELS: Record<string, string> = Object.freeze({
  email: "ünvan", emailConfirm: "ünvan təsdiqi", username: "istifadəçi adı",
  password: "parol", passwordConfirm: "parol təsdiqi", code: "kod",
  firstName: "ad", lastName: "soyad", middleName: "ata adı", fullName: "tam ad",
  phone: "telefon", phoneCountryCode: "ölkə kodu", street: "ünvan sətri", street2: "mənzil",
  city: "şəhər", state: "ştat", postal: "poçt indeksi", country: "ölkə",
  birthIso: "doğum tarixi", birthDay: "doğum günü", birthMonth: "doğum ayı", birthYear: "doğum ili",
  age: "yaş", gender: "cins", prefix: "müraciət", company: "şirkət", jobTitle: "vəzifə",
  website: "sayt", bio: "haqqında",
});

export const filledNote = (filled: string[] = []): string => filled.map((role) => LABELS[role] ?? role).join(" + ");

// Doldurma nəticəsinin statusdaki quyruğu: nə doldu, nə işarələndi, hansı düymə basıldı.
// Sahə çoxdursa ad-ad sadalanmır (status sətri bir neçə sətrə keçərdi) — sayı yazılır.
// fillNote-un nəticədən oxuduğu minimal forma (qismən obyektlər də qəbul edilir).
export interface FillNoteInput {
  filled?: string[];
  checked?: number;
  chosen?: number;
  submitted?: string | null;
  navigated?: boolean;
  reason?: string;
  codeButtons?: string[];
  codeRequested?: boolean;
}
export function fillNote(result?: FillNoteInput | null): string {
  const parts: string[] = [];
  const filled = result?.filled ?? [];
  if (filled.length > 5) parts.push(`${filled.length} xana dolduruldu`);
  else if (filled.length) parts.push(filledNote(filled));
  if (result?.chosen) parts.push(`${result.chosen} seçim`);
  if (result?.checked) parts.push(`${result.checked} razılıq xanası`);
  // Kod düymələri aşkarlanıbsa deyilir: istifadəçi hansının basıldığını və hansıların
  // səhifədə olduğunu görməlidir (basılan ilk sırada gəlir).
  const codeButtons = result?.codeButtons ?? [];
  if (result?.codeRequested) parts.push(`kod istənildi: "${result.submitted}"`);
  else if (result?.submitted) parts.push(`"${result.submitted}" basıldı`);
  else if (result?.navigated) parts.push("göndərildi (səhifə keçid etdi)");
  else if (result?.reason) parts.push(result.reason);
  if (codeButtons.length && !result?.codeRequested) {
    parts.push(`kod düyməsi: ${codeButtons.slice(0, 2).map((name) => `"${name}"`).join(", ")}`);
  }
  return parts.join(", ");
}
