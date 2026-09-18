// Naməlum saytda qeydiyyatın avtomatlaşdırılması (background/forms.ts).
//
// Bu, saytdan asılı olmayan TƏXMİNDİR: sahələr `type`, `autocomplete`, `name`, `id`,
// `placeholder`, `aria-label` və LABEL mətninə görə tanınır. Səhv təxmin iki cür ziyan verir:
// ya yanlış xanaya yazır (promo kodu yerinə aktivasiya kodu), ya da heç nə tapmır. Üstəlik
// modul artıq düymə də basır — yanlış düymə (giriş, ödəniş, silmə) fəlakət olardı.
// Ona görə hər qayda burada yoxlanılır.
import { describe, expect, it } from "vitest";

import {
  describePage, describePageInPage,
  fillForm, fillFormInPage, fillNote, filledNote, FIND_TIMEOUT_MS, openSignup, openSignupInPage,
  signupValues, SUBMIT_TIMEOUT_MS,
} from "../src/background/forms";
import type { OpenSignupResult } from "../src/background/forms";

describe("audit: qeydiyyatın düzgün sahə və konteynerlə məhdudlaşması", () => {
  function webshareForm() : any {
    const email = input({ type: "email", ac: "current-email", id: "email-input" });
    const password = input({ type: "password", ac: "current-password" });
    const go = button({ text: "Sign Up With Email" });
    const terms = check();
    const label = box("LABEL", [terms, textNode("I agree to the Terms of Service and Privacy Policy")]);
    const signup = box("FORM", [textNode("Get Started For Free"),
      box("DIV", [email]), box("DIV", [password]), go,
      button({ text: "Sign in", tag: "A", href: "/login" })]);
    Object.assign(signup, { fields: [email, password], buttons: [go], customs: [] });
    box("DIV", [box("DIV", [signup]), box("DIV", [label])]);
    return { email, password, go, terms, signup,
      dom: { forms: [signup], loose: [terms], url: "https://dashboard.webshare.io/register" } };
  }

  it("Webshare: current-password olan qeydiyyat artıq açıqdır, submit basılmır", async () => {
    const { dom, go } = webshareForm();
    const result = await inPage(dom, () => openSignupInPage(30, { navigate: false }));
    expect(result).toStrictEqual({ already: true });
    expect(go.clicked).not.toBe(true);
  });

  it("Webshare: email, current-password və formadan kənar yaxın razılıq doldurulur", async () => {
    const { dom, email, password, terms, go } = webshareForm();
    const result = await fill(dom, { email: VALUES.email, password: VALUES.password });
    expect(email.value).toBe(VALUES.email);
    expect(password.value).toBe(VALUES.password);
    expect(terms.checked).toBe(true);
    expect(result.checked).toBe(1);
    expect(go.clicked).not.toBe(true);
  });

  it("Webshare: razılıq gözləyən deaktiv submit də qeydiyyat nişanıdır", async () => {
    const { dom, email, password, terms, go } = webshareForm();
    go.disabled = true;
    const open = await inPage(dom, () => openSignupInPage(30, { navigate: false }));
    expect(open).toStrictEqual({ already: true });
    await fill(dom, { email: VALUES.email, password: VALUES.password });
    expect(email.value).toBe(VALUES.email);
    expect(password.value).toBe(VALUES.password);
    expect(terms.checked).toBe(true);
  });

  it("Webshare: göndərmə yalnız hər iki sahə və razılıq hazır olduqda işləyir", async () => {
    const { dom, email, password, terms, go } = webshareForm();
    let atClick;
    go.click = () => { atClick = [email.value, password.value, terms.checked]; };
    const result = await fill(dom, { email: VALUES.email, password: VALUES.password }, true);
    expect(atClick).toStrictEqual([VALUES.email, VALUES.password, true]);
    expect(result.submitted).toBe("sign up with email");
    expect(result.codeRequested, "bu, kod istəmə düyməsi deyil").toBe(undefined);
  });

  it("Webshare: submit keçidi işarələnməmiş xarici razılığı keçmir", async () => {
    const { dom, email, password, go } = webshareForm();
    email.value = VALUES.email;
    password.value = VALUES.password;
    const result = await inPage(dom, () : any => fillFormInPage(VALUES,
      { timeoutMs: 30, submitMs: 30, mode: "submit" }));
    expect(go.clicked).not.toBe(true);
    expect(result.reason).toMatch(/razılıq/);
  });

  it("səhv təsnif olunmuş qeydiyyatın submit düyməsi açılış namizədi deyil", async () => {
    const password = input({ type: "password", ac: "current-password" });
    const go = button({ text: "Sign Up With Email" });
    go.getAttribute = (key: any) => key === "role" ? "tab" : null;
    // Sosial metod düyməsi də daxil olmaqla yanlış panel açıq sayılmamalıdır.
    const owner: any = form([password], [go]);
    await inPage({ forms: [owner] }, () => openSignupInPage(30, { navigate: false }));
    expect(go.clicked).not.toBe(true);
  });

  it("submit daxilindəki mətn bloku açılış yoxlamasını keçə bilmir", async () => {
    const password = input({ type: "password", ac: "current-password" });
    const go = button({ text: "Sign Up With Email" });
    go.getAttribute = (key: any) => key === "role" ? "tab" : null;
    const caption = textNode("Sign Up With Email", () => { go.clicked = true; });
    go.children = go.childNodes = [caption];
    caption.parentElement = go;
    caption.closest = (selector: any) => climb(caption, selector);
    const root = box("FORM", [password, go]);
    Object.assign(root, { fields: [password], buttons: [go], customs: [] });
    await inPage({ forms: [root] }, () => openSignupInPage(30, { navigate: false }));
    expect(go.clicked).not.toBe(true);
    expect(caption.clicked).not.toBe(true);
  });

  it("type=button giriş düyməsi də boş parollu formanı göndərmir", async () => {
    const go = button({ text: "Log in", type: "button" });
    const root: any = form([input({ type: "password", ac: "current-password" })], [go]);
    await inPage({ forms: [root] }, () => openSignupInPage(30, { navigate: false }));
    expect(go.clicked).not.toBe(true);
  });

  it("ortaq qutuda başqa forma varsa onun xaricindəki razılıq götürülmür", async () => {
    const { dom, signup, terms } = webshareForm();
    const other = box("FORM", [input({ type: "email" })]);
    Object.assign(other, { fields: other.querySelectorAll(FIELD_SELECTOR), buttons: [], customs: [] });
    box("DIV", [signup, other, terms]);
    await fill({ ...dom, forms: [signup, other] });
    expect(terms.checked).toBe(false);
  });

  it("eyni dialoqda email düyməsindən ayrı yerləşən parol da doldurulur", async () => {
    const email = input({ type: "email" });
    const password = input({ type: "password", ac: "new-password" });
    const modal = box("DIV", [box("DIV", [email, button({ text: "Get started" })]), box("DIV", [password])], { role: "dialog" });
    await fill({ loose: modal.querySelectorAll(FIELD_SELECTOR), looseButtons: modal.querySelectorAll("button") },
      { email: VALUES.email, password: VALUES.password });
    expect(email.value).toBe(VALUES.email);
    expect(password.value).toBe(VALUES.password);
  });
  it("Send code yanındakı email xanası kod xanası sayılmır", async () => {
    const email = input({ type: "email", name: "email" });
    const send = button({ text: "Send code" });
    const root = box("FORM", [box("DIV", [email, send])]);
    Object.assign(root, { fields: [email], buttons: [send], customs: [] });
    await fill({ forms: [root] }, { email: VALUES.email });
    expect(email.value).toBe(VALUES.email);
  });

  it("başqa formanın gizli razılıq xanasına toxunmur", async () => {
    const other = check({ boxText: "I accept the Terms of Service", visible: false });
    const signup: any = form([input({ type: "email" }), input({ type: "password", ac: "new-password" })]);
    const contact: any = form([textarea({ name: "message" }), other], [button({ text: "Send message" })]);
    await fill({ forms: [signup, contact] }, { email: VALUES.email, password: VALUES.password });
    expect(other.checked).toBe(false);
  });

  it("qeydiyyat dialoqu səhifənin əlaqəsiz email/telefon sahələrindən üstündür", async () => {
    const pageMail = input({ type: "email" }), phone = input({ name: "phone" });
    const email = input({ type: "email" });
    const modal = box("DIV", [email, input({ type: "password", ac: "new-password" }), button({ text: "Create account" })], { role: "dialog" });
    const page = box("DIV", [box("DIV", [pageMail, phone]), modal]);
    await fill({ loose: page.querySelectorAll(FIELD_SELECTOR), looseButtons: page.querySelectorAll("button") },
      { email: VALUES.email, password: VALUES.password, phone: VALUES.phone });
    expect(email.value).toBe(VALUES.email);
    expect(pageMail.value).toBe("");
    expect(phone.value).toBe("");
  });

  it("gözləmə vaxtı login paneli signup-a çevriləndə yenidən qiymətləndirir", async () => {
    const email = input({ type: "email" });
    const fields = [email, input({ type: "password", ac: "current-password" })];
    const buttons = [button({ text: "Log in" })];
    const panel: any = form(fields, buttons);
    await inPage({ forms: [panel] }, async () => {
      const timer = setTimeout(() => {
        const pass = input({ type: "password", ac: "new-password" });
        const create = button({ text: "Create account" });
        pass._form = create._form = panel;
        fields.splice(1, 1, pass);
        buttons.splice(0, 1, create);
      }, 5);
      try { await fillFormInPage({ email: VALUES.email, password: VALUES.password }, { timeoutMs: 450 }); }
      finally { clearTimeout(timer); }
    });
    expect(email.value).toBe(VALUES.email);
  });
});

// --- saxta DOM -----------------------------------------------------------------------------
// Səhifə funksiyaları həqiqi DOM API-sinin kiçik bir hissəsini işlədir: querySelectorAll,
// getAttribute, closest, offset*, dispatchEvent, click. Hamısı burada təqlid olunur.
function base({ type = "text", name = "", id = "", ac = null, label = null, ph = "", title = null,
  testId = null, boxText = null, maxLength = -1, minLength = -1, pattern = null, required = false,
  disabled = false, readOnly = false, visible = true, value = "" }: any = {}) {
  const el: any = {
    tagName: "INPUT", type, name, id, placeholder: ph, maxLength, minLength, required,
    disabled, readOnly, events: [], _value: String(value),
    childNodes: [],                       // xanada mətn qovşağı olmur (ownText → "")
    offsetParent: visible ? {} : null, offsetWidth: visible ? 200 : 0, offsetHeight: visible ? 30 : 0,
    getAttribute(key: any) {
      if (key === "autocomplete") return ac;
      if (key === "aria-label") return label;
      if (key === "title") return title;
      if (key === "data-testid") return testId;
      if (key === "pattern") return pattern;
      if (key === "aria-required") return required ? "true" : null;
      if (key === "aria-disabled") return disabled ? "true" : null;
      if (key === "aria-checked") return this._aria ?? null;
      return null;
    },
    // Label mətni: `closest` qutu qaytarır, mətn onun içindədir (real formalarda belədir).
    // Seçici "form..." ilə başlayırsa xananın öz forması qaytarılır (real DOM-da belədir) —
    // formanın növünün təsnifi (abunə/giriş/qeydiyyat) məhz buna söykənir.
    closest(selector: any) {
      if (selector === "label") return this._label ?? null;
      if (selector.startsWith("form")) return this._form ?? this._dialog ?? null;
      if (selector.startsWith("[role='dialog']")) return this._dialog ?? null;
      return boxText === null ? null : { textContent: boxText };
    },
    focus() { this.focused = true; },
    blur() { this.blurred = true; },
    scrollIntoView() { this.scrolled = true; },
    dispatchEvent(event: any) { this.events.push(event.type); return true; },
    click() { this.clicked = true; if (this.type === "checkbox" || this.type === "radio") this.checked = true; },
  };
  // `value` prototipdəki setter ilə yazılır (kod React üçün məhz belə edir)
  const proto: any = {
    set value(v) { this._value = this.maxLength > 0 ? String(v).slice(0, this.maxLength) : String(v); },
    get value() { return this._value; },
  };
  return Object.assign(Object.create(proto), el);
}

const input = (props: any) => base(props);
const textarea = (props: any) => Object.assign(base(props), { tagName: "TEXTAREA", type: undefined });
const check = (props: any = {}) => Object.assign(base({ type: "checkbox", ...props }), { checked: props.checked === true });
const radio = (props: any = {}) => Object.assign(base({ type: "radio", ...props }), { checked: props.checked === true });

// GÖRÜNMƏYƏN checkbox + ona bağlı <label>: müasir dizayn sistemlərinin (Tailwind `sr-only`,
// shadcn, MUI) standart qurğusu. Əsl input gizlidir, klik label-a düşür.
// `native: false` — input-un öz `click()`-i state-i dəyişmir (bəzi framework-larda belədir),
// yalnız label kliki işləyir. Beləliklə label yolunun HƏQİQƏTƏN işlədiyi yoxlanılır.
function hiddenCheck({ id = "terms-box", text = "I agree to the Terms of Service", native = false, ...props }: any = {}) : any {
  const box = check({ id, visible: false, ...props });
  if (!native) box.click = function () { this.clickedSelf = true; };
  const label: any = {
    tagName: "LABEL", textContent: text,
    getAttribute: (key: any) => (key === "for" ? id : null),
    offsetParent: {}, offsetWidth: 200, offsetHeight: 20,
    closest: () => null,
    click() { this.clicked = true; box.checked = true; },
  };
  box._label = label;
  return { box, label };
}

// `data-state="checked"` (Radix/shadcn) və ya aria ilə ARTIQ işarələnmiş xana
const stateCheck = ({ state = "checked", text = "I agree to the terms" }: any = {}) => {
  const box = check({ boxText: text });
  box.getAttribute = function (key: any) {
    if (key === "data-state") return state;
    if (key === "aria-checked") return null;
    if (key === "aria-required") return null;
    if (key === "aria-disabled") return null;
    return null;
  };
  return box;
};

function select({ options = [], ...props }: any = {}) {
  const el = Object.assign(base({ type: "select-one", ...props }), { tagName: "SELECT" });
  el.options = options.map((option: any) => (typeof option === "string"
    ? { value: option, textContent: option, disabled: false }
    : { value: option.value ?? option.text ?? "", textContent: option.text ?? option.value ?? "", disabled: option.disabled === true }));
  return el;
}

// Mətn qovşağı: `ownText` yalnız BİRBAŞA mətn qovşaqlarını oxuyur (nodeType 3)
const textPart = (text: any) : any => ({ nodeType: 3, nodeValue: text });

function button({ text = "", type = "submit", tag = "BUTTON", label = null, value = "",
  disabled = false, ariaDisabled = null, visible = true, href = null }: any = {}) : any {
  return {
    tagName: tag, type, textContent: text, value, disabled,
    childNodes: text ? [textPart(text)] : [],
    offsetParent: visible ? {} : null, offsetWidth: visible ? 100 : 0, offsetHeight: visible ? 30 : 0,
    getAttribute(key: any) {
      if (key === "aria-disabled") return ariaDisabled;
      if (key === "aria-label") return label;
      if (key === "href") return href;
      return null;
    },
    // Real DOM-da düymə də öz formasını/dialoqunu tapır: `form()` bu əlaqəni qurur
    closest(selector: any): any {
      if (selector.startsWith("form")) return this._form ?? this._dialog ?? null;
      if (selector.startsWith("[role='dialog']")) return this._dialog ?? null;
      return null;
    },
    click() { this.clicked = true; },
  };
}

// Custom checkbox: React komponentləri belə olur (div[role="checkbox"])
const custom = ({ label = null, checked = false, role = "checkbox" }: any = {}) : any => ({
  tagName: "DIV", role,
  getAttribute(key: any) {
    if (key === "aria-checked") return this._checked ? "true" : "false";
    if (key === "aria-label") return label;
    return null;
  },
  _checked: checked,
  offsetParent: {}, offsetWidth: 100, offsetHeight: 20,
  closest: () => null,
  click() { this.clicked = true; this._checked = true; },
  dispatchEvent() { return true; },
});

const FIELD_SELECTOR = "input, select, textarea";
const CHECKBOX_SELECTOR = 'input[type="checkbox"]';
const routeAll = (fields: any, buttons: any, customs: any) => (selector: any) => {
  if (selector === "form") return [];
  if (selector === FIELD_SELECTOR) return fields;
  if (selector === CHECKBOX_SELECTOR) return fields.filter((el: any) => el.type === "checkbox");
  if (selector.startsWith("label[for=")) return [];
  if (selector.includes('role="checkbox"')) return customs;
  if (selector.includes("button")) return buttons;
  return [];
};
// Forma: xanalar + düymələr (+ custom checkbox-lar).
// `text` — formanın mətni (abunə qutusunu tanımaq üçün: "Subscribe to our newsletter"),
// `action` — formanın göndərildiyi ünvan (Mailchimp və s. birbaşa nişandır),
// `dialog` — forma açılan pəncərənin (modal) içindədir.
const form: any = (fields: any, buttons: any = [], customs: any = [], { text = "", action = null, role = null, dialog = false }: any = {}) : any => {
  const dialogNode = dialog
    ? { tagName: "DIV", getAttribute: (key: any) => (key === "role" ? "dialog" : null), offsetParent: {}, offsetWidth: 300, offsetHeight: 200 }
    : null;
  const node: any = {
    tagName: "FORM", fields, buttons, customs, textContent: text,
    getAttribute: (key: any) => (key === "action" ? action : key === "role" ? role : null),
    querySelectorAll: routeAll(fields, buttons, customs),
    closest: (selector: any) => (selector.startsWith("[role='dialog']") ? dialogNode : null),
    // Sənəd kökü yerinə forma seçiləndə "bu element formanın içindədirmi?" yoxlanılır
    contains: (el: any) => fields.includes(el) || buttons.includes(el) || customs.includes(el),
  };
  // Real DOM-da xana öz formasını `closest("form")` ilə tapır — stub-da əlaqə burada qurulur
  for (const el of [...fields, ...buttons, ...customs]) {
    el._form = node;
    if (dialogNode) el._dialog = dialogNode;
  }
  return node;
};

// document: formalar + formasız elementlər.
// `labels`  — `label[for=...]` axtarışı üçün: görünməyən checkbox-lar məhz belə işarələnir.
// `url`     — səhifənin ünvanı (`location.href`): qeydiyyat marşrutunun tanınması üçün.
// `links`   — `<a href>` elementləri: qeydiyyat səhifəsinin ünvanı onlardan tapılır.
// `dialogs` — `<form>` OLMAYAN modal pəncərələr (React auth modalı belədir).
async function inPage({ forms = [], loose = [], looseButtons = [], looseCustoms = [], labels = [],
  url = null, links = [], dialogs = [] }: any, run: any) {
  const previous: any = {
    document: (globalThis as any).document, Event: (globalThis as any).Event,
    MutationObserver: (globalThis as any).MutationObserver, CSS: (globalThis as any).CSS, location: (globalThis as any).location,
  };
  const fields = [...forms.flatMap((f: any) => f.fields), ...dialogs.flatMap((d: any) => d.fields), ...loose];
  const buttons = [...forms.flatMap((f: any) => f.buttons), ...dialogs.flatMap((d: any) => d.buttons), ...looseButtons];
  const customs = [...forms.flatMap((f: any) => f.customs), ...looseCustoms];
  const route = routeAll(fields, buttons, customs);
  const isDialogSelector = (selector: any) => selector.startsWith("[role='dialog']");
  (globalThis as any).document = {
    documentElement: {},
    getElementById: () => null,
    querySelector: (selector: any) => {
      if (isDialogSelector(selector)) return dialogs[0] ?? null;
      const match = /^label\[for="(.*)"\]$/.exec(selector);
      if (!match) return null;
      return labels.find((tag: any) => tag.getAttribute("for") === match[1]) ?? null;
    },
    querySelectorAll: (selector: any) => {
      if (selector === "form") return forms;
      if (selector === "a[href]") return links;
      return route(selector);
    },
  };
  (globalThis as any).Event = class { declare type: any; constructor(type: any, options: any) { this.type = type; Object.assign(this, options); } };
  (globalThis as any).MutationObserver = class { constructor() {} observe() {} disconnect() {} };
  (globalThis as any).CSS = { escape: (v: any) => v };
  if (url) (globalThis as any).location = new URL(url);
  else delete (globalThis as any).location;
  try { return await run(); } finally {
    for (const key of ["document", "Event", "MutationObserver", "CSS", "location"]) {
      if (previous[key] === undefined) delete (globalThis as any)[key]; else (globalThis as any)[key] = previous[key];
    }
  }
}

// Formasız MODAL (React auth pəncərəsi): `<form>` elementi yoxdur, hər şey dialoqun içindədir.
// `texts` — sadə mətn blokları (tab yazıları, "Forgot password?" keçidi): `<button>` deyil,
// yalnız klik hadisəsi olan `<div>`-lərdir. Real saytlarda tablar məhz belə qurulur.
function dialogNode({ fields = [], buttons = [], texts = [] }: any = {}) {
  const node = {
    tagName: "DIV", fields, buttons, texts,
    getAttribute: (key: any) => (key === "role" ? "dialog" : null),
    offsetParent: {}, offsetWidth: 500, offsetHeight: 600,
    querySelectorAll: (selector: any) => {
      if (selector === FIELD_SELECTOR) return fields;
      if (selector === CHECKBOX_SELECTOR) return fields.filter((el: any) => el.type === "checkbox");
      if (selector === "*") return [...texts, ...buttons, ...fields];
      if (selector.startsWith("a, button, label, span")) return [...texts, ...buttons];
      if (selector.includes("button")) return buttons;
      return [];
    },
    closest: (selector: any) => (selector.startsWith("[role='dialog']") ? node : null),
    contains: (el: any) => fields.includes(el) || buttons.includes(el) || texts.includes(el),
  };
  for (const el of [...fields, ...buttons, ...texts]) el._dialog = node;
  return node;
}

// Klik hadisəsi olan sadə mətn bloku (tab, keçid). `<button>`/`<a>` DEYİL.
// `decorated: true` — REAL HAL: tabın içində bəzək elementi (alt xətt) olur, yəni element
// yarpaq deyil. Etiket yalnız `ownText` ilə tapılır — coinmarketcap.com-da məhz belədir.
const textNode = (text: any, onClick?: any, { decorated = false }: any = {}) : any => ({
  tagName: "DIV", textContent: text,
  childNodes: [textPart(text), ...(decorated ? [{ nodeType: 1, tagName: "DIV" }] : [])],
  children: decorated ? [{ tagName: "DIV", textContent: "" }] : [],
  getAttribute: () => null,
  offsetParent: {}, offsetWidth: 90, offsetHeight: 24,
  closest(selector: any) {
    if (selector.startsWith("form")) return this._dialog ?? null;
    if (selector.startsWith("[role='dialog']")) return this._dialog ?? null;
    return null;
  },
  click() { this.clicked = true; onClick?.(); },
});

// ===========================================================================================
// KİÇİK DOM AĞACI: valideyn/uşaq əlaqələri REAL
// ===========================================================================================
// Yuxarıdaki stub-lar hər elementi təkbaşına götürür; panelin tapılması isə VALİDEYN ZƏNCİRİNƏ
// söykənir. coinmarketcap.com-un auth modalında nə `<form>`, nə `role="dialog"`, nə də tanınan
// class var — yalnız iç-içə `<div>`-lər. Bu ağac məhz o quruluşu təqlid edir.
const descendantsOf = (node: any): any => {
  const out = [];
  for (const child of node.children ?? []) {
    out.push(child);
    if (child.children?.length) out.push(...descendantsOf(child));
  }
  return out;
};

const tagOf = (node: any) => (node.tagName ?? "").toUpperCase();

function matchesSelector(node: any, selector: any) {
  const tag = tagOf(node);
  if (selector === "*") return true;
  if (selector === "form" || selector.startsWith("form")) return tag === "FORM";
  if (selector === "a[href]") return tag === "A" && node.getAttribute?.("href");
  if (selector === "label") return tag === "LABEL";
  if (selector.startsWith("label[for=")) {
    const want = /label\[for="(.*)"\]/.exec(selector)?.[1];
    return tag === "LABEL" && node.getAttribute?.("for") === want;
  }
  if (selector.startsWith("[role='dialog']")) return node.getAttribute?.("role") === "dialog";
  if (selector === FIELD_SELECTOR) return ["INPUT", "SELECT", "TEXTAREA"].includes(tag);
  if (selector === CHECKBOX_SELECTOR) return tag === "INPUT" && node.type === "checkbox";
  if (selector.startsWith("a, button, label, span")) {
    return ["A", "BUTTON", "LABEL", "SPAN", "P", "H1", "H2", "H3", "H4", "LI", "DIV"].includes(tag);
  }
  if (selector.includes("button")) {
    return tag === "BUTTON" || (tag === "INPUT" && ["submit", "button"].includes(node.type))
      || ["button", "tab"].includes(node.getAttribute?.("role"));
  }
  if (selector.includes("div")) return tag === "DIV";      // labelOf-un qutu seçicisi
  return false;
}

const climb = (node: any, selector: any) => {
  let current = node;
  while (current) {
    if (matchesSelector(current, selector)) return current;
    current = current.parentElement ?? null;
  }
  return null;
};

// Konteyner element: uşaqları ilə birlikdə. `role`/`class` QƏSDƏN default null-dır.
function box(tag: any, children: any, { role = null, action = null, className = null }: any = {}): any {
  const node: any = {
    tagName: tag, children,
    childNodes: children,                 // yalnız element qovşaqları → ownText boşdur
    offsetParent: {}, offsetWidth: 400, offsetHeight: 300,
    getAttribute: (key: any) => (key === "role" ? role : key === "action" ? action
      : key === "class" ? className : null),
    querySelectorAll: (selector: any) => descendantsOf(node).filter((el: any) => matchesSelector(el, selector)),
    contains: (el: any) => el === node || descendantsOf(node).includes(el),
  };
  Object.defineProperty(node, "textContent", {
    get: () => descendantsOf(node).map((el: any) => (el.children?.length ? "" : (el.textContent ?? ""))).join(" "),
  });
  node.closest = (selector: any) => climb(node, selector);
  for (const child of children) {
    child.parentElement = node;
    child.closest = (selector: any) => climb(child, selector);
  }
  return node;
}

// Bütöv profil: shared/identity.ts-in verdiyi forma
const VALUES = {
  email: "user@gmail.com", username: "user15xk", password: "Ab3xKm9pQr2sTv5w", code: "483920",
  firstName: "Emily", lastName: "Carter", middleName: "Nora", fullName: "Emily Carter",
  phone: "+15122087412", phoneNational: "(512) 208-7412", phoneDigits: "5122087412",
  phoneCountryCode: "+1",
  street: "1425 Cedar Street", street2: "Apt 12", city: "Austin", state: "Texas",
  stateCode: "TX", postal: "78701", country: "United States", countryCode: "US",
  birthIso: "1994-07-17", birthYear: "1994", birthMonth: "07", birthMonthName: "July",
  birthDay: "17", age: "31", gender: "female",
  company: "Cedar Studio", jobTitle: "Data Analyst", website: "https://user15xk.example.com",
  bio: "Hi, I'm Emily. I work as a data analyst and enjoy hiking in my free time.",
};

// Limitlər qısadır ki, testlər gözləmə ilə ləngiməsin
const fill = (dom: any, values: any = VALUES, submit = false) =>
  inPage(dom, () : any => fillFormInPage(values, { timeoutMs: 30, submitMs: submit ? 30 : 0 }));

// Bir xananı doldurub dəyərini qaytarır (rol yoxlamaları üçün qısa yol)
const one = async (props: any, values = VALUES) : Promise<any> => {
  const el = props.tagName === "SELECT" ? props : input(props);
  const result = await fill({ forms: [form([el])] }, values);
  return { el, result };
};

// ===========================================================================================
describe("ünvan, istifadəçi adı və parol", () => {
  it("type=email və poçt sözləri tanınır", async () => {
    for (const props of [{ type: "email" }, { name: "email" }, { name: "user_email" },
      { ac: "email" }, { ph: "E-mail address" }, { boxText: "Email address" }]) {
      const { el } = await one(props);
      expect(el.value, JSON.stringify(props)).toBe(VALUES.email);
    }
  });

  it("istifadəçi adı ünvandan AYRI doldurulur", async () => {
    const email = input({ type: "email" });
    const user = input({ name: "username" });
    const result = await fill({ forms: [form([email, user])] });
    expect(email.value).toBe(VALUES.email);
    expect(user.value).toBe(VALUES.username);
    expect(result.filled.includes("username")).toBeTruthy();
  });

  it("ikinci poçt və parol xanası TƏSDİQ sayılır (adında təsdiq sözü olmasa da)", async () => {
    const email = input({ type: "email" });
    const email2 = input({ type: "email", name: "email_2" });
    const pass = input({ type: "password", ac: "new-password" });
    const pass2 = input({ type: "password", name: "pass2" });
    const result = await fill({ forms: [form([email, email2, pass, pass2])] });
    expect(email2.value).toBe(VALUES.email);
    expect(pass2.value).toBe(VALUES.password);
    expect(result.filled.includes("emailConfirm") && result.filled.includes("passwordConfirm")).toBeTruthy();
  });

  it("current-password sahəsinə TOXUNULMUR (giriş və ya parolu dəyiş forması)", async () => {
    const el = input({ type: "password", ac: "current-password" });
    const result = await fill({ forms: [form([el])] });
    expect(el.value).toBe("");
    expect(result.done).toBe(false);
  });
});

describe("şəxsi məlumat xanaları", () => {
  const cases = [
    [{ name: "first_name" }, "firstName"],
    [{ ac: "given-name" }, "firstName"],
    [{ boxText: "Ad" }, "firstName"],
    [{ name: "last_name" }, "lastName"],
    [{ ac: "family-name" }, "lastName"],
    [{ boxText: "Soyad" }, "lastName"],
    [{ name: "middle_name" }, "middleName"],
    [{ name: "full_name" }, "fullName"],
    [{ ph: "Your name" }, "fullName"],
    [{ type: "tel" }, "phone"],
    [{ name: "phone_number" }, "phone"],
    [{ boxText: "Telefon" }, "phone"],
    [{ name: "zip" }, "postal"],
    [{ name: "postal_code" }, "postal"],
    [{ boxText: "Poçt indeksi" }, "postal"],
    [{ name: "city" }, "city"],
    [{ boxText: "Şəhər" }, "city"],
    [{ name: "state" }, "state"],
    [{ name: "province" }, "state"],
    [{ name: "country" }, "country"],
    [{ name: "address_line_1" }, "street"],
    [{ name: "street" }, "street"],
    [{ name: "address_line_2" }, "street2"],
    [{ name: "apartment" }, "street2"],
    [{ type: "date" }, "birthIso"],
    [{ name: "birthdate" }, "birthIso"],
    [{ name: "age", type: "number" }, "age"],
    [{ name: "company" }, "company"],
    [{ name: "job_title" }, "jobTitle"],
    [{ name: "website" }, "website"],
  ];

  it("hər sahə öz rolunu alır", async () => {
    for (const [props, role] of cases) {
      const { el, result } = await one(props);
      expect(result.filled, `${JSON.stringify(props)} → ${role}`).toStrictEqual([role]);
      expect(el.value, JSON.stringify(props)).not.toBe("");
    }
  });

  it("textarea yalnız haqqında/mesaj sözü ilə doldurulur", async () => {
    const bio = textarea({ name: "about_you" });
    expect((await fill({ forms: [form([bio])] })).filled).toStrictEqual(["bio"]);
    expect(bio.value).toBe(VALUES.bio);

    const other = textarea({ name: "custom_json" });
    expect((await fill({ forms: [form([other])] })).done).toBe(false);
  });

  it("axtarış, promo, kupon və məbləğ xanalarına TOXUNULMUR", async () => {
    for (const name of ["search", "q", "promo_code", "coupon", "referral_code", "quantity", "amount"]) {
      const el = input({ name });
      expect((await fill({ forms: [form([el])] })).done, name).toBe(false);
      expect(el.value, name).toBe("");
    }
  });

  it("saytın/istifadəçinin yazdığı dəyər üzərindən YAZILMIR (ünvan və parol istisnadır)", async () => {
    const city = input({ name: "city", value: "Baku" });
    const email = input({ type: "email", value: "old@example.com" });
    await fill({ forms: [form([city, email])] });
    expect(city.value, "profil xanası qorunur").toBe("Baku");
    expect(email.value, "ünvan bizimdir — yenilənir").toBe(VALUES.email);
  });
});

describe("dəyər forması xananın məhdudiyyətinə uyğunlaşır", () => {
  it("telefon: maxlength 10 olanda yalnız rəqəmlər yazılır", async () => {
    const el = input({ type: "tel", maxLength: 10 });
    await fill({ forms: [form([el])] });
    expect(el.value).toBe(VALUES.phoneDigits);
  });

  it("telefon: pattern verilibsə ona uyğun variant seçilir", async () => {
    const el = input({ type: "tel", pattern: "\\+[0-9]{11,13}" });
    await fill({ forms: [form([el])] });
    expect(el.value).toBe(VALUES.phone);
  });

  it("ad xanası qısa olarsa kəsilir", async () => {
    const el = input({ name: "username", maxLength: 5 });
    const result = await fill({ forms: [form([el])] });
    expect(el.value).toBe(VALUES.username.slice(0, 5));
    expect(result.filled).toStrictEqual(["username"]);
  });

  it("kəsilməsi ziyanlı rollar (indeks, parol, kod) uyğun gəlmirsə YAZILMIR", async () => {
    const postal = input({ name: "zip", maxLength: 3 });
    const result = await fill({ forms: [form([postal, input({ name: "city" })])] });
    expect(postal.value).toBe("");
    expect(result.failed).toStrictEqual(["postal"]);
    expect(result.filled.includes("city"), "qalan xanalar yenə dolur").toBeTruthy();
  });

  it("ştat və ölkə üçün qısa kod variantı var", async () => {
    const state = input({ name: "state", maxLength: 2 });
    const country = input({ name: "country", maxLength: 2 });
    await fill({ forms: [form([state, country])] });
    expect(state.value).toBe(VALUES.stateCode);
    expect(country.value).toBe(VALUES.countryCode);
  });
});

describe("seçim siyahıları (select)", () => {
  it("ölkə, ştat, ay, gün və il seçilir", async () => {
    const country = select({ name: "country", options: ["", "Turkey", "United States", "Germany"] });
    const state = select({ name: "state", options: ["", { value: "TX", text: "Texas" }, { value: "CA", text: "California" }] });
    const month = select({ name: "birth_month", options: ["", "June", "July", "August"] });
    const day = select({ name: "birth_day", options: ["", "16", "17", "18"] });
    const year = select({ name: "birth_year", options: ["", "1993", "1994", "1995"] });
    const result = await fill({ forms: [form([country, state, month, day, year])] });
    expect(country.value).toBe("United States");
    expect(state.value).toBe("TX");
    expect(month.value).toBe("July");
    expect(day.value).toBe("17");
    expect(year.value).toBe("1994");
    expect(result.filled.length).toBe(5);
  });

  it("ölkə kodu siyahısı (+1) tanınır", async () => {
    const el = select({ name: "phone_country_code", options: ["", "+90 Turkey", "+1 United States"] });
    await fill({ forms: [form([el])] });
    expect(el.value).toBe("+1 United States");
  });

  it("cins siyahısında neytral variant üstün tutulur", async () => {
    const el = select({ name: "gender", options: ["", "Male", "Female", "Prefer not to say"] });
    await fill({ forms: [form([el])] });
    expect(el.value).toBe("Prefer not to say");
  });

  it("neytral variant yoxdursa profilin cinsi seçilir", async () => {
    const el = select({ name: "gender", options: ["", "Male", "Female"] });
    await fill({ forms: [form([el])] });
    expect(el.value).toBe("Female");
  });

  it("müraciət (Mr/Ms) siyahısı doldurulur", async () => {
    const el = select({ name: "title", options: ["", "Mr", "Ms", "Dr"] });
    await fill({ forms: [form([el])] });
    expect(el.value).toBe("Ms");
  });

  it("rolu tanınmayan MƏCBURİ siyahı ilk həqiqi variantı alır", async () => {
    const el = select({ name: "how_did_you_hear", required: true, options: ["Select an option", "Friend", "Ads"] });
    const result = await fill({ forms: [form([el, input({ type: "email" })])] });
    expect(el.value, "yer tutan variant seçilmir").toBe("Friend");
    expect(result.chosen).toBe(1);
  });

  it("məcburi olmayan naməlum siyahıya toxunulmur", async () => {
    const el = select({ name: "how_did_you_hear", options: ["", "Friend"] });
    const result = await fill({ forms: [form([el, input({ type: "email" })])] });
    expect(el.value).toBe("");
    expect(result.chosen).toBe(0);
  });

  it("siyahıda uyğun variant yoxdursa rol uğursuz sayılır", async () => {
    const el = select({ name: "country", options: ["", "Turkey", "Germany"] });
    const result = await fill({ forms: [form([el, input({ type: "email" })])] });
    expect(el.value).toBe("");
    expect(result.failed).toStrictEqual(["country"]);
  });
});

describe("razılıq, yaş və robot xanaları", () => {
  it("şərtlər, məxfilik və 18 yaş xanaları işarələnir", async () => {
    for (const props of [{ boxText: "I agree to the Terms of Service" },
      { boxText: "I accept the Privacy Policy" }, { boxText: "I am over 18 years old" },
      { name: "terms" }, { label: "Şərtləri qəbul edirəm" }, { boxText: "Kullanım koşullarını kabul ediyorum" }]) {
      const box = check(props);
      const result = await fill({ forms: [form([input({ type: "email" }), box])] });
      expect(box.checked, JSON.stringify(props)).toBe(true);
      expect(result.checked, JSON.stringify(props)).toBe(1);
    }
  });

  it('"mən robot deyiləm" xanası işarələnir', async () => {
    const box = check({ boxText: "I'm not a robot" });
    await fill({ forms: [form([input({ type: "email" }), box])] });
    expect(box.checked).toBe(true);
  });

  it("marketinq abunəsi məcburi deyilsə İŞARƏLƏNMİR", async () => {
    const box = check({ boxText: "Send me the newsletter and special offers" });
    const result = await fill({ forms: [form([input({ type: "email" }), box])] });
    expect(box.checked).toBe(false);
    expect(result.checked).toBe(0);
    expect(result.skipped.includes("marketinq")).toBeTruthy();
  });

  it("marketinq xanası MƏCBURİ olarsa işarələnir (forma başqa cür göndərilmir)", async () => {
    const box = check({ boxText: "Subscribe to updates", required: true });
    await fill({ forms: [form([input({ type: "email" }), box])] });
    expect(box.checked).toBe(true);
  });

  it("naməlum checkbox məcburi deyilsə toxunulmur", async () => {
    const box = check({ name: "make_profile_public" });
    const result = await fill({ forms: [form([input({ type: "email" }), box])] });
    expect(box.checked).toBe(false);
    expect(result.checked).toBe(0);
  });

  it("artıq işarələnmiş xana yenidən basılmır", async () => {
    const box = check({ name: "terms", checked: true });
    const result = await fill({ forms: [form([input({ type: "email" }), box])] });
    expect(box.clicked).not.toBe(true);
    expect(result.checked).toBe(0);
  });

  it("saytın öz div[role=checkbox] komponenti də işarələnir", async () => {
    const box = custom({ label: "I agree to the terms" });
    const result = await fill({ forms: [form([input({ type: "email" })], [], [box])] });
    expect(box._checked).toBe(true);
    expect(result.checked).toBe(1);
  });
});

// ===========================================================================================
// Razılıq xanalarının ÇƏTİN halları — real saytlarda ən çox rast gəlinənlər.
// Bunlar əvvəl işləmirdi: xana ya <form>-un kənarında olurdu, ya da vizual olaraq gizlədilmişdi
// (Tailwind `sr-only`, shadcn, MUI) və görünmə şərtinə görə ümumiyyətlə nəzərə alınmırdı.
// Nəticə: forma "şərtləri qəbul et" yoxlamasından keçmirdi.
describe("razılıq xanaları — gizli, kənarda və xüsusi vəziyyətli", () => {
  it("GÖRÜNMƏYƏN checkbox ona bağlı <label> vasitəsilə işarələnir", async () => {
    const { box, label } = hiddenCheck({ text: "I agree to the Terms of Service" });
    const result = await fill({
      forms: [form([input({ type: "email" }), box])],
      labels: [label],
    });
    expect(box.checked, "gizli xana işarələnməli idi").toBe(true);
    expect(label.clicked, "klik label-a düşməli idi").toBe(true);
    expect(result.checked).toBe(1);
  });

  it("form atributu ilə bağlı kənar razılıq xanası işarələnir", async () => {
    const box = check({ boxText: "I accept the Privacy Policy" });
    const signup: any = form([input({ type: "email" }), input({ type: "password", ac: "new-password" })]);
    box.form = signup;
    const result = await fill({
      forms: [signup],
      loose: [box],
    });
    expect(box.checked).toBe(true);
    expect(result.checked).toBe(1);
  });

  it("data-state=\"checked\" (Radix/shadcn) artıq işarələnmiş sayılır", async () => {
    const box = stateCheck({ state: "checked" });
    const result = await fill({ forms: [form([input({ type: "email" }), box])] });
    expect(box.clicked, "təkrar basılmamalı idi").not.toBe(true);
    expect(result.checked).toBe(0);
  });

  it("data-state=\"unchecked\" olan xana işarələnir", async () => {
    const box = stateCheck({ state: "unchecked" });
    await fill({ forms: [form([input({ type: "email" }), box])] });
    expect(box.checked).toBe(true);
  });

  it("razılıq sözlüyü genişdir: oxudum/anladım/razılaşma/kuki/согласен", async () => {
    for (const text of [
      "I have read and understood the User Agreement",
      "I confirm that I am 18 or older",
      "Accept cookies and data processing",
      "İstifadəçi razılaşmasını oxudum və qəbul edirəm",
      "Məxfilik siyasəti ilə razıyam",
      "Gizlilik politikasını okudum, kabul ediyorum",
      "Я согласен с условиями пользовательского соглашения",
      "Ознакомлен с политикой конфиденциальности",
    ]) {
      const box = check({ boxText: text });
      const result = await fill({ forms: [form([input({ type: "email" }), box])] });
      expect(box.checked, text).toBe(true);
      expect(result.checked, text).toBe(1);
    }
  });

  it("sənədin uzağındaki NAMƏLUM və görünməyən xanaya toxunulmur (məcburi olsa da)", async () => {
    const stray = check({ name: "hidden_feature_flag", required: true, visible: false });
    const result = await fill({
      forms: [form([input({ type: "email" }), input({ type: "password", ac: "new-password" })])],
      loose: [stray],
    });
    expect(stray.checked).not.toBe(true);
    expect(result.checked).toBe(0);
  });

  it("formanın İÇİNDƏKİ məcburi naməlum xana yenə işarələnir (yoxsa forma getmir)", async () => {
    const box = check({ name: "confirm_data_accuracy", required: true });
    const result = await fill({ forms: [form([input({ type: "email" }), box])] });
    expect(box.checked).toBe(true);
    expect(result.checked).toBe(1);
  });

  it("marketinq xanası gizli olsa da işarələnmir", async () => {
    const { box, label } = hiddenCheck({ id: "news", text: "Send me the newsletter and promotions" });
    const result = await fill({
      forms: [form([input({ type: "email" }), box])],
      labels: [label],
    });
    expect(box.checked).not.toBe(true);
    expect(result.skipped.includes("marketinq")).toBeTruthy();
  });

  it("bir formada bir NEÇƏ razılıq xanası — hamısı işarələnir", async () => {
    const terms = check({ boxText: "I agree to the Terms" });
    const privacy = check({ boxText: "I accept the Privacy Policy" });
    const age = check({ boxText: "I am over 18 years old" });
    const news = check({ boxText: "Subscribe to our newsletter" });
    const result = await fill({ forms: [form([input({ type: "email" }), terms, privacy, age, news])] });
    expect(terms.checked).toBe(true);
    expect(privacy.checked).toBe(true);
    expect(age.checked).toBe(true);
    expect(news.checked, "marketinq toxunulmamalıdır").not.toBe(true);
    expect(result.checked).toBe(3);
  });

  it("switch komponenti (role=switch) də işarələnir", async () => {
    const box = custom({ label: "I accept the terms and conditions", role: "switch" });
    const result = await fill({ forms: [form([input({ type: "email" })], [], [box])] });
    expect(box._checked).toBe(true);
    expect(result.checked).toBe(1);
  });
});

describe("radio qrupları", () => {
  it("cins qrupunda neytral variant, yoxsa profilin cinsi seçilir", async () => {
    const male = radio({ name: "gender", value: "male", boxText: "Male" });
    const female = radio({ name: "gender", value: "female", boxText: "Female" });
    const other = radio({ name: "gender", value: "other", boxText: "Prefer not to say" });
    await fill({ forms: [form([input({ type: "email" }), male, female, other])] });
    expect(other.checked).toBe(true);
    expect(male.checked).not.toBe(true);

    const m2 = radio({ name: "gender", value: "male", boxText: "Male" });
    const f2 = radio({ name: "gender", value: "female", boxText: "Female" });
    await fill({ forms: [form([input({ type: "email" }), m2, f2])] });
    expect(f2.checked, "profil qadındır").toBe(true);
  });

  it("razılıq qrupunda təsdiq cavabı seçilir", async () => {
    const yes = radio({ name: "terms", value: "yes", boxText: "Yes, I agree to the terms" });
    const no = radio({ name: "terms", value: "no", boxText: "No" });
    await fill({ forms: [form([input({ type: "email" }), yes, no])] });
    expect(yes.checked).toBe(true);
    expect(no.checked).not.toBe(true);
  });

  it("məcburi naməlum qrupda mənfi olmayan ilk variant seçilir", async () => {
    const no = radio({ name: "plan", value: "no", boxText: "No thanks", required: true });
    const yes = radio({ name: "plan", value: "personal", boxText: "Personal", required: true });
    await fill({ forms: [form([input({ type: "email" }), no, yes])] });
    expect(yes.checked).toBe(true);
    expect(no.checked).not.toBe(true);
  });

  it("məcburi olmayan naməlum qrupa toxunulmur", async () => {
    const a = radio({ name: "plan", value: "a", boxText: "Plan A" });
    const b = radio({ name: "plan", value: "b", boxText: "Plan B" });
    const result = await fill({ forms: [form([input({ type: "email" }), a, b])] });
    expect(a.checked).not.toBe(true);
    expect(b.checked).not.toBe(true);
    expect(result.checked).toBe(0);
  });
});

describe("formanın seçilməsi", () => {
  it("giriş formasının yerinə qeydiyyat forması seçilir", async () => {
    const login: any = form([input({ type: "email", name: "email" }), input({ type: "password", ac: "current-password" })]);
    const signup: any = form([
      input({ type: "email", name: "reg_email" }),
      input({ type: "password", ac: "new-password", name: "reg_pass" }),
      input({ type: "password", name: "reg_pass_confirm" }),
    ]);
    const result = await fill({ forms: [login, signup] });
    expect(login.fields[0].value, "giriş formasına toxunulmamalıdır").toBe("");
    expect(signup.fields[0].value).toBe(VALUES.email);
    expect(result.filled.includes("passwordConfirm")).toBeTruthy();
  });

  it("çoxsahəli abunə forması qeydiyyat formasını üstələmir (çəki: parol + kod)", async () => {
    const contact: any = form([input({ name: "full_name" }), input({ type: "email", name: "contact_email" }),
      input({ type: "tel" }), input({ name: "city" }), input({ name: "company" })]);
    const signup: any = form([input({ type: "email", name: "signup_email" }), input({ type: "password", ac: "new-password" })]);
    await fill({ forms: [contact, signup] });
    expect(signup.fields[0].value).toBe(VALUES.email);
    expect(contact.fields[1].value).toBe("");
  });

  it("kod fazasında kod xanasını daşıyan forma seçilir (düymə də oradan)", async () => {
    const create = button({ text: "Create account" });
    const signup: any = form([input({ type: "email" }), input({ type: "password", ac: "new-password" }),
      input({ type: "password", name: "password_confirmation" })], [create]);
    const verify = button({ text: "Verify" });
    const code: any = form([input({ name: "verification_code", maxLength: 6 })], [verify]);

    const result = await fill({ forms: [signup, code] }, { code: VALUES.code }, true);
    expect(result.filled).toStrictEqual(["code"]);
    expect(result.submitted).toBe("verify");
    expect(verify.clicked).toBe(true);
    expect(create.clicked).not.toBe(true);
  });

  it("kod gözlənilən vaxt kod xanası olmayan forma SEÇİLMİR", async () => {
    const signup: any = form([input({ type: "email" }), input({ type: "password", ac: "new-password" }),
      input({ type: "password", name: "password_confirmation" })]);
    const result = await fill({ forms: [signup] }, { code: VALUES.code });
    expect(result.done).toBe(false);
    expect(result.reason).toMatch(/uyğun sahə tapılmadı/);
  });

  it("forma olmasa da sənəddəki sahələr doldurulur (React modal)", async () => {
    const email = input({ type: "email" });
    const pass = input({ type: "password", ac: "new-password" });
    const result = await fill({ forms: [], loose: [email, pass] });
    expect(result.filled).toStrictEqual(["email", "password"]);
  });

  it("onlyEmpty: doldurulmuş forma yerinə BOŞ xanası olan forma seçilir (2-ci mərhələ)", async () => {
    // Birinci mərhələ artıq doludur; səhifədə həm də GİRİŞ forması var (boş ünvan xanası ilə) —
    // ikinci keçid onu seçməməlidir, çünki ünvan/istifadəçi adı bu keçiddə sayılmır.
    const login: any = form([input({ type: "email", name: "login_email" }), input({ type: "password", ac: "current-password" })]);
    const done: any = form([
      input({ type: "email", value: VALUES.email }),
      input({ type: "password", ac: "new-password", value: VALUES.password }),
      input({ name: "city", value: VALUES.city }),
    ]);
    const step2: any = form([input({ name: "job_title" }), textarea({ name: "about_you" })]);
    const result = await inPage({ forms: [login, done, step2] },
      () : any => fillFormInPage(VALUES, { timeoutMs: 30, submitMs: 0, onlyEmpty: true }));
    expect(result.filled).toStrictEqual(["jobTitle", "bio"]);
    expect(step2.fields[0].value).toBe(VALUES.jobTitle);
    expect(login.fields[0].value, "giriş formasına toxunulmur").toBe("");
    expect(done.fields[0].value, "birinci mərhələ olduğu kimi qalır").toBe(VALUES.email);
  });

  it("onlyEmpty: ikinci mərhələdəki PAROL xanası yenə doldurulur", async () => {
    const step2: any = form([input({ type: "password", ac: "new-password" }), input({ name: "city" })]);
    const result = await inPage({ forms: [step2] },
      () : any => fillFormInPage(VALUES, { timeoutMs: 30, submitMs: 0, onlyEmpty: true }));
    expect(result.filled).toStrictEqual(["password", "city"]);
  });

  it("promo kodu xanası kod kimi doldurulmur", async () => {
    const promo = input({ name: "promo_code", maxLength: 10 });
    const result = await fill({ forms: [form([promo])] }, { code: VALUES.code });
    expect(promo.value).toBe("");
    expect(result.done).toBe(false);
  });

  it("poçt indeksi kod kimi doldurulmur (PIN code)", async () => {
    const pin = input({ name: "pin_code", maxLength: 6 });
    const result = await fill({ forms: [form([pin])] }, { code: VALUES.code });
    expect(pin.value).toBe("");
    expect(result.done).toBe(false);
  });
});

describe("görünməyən və bloklanmış sahələr", () => {
  it("gizli, disabled və readonly sahələr atlanılır", async () => {
    for (const props of [{ visible: false }, { disabled: true }, { readOnly: true }]) {
      const el = input({ type: "email", ...props });
      expect((await fill({ forms: [form([el])] })).done, JSON.stringify(props)).toBe(false);
      expect(el.value, JSON.stringify(props)).toBe("");
    }
  });

  it("gizli sahə varsa görünən qardaşı seçilir", async () => {
    const hidden = input({ type: "email", visible: false });
    const shown = input({ type: "email", name: "email2" });
    await fill({ forms: [form([hidden, shown])] });
    expect(hidden.value).toBe("");
    expect(shown.value).toBe(VALUES.email);
  });
});

describe("yazma qaydaları", () => {
  it("input və change hadisələri göndərilir (framework state-i alsın)", async () => {
    const email = input({ type: "email" });
    await fill({ forms: [form([email])] });
    expect(email.events).toStrictEqual(["input", "change"]);
    expect(email.focused).toBe(true);
  });

  it("prototipdəki setter işlədilir: instansiya setter-i yazını udsa da keçir (React)", async () => {
    const email = input({ type: "email" });
    Object.defineProperty(email, "value", { configurable: true, get() { return this._value; }, set() { this.swallowed = true; } });
    email.value = "x";
    expect(email._value).toBe("");
    await fill({ forms: [form([email])] });
    expect(email.value).toBe(VALUES.email);
  });

  it("heç bir sahə tapılmasa aydın səbəb qaytarılır (throw etmir)", async () => {
    const result = await fill({ forms: [form([input({ name: "custom_field_xyz" })])] });
    expect(result.done).toBe(false);
    expect(result.reason).toMatch(/uyğun sahə tapılmadı/);
  });
});

describe("göndərmə düyməsi", () => {
  const signupForm: any = (buttons: any) : any => form([
    input({ type: "email", name: "email" }),
    input({ type: "password", ac: "new-password" }),
  ], buttons);

  it("qeydiyyat yazısı olan düymə basılır və statusa düşür", async () => {
    for (const text of ["Create account", "Register", "Sign up", "Yarat", "Hesap oluştur",
      "Kaydol", "Üye ol", "Qeydiyyatdan keç", "Join now", "Зарегистрироваться"]) {
      const go = button({ text });
      const result = await fill({ forms: [signupForm([go])] }, VALUES, true);
      expect(go.clicked, text).toBe(true);
      expect(result.submitted).toBe(text.toLowerCase());
    }
  });

  it("input[type=submit] düyməsinin yazısı value-dandır", async () => {
    const go = button({ tag: "INPUT", type: "submit", value: "Create account", text: "" });
    await fill({ forms: [signupForm([go])] }, VALUES, true);
    expect(go.clicked).toBe(true);
  });

  it("giriş, sosial şəbəkə, ödəniş və silmə düymələri BASILMIR", async () => {
    // Bu yazılar formanı GİRİŞ forması kimi damğalamır (sosial, ödəniş, silmə…), ona görə
    // forma yenə doldurulur — sadəcə düyməyə toxunulmur.
    for (const text of ["Continue with Google", "Sign up with Apple", "Cancel", "Delete account",
      "Subscribe", "Pay now", "Resend code", "Already have an account?"]) {
      const go = button({ text });
      const result = await fill({ forms: [signupForm([go])] }, VALUES, true);
      expect(go.clicked, text).not.toBe(true);
      expect(result.submitted, text).toBe(undefined);
      expect(result.done, text).toBe(true);
    }
  });

  // Formanın YEGANƏ düyməsi girişdən danışırsa bu, qeydiyyat forması deyil: ora ünvan/parol
  // yazmaq mənasızdır (istifadəçinin səhifəsini korlayır). Düzgün davranış qeydiyyat
  // səhifəsini tapmaqdır — bunu `openSignupInPage` edir.
  it("GİRİŞ forması ümumiyyətlə doldurulmur", async () => {
    for (const text of ["Sign in", "Log in", "Giriş", "Forgot password"]) {
      const login: any = signupForm([button({ text })]);
      const result = await fill({ forms: [login] }, VALUES, true);
      expect(result.done, text).toBe(false);
      expect(login.fields[0].value, text).toBe("");
      expect(login.fields[1].value, text).toBe("");
      expect(result.reason, text).toMatch(/uyğun sahə tapılmadı/);
    }
  });

  it("giriş və qeydiyyat tabı bir yerdə olanda forma doldurulur (qeydiyyat sözü üstündür)", async () => {
    const go = button({ text: "Create account" });
    const tabs: any = signupForm([button({ text: "Log in" }), go]);
    const result = await fill({ forms: [tabs] }, VALUES, true);
    expect(result.done).toBe(true);
    expect(go.clicked).toBe(true);
  });

  it("qadağan sözü söz içində tutulmur (Create Silver account basılır)", async () => {
    const go = button({ text: "Create Silver account" });
    await fill({ forms: [signupForm([go])] }, VALUES, true);
    expect(go.clicked).toBe(true);
  });

  it("güclü yazı zəif yazıdan üstündür", async () => {
    const weak = button({ text: "Continue" });
    const strong = button({ text: "Create account" });
    await fill({ forms: [signupForm([weak, strong])] }, VALUES, true);
    expect(strong.clicked).toBe(true);
    expect(weak.clicked).not.toBe(true);
  });

  it("yazısı tanınmayan submit düyməsi son ehtimaldır", async () => {
    const unknown = button({ text: "→" });
    await fill({ forms: [signupForm([unknown])] }, VALUES, true);
    expect(unknown.clicked).toBe(true);
  });

  it("gizli və deaktiv düymə basılmır", async () => {
    for (const props of [{ visible: false }, { disabled: true }, { ariaDisabled: "true" }]) {
      const go = button({ text: "Create account", ...props });
      const result = await fill({ forms: [signupForm([go])] }, VALUES, true);
      expect(go.clicked, JSON.stringify(props)).not.toBe(true);
      expect(result.reason).toMatch(/düyməsi tapılmadı/);
      expect(result.done).toBe(true);
    }
  });

  it("submit rejimi boş sahələr olduqda düyməni basmır", async () => {
    const email = input({ type: "email" });
    const go = button({ text: "Create account" });
    const dom: any = { forms: [form([email, input({ type: "password", ac: "new-password" })], [go])] };
    const result = await inPage(dom, () : any => fillFormInPage(VALUES, { timeoutMs: 30, submitMs: 30, mode: "submit" }));
    expect(email.value, "doldurma bu rejimdə işləmir").toBe("");
    expect(go.clicked).not.toBe(true);
    expect(result.submitted).toBe(undefined);
    expect(result.reason).toMatch(/email/);
  });

  it("submit rejimi əvvəl doldurulmuş və qəbul edilmiş dəyərlərlə işləyir", async () => {
    const email = input({ type: "email", value: VALUES.email });
    const password = input({ type: "password", ac: "new-password", value: VALUES.password });
    const go = button({ text: "Create account" });
    const result = await inPage({ forms: [form([email, password], [go])] },
      () : any => fillFormInPage(VALUES, { timeoutMs: 30, submitMs: 30, mode: "submit" }));
    expect(go.clicked).toBe(true);
    expect(result.submitted).toBe("create account");
    expect(email.events, "submit sahələri yenidən yazmır").toStrictEqual([]);
  });

  it("sayt dəyəri silsə, dəyişsə və ya etibarsız saysa submit dayanır", async () => {
    for (const state of ["", "old@example.org", VALUES.email]) {
      const email = input({ type: "email", value: state });
      if (state === VALUES.email) email.validity = { valid: false };
      const password = input({ type: "password", ac: "new-password", value: VALUES.password });
      const go = button({ text: "Create account" });
      const result = await inPage({ forms: [form([email, password], [go])] },
        () : any => fillFormInPage(VALUES, { timeoutMs: 30, submitMs: 30, mode: "submit" }));
      expect(go.clicked, state).not.toBe(true);
      expect(result.reason).toMatch(/email/);
    }
  });

  it("qəbul edilməyən parolla qismən doldurulmuş forma göndərilmir", async () => {
    const email = input({ type: "email" });
    const password = input({ type: "password", ac: "new-password", minLength: 40 });
    const go = button({ text: "Create account" });
    const result = await fill({ forms: [form([email, password], [go])] }, VALUES, true);
    expect(email.value).toBe(VALUES.email);
    expect(password.value).toBe("");
    expect(go.clicked).not.toBe(true);
    expect(result.reason).toMatch(/password/);
  });

  it("tanınmayan məcburi sahə boşdursa submit dayanır", async () => {
    const go = button({ text: "Create account" });
    const signup: any = signupForm([go]);
    signup.fields.push(input({ name: "required_custom_field", required: true }));
    const result = await fill({ forms: [signup] }, VALUES, true);
    expect(go.clicked).not.toBe(true);
    expect(result.reason).toMatch(/məcburi/);
  });

  it("submit istənilməyəndə düyməyə toxunulmur", async () => {
    const go = button({ text: "Create account" });
    const result = await fill({ forms: [signupForm([go])] }, VALUES, false);
    expect(go.clicked).not.toBe(true);
    expect(result.submitted).toBe(undefined);
  });

  it("forma tapılmayıb sənəd kökü işlədilirsə yalnız GÜCLÜ yazı basılır", async () => {
    const weak = button({ text: "Continue" });
    const loose = [input({ type: "email" }), input({ type: "password", ac: "new-password" })];
    const result = await fill({ forms: [], loose, looseButtons: [weak] }, VALUES, true);
    expect(weak.clicked).not.toBe(true);
    expect(result.reason).toMatch(/düyməsi tapılmadı/);

    const strong = button({ text: "Create account" });
    await fill({
      forms: [], loose: [input({ type: "email" }), input({ type: "password", ac: "new-password" })],
      looseButtons: [strong],
    }, VALUES, true);
    expect(strong.clicked).toBe(true);
  });

  it("heç nə dolmadısa düymə də basılmır", async () => {
    const go = button({ text: "Create account" });
    const result = await fill({ forms: [form([input({ name: "custom_field_xyz" })], [go])] }, VALUES, true);
    expect(result.done).toBe(false);
    expect(go.clicked).not.toBe(true);
  });
});

// ===========================================================================================
// KODU POÇTA GÖNDƏRƏN DÜYMƏ
// ===========================================================================================
// Çox saytda qeydiyyat iki mərhələlidir: əvvəl poçt yazılır və "Send code" basılır, kod
// gəldikdən sonra isə "Verify / Create account". Əvvəl belə düymə "zəif" sayılırdı, yəni
// səhifədə "Create account" varsa o basılırdı və kod HEÇ VAXT göndərilmirdi.
// Qayda: kod ƏLİMİZDƏ YOXDURSA kod düyməsi hər şeydən üstündür; ƏLİMİZDƏDİRSƏ ona toxunulmur
// (yeni kod istəsək əlimizdəki köhnələr).
describe("kod göndərmə düyməsi", () => {
  // Birinci mərhələdə kod HƏLƏ YOXDUR (signupValues onu göndərmir)
  const noCode = { ...VALUES, code: "" };
  const mailForm: any = (buttons: any) : any => form([input({ type: "email", name: "email" })], buttons);

  it("kod hələ yoxdursa kod düyməsi qeydiyyat düyməsindən ÜSTÜN tutulur", async () => {
    const send = button({ text: "Send code" });
    const create = button({ text: "Create account" });
    const result = await fill({ forms: [mailForm([create, send])] }, noCode, true);
    expect(send.clicked, "kod düyməsi basılmalı idi").toBe(true);
    expect(create.clicked).not.toBe(true);
    expect(result.submitted).toBe("send code");
    expect(result.codeRequested).toBe(true);
  });

  it("kod düymələrinin bütün adları tanınır", async () => {
    for (const text of ["Send code", "Send the code", "Get code", "Request a code",
      "Send verification code", "Email me a code", "Send OTP", "Send magic link",
      "Kodu göndər", "Kod al", "Doğrulama kodu", "Отправить код", "Получить код"]) {
      const go = button({ text });
      const result = await fill({ forms: [mailForm([go])] }, noCode, true);
      expect(go.clicked, text).toBe(true);
      expect(result.codeRequested, text).toBe(true);
    }
  });

  it("kod ƏLİMİZDƏ olanda kod düyməsinə TOXUNULMUR (yenisi istənilmir)", async () => {
    const send = button({ text: "Send code" });
    const verify = button({ text: "Verify" });
    const codeForm: any = form([input({ name: "verification_code", maxLength: 6 })], [send, verify]);
    const result = await fill({ forms: [codeForm] }, { code: VALUES.code }, true);
    expect(verify.clicked).toBe(true);
    expect(send.clicked, "yeni kod istənilməməli idi").not.toBe(true);
    expect(result.codeRequested).toBe(undefined);
  });

  it("kod əlimizdədirsə və səhifədə YALNIZ kod düyməsi varsa heç nə basılmır", async () => {
    const send = button({ text: "Send code" });
    const result = await fill({ forms: [form([input({ name: "otp", maxLength: 6 })], [send])] },
      { code: VALUES.code }, true);
    expect(send.clicked).not.toBe(true);
    expect(result.reason).toMatch(/düyməsi tapılmadı/);
  });

  it("aşkarlanan kod düymələri nəticədə sadalanır (istifadəçi görməlidir)", async () => {
    const send = button({ text: "Send code" });
    const result = await fill({ forms: [mailForm([send])] }, noCode, false);
    expect(result.codeButtons).toStrictEqual(["send code"]);
  });

  it("forma yoxdursa (React modal) kod düyməsi YENƏ basılır — yazısı birmənalıdır", async () => {
    const send = button({ text: "Send verification code" });
    const result = await fill({
      forms: [], loose: [input({ type: "email" })], looseButtons: [send],
    }, noCode, true);
    expect(send.clicked).toBe(true);
    expect(result.codeRequested).toBe(true);
  });

  it('"Resend code" basılmır (kod təkrar göndərilməməlidir)', async () => {
    const resend = button({ text: "Resend code" });
    const result = await fill({ forms: [mailForm([resend])] }, noCode, true);
    expect(resend.clicked).not.toBe(true);
    expect(result.codeButtons, "qadağan düymə siyahıya da düşmür").toBe(undefined);
  });

  it("deaktiv kod düyməsi aktivləşənə qədər gözlənilir, sonra basılır", async () => {
    const send = button({ text: "Send code", disabled: true });
    const dom: any = { forms: [mailForm([send])] };
    dom.forms[0].fields[0].value = VALUES.email;
    const result = await inPage(dom, async () : Promise<any> => {
      const running: any = fillFormInPage(noCode, { timeoutMs: 30, submitMs: 900, mode: "submit" });
      setTimeout(() => { send.disabled = false; }, 120);
      return running;
    });
    expect(send.clicked, "aktivləşəndən sonra basılmalı idi").toBe(true);
    expect(result.codeRequested).toBe(true);
  });

  it("kod düyməsi ilə sosial giriş qarışmır (Continue with Google)", async () => {
    const google = button({ text: "Continue with Google" });
    const send = button({ text: "Send code" });
    await fill({ forms: [mailForm([google, send])] }, noCode, true);
    expect(send.clicked).toBe(true);
    expect(google.clicked).not.toBe(true);
  });

  it("kod düyməsi yoxdursa adi qaydalar işləyir", async () => {
    const create = button({ text: "Create account" });
    const result = await fill({
      forms: [form([input({ type: "email" }), input({ type: "password", ac: "new-password" })], [create])],
    }, noCode, true);
    expect(create.clicked).toBe(true);
    expect(result.codeRequested).toBe(undefined);
  });
});

// ===========================================================================================
// YAD FORMALAR: ABUNƏ QUTUSU, GİRİŞ VƏ AXTARIŞ
// ===========================================================================================
// ⚠ REAL QÜSUR: coinmarketcap.com ANA SƏHİFƏSİNDƏ Başlat basıldı və ünvan **bülletenə abunə**
// xanasına yazıldı. İki səbəb üst-üstə düşdü: (1) səhifədə görünən poçt xanası + başlıqdaki
// "Sign up" düyməsi "qeydiyyat forması açıqdır" sayıldı, ona görə qeydiyyat səhifəsi
// ümumiyyətlə axtarılmadı; (2) doldurma qatında tək poçt xanası olan abunə forması 2 xal alıb
// qalib gəldi. Aşağıdaki testlər hər iki qapını bağlayır.
describe("abunə (bülleten) qutusuna YAZILMIR", () => {
  const newsletter: any = (extra = {}) : any => form([input({ type: "email", ph: "Enter your email" })],
    [button({ text: "Subscribe" })], [], extra);

  it("ana səhifə: abunə forması + başlıqda 'Sign up' → forma AÇIQ sayılmır", async () => {
    const link = button({ tag: "A", text: "Sign up", type: "", href: "/signup" });
    const result = await inPage({ forms: [newsletter()], looseButtons: [link] },
      () => openSignupInPage(30));
    expect(result.already, "abunə qutusu qeydiyyat forması sayılmamalıdır").toBe(undefined);
    expect(link.clicked, "qeydiyyat linki basılmalı idi").toBe(true);
  });

  it("ana səhifə: abunə xanasına ünvan YAZILMIR (başqa forma da yoxdursa heç nə edilmir)", async () => {
    const box: any = newsletter();
    const result = await fill({ forms: [box] });
    expect(box.fields[0].value, "abunə xanasına yazılmamalı idi").toBe("");
    expect(result.done).toBe(false);
    expect(result.reason).toMatch(/uyğun sahə tapılmadı/);
  });

  it("abunə forması ilə qeydiyyat forması yanaşı olanda QEYDİYYAT seçilir", async () => {
    const box: any = newsletter();
    const signup: any = form([input({ type: "email", name: "reg_email" }),
      input({ type: "password", ac: "new-password" })], [button({ text: "Create account" })]);
    const result = await fill({ forms: [box, signup] });
    expect(box.fields[0].value).toBe("");
    expect(signup.fields[0].value).toBe(VALUES.email);
    expect(result.filled.includes("password")).toBeTruthy();
  });

  it("abunə nişanları: düymə, xananın imzası və formanın action-ı", async () => {
    const cases: any = [
      form([input({ type: "email" })], [button({ text: "Subscribe" })]),
      form([input({ type: "email" })], [button({ text: "Подписаться" })]),
      form([input({ type: "email", ph: "Email for our newsletter" })], [button({ text: "Go" })]),
      form([input({ type: "email", label: "Abunə ol" })], [button({ text: "Göndər" })]),
      form([input({ type: "email", boxText: "Stay updated with weekly digest" })], [button({ text: "OK" })]),
      form([input({ type: "email", name: "EMAIL", id: "mce-EMAIL" })], [button({ text: "Join" })],
        [], { action: "https://x.us1.list-manage.com/subscribe/post" }),
    ];
    for (const box of cases) {
      const result = await fill({ forms: [box] });
      expect(box.fields[0].value, JSON.stringify(box.fields[0].name)).toBe("");
      expect(result.done).toBe(false);
    }
  });

  it("QEYDİYYAT forması abunə sayılmır (marketinq xanası olsa da)", async () => {
    // Regresiya qorunması: razılıq/marketinq xanasının mətni bütün formanı damğalamamalıdır
    const signup: any = form([
      input({ type: "email" }),
      check({ boxText: "Send me the newsletter and product updates" }),
    ], [button({ text: "Create account" })]);
    const result = await fill({ forms: [signup] });
    expect(signup.fields[0].value).toBe(VALUES.email);
    expect(result.done).toBe(true);
  });

  it("axtarış forması doldurulmur", async () => {
    for (const search of [
      form([input({ type: "search", name: "q" })], [button({ text: "Search" })]),
      form([input({ type: "text", name: "q" })], [button({ text: "Search" })], [], { role: "search" }),
    ]) {
      const result = await fill({ forms: [search] });
      expect(search.fields[0].value).toBe("");
      expect(result.done).toBe(false);
    }
  });

  it("sənəd kökündə də abunə xanası sayılmır (forma seçilməyəndə)", async () => {
    // Abunə forması bloklanıbsa onun xanası sənəd kökündə də görünməməlidir
    const box: any = newsletter();
    const result = await inPage({ forms: [box] }, () : any => fillFormInPage(VALUES, { timeoutMs: 30, submitMs: 0 }));
    expect(box.fields[0].value).toBe("");
    expect(result.done).toBe(false);
  });

  // Eyni qüsur sinfinin qalan halları: poçt xanası olan, amma QEYDİYYAT OLMAYAN formalar.
  it("ƏLAQƏ forması doldurulmur (mesaj xanası var)", async () => {
    const contact: any = form([
      input({ type: "email", name: "email" }),
      input({ name: "full_name" }),
      textarea({ name: "message" }),
    ], [button({ text: "Send message" })]);
    const result = await fill({ forms: [contact] });
    expect(contact.fields[0].value).toBe("");
    expect(result.done).toBe(false);
  });

  it("ŞƏRH forması doldurulmur (WordPress: ad + poçt + şərh)", async () => {
    const comment: any = form([
      input({ name: "author" }), input({ type: "email", name: "email" }),
      input({ name: "url" }), textarea({ name: "comment" }),
    ], [button({ text: "Post Comment" })]);
    const result = await fill({ forms: [comment] });
    expect(comment.fields[1].value).toBe("");
    expect(result.done).toBe(false);
  });

  it("PAROLUN BƏRPASI forması doldurulmur", async () => {
    for (const text of ["Reset password", "Send reset link", "Forgot password", "Восстановить пароль"]) {
      const reset: any = form([input({ type: "email" })], [button({ text })]);
      const result = await fill({ forms: [reset] });
      expect(reset.fields[0].value, text).toBe("");
      expect(result.done, text).toBe(false);
    }
  });

  it("ÖDƏNİŞ/səbət forması doldurulmur (qonaq kimi alış)", async () => {
    for (const text of ["Checkout", "Place order", "Pay now", "Donate"]) {
      const checkout: any = form([input({ type: "email" }), input({ name: "city" })], [button({ text })]);
      const result = await fill({ forms: [checkout] });
      expect(checkout.fields[0].value, text).toBe("");
      expect(result.done, text).toBe(false);
    }
  });

  it("PAROL xanası varsa forma bloklanmır — ödəniş səhifəsində hesab yaradıla bilər", async () => {
    const signupAtCheckout: any = form([
      input({ type: "email" }), input({ type: "password", ac: "new-password" }),
    ], [button({ text: "Pay now" })]);
    const result = await fill({ forms: [signupAtCheckout] });
    expect(signupAtCheckout.fields[0].value).toBe(VALUES.email);
    expect(result.done).toBe(true);
  });

  it("qeydiyyat sözü olan düymə bütün blokları LƏĞV edir", async () => {
    // "Sign up" yazan düymə varsa forma qeydiyyat formasıdır — abunə/əlaqə/ticarət sayılmır
    for (const extra of [button({ text: "Subscribe" }), button({ text: "Send message" }),
      button({ text: "Checkout" })]) {
      const signup: any = form([input({ type: "email" }), textarea({ name: "message" })],
        [extra, button({ text: "Create account" })]);
      const result = await fill({ forms: [signup] });
      expect(signup.fields[0].value).toBe(VALUES.email);
      expect(result.done).toBe(true);
    }
  });
});
// ===========================================================================================
describe("qeydiyyat açılışının ümumi gecikmə regressiyaları", () => {
  const hide = (el: any) => Object.assign(el, { offsetParent: null, offsetWidth: 0, offsetHeight: 0 });
  const show = (el: any) => Object.assign(el, { offsetParent: {}, offsetWidth: 100, offsetHeight: 30 });
  function fixture() : any {
    const email = hide(input({ type: "email" }));
    const password = hide(input({ type: "password", ac: "new-password" }));
    const signup: any = form([email, password]);
    return { signup, reveal: () => { show(email); show(password); } };
  }

  it("sonradan yaranan başlıq düyməsi doldurma timeout-una düşmədən açılır", async () => {
    const { signup, reveal } = fixture();
    const start = hide(button({ text: "Register", type: "button" }));
    start.click = reveal;
    await inPage({ forms: [signup], looseButtons: [start] }, async () => {
      const timer = setTimeout(() => show(start), 40);
      try {
        const result = await openSignupInPage(700, { navigate: false });
        expect((result as any).ready).toBe(true);
      } finally { clearTimeout(timer); }
    });
  });

  it("eyni dərəcəli yeni email mərhələsi süni 2 saniyə gözləmir", async () => {
    const { signup, reveal } = fixture();
    const start = button({ text: "Sign up", type: "button" });
    const emailMethod = hide(button({ text: "Continue with email", type: "button" }));
    start.click = () => { hide(start); show(emailMethod); };
    emailMethod.click = reveal;
    await inPage({ forms: [signup], looseButtons: [start, emailMethod] }, async () => {
      const started = Date.now();
      const result = await openSignupInPage(6000, { navigate: false });
      expect((result as any).ready).toBe(true);
      expect(Date.now() - started < 700, "hazır növbəti addım dərhal seçilməlidir").toBeTruthy();
    });
  });

  it("gec açılan login modalının signup tabı eyni açılışda tapılır", async () => {
    const { signup, reveal } = fixture();
    const login = button({ text: "Log in", type: "button" });
    const tab = hide(button({ text: "Register", type: "button" }));
    let timer: any;
    login.click = () => { hide(login); timer = setTimeout(() => show(tab), 1200); };
    tab.click = reveal;
    await inPage({ forms: [signup], looseButtons: [login, tab] }, async () => {
      try {
        const result = await openSignupInPage(2700, { navigate: false });
        expect((result as any).ready, "gec modal login kimi doldurmaya ötürülməməlidir").toBe(true);
      } finally { clearTimeout(timer); }
    });
  });

  it("düymənin içindəki yazı yeni addım sayılıb eyni düymə təkrar basılmır", async () => {
    const { signup, reveal } = fixture();
    const start = button({ text: "Sign up", type: "button" });
    let clicks = 0, timer: any;
    const click = () => { clicks++; timer ??= setTimeout(reveal, 70); };
    start.click = click;
    const caption = textNode("Sign up", click);
    start.children = start.childNodes = [caption];
    start.contains = (el: any) => el === start || el === caption;
    caption.parentElement = start;
    const body = box("BODY", [start, signup]);
    await inPage({ forms: [signup], looseButtons: [start] }, async () => {
      (document as any).body = body;
      try {
        const result = await openSignupInPage(700, { navigate: false });
        expect((result as any).ready).toBe(true);
        expect(clicks).toBe(1);
      } finally { clearTimeout(timer); }
    });
  });

  it("6000-dən çox elementli səhifədə adi div qeydiyyat düyməsi də tapılır", async () => {
    const { signup, reveal } = fixture();
    const start = textNode("Register", reveal, { decorated: true });
    const body = box("BODY", [...Array.from({ length: 6100 }, () => textNode("Market price")), start, signup]);
    await inPage({ forms: [signup] }, async () => {
      (document as any).body = body;
      const result = await openSignupInPage(700, { navigate: false });
      expect((result as any).ready).toBe(true);
      expect(start.clicked).toBe(true);
    });
  });

  it("ilk düymə cavabsız qalanda mövcud ikinci qeydiyyat düyməsi də sınanır", async () => {
    const { signup, reveal } = fixture();
    const inactive = button({ text: "Sign up", type: "button" });
    const working = button({ text: "Register", type: "button" });
    working.click = reveal;
    await inPage({ forms: [signup], looseButtons: [inactive, working] }, async () => {
      const result = await openSignupInPage(900, { navigate: false });
      expect((result as any).ready).toBe(true);
      expect(inactive.clicked).toBe(true);
    });
  });
});

describe("qeydiyyat formasının açılması (openSignupInPage)", () => {
  const open = (dom: any) => inPage(dom, () => openSignupInPage(30));

  // ⚠ Parol xanası TƏK BAŞINA "qeydiyyat forması" demək deyil: giriş forması da parol daşıyır.
  // Əlavə əlamət lazımdır — `new-password`, təsdiq xanası, ad/istifadəçi adı xanası, formanın
  // qeydiyyat düyməsi, ya da /signup marşrutu. Şübhə olanda "açıq deyil" seçilir: onda ən pisi
  // bir artıq klikdir, əksi isə yad formaya yazmaq olardı.
  it("new-password xanası qeydiyyat formasıdır", async () => {
    const result = await open({ forms: [form([input({ type: "password", ac: "new-password" })])] });
    expect(result).toStrictEqual({ already: true });
  });

  it("parol + təsdiq xanası qeydiyyat formasıdır", async () => {
    const result = await open({
      forms: [form([input({ type: "password" }), input({ type: "password", name: "password_confirmation" })])],
    });
    expect(result).toStrictEqual({ already: true });
  });

  it("parol + qeydiyyat düyməsi qeydiyyat formasıdır", async () => {
    const result = await open({
      forms: [form([input({ type: "email" }), input({ type: "password" })], [button({ text: "Create account" })])],
    });
    expect(result).toStrictEqual({ already: true });
  });

  it("parol + istifadəçi adı xanası qeydiyyat formasıdır", async () => {
    const result = await open({
      forms: [form([input({ name: "username" }), input({ type: "password" })])],
    });
    expect(result).toStrictEqual({ already: true });
  });

  it("TƏK parol xanası (giriş forması ola bilər) açıq forma SAYILMIR", async () => {
    const link = button({ tag: "A", text: "Sign up", type: "" });
    const result = await open({
      forms: [form([input({ type: "email" }), input({ type: "password" })], [button({ text: "Log in" })])],
      looseButtons: [link],
    });
    expect(result.already).toBe(undefined);
    expect(link.clicked, "qeydiyyat linki axtarılmalı idi").toBe(true);
  });

  it("ünvan xanası + qeydiyyat düyməsi də açıq forma sayılır", async () => {
    const result = await open({ forms: [form([input({ type: "email" })], [button({ text: "Sign up" })])] });
    expect(result).toStrictEqual({ already: true });
  });

  it("kod xanası varsa forma açıq sayılır", async () => {
    const result = await open({ forms: [form([input({ name: "verification_code", maxLength: 6 })])] });
    expect(result).toStrictEqual({ already: true });
  });

  it("Sign up / Register / Qeydiyyat linki basılır", async () => {
    for (const text of ["Sign up", "Register", "Create account", "Qeydiyyat", "Kaydol", "Регистрация"]) {
      const link = button({ tag: "A", text, type: "" });
      const result = await open({ forms: [], looseButtons: [link] });
      expect(link.clicked, text).toBe(true);
      expect(result.opened).toBe(text);
    }
  });

  it("sosial giriş, pul kisəsi və 'artıq hesabım var' düymələri BASILMIR", async () => {
    for (const text of ["Continue with Google", "Continue with Apple", "Continue with Binance",
      "Continue with Wallet", "Sign in with Google", "Already a member?", "Forgot password"]) {
      const link = button({ tag: "A", text, type: "" });
      const result = await open({ forms: [], looseButtons: [link] });
      expect(link.clicked, text).not.toBe(true);
      expect(result, text).toStrictEqual({ none: true });
    }
  });

  // ⚠ REAL HAL (coinmarketcap.com): başlıqda qeydiyyat düyməsi YOXDUR — yalnız "Log In" var,
  // qeydiyyat tabı onun açdığı modalın içindədir. Ona görə giriş düyməsi SON EHTİMAL kimi
  // basılır: auth səthi açılır, sonra içindəki "Sign Up" tabı basılır.
  it("qeydiyyat düyməsi yoxdursa auth səthi ('Log In') açılır", async () => {
    const login = button({ tag: "A", text: "Log In", type: "" });
    await open({ forms: [], looseButtons: [login] });
    expect(login.clicked).toBe(true);
  });

  it("qeydiyyat düyməsi VARSA giriş düyməsinə toxunulmur", async () => {
    const login = button({ tag: "A", text: "Log In", type: "" });
    const signup = button({ tag: "A", text: "Sign up", type: "" });
    await open({ forms: [], looseButtons: [login, signup] });
    expect(signup.clicked).toBe(true);
    expect(login.clicked).not.toBe(true);
  });

  // Giriş formasının öz "Log in" submit düyməsi auth səthi açmır — basılsa boş forma
  // göndərilərdi (istifadəçi validasiya xətası görərdi).
  it("giriş formasının SUBMIT düyməsi basılmır", async () => {
    const submit = button({ text: "Log in", type: "submit" });
    const login: any = form([input({ type: "email" }), input({ type: "password" })], [submit]);
    const result = await open({ forms: [login] });
    expect(submit.clicked).not.toBe(true);
    expect(result).toStrictEqual({ none: true });
  });

  it("href-də signup olan link üstün tutulur", async () => {
    const weak = button({ tag: "A", text: "Join", type: "" });
    const strong = button({ tag: "A", text: "Register", type: "", href: "/auth/signup" });
    await open({ forms: [], looseButtons: [weak, strong] });
    expect(strong.clicked).toBe(true);
  });

  it("uyğun link yoxdursa heç nə basılmır", async () => {
    const link = button({ tag: "A", text: "Pricing", type: "" });
    const result = await open({ forms: [], looseButtons: [link] });
    expect(result).toStrictEqual({ none: true });
    expect(link.clicked).not.toBe(true);
  });

  it('"Sign up for our newsletter" düyməsi basılmır (abunə qutusudur)', async () => {
    const link = button({ tag: "A", text: "Sign up for our newsletter", type: "" });
    const result = await open({ forms: [], looseButtons: [link] });
    expect(link.clicked).not.toBe(true);
    expect(result).toStrictEqual({ none: true });
  });
});

// ===========================================================================================
// QEYDİYYAT SƏHİFƏSİNİN ÜNVANLA TAPILMASI
// ===========================================================================================
// Basılası element olmaya bilər: menyu gizlidir, düymə JS ilə sonra qurulur, qeydiyyat ayrı
// səhifədədir. Belə halda ünvan saytın ÖZ linklərindən oxunur (görünmə tələb olunmur, çünki
// `href` gizli menyuda da mövcuddur), tapılmasa standart yol təxmin edilir.
describe("qeydiyyat ünvanının tapılması (navigate)", () => {
  const anchor = (href: any, text = "") => button({ tag: "A", text, type: "", href, visible: false });
  const at = (url: any, dom: any) => inPage({ url, ...dom }, () => openSignupInPage(30));

  it("saytın öz /signup linki tapılır (gizli menyuda olsa da)", async () => {
    const result = await at("https://site.example/", { links: [anchor("/signup", "Sign up")] });
    expect(result).toStrictEqual({ navigate: "https://site.example/signup" });
  });

  it("register, create-account, join və qeydiyyat yolları tanınır", async () => {
    for (const path of ["/register", "/create-account", "/auth/signup", "/users/sign_up",
      "/en/join", "/qeydiyyat", "/uye-ol", "/hesab/kayit-ol"]) {
      const result = await at("https://site.example/", { links: [anchor(path)] });
      expect(result.navigate, path).toBe("https://site.example" + path);
    }
  });

  it("GİRİŞ linkləri seçilmir", async () => {
    for (const path of ["/login", "/signin", "/auth/login", "/forgot-password", "/reset-password"]) {
      const result = await at("https://site.example/", { links: [anchor(path)] });
      expect(result.navigate, path).not.toBe("https://site.example" + path);
    }
  });

  it("BAŞQA saytın linki seçilmir (activeTab icazəsi itərdi)", async () => {
    const result = await at("https://site.example/", { links: [anchor("https://other.example/signup")] });
    expect(result.navigate).toBe(undefined);
    expect(result).toStrictEqual({ none: true });
  });

  it("ən QISA yol üstün tutulur (yardım məqaləsi yerinə əsl səhifə)", async () => {
    const result = await at("https://site.example/", {
      links: [anchor("/help/articles/how-to-register-an-account"), anchor("/register")],
    });
    expect(result.navigate).toBe("https://site.example/register");
  });

  // ⚠ ÜNVAN TƏXMİN EDİLMİR. Əvvəlki versiya link tapmayanda "/signup" kimi standart yolları
  // sınayırdı və coinmarketcap.com-da bu, MÖVCUD OLMAYAN səhifəni açdı (istifadəçi xəta
  // səhifəsi gördü). Ünvan yalnız səhifənin öz `href`-lərindən gəlir.
  it("link yoxdursa ünvan TƏXMİN EDİLMİR", async () => {
    const result = await at("https://site.example/pricing", {});
    expect(result.navigate).toBe(undefined);
    expect(result).toStrictEqual({ none: true });
  });

  it("qeydiyyata aid olmayan linklər ünvan kimi işlədilmir", async () => {
    const result = await at("https://site.example/", {
      links: [anchor("/pricing"), anchor("/about"), anchor("/blog/how-to-join-a-webinar")],
    });
    expect(result.navigate).toBe(undefined);
  });

  it("ARTIQ qeydiyyat səhifəsindəyiksə keçid təklif olunmur (dövrə olmasın)", async () => {
    for (const url of ["https://site.example/signup", "https://site.example/auth/register?ref=1"]) {
      const result = await at(url, { links: [anchor("/register")] });
      expect(result.navigate, url).toBe(undefined);
      expect(result, url).toStrictEqual({ none: true });
    }
  });

  it("naviqasiya söndürüləndə (ikinci cəhd) ünvan qaytarılmır", async () => {
    const result = await inPage({ url: "https://site.example/", links: [anchor("/signup")] },
      () => openSignupInPage(30, { navigate: false }));
    expect(result).toStrictEqual({ none: true });
  });

  it("basılası düymə VARSA əvvəl o sınanır, keçid isə ehtiyatdır", async () => {
    const link = button({ tag: "A", text: "Sign up", type: "", href: "/signup" });
    const result = await inPage({ url: "https://site.example/", looseButtons: [link], links: [anchor("/register")] },
      () => openSignupInPage(30));
    expect(link.clicked, "əvvəl klik sınanmalıdır").toBe(true);
    // Klik forma açmadı → saytın ÖZ linki ilə keçid (standart yol TƏXMİN edilmir)
    expect(result.navigate).toBe("https://site.example/register");
  });

  it("klik forma açmadıqda standart yol TƏXMİN EDİLMİR (klik nəsə açmış ola bilər)", async () => {
    const link = button({ tag: "A", text: "Sign up", type: "" });
    const result = await inPage({ url: "https://site.example/", looseButtons: [link] },
      () => openSignupInPage(30));
    expect(link.clicked).toBe(true);
    expect(result.navigate).toBe(undefined);
    expect((result as any).ready).toBe(false);
  });

  it("location oxunmasa (test/qorunan mühit) keçid təklif olunmur", async () => {
    const result = await inPage({ links: [anchor("/signup")] }, () => openSignupInPage(30));
    expect(result).toStrictEqual({ none: true });
  });
});

// ===========================================================================================
// JS İLƏ AÇILAN AUTH MODALI ("Log In | Sign Up" tabları)
// ===========================================================================================
// ⚠ REAL HAL — coinmarketcap.com (ekran görüntüsü ilə təsdiqlənib):
//   • başlıqda QEYDİYYAT düyməsi yoxdur, yalnız "Log In" var;
//   • "Log In" basılanda JS modal açır; modalda "Log In | Sign Up" tabları olur və GİRİŞ tabı
//     aktiv gəlir (poçt + parol xanaları görünür);
//   • qeydiyyat üçün "Sign Up" tabı basılmalıdır.
// Əvvəllər script bu halda `coinmarketcap.com/signup` ünvanını UYDURUB açırdı və sayt xəta
// səhifəsi verirdi. İndi ardıcıllıq real DOM-dan gəlir: auth səthi açılır → tab basılır.
describe("auth modalı: 'Log In' → 'Sign Up' tabı", () => {
  // Modalın DOM-u: tab cərgəsi + aktiv tabın forması. Tab basılanda forma dəyişir.
  function authModal({ active = "login" }: any = {}) : any {
    const state = { active };
    const tab = (name: any, key: any) => {
      const el = button({ text: name, type: "", tag: "BUTTON" });
      el.getAttribute = (attribute: any) => {
        if (attribute === "aria-selected") return state.active === key ? "true" : "false";
        if (attribute === "role") return "tab";
        return null;
      };
      el.click = function () { this.clicked = true; state.active = key; };
      return el;
    };
    const loginTab = tab("Log In", "login");
    const signupTab = tab("Sign Up", "signup");
    // Modalın xanaları: giriş tabında poçt + parol, qeydiyyat tabında da poçt + parol
    // (CMC-də belədir) — fərq YALNIZ aktiv tabdadır, ona görə tab seçimi oxunmalıdır.
    const email = input({ type: "email", ph: "Enter your email address..." });
    const password = input({ type: "password" });
    const modal: any = form([email, password], [loginTab, signupTab, button({ text: "Continue with Google" })],
      [], { dialog: true });
    return { modal, loginTab, signupTab, state, email, password };
  }

  it("giriş tabı aktiv olanda forma AÇIQ sayılmır (ünvan girişə yazılmazdı)", async () => {
    const { modal } = authModal({ active: "login" });
    const result = await inPage({ forms: [modal] }, () => openSignupInPage(60));
    expect(result.already).toBe(undefined);
  });

  it("qeydiyyat tabı basılır və ondan sonra forma açıq sayılır", async () => {
    const { modal, signupTab, state } = authModal({ active: "login" });
    const result = await inPage({ forms: [modal] }, () => openSignupInPage(60));
    expect(signupTab.clicked, "Sign Up tabı basılmalı idi").toBe(true);
    expect(state.active).toBe("signup");
    expect((result as any).ready).toBe(true);
    expect(result.opened).toMatch(/Sign Up/);
  });

  it("qeydiyyat tabı ARTIQ aktivdirsə heç nə basılmır", async () => {
    const { modal, signupTab } = authModal({ active: "signup" });
    const result = await inPage({ forms: [modal] }, () => openSignupInPage(60));
    expect(result).toStrictEqual({ already: true });
    expect(signupTab.clicked).not.toBe(true);
  });

  it("modalın sosial düymələrinə toxunulmur", async () => {
    const { modal } = authModal({ active: "login" });
    const google = modal.buttons.find((el: any) => el.textContent === "Continue with Google");
    await inPage({ forms: [modal] }, () => openSignupInPage(60));
    expect(google!.clicked).not.toBe(true);
  });

  it("qeydiyyat tabı aktiv olandan sonra forma doldurulur", async () => {
    const { modal, email, password } = authModal({ active: "signup" });
    const result = await inPage({ forms: [modal] }, () : any => fillFormInPage(VALUES, { timeoutMs: 30, submitMs: 0 }));
    expect(email.value).toBe(VALUES.email);
    expect(password.value).toBe(VALUES.password);
    expect(result.done).toBe(true);
  });

  // Tam ssenari: ana səhifə + abunə qutusu + başlıqda yalnız "Log In".
  // Əvvəl ünvan abunə qutusuna yazılırdı, sonra uydurma /signup açılırdı — hər ikisi yanlışdır.
  it("ANA SƏHİFƏ: abunə qutusu var, başlıqda yalnız 'Log In' → auth modalı açılır", async () => {
    const newsletter: any = form([input({ type: "email", ph: "Enter your email" })],
      [button({ text: "Subscribe" })]);
    const loginBtn = button({ tag: "BUTTON", text: "Log In", type: "" });
    const result = await inPage({
      url: "https://coinmarketcap.com/",
      forms: [newsletter],
      looseButtons: [loginBtn],
      links: [],
    }, () => openSignupInPage(60));
    expect(newsletter.fields[0].value, "abunə xanasına toxunulmamalıdır").toBe("");
    expect(loginBtn.clicked, "auth səthi açılmalı idi").toBe(true);
    expect(result.navigate, "uydurma ünvan açılmamalıdır").toBe(undefined);
  });
});

// ===========================================================================================
// FORMASIZ AUTH MODALI: tab ADİ MƏTN BLOKUDUR, panel məzmunundan tanınır
// ===========================================================================================
// ⚠ İKİNCİ REAL QÜSUR (coinmarketcap.com, ekran görüntüsü): modal AÇILDI, amma "Sign Up" tabı
// basılmadı və ünvan/parol GİRİŞ formasına yazıldı. İki səbəb:
//   1. tablar `<button>`/`<a>`/`role="tab"` DEYİL — sadəcə klik hadisəsi olan mətn bloklarıdır,
//      ona görə standart seçicilər onları görmürdü;
//   2. modalda `<form>` elementi yoxdur, yəni forma səviyyəsindəki təsnif işə düşmürdü;
//      üstəlik modalda hər iki tabın yazısı ("Log In" və "Sign Up") göründüyü üçün "düymələrdə
//      qeydiyyat sözü var" şərti giriş panelini də qeydiyyat kimi göstərirdi.
// Həll: panelin növü ÖZ MƏZMUNUNDAN çıxarılır ("Forgot password?" → giriş; razılıq xanası →
// qeydiyyat) və modalın içində tab axtarışı adi elementlərə də şamil olunur.
describe("formasız auth modalı (CMC qurğusu)", () => {
  // Ekran görüntüsündəki giriş paneli: tablar + poçt + parol + "Forgot password?" + "Log In"
  function loginPanel() : any {
    const state = { active: "login" };
    const signupTab = textNode("Sign Up", () => { state.active = "signup"; });
    const loginTab = textNode("Log In", () => { state.active = "login"; });
    const email = input({ type: "email", ph: "Email Address" });
    const password = input({ type: "password", ac: "current-password" });
    const modal = dialogNode({
      fields: [email, password],
      buttons: [
        button({ text: "Log In", type: "submit" }),
        button({ text: "Continue with Google" }),
        button({ text: "Continue with Apple" }),
        button({ text: "Continue with Binance" }),
      ],
      texts: [loginTab, signupTab, textNode("Forgot password?")],
    });
    return { modal, email, password, loginTab, signupTab, state };
  }

  it("GİRİŞ paneli doldurulmur ('Forgot password?' + current-password nişanı)", async () => {
    const { modal, email, password } = loginPanel();
    const result = await inPage({ dialogs: [modal], loose: modal.fields },
      () : any => fillFormInPage(VALUES, { timeoutMs: 30, submitMs: 0 }));
    expect(email.value, "ünvan giriş formasına yazılmamalı idi").toBe("");
    expect(password.value).toBe("");
    expect(result.done).toBe(false);
  });

  it("giriş paneli açıq olanda forma AÇIQ sayılmır", async () => {
    const { modal } = loginPanel();
    const result = await inPage({ dialogs: [modal], loose: modal.fields },
      () => openSignupInPage(60));
    expect(result.already).toBe(undefined);
  });

  it("mətn blokundan ibarət 'Sign Up' tabı tapılıb basılır", async () => {
    const { modal, signupTab, state } = loginPanel();
    await inPage({ dialogs: [modal], loose: modal.fields }, () => openSignupInPage(60));
    expect(signupTab.clicked, "tab mətn bloku olsa da basılmalıdır").toBe(true);
    expect(state.active).toBe("signup");
  });

  it("modalın sosial düymələri və giriş submit-i basılmır", async () => {
    const { modal } = loginPanel();
    await inPage({ dialogs: [modal], loose: modal.fields }, () => openSignupInPage(60));
    for (const el of modal.buttons) expect(el.clicked, el.textContent).not.toBe(true);
  });

  it("QEYDİYYAT paneli (razılıq xanası nişanı) doldurulur", async () => {
    // Ekran görüntüsündəki qeydiyyat paneli: poçt + parol + marketinq xanası, "Forgot" yoxdur
    const email = input({ type: "email", ph: "Enter your email address..." });
    const password = input({ type: "password" });
    const consent = check({ boxText: "Please keep me updated by email with the latest crypto news" });
    const modal = dialogNode({
      fields: [email, password, consent],
      buttons: [button({ text: "Create an account", type: "submit" })],
      texts: [textNode("Log In"), textNode("Sign Up")],
    });
    const result = await inPage({ dialogs: [modal], loose: modal.fields },
      () : any => fillFormInPage(VALUES, { timeoutMs: 30, submitMs: 0 }));
    expect(email.value).toBe(VALUES.email);
    expect(password.value).toBe(VALUES.password);
    expect(result.done).toBe(true);
    expect(consent.checked, "marketinq xanası işarələnməməlidir").not.toBe(true);
  });
});

// ===========================================================================================
// NİŞANSIZ MODAL: nə <form>, nə role="dialog", nə class — YALNIZ iç-içə <div>-lər
// ===========================================================================================
// ⚠ ÜÇÜNCÜ REAL CƏHD. Əvvəlki iki düzəliş modalı `role="dialog"` / `.modal` ilə axtarırdı;
// coinmarketcap.com styled-components işlədir, yəni HEÇ BİR nişan yoxdur. Ona görə panel indi
// yalnız VALİDEYN ZƏNCİRİ ilə tapılır (`panelsOf` / `containersOf`) və bu testlər məhz həmin
// yolu yoxlayır: aşağıdaki ağacda nə forma, nə rol, nə class var.
describe("nişansız auth modalı (yalnız div ağacı)", () => {
  function cmcModal({ panel = "login" }: any = {}) : any {
    const state = { active: panel };
    // ⚠ REAL QURULUŞ (diaqnostikadan): tabın içində bəzək elementi var, yəni element YARPAQ
    // DEYİL. Etiket yalnız `ownText` ilə tapılır — hesabatda "Sign Up" məhz buna görə görünmədi.
    const signupTab = textNode("Sign Up", () => { state.active = "signup"; }, { decorated: true });
    const loginTab = textNode("Log In", () => { state.active = "login"; }, { decorated: true });
    const email = input({ type: "email", ph: "Enter your email address..." });
    const password = input({ type: "password", ph: "Enter your password..." });

    const body = panel === "login"
      ? [
        textNode("Email Address"), email,
        textNode("Password"), password, textNode("Forgot password?"),
        button({ text: "Log In", type: "" }),
      ]
      : [
        textNode("Or continue with email"),
        textNode("Email Address"), email,
        textNode("Password"), password,
        check({ label: "Please keep me updated by email with the latest crypto news" }),
        button({ text: "Create an account", type: "" }),
      ];

    const social = box("DIV", [
      button({ text: "Continue with Google", type: "" }),
      button({ text: "Continue with Apple", type: "" }),
      button({ text: "Continue with Binance", type: "" }),
    ]);
    const tabs = box("DIV", [loginTab, signupTab]);
    const panelBox = box("DIV", body);
    const modal = box("DIV", [tabs, panelBox, social]);
    return { modal, tabs, panelBox, email, password, loginTab, signupTab, state };
  }

  it("GİRİŞ paneli doldurulmur (nişan yoxdur, panel valideyn zənciri ilə tapılır)", async () => {
    const { modal, email, password } = cmcModal({ panel: "login" });
    const fields = modal.querySelectorAll(FIELD_SELECTOR);
    const result = await inPage({ loose: fields, looseButtons: modal.querySelectorAll("button") },
      () : any => fillFormInPage(VALUES, { timeoutMs: 30, submitMs: 0 }));
    expect(email.value, "ünvan giriş panelinə yazılmamalı idi").toBe("");
    expect(password.value).toBe("");
    expect(result.done).toBe(false);
  });

  it("mətn blokundan ibarət 'Sign Up' tabı valideyn zənciri ilə tapılıb basılır", async () => {
    const { modal, signupTab, state } = cmcModal({ panel: "login" });
    await inPage({
      loose: modal.querySelectorAll(FIELD_SELECTOR),
      looseButtons: modal.querySelectorAll("button"),
    }, () => openSignupInPage(60));
    expect(signupTab.clicked, "tab nişansız modalda da tapılmalıdır").toBe(true);
    expect(state.active).toBe("signup");
  });

  it("giriş paneli açıq olanda forma AÇIQ sayılmır", async () => {
    const { modal } = cmcModal({ panel: "login" });
    const result = await inPage({
      loose: modal.querySelectorAll(FIELD_SELECTOR),
      looseButtons: modal.querySelectorAll("button"),
    }, () => openSignupInPage(60));
    expect(result.already).toBe(undefined);
  });

  it("sosial düymələr basılmır", async () => {
    const { modal } = cmcModal({ panel: "login" });
    const buttons = modal.querySelectorAll("button");
    await inPage({ loose: modal.querySelectorAll(FIELD_SELECTOR), looseButtons: buttons },
      () => openSignupInPage(60));
    for (const el of buttons.filter((b: any) => /Continue with/.test(b.textContent))) {
      expect(el.clicked, el.textContent).not.toBe(true);
    }
  });

  it("QEYDİYYAT paneli (razılıq xanası + new-password) doldurulur", async () => {
    const { modal, email, password } = cmcModal({ panel: "signup" });
    const result = await inPage({
      loose: modal.querySelectorAll(FIELD_SELECTOR),
      looseButtons: modal.querySelectorAll("button"),
    }, () : any => fillFormInPage(VALUES, { timeoutMs: 30, submitMs: 0 }));
    expect(email.value).toBe(VALUES.email);
    expect(password.value).toBe(VALUES.password);
    expect(result.done).toBe(true);
  });

  it("qeydiyyat paneli açıq olanda forma AÇIQ sayılır (klik lazım deyil)", async () => {
    const { modal, signupTab } = cmcModal({ panel: "signup" });
    const result = await inPage({
      loose: modal.querySelectorAll(FIELD_SELECTOR),
      looseButtons: modal.querySelectorAll("button"),
    }, () => openSignupInPage(60));
    expect(result).toStrictEqual({ already: true });
    expect(signupTab.clicked).not.toBe(true);
  });

  it("səbəb statusda görünür: hansı xananın niyə buraxıldığı", async () => {
    const { modal } = cmcModal({ panel: "login" });
    const result = await inPage({ loose: modal.querySelectorAll(FIELD_SELECTOR) },
      () : any => fillFormInPage(VALUES, { timeoutMs: 30, submitMs: 0 }));
    expect(result.reason).toMatch(/giriş panelindədir/);
  });

  // YANAŞI duran giriş və qeydiyyat formaları (köhnə dizayn): qərar xananın ÖZ panelinə
  // görə verilir, kənar qata görə deyil — əks halda heç biri doldurulmazdı.
  it("yanaşı giriş + qeydiyyat panelində QEYDİYYAT doldurulur", async () => {
    const loginEmail = input({ type: "email", name: "login_email" });
    const loginPass = input({ type: "password", ac: "current-password" });
    const loginSide = box("DIV", [loginEmail, loginPass, textNode("Forgot password?"),
      button({ text: "Log in", type: "" })]);

    const regEmail = input({ type: "email", name: "reg_email" });
    const regPass = input({ type: "password", ac: "new-password" });
    const regConfirm = input({ type: "password", name: "password_confirmation" });
    const regSide = box("DIV", [regEmail, regPass, regConfirm, button({ text: "Register", type: "" })]);

    const page = box("DIV", [loginSide, regSide]);
    const result = await inPage({
      loose: page.querySelectorAll(FIELD_SELECTOR),
      looseButtons: page.querySelectorAll("button"),
    }, () : any => fillFormInPage(VALUES, { timeoutMs: 30, submitMs: 0 }));
    expect(regEmail.value, "qeydiyyat tərəfi doldurulmalıdır").toBe(VALUES.email);
    expect(regPass.value).toBe(VALUES.password);
    expect(loginEmail.value, "giriş tərəfinə toxunulmamalıdır").toBe("");
    expect(loginPass.value).toBe("");
    expect(result.done).toBe(true);
  });

  // ⚠ REAL MƏLUMATDAN: səhifədə `<form>` ümumiyyətlə yoxdur və görünən bir BÜLLETEN xanası var
  // ("Enter your e-mail address"). Giriş paneli bloklandıqda o, YEGANƏ namizəd qalır — ünvan
  // ora yazılsa ilk qüsur başqa yoldan qayıdardı. Tək poçt xanası qeydiyyat forması deyil.
  it("giriş paneli bloklananda səhifədəki bülleten xanası da doldurulmur", async () => {
    const { modal } = cmcModal({ panel: "login" });
    const pageMail = input({ type: "text", ph: "Enter your e-mail address" });
    const footer = box("DIV", [pageMail]);
    const result = await inPage({
      loose: [...modal.querySelectorAll(FIELD_SELECTOR), ...footer.querySelectorAll(FIELD_SELECTOR)],
      looseButtons: modal.querySelectorAll("button"),
    }, () : any => fillFormInPage(VALUES, { timeoutMs: 30, submitMs: 0 }));
    expect(pageMail.value, "bülleten xanasına yazılmamalı idi").toBe("");
    expect(result.done).toBe(false);
    expect(result.reason).toMatch(/qeydiyyat konteksti yoxdur|giriş panelindədir/);
  });

  it("qeydiyyat paneli açıq olanda bülleten xanası YENƏ toxunulmur, modal doldurulur", async () => {
    const { modal, email, password } = cmcModal({ panel: "signup" });
    const pageMail = input({ type: "text", ph: "Enter your e-mail address" });
    const footer = box("DIV", [pageMail]);
    const result = await inPage({
      loose: [...modal.querySelectorAll(FIELD_SELECTOR), ...footer.querySelectorAll(FIELD_SELECTOR)],
      looseButtons: modal.querySelectorAll("button"),
    }, () : any => fillFormInPage(VALUES, { timeoutMs: 30, submitMs: 0 }));
    expect(email.value).toBe(VALUES.email);
    expect(password.value).toBe(VALUES.password);
    expect(pageMail.value, "bülleten xanası boş qalmalıdır").toBe("");
    expect(result.done).toBe(true);
  });

  // ⚠ DÖRDÜNCÜ REAL CƏHD — hesabatdaki SƏNƏD SIRASI. Yuxarıdaki test bülleten xanasını
  // modaldan SONRA qoyurdu və məhz buna görə keçirdi: `assign` rolu birinci gələnə verir.
  // Real səhifədə sıra TƏRSİNƏDİR (diaqnostika: `fields[0]` = "Enter your e-mail address",
  // modalın ünvan xanası isə 12-cidir) — yəni `email` bülletenə düşür, modalın xanası isə
  // `nearBy` olmadığı üçün ümumiyyətlə atılır: parol modala, ünvan bülletenə yazılırdı.
  // Həll: sənəd kökü BİR forma sayılmır, PANEL kökləri ayrıca qiymətləndirilir (`tightest`).
  it("bülleten xanası modaldan ƏVVƏL gəlsə də ünvan MODALA yazılır", async () => {
    const { modal, email, password } = cmcModal({ panel: "signup" });
    const pageMail = input({ type: "text", ph: "Enter your e-mail address" });
    // Real quruluş: bülleten qutusu səhifənin öz bloklarının içindədir
    const pageBlock = box("DIV", [box("DIV", [pageMail])]);
    const root = box("DIV", [pageBlock, modal]);
    const fields = root.querySelectorAll(FIELD_SELECTOR);
    expect(fields[0], "sənəd sırası real hesabatla eyni olmalıdır").toBe(pageMail);
    const result = await inPage({
      loose: fields,
      looseButtons: root.querySelectorAll("button"),
      url: "https://coinmarketcap.com/",
    }, () : any => fillFormInPage(VALUES, { timeoutMs: 30, submitMs: 0 }));
    expect(email.value, "ünvan modalın xanasına yazılmalıdır").toBe(VALUES.email);
    expect(password.value).toBe(VALUES.password);
    expect(pageMail.value, "bülleten xanası boş qalmalıdır").toBe("");
    expect(result.done).toBe(true);
  });

  // Dar kök yalnız sənəd kökü qədər çox şey izah edirsə seçilir: iki qola ayrılmış səhifədə
  // (ortaq valideyn `containersOf` dərinliyindən uzaqda) yarım forma seçilməməlidir.
  it("xanalar uzaq qollarda olsa sənəd kökü qalır (yarım forma seçilmir)", async () => {
    const mail = input({ type: "email", name: "email" });
    const pass = input({ type: "password", ac: "new-password" });
    // Hər xana 9 qat dərinlikdə: ortaq valideyn heç bir xananın valideyn zəncirinə düşmür
    const bury = (el: any) => {
      let node = el;
      for (let i = 0; i < 9; i += 1) node = box("DIV", [node]);
      return node;
    };
    const root = box("DIV", [bury(mail), bury(pass),
      box("DIV", [button({ text: "Create account", type: "" })])]);
    const result = await inPage({
      loose: root.querySelectorAll(FIELD_SELECTOR),
      looseButtons: root.querySelectorAll("button"),
    }, () : any => fillFormInPage(VALUES, { timeoutMs: 30, submitMs: 0 }));
    expect(mail.value, "ünvan yenə doldurulmalıdır").toBe(VALUES.email);
    expect(pass.value, "parol yenə doldurulmalıdır").toBe(VALUES.password);
    expect(result.done).toBe(true);
  });
});

// ===========================================================================================
// DİAQNOSTİKA: səhifənin OLDUĞU KİMİ təsviri
// ===========================================================================================
// Qeydiyyat səthinin tapılması təxmindir və səhv təxmini kənardan görmək mümkün deyil. Bu
// funksiya səhifəni təsvir edir (heç nə dəyişdirmir) — düzəliş təxminlə deyil, faktla aparılır.
describe("describePageInPage", () => {
  it("xanaları, formaları və klikləniləsi mətnləri sadalayır", async () => {
    const email = input({ type: "email", name: "email", ph: "Email Address" });
    const password = input({ type: "password", ac: "current-password" });
    const signupTab = textNode("Sign Up");
    const modal = box("DIV", [box("DIV", [textNode("Log In"), signupTab]),
      box("DIV", [email, password, textNode("Forgot password?"), button({ text: "Log In", type: "" })])]);
    const fields = modal.querySelectorAll(FIELD_SELECTOR);

    const report = await inPage({
      url: "https://coinmarketcap.com/",
      loose: fields,
      looseButtons: modal.querySelectorAll("button"),
    }, () : any => describePageInPage());

    expect(report.url).toBe("https://coinmarketcap.com/");
    expect(report.fields.length).toBe(2);
    expect(report.fields[0].type).toBe("email");
    expect(report.fields[1].autocomplete).toBe("current-password");
    expect(report.fields[0].inForm, "formasız modal olduğu bilinməlidir").toBe(false);
    expect(report.fields[0].chain.length > 0, "valideyn zənciri yazılmalıdır").toBeTruthy();
  });

  it("mətn bloku olan tablar da hesabata düşür (əsas məsələ məhz budur)", async () => {
    const signupTab = textNode("Sign Up");
    const page = box("DIV", [textNode("Log In"), signupTab, textNode("Pricing")]);
    const report = await inPage({ url: "https://x.example/", loose: [], looseButtons: [] },
      () : any => {
        (globalThis as any).document.querySelectorAll = (selector: any) => (selector === "*"
          ? page.querySelectorAll("*")
          : []);
        return describePageInPage();
      });
    const texts = report.clickables.map((item: any) => item.text);
    expect(texts.includes("Sign Up"), JSON.stringify(texts)).toBeTruthy();
    expect(texts.includes("Log In")).toBeTruthy();
    expect(texts.includes("Pricing"), "aidiyyəti olmayan mətn siyahıya düşməməlidir").toBe(false);
    expect(report.clickables[0].tag, "tab düymə deyil — bu, hesabatda görünməlidir").toBe("div");
  });

  it("location oxunmasa da çökmür", async () => {
    const report = await inPage({}, () : any => describePageInPage());
    expect(report.url).toBe("");
    expect(Array.isArray(report.fields)).toBeTruthy();
    expect(report.note.some((line: any) => /location/.test(line))).toBeTruthy();
  });
});

// ===========================================================================================
// Worker tərəfi: chrome API-si saxtadır — hansı taba, hansı dünyaya müraciət olunduğu və
// xətaların necə mətnə çevrildiyi yoxlanılır.
function withChrome({ session = { started: 1 }, script, tab = { url: "https://x.com/" } }: any, fn: any) {
  const previous = (globalThis as any).chrome;
  const calls: any[] = [];
  const updates: any[] = [];
  const pageState: any = () : any => ({ documentId: tab?.documentId ?? `document-${updates.length}`,
    url: updates.at(-1)?.url ?? tab?.url, readyState: "complete" });
  (globalThis as any).chrome = {
    storage: { session: { get: async () : Promise<any> => ({ session }) } },
    runtime: { getPlatformInfo: async () : Promise<any> => ({}) },
    scripting: { executeScript: async (options: any) => {
      calls.push(options);
      if (options.func.name === "pageState") return [{ documentId: pageState().documentId, result: pageState() }];
      const result = await script(options);
      return options.func === openSignupInPage && Array.isArray(result)
        ? result.map((frame) : any => ({ documentId: pageState().documentId, ...frame })) : result;
    } },
    tabs: {
      get: async () => (tab ? { id: 7, status: "complete", ...tab } : Promise.reject(new Error("no tab"))),
      update: async (tabId: any, options: any) : Promise<any> => { updates.push({ tabId, ...options }); return { id: tabId, ...options }; },
      onUpdated: { addListener() {}, removeListener() {} },
    },
  };
  calls.length = 0;
  return fn(calls, updates).finally(() => {
    if (previous === undefined) delete (globalThis as any).chrome; else (globalThis as any).chrome = previous;
  });
}

const live = { relayTabId: 7, started: 1 };

describe("fillForm — worker tərəfi", () => {
  it("Microsoft ailəsində Azure-dan rəsmi giriş domeninə keçid qeydiyyatı kəsmir", () => {
    const session = { ...live, relaySite: "https://ai.azure.com" };
    return withChrome({ session, tab: { url: "https://login.microsoftonline.com/" },
      script: () => [{ result: { done: true, filled: ["email"] } }] }, async () => {
      const result = await fillForm(session, { email: VALUES.email }, { submit: false });
      expect(result.done).toBe(true);
    });
  });
  it("eyni saytın auth iframe-i doldurulur, yad iframe-ə dəyər ötürülmür", () => {
    const session = { ...live, relaySite: "https://www.example.com" };
    return withChrome({ session, tab: { url: session.relaySite }, script: (o: any) => {
      if (o.func.name === "frameOrigin") return [
        { documentId: "main-doc", frameId: 0, result: "https://www.example.com" },
        { documentId: "auth-doc", frameId: 4, result: "https://auth.example.com" },
        { documentId: "other-doc", frameId: 5, result: "https://unrelated.example" },
      ];
      if (o.target.documentIds?.includes("auth-doc")) {
        expect(o.args[1].allowedOrigins?.includes("https://auth.example.com") || o.args[1].allowedOrigin === "https://auth.example.com").toBeTruthy();
        return [{ documentId: "auth-doc", frameId: 4, result: o.args[1].mode === "submit"
          ? { submitted: "create account" } : { done: true, filled: ["email"] } }];
      }
      return [{ documentId: "main-doc", frameId: 0, result: { done: false } }];
    } }, async (calls: any) => {
      const result = await fillForm(session, { email: VALUES.email });
      expect(result.done).toBe(true);
      expect(result.submitted).toBe("create account");
      expect(calls.filter((call: any) => call.func === fillFormInPage).every((call: any) => !call.target.allFrames && !call.target.documentIds?.includes("other-doc"))).toBeTruthy();
    });
  });
  it("tab başqa sayta keçəndə geniş host icazəsi olsa da doldurmur", () =>
    withChrome({ session: { ...live, relaySite: "https://example.com" }, tab: { url: "https://unrelated.example/" },
      script: () => [{ result: { done: true } }] }, async (calls: any) => {
      const result = await fillForm({ ...live, relaySite: "https://example.com" }, { email: VALUES.email });
      expect(result.done).toBe(false);
      expect(calls.length).toBe(0);
    }));

  it("göndərmə doldurulan sənədə bağlanır, yeni sənəddə başqa düymə basılmır", () =>
    withChrome({ script: (o: any) => [{ documentId: "filled-document", frameId: 0,
      result: o.args[1].mode === "fill" ? { done: true, filled: ["email"] } : { submitted: "create account" } }] }, async (calls: any) => {
      await fillForm(live, { email: VALUES.email });
      expect(calls[1].target).toStrictEqual({ tabId: 7, documentIds: ["filled-document"] });
    }));
  it("doldurma və göndərmə AYRI-AYRI yeridilir (düymə səhifəni dəyişə bilər)", () =>
    withChrome({ script: (o: any) => [{ result: o.args[1].mode === "fill" ? { done: true, filled: ["email"] } : { submitted: "create account" } }] }, async (calls: any) => {
      const result = await fillForm(live, { email: VALUES.email, password: "", code: null });
      expect(result).toStrictEqual({ done: true, filled: ["email"], submitted: "create account" });
      expect(calls.length).toBe(2);
      expect(calls[0].target).toStrictEqual({ tabId: 7 });
      expect(calls[0].func).toBe(fillFormInPage);
      expect(calls[0].world).toBe("MAIN");
      expect(calls[0].injectImmediately, "hazır sahələr ağır resursların yüklənməsini gözləməməlidir").toBe(true);
      expect(calls[0].args).toStrictEqual([{ email: VALUES.email }, { timeoutMs: FIND_TIMEOUT_MS, mode: "fill", onlyEmpty: false }]);
      expect(calls[1].args[1].mode).toBe("submit");
      expect(calls[1].args[1].submitMs).toBe(SUBMIT_TIMEOUT_MS);
    }));

  it("submit: false ötürüləndə ikinci yeridilmə olmur", () =>
    withChrome({ script: () => [{ result: { done: true, filled: ["code"] } }] }, async (calls: any) => {
      await fillForm(live, { code: VALUES.code }, { submit: false });
      expect(calls.length).toBe(1);
      expect(calls[0].args[1].mode).toBe("fill");
    }));

  it("heç nə dolmasa göndərmə cəhdi edilmir", () =>
    withChrome({ script: () => [{ result: { done: false, reason: "formada uyğun sahə tapılmadı" } }] }, async (calls: any) => {
      const result = await fillForm(live, { code: VALUES.code });
      expect(result.done).toBe(false);
      // İki yeridilmə: əsas frame + bütün frame-lər (iframe ehtimalı). Göndərmə YOXDUR.
      expect(calls.length).toBe(2);
      expect(calls[1].target.allFrames).toBe(true);
      expect(calls.every((call: any) => call.args[1].mode === "fill")).toBeTruthy();
    }));

  // Bəzi saytlar qeydiyyat formasını eyni origin-li IFRAME-də verir (hostlanmış auth widget-i).
  // Əsas frame-də forma tapılmasa bütün frame-lər sınanır və göndərmə HƏMİN frame-də aparılır.
  it("forma iframe-dədirsə tapılır və göndərmə eyni frame-də aparılır", () =>
    withChrome({
      script: (o: any) => {
        if (o.target.allFrames) {
          return [
            { frameId: 0, result: { done: false, reason: "formada uyğun sahə tapılmadı" } },
            { frameId: 42, result: { done: true, filled: ["email", "password"] } },
          ];
        }
        if (o.args[1].mode === "submit") return [{ frameId: 42, result: { submitted: "create account" } }];
        return [{ frameId: 0, result: { done: false, reason: "formada uyğun sahə tapılmadı" } }];
      },
    }, async (calls: any) => {
      const result = await fillForm(live, { email: VALUES.email });
      expect(result.done).toBe(true);
      expect(result.filled).toStrictEqual(["email", "password"]);
      expect(result.submitted).toBe("create account");
      expect(calls[2].target, "göndərmə eyni frame-də olmalıdır").toStrictEqual({ tabId: 7, frameIds: [42] });
    }));

  it("əsas frame işləyəndə frame axtarışı APARILMIR (əlavə yeridilmə yoxdur)", () =>
    withChrome({ script: (o: any) => [{ result: o.args[1].mode === "fill" ? { done: true, filled: ["email"] } : { submitted: "ok" } }] },
      async (calls: any) => {
        await fillForm(live, { email: VALUES.email });
        expect(calls.length, "doldurma + göndərmə").toBe(2);
        expect(calls[0].target.allFrames).toBe(undefined);
        expect(calls[1].target).toStrictEqual({ tabId: 7 });
      }));

  it("göndərmə cavabsız qalsa bu, KEÇİD sayılır (doldurmanın nəticəsi qalır)", () =>
    withChrome({
      script: (o: any) => (o.args[1].mode === "fill"
        ? [{ result: { done: true, filled: ["email", "password"], checked: 1 } }]
        : new Promise(() => {})),          // klik naviqasiya etdi → cavab gəlmir
    }, async () => {
      const result = await fillForm(live, { email: VALUES.email }, { submitMs: 10, graceMs: 30 });
      expect(result.done).toBe(true);
      expect(result.filled).toStrictEqual(["email", "password"]);
      expect(result.navigated).toBe(true);
      expect(result.submitted).toBe(undefined);
    }));

  it("yazılacaq dəyər yoxdursa skript yeridilmir", () =>
    withChrome({ script: () => [{ result: { done: true } }] }, async (calls: any) => {
      expect((await fillForm(live, { code: "" })).reason).toMatch(/dəyər yoxdur/);
      expect(calls).toStrictEqual([]);
    }));

  it("relay tabı yoxdursa və sessiya dəyişibsə skript yeridilmir", () =>
    withChrome({ session: { started: 2 }, script: () => [{ result: { done: true } }] }, async (calls: any) => {
      expect((await fillForm({ started: 1 }, { code: "1" })).reason).toMatch(/relay tabı yoxdur/);
      expect((await fillForm(live, { code: "1" })).reason).toMatch(/sessiya dəyişdi/);
      expect(calls).toStrictEqual([]);
    }));

  it("icazə xətası blocked kimi qaytarılır", () =>
    withChrome({ script: () : any => { throw new Error('Cannot access contents of url "https://x.com/".'); } }, async () => {
      const result = await fillForm(live, { code: VALUES.code });
      expect(result.blocked).toBe(true);
      expect(result.reason).toMatch(/icazə/);
    }));

  it("digər xətalar udulur — kodun çatdırılması bundan asılı olmamalıdır", () =>
    withChrome({ script: () : any => { throw new Error("No tab with id: 7"); } }, async () => {
      const result = await fillForm(live, { code: VALUES.code });
      expect(result.done).toBe(false);
      expect(result.blocked).toBe(undefined);
      expect(result.reason).toMatch(/No tab with id/);
    }));
});

describe("openSignup — worker tərəfi", () => {
  it("hazır forma cavabından sonra əlavə sakitləşmə fasiləsi yoxdur", () =>
    withChrome({ script: () => [{ result: { opened: "Sign up", ready: true } }] }, async () => {
      let deadline;
      try {
        // Yarışın uduzanı `{ slow: true }` qaytarır — nəticə tipi hər iki variantı əhatə edir.
        const result = await Promise.race<OpenSignupResult & { slow?: boolean }>([openSignup(live), new Promise((resolve) => {
          deadline = setTimeout(() => resolve({ slow: true }), 400);
        })]);
        expect(result.slow, "hazır DOM üçün 1,2 saniyə gözlənməməlidir").toBe(undefined);
        expect(result.opened).toBe("Sign up");
      } finally { clearTimeout(deadline); }
    }));

  it("keçid tamamlananda ölmüş skriptin 10 saniyəlik limiti gözlənmir", () => {
    const tab = { url: "https://x.com/", documentId: "old-document" };
    return withChrome({ tab, script: () => new Promise(() => {}) }, async () => {
      const listeners = new Set<any>();
      (globalThis as any).chrome.tabs.onUpdated = {
        addListener: (listener: any) => listeners.add(listener),
        removeListener: (listener: any) => listeners.delete(listener),
      };
      const running = openSignup(live, { timeoutMs: 900, graceMs: 10 });
      for (let i = 0; i < 10 && !listeners.size; i++) await new Promise(setImmediate);
      expect(listeners.size, "naviqasiya skriptlə paralel izlənməlidir").toBeTruthy();
      for (const listener of listeners) listener(7, { status: "loading" });
      for (const listener of listeners) listener(99, { status: "complete" });
      tab.documentId = "new-document";
      for (const listener of listeners) listener(7, { status: "complete" });
      let deadline;
      try {
        const result = await Promise.race<OpenSignupResult & { slow?: boolean }>([running, new Promise((resolve) => {
          deadline = setTimeout(() => resolve({ slow: true }), 400);
        })]);
        expect(result.slow).toBe(undefined);
        expect(result.navigated).toBe(true);
        expect(listeners.size, "hadisə dinləyicisi təmizlənməlidir").toBe(0);
      } finally { clearTimeout(deadline); }
    });
  });

  it("nəticə olduğu kimi qaytarılır", () =>
    withChrome({ script: () => [{ result: { already: true } }] }, async (calls: any) => {
      expect(await openSignup(live)).toStrictEqual({ already: true });
      expect(calls.some((call: any) => call.func === openSignupInPage)).toBeTruthy();
    }));

  it("link açılıbsa ad qaytarılır", () =>
    withChrome({ script: () => [{ result: { opened: "Sign up", ready: true } }] }, async () => {
      const result = await openSignup(live);
      expect(result.opened).toBe("Sign up");
      expect(result.navigated).toBe(false);
    }));

  it("skript naviqasiya səbəbindən cavab verməsə bu xəta sayılmır", () =>
    withChrome({ script: () => new Promise(() => {}) }, async () => {
      const result = await openSignup(live, { timeoutMs: 10, graceMs: 30 });
      expect(result.navigated).toBe(true);
      expect(result.error).toBe(undefined);
    }));

  it("skript ölübsə və URL dəyişibsə də keçid sayılır", () => {
    const tab = { url: "https://x.com/", documentId: "old-document" };
    return withChrome({ tab, script: () : any => {
      tab.url = "https://x.com/signup";
      tab.documentId = "new-document";
      throw new Error("Frame with ID 0 was removed.");
    } }, async () => {
      const result = await openSignup(live);
      expect(result.navigated).toBe(true);
      expect(result.error).toBe(undefined);
    });
  });

  it("icazə xətası naviqasiya kimi yozulmur", () =>
    withChrome({ script: () : any => { throw new Error("Cannot access contents of url"); } }, async () => {
      const result = await openSignup(live);
      expect(result.blocked).toBe(true);
      expect(result.error).toMatch(/icazə/);
    }));

  // Səhifə funksiyası `{ navigate }` qaytardıqda tab HƏMİN ünvana aparılır və axtarış BİR DƏFƏ
  // təkrarlanır (ikinci cəhddə naviqasiya qadağandır — dövrə yaranmasın).
  it("navigate: tab qeydiyyat ünvanına aparılır və axtarış təkrarlanır", () =>
    withChrome({
      script: (o: any) => [{
        result: o.args[1]?.navigate === false
          ? { already: true }
          : { navigate: "https://x.com/signup" },
      }],
    }, async (calls: any, updates: any) => {
      const result = await openSignup(live);
      expect(updates).toStrictEqual([{ tabId: 7, url: "https://x.com/signup" }]);
      expect(result.navigatedTo).toBe("https://x.com/signup");
      expect((result as any).ready).toBe(true);
      const opens = calls.filter((call: any) => call.func === openSignupInPage);
      expect(opens.length, "ikinci axtarış aparılmalıdır").toBe(2);
      expect(opens[0].args[1].navigate).toBe(true);
      expect(opens[1].args[1].navigate, "ikinci cəhddə keçid qadağandır").toBe(false);
    }));

  it("navigate: səhifədə forma tapılmasa nəticə bunu deyir", () =>
    withChrome({
      script: (o: any) => [{
        result: o.args[1]?.navigate === false
          ? { none: true }
          : { navigate: "https://x.com/register" },
      }],
    }, async () => {
      const result = await openSignup(live);
      expect(result.navigatedTo).toBe("https://x.com/register");
      expect(result.ready, "səhifədə forma tapılmadı").toBe(false);
    }));

  it("navigate: keçid alınmasa aydın xəta qaytarılır", () =>
    withChrome({ script: () => [{ result: { navigate: "https://x.com/signup" } }] }, async () => {
      (globalThis as any).chrome.tabs.update = async () : Promise<any> => { throw new Error("No tab with id: 7"); };
      const result = await openSignup(live);
      expect(result.error).toMatch(/qeydiyyat səhifəsi açılmadı/);
    }));

  it("allowNavigate: false ötürüləndə səhifə funksiyası da keçid axtarmır", () =>
    withChrome({ script: () => [{ result: { none: true } }] }, async (calls: any, updates: any) => {
      await openSignup(live, { allowNavigate: false });
      expect(calls.find((call: any) => call.func === openSignupInPage).args[1].navigate).toBe(false);
      expect(updates).toStrictEqual([]);
    }));
});

describe("describePage — worker tərəfi", () => {
  it("verilmiş taba yeridilir və hesabatı qaytarır (sessiya tələb olunmur)", () =>
    withChrome({ script: () : any => [{ result: { url: "https://x.com/", fields: [], clickables: [] } }] },
      async (calls: any) => {
        const report = await describePage(7);
        expect(report.url).toBe("https://x.com/");
        expect(calls[0].target).toStrictEqual({ tabId: 7 });
        expect(calls[0].func).toBe(describePageInPage);
        expect(calls[0].world).toBe("MAIN");
      }));

  it("tab seçilməyibsə aydın xəta", async () => {
    await expect(() => describePage(null)).rejects.toThrow(/tab seçilməyib/);
  });

  it("icazə xətası istifadəçi dilinə çevrilir", () =>
    withChrome({ script: () : any => { throw new Error("Cannot access contents of url"); } }, async () => {
      await expect(() => describePage(7)).rejects.toThrow(/icazə/);
    }));
});

describe("signupValues", () => {
  it("profili düzəldir: ünvan, ad və parol sessiyadan gəlir", () => {
    const session = {
      address: "a@b.com", username: "userx", password: "p",
      identity: { email: "old@x.com", username: "old", firstName: "Emily", city: "Austin" },
    };
    expect(signupValues(session)).toStrictEqual({
      email: "a@b.com", username: "userx", password: "p", firstName: "Emily", city: "Austin",
    });
  });

  it("profil yoxdursa boş sahələr qaytarılır və extra üstündür", () => {
    expect(signupValues(null, { email: "x@y.z" })).toStrictEqual({ email: "x@y.z", username: "", password: "" });
  });
});

describe("fillNote / filledNote", () => {
  it("rollar istifadəçi dilinə çevrilir", () => {
    expect(filledNote(["email", "username", "firstName", "postal"])).toBe("ünvan + istifadəçi adı + ad + poçt indeksi");
    expect(filledNote([])).toBe("");
  });

  it("çox sahə olanda sayı yazılır", () => {
    const filled = ["email", "username", "password", "passwordConfirm", "firstName", "lastName"];
    expect(fillNote({ filled, checked: 2, chosen: 1, submitted: "create account" })).toBe('6 xana dolduruldu, 1 seçim, 2 razılıq xanası, "create account" basıldı');
  });

  it("az sahə ad-ad sadalanır, düymə basılmayıbsa səbəb yazılır", () => {
    expect(fillNote({ filled: ["code"], reason: "göndərmə düyməsi tapılmadı" })).toBe("kod, göndərmə düyməsi tapılmadı");
    expect(fillNote(null)).toBe("");
  });
});
