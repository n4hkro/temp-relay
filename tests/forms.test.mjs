// Naməlum saytda qeydiyyatın avtomatlaşdırılması (background/forms.js).
//
// Bu, saytdan asılı olmayan TƏXMİNDİR: sahələr `type`, `autocomplete`, `name`, `id`,
// `placeholder`, `aria-label` və LABEL mətninə görə tanınır. Səhv təxmin iki cür ziyan verir:
// ya yanlış xanaya yazır (promo kodu yerinə aktivasiya kodu), ya da heç nə tapmır. Üstəlik
// modul artıq düymə də basır — yanlış düymə (giriş, ödəniş, silmə) fəlakət olardı.
// Ona görə hər qayda burada yoxlanılır.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  describePage, describePageInPage,
  fillForm, fillFormInPage, fillNote, filledNote, FIND_TIMEOUT_MS, openSignup, openSignupInPage,
  signupValues, SUBMIT_TIMEOUT_MS,
} from "../src/background/forms.js";

describe("audit: qeydiyyatın düzgün sahə və konteynerlə məhdudlaşması", () => {
  function webshareForm() {
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
    assert.deepEqual(result, { already: true });
    assert.notEqual(go.clicked, true);
  });

  it("Webshare: email, current-password və formadan kənar yaxın razılıq doldurulur", async () => {
    const { dom, email, password, terms, go } = webshareForm();
    const result = await fill(dom, { email: VALUES.email, password: VALUES.password });
    assert.equal(email.value, VALUES.email);
    assert.equal(password.value, VALUES.password);
    assert.equal(terms.checked, true);
    assert.equal(result.checked, 1);
    assert.notEqual(go.clicked, true);
  });

  it("Webshare: razılıq gözləyən deaktiv submit də qeydiyyat nişanıdır", async () => {
    const { dom, email, password, terms, go } = webshareForm();
    go.disabled = true;
    const open = await inPage(dom, () => openSignupInPage(30, { navigate: false }));
    assert.deepEqual(open, { already: true });
    await fill(dom, { email: VALUES.email, password: VALUES.password });
    assert.equal(email.value, VALUES.email);
    assert.equal(password.value, VALUES.password);
    assert.equal(terms.checked, true);
  });

  it("Webshare: göndərmə yalnız hər iki sahə və razılıq hazır olduqda işləyir", async () => {
    const { dom, email, password, terms, go } = webshareForm();
    let atClick;
    go.click = () => { atClick = [email.value, password.value, terms.checked]; };
    const result = await fill(dom, { email: VALUES.email, password: VALUES.password }, true);
    assert.deepEqual(atClick, [VALUES.email, VALUES.password, true]);
    assert.equal(result.submitted, "sign up with email");
    assert.equal(result.codeRequested, undefined, "bu, kod istəmə düyməsi deyil");
  });

  it("Webshare: submit keçidi işarələnməmiş xarici razılığı keçmir", async () => {
    const { dom, email, password, go } = webshareForm();
    email.value = VALUES.email;
    password.value = VALUES.password;
    const result = await inPage(dom, () => fillFormInPage(VALUES,
      { timeoutMs: 30, submitMs: 30, mode: "submit" }));
    assert.notEqual(go.clicked, true);
    assert.match(result.reason, /razılıq/);
  });

  it("səhv təsnif olunmuş qeydiyyatın submit düyməsi açılış namizədi deyil", async () => {
    const password = input({ type: "password", ac: "current-password" });
    const go = button({ text: "Sign Up With Email" });
    go.getAttribute = (key) => key === "role" ? "tab" : null;
    // Sosial metod düyməsi də daxil olmaqla yanlış panel açıq sayılmamalıdır.
    const owner = form([password], [go]);
    await inPage({ forms: [owner] }, () => openSignupInPage(30, { navigate: false }));
    assert.notEqual(go.clicked, true);
  });

  it("submit daxilindəki mətn bloku açılış yoxlamasını keçə bilmir", async () => {
    const password = input({ type: "password", ac: "current-password" });
    const go = button({ text: "Sign Up With Email" });
    go.getAttribute = (key) => key === "role" ? "tab" : null;
    const caption = textNode("Sign Up With Email", () => { go.clicked = true; });
    go.children = go.childNodes = [caption];
    caption.parentElement = go;
    caption.closest = (selector) => climb(caption, selector);
    const root = box("FORM", [password, go]);
    Object.assign(root, { fields: [password], buttons: [go], customs: [] });
    await inPage({ forms: [root] }, () => openSignupInPage(30, { navigate: false }));
    assert.notEqual(go.clicked, true);
    assert.notEqual(caption.clicked, true);
  });

  it("type=button giriş düyməsi də boş parollu formanı göndərmir", async () => {
    const go = button({ text: "Log in", type: "button" });
    const root = form([input({ type: "password", ac: "current-password" })], [go]);
    await inPage({ forms: [root] }, () => openSignupInPage(30, { navigate: false }));
    assert.notEqual(go.clicked, true);
  });

  it("ortaq qutuda başqa forma varsa onun xaricindəki razılıq götürülmür", async () => {
    const { dom, signup, terms } = webshareForm();
    const other = box("FORM", [input({ type: "email" })]);
    Object.assign(other, { fields: other.querySelectorAll(FIELD_SELECTOR), buttons: [], customs: [] });
    box("DIV", [signup, other, terms]);
    await fill({ ...dom, forms: [signup, other] });
    assert.equal(terms.checked, false);
  });

  it("eyni dialoqda email düyməsindən ayrı yerləşən parol da doldurulur", async () => {
    const email = input({ type: "email" });
    const password = input({ type: "password", ac: "new-password" });
    const modal = box("DIV", [box("DIV", [email, button({ text: "Get started" })]), box("DIV", [password])], { role: "dialog" });
    await fill({ loose: modal.querySelectorAll(FIELD_SELECTOR), looseButtons: modal.querySelectorAll("button") },
      { email: VALUES.email, password: VALUES.password });
    assert.equal(email.value, VALUES.email);
    assert.equal(password.value, VALUES.password);
  });
  it("Send code yanındakı email xanası kod xanası sayılmır", async () => {
    const email = input({ type: "email", name: "email" });
    const send = button({ text: "Send code" });
    const root = box("FORM", [box("DIV", [email, send])]);
    Object.assign(root, { fields: [email], buttons: [send], customs: [] });
    await fill({ forms: [root] }, { email: VALUES.email });
    assert.equal(email.value, VALUES.email);
  });

  it("başqa formanın gizli razılıq xanasına toxunmur", async () => {
    const other = check({ boxText: "I accept the Terms of Service", visible: false });
    const signup = form([input({ type: "email" }), input({ type: "password", ac: "new-password" })]);
    const contact = form([textarea({ name: "message" }), other], [button({ text: "Send message" })]);
    await fill({ forms: [signup, contact] }, { email: VALUES.email, password: VALUES.password });
    assert.equal(other.checked, false);
  });

  it("qeydiyyat dialoqu səhifənin əlaqəsiz email/telefon sahələrindən üstündür", async () => {
    const pageMail = input({ type: "email" }), phone = input({ name: "phone" });
    const email = input({ type: "email" });
    const modal = box("DIV", [email, input({ type: "password", ac: "new-password" }), button({ text: "Create account" })], { role: "dialog" });
    const page = box("DIV", [box("DIV", [pageMail, phone]), modal]);
    await fill({ loose: page.querySelectorAll(FIELD_SELECTOR), looseButtons: page.querySelectorAll("button") },
      { email: VALUES.email, password: VALUES.password, phone: VALUES.phone });
    assert.equal(email.value, VALUES.email);
    assert.equal(pageMail.value, "");
    assert.equal(phone.value, "");
  });

  it("gözləmə vaxtı login paneli signup-a çevriləndə yenidən qiymətləndirir", async () => {
    const email = input({ type: "email" });
    const fields = [email, input({ type: "password", ac: "current-password" })];
    const buttons = [button({ text: "Log in" })];
    const panel = form(fields, buttons);
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
    assert.equal(email.value, VALUES.email);
  });
});

// --- saxta DOM -----------------------------------------------------------------------------
// Səhifə funksiyaları həqiqi DOM API-sinin kiçik bir hissəsini işlədir: querySelectorAll,
// getAttribute, closest, offset*, dispatchEvent, click. Hamısı burada təqlid olunur.
function base({ type = "text", name = "", id = "", ac = null, label = null, ph = "", title = null,
  testId = null, boxText = null, maxLength = -1, minLength = -1, pattern = null, required = false,
  disabled = false, readOnly = false, visible = true, value = "" } = {}) {
  const el = {
    tagName: "INPUT", type, name, id, placeholder: ph, maxLength, minLength, required,
    disabled, readOnly, events: [], _value: String(value),
    childNodes: [],                       // xanada mətn qovşağı olmur (ownText → "")
    offsetParent: visible ? {} : null, offsetWidth: visible ? 200 : 0, offsetHeight: visible ? 30 : 0,
    getAttribute(key) {
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
    closest(selector) {
      if (selector === "label") return this._label ?? null;
      if (selector.startsWith("form")) return this._form ?? this._dialog ?? null;
      if (selector.startsWith("[role='dialog']")) return this._dialog ?? null;
      return boxText === null ? null : { textContent: boxText };
    },
    focus() { this.focused = true; },
    blur() { this.blurred = true; },
    scrollIntoView() { this.scrolled = true; },
    dispatchEvent(event) { this.events.push(event.type); return true; },
    click() { this.clicked = true; if (this.type === "checkbox" || this.type === "radio") this.checked = true; },
  };
  // `value` prototipdəki setter ilə yazılır (kod React üçün məhz belə edir)
  const proto = {
    set value(v) { this._value = this.maxLength > 0 ? String(v).slice(0, this.maxLength) : String(v); },
    get value() { return this._value; },
  };
  return Object.assign(Object.create(proto), el);
}

const input = (props) => base(props);
const textarea = (props) => Object.assign(base(props), { tagName: "TEXTAREA", type: undefined });
const check = (props = {}) => Object.assign(base({ type: "checkbox", ...props }), { checked: props.checked === true });
const radio = (props = {}) => Object.assign(base({ type: "radio", ...props }), { checked: props.checked === true });

// GÖRÜNMƏYƏN checkbox + ona bağlı <label>: müasir dizayn sistemlərinin (Tailwind `sr-only`,
// shadcn, MUI) standart qurğusu. Əsl input gizlidir, klik label-a düşür.
// `native: false` — input-un öz `click()`-i state-i dəyişmir (bəzi framework-larda belədir),
// yalnız label kliki işləyir. Beləliklə label yolunun HƏQİQƏTƏN işlədiyi yoxlanılır.
function hiddenCheck({ id = "terms-box", text = "I agree to the Terms of Service", native = false, ...props } = {}) {
  const box = check({ id, visible: false, ...props });
  if (!native) box.click = function () { this.clickedSelf = true; };
  const label = {
    tagName: "LABEL", textContent: text,
    getAttribute: (key) => (key === "for" ? id : null),
    offsetParent: {}, offsetWidth: 200, offsetHeight: 20,
    closest: () => null,
    click() { this.clicked = true; box.checked = true; },
  };
  box._label = label;
  return { box, label };
}

// `data-state="checked"` (Radix/shadcn) və ya aria ilə ARTIQ işarələnmiş xana
const stateCheck = ({ state = "checked", text = "I agree to the terms" } = {}) => {
  const box = check({ boxText: text });
  box.getAttribute = function (key) {
    if (key === "data-state") return state;
    if (key === "aria-checked") return null;
    if (key === "aria-required") return null;
    if (key === "aria-disabled") return null;
    return null;
  };
  return box;
};

function select({ options = [], ...props } = {}) {
  const el = Object.assign(base({ type: "select-one", ...props }), { tagName: "SELECT" });
  el.options = options.map((option) => (typeof option === "string"
    ? { value: option, textContent: option, disabled: false }
    : { value: option.value ?? option.text ?? "", textContent: option.text ?? option.value ?? "", disabled: option.disabled === true }));
  return el;
}

// Mətn qovşağı: `ownText` yalnız BİRBAŞA mətn qovşaqlarını oxuyur (nodeType 3)
const textPart = (text) => ({ nodeType: 3, nodeValue: text });

function button({ text = "", type = "submit", tag = "BUTTON", label = null, value = "",
  disabled = false, ariaDisabled = null, visible = true, href = null } = {}) {
  return {
    tagName: tag, type, textContent: text, value, disabled,
    childNodes: text ? [textPart(text)] : [],
    offsetParent: visible ? {} : null, offsetWidth: visible ? 100 : 0, offsetHeight: visible ? 30 : 0,
    getAttribute(key) {
      if (key === "aria-disabled") return ariaDisabled;
      if (key === "aria-label") return label;
      if (key === "href") return href;
      return null;
    },
    // Real DOM-da düymə də öz formasını/dialoqunu tapır: `form()` bu əlaqəni qurur
    closest(selector) {
      if (selector.startsWith("form")) return this._form ?? this._dialog ?? null;
      if (selector.startsWith("[role='dialog']")) return this._dialog ?? null;
      return null;
    },
    click() { this.clicked = true; },
  };
}

// Custom checkbox: React komponentləri belə olur (div[role="checkbox"])
const custom = ({ label = null, checked = false, role = "checkbox" } = {}) => ({
  tagName: "DIV", role,
  getAttribute(key) {
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
const routeAll = (fields, buttons, customs) => (selector) => {
  if (selector === "form") return [];
  if (selector === FIELD_SELECTOR) return fields;
  if (selector === CHECKBOX_SELECTOR) return fields.filter((el) => el.type === "checkbox");
  if (selector.startsWith("label[for=")) return [];
  if (selector.includes('role="checkbox"')) return customs;
  if (selector.includes("button")) return buttons;
  return [];
};
// Forma: xanalar + düymələr (+ custom checkbox-lar).
// `text` — formanın mətni (abunə qutusunu tanımaq üçün: "Subscribe to our newsletter"),
// `action` — formanın göndərildiyi ünvan (Mailchimp və s. birbaşa nişandır),
// `dialog` — forma açılan pəncərənin (modal) içindədir.
const form = (fields, buttons = [], customs = [], { text = "", action = null, role = null, dialog = false } = {}) => {
  const dialogNode = dialog
    ? { tagName: "DIV", getAttribute: (key) => (key === "role" ? "dialog" : null), offsetParent: {}, offsetWidth: 300, offsetHeight: 200 }
    : null;
  const node = {
    tagName: "FORM", fields, buttons, customs, textContent: text,
    getAttribute: (key) => (key === "action" ? action : key === "role" ? role : null),
    querySelectorAll: routeAll(fields, buttons, customs),
    closest: (selector) => (selector.startsWith("[role='dialog']") ? dialogNode : null),
    // Sənəd kökü yerinə forma seçiləndə "bu element formanın içindədirmi?" yoxlanılır
    contains: (el) => fields.includes(el) || buttons.includes(el) || customs.includes(el),
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
  url = null, links = [], dialogs = [] }, run) {
  const previous = {
    document: globalThis.document, Event: globalThis.Event,
    MutationObserver: globalThis.MutationObserver, CSS: globalThis.CSS, location: globalThis.location,
  };
  const fields = [...forms.flatMap((f) => f.fields), ...dialogs.flatMap((d) => d.fields), ...loose];
  const buttons = [...forms.flatMap((f) => f.buttons), ...dialogs.flatMap((d) => d.buttons), ...looseButtons];
  const customs = [...forms.flatMap((f) => f.customs), ...looseCustoms];
  const route = routeAll(fields, buttons, customs);
  const isDialogSelector = (selector) => selector.startsWith("[role='dialog']");
  globalThis.document = {
    documentElement: {},
    getElementById: () => null,
    querySelector: (selector) => {
      if (isDialogSelector(selector)) return dialogs[0] ?? null;
      const match = /^label\[for="(.*)"\]$/.exec(selector);
      if (!match) return null;
      return labels.find((tag) => tag.getAttribute("for") === match[1]) ?? null;
    },
    querySelectorAll: (selector) => {
      if (selector === "form") return forms;
      if (selector === "a[href]") return links;
      return route(selector);
    },
  };
  globalThis.Event = class { constructor(type, options) { this.type = type; Object.assign(this, options); } };
  globalThis.MutationObserver = class { constructor() {} observe() {} disconnect() {} };
  globalThis.CSS = { escape: (v) => v };
  if (url) globalThis.location = new URL(url);
  else delete globalThis.location;
  try { return await run(); } finally {
    for (const key of ["document", "Event", "MutationObserver", "CSS", "location"]) {
      if (previous[key] === undefined) delete globalThis[key]; else globalThis[key] = previous[key];
    }
  }
}

// Formasız MODAL (React auth pəncərəsi): `<form>` elementi yoxdur, hər şey dialoqun içindədir.
// `texts` — sadə mətn blokları (tab yazıları, "Forgot password?" keçidi): `<button>` deyil,
// yalnız klik hadisəsi olan `<div>`-lərdir. Real saytlarda tablar məhz belə qurulur.
function dialogNode({ fields = [], buttons = [], texts = [] } = {}) {
  const node = {
    tagName: "DIV", fields, buttons, texts,
    getAttribute: (key) => (key === "role" ? "dialog" : null),
    offsetParent: {}, offsetWidth: 500, offsetHeight: 600,
    querySelectorAll: (selector) => {
      if (selector === FIELD_SELECTOR) return fields;
      if (selector === CHECKBOX_SELECTOR) return fields.filter((el) => el.type === "checkbox");
      if (selector === "*") return [...texts, ...buttons, ...fields];
      if (selector.startsWith("a, button, label, span")) return [...texts, ...buttons];
      if (selector.includes("button")) return buttons;
      return [];
    },
    closest: (selector) => (selector.startsWith("[role='dialog']") ? node : null),
    contains: (el) => fields.includes(el) || buttons.includes(el) || texts.includes(el),
  };
  for (const el of [...fields, ...buttons, ...texts]) el._dialog = node;
  return node;
}

// Klik hadisəsi olan sadə mətn bloku (tab, keçid). `<button>`/`<a>` DEYİL.
// `decorated: true` — REAL HAL: tabın içində bəzək elementi (alt xətt) olur, yəni element
// yarpaq deyil. Etiket yalnız `ownText` ilə tapılır — coinmarketcap.com-da məhz belədir.
const textNode = (text, onClick, { decorated = false } = {}) => ({
  tagName: "DIV", textContent: text,
  childNodes: [textPart(text), ...(decorated ? [{ nodeType: 1, tagName: "DIV" }] : [])],
  children: decorated ? [{ tagName: "DIV", textContent: "" }] : [],
  getAttribute: () => null,
  offsetParent: {}, offsetWidth: 90, offsetHeight: 24,
  closest(selector) {
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
const descendantsOf = (node) => {
  const out = [];
  for (const child of node.children ?? []) {
    out.push(child);
    if (child.children?.length) out.push(...descendantsOf(child));
  }
  return out;
};

const tagOf = (node) => (node.tagName ?? "").toUpperCase();

function matchesSelector(node, selector) {
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

const climb = (node, selector) => {
  let current = node;
  while (current) {
    if (matchesSelector(current, selector)) return current;
    current = current.parentElement ?? null;
  }
  return null;
};

// Konteyner element: uşaqları ilə birlikdə. `role`/`class` QƏSDƏN default null-dır.
function box(tag, children, { role = null, action = null, className = null } = {}) {
  const node = {
    tagName: tag, children,
    childNodes: children,                 // yalnız element qovşaqları → ownText boşdur
    offsetParent: {}, offsetWidth: 400, offsetHeight: 300,
    getAttribute: (key) => (key === "role" ? role : key === "action" ? action
      : key === "class" ? className : null),
    querySelectorAll: (selector) => descendantsOf(node).filter((el) => matchesSelector(el, selector)),
    contains: (el) => el === node || descendantsOf(node).includes(el),
  };
  Object.defineProperty(node, "textContent", {
    get: () => descendantsOf(node).map((el) => (el.children?.length ? "" : (el.textContent ?? ""))).join(" "),
  });
  node.closest = (selector) => climb(node, selector);
  for (const child of children) {
    child.parentElement = node;
    child.closest = (selector) => climb(child, selector);
  }
  return node;
}

// Bütöv profil: shared/identity.js-in verdiyi forma
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
const fill = (dom, values = VALUES, submit = false) =>
  inPage(dom, () => fillFormInPage(values, { timeoutMs: 30, submitMs: submit ? 30 : 0 }));

// Bir xananı doldurub dəyərini qaytarır (rol yoxlamaları üçün qısa yol)
const one = async (props, values = VALUES) => {
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
      assert.equal(el.value, VALUES.email, JSON.stringify(props));
    }
  });

  it("istifadəçi adı ünvandan AYRI doldurulur", async () => {
    const email = input({ type: "email" });
    const user = input({ name: "username" });
    const result = await fill({ forms: [form([email, user])] });
    assert.equal(email.value, VALUES.email);
    assert.equal(user.value, VALUES.username);
    assert.ok(result.filled.includes("username"));
  });

  it("ikinci poçt və parol xanası TƏSDİQ sayılır (adında təsdiq sözü olmasa da)", async () => {
    const email = input({ type: "email" });
    const email2 = input({ type: "email", name: "email_2" });
    const pass = input({ type: "password", ac: "new-password" });
    const pass2 = input({ type: "password", name: "pass2" });
    const result = await fill({ forms: [form([email, email2, pass, pass2])] });
    assert.equal(email2.value, VALUES.email);
    assert.equal(pass2.value, VALUES.password);
    assert.ok(result.filled.includes("emailConfirm") && result.filled.includes("passwordConfirm"));
  });

  it("current-password sahəsinə TOXUNULMUR (giriş və ya parolu dəyiş forması)", async () => {
    const el = input({ type: "password", ac: "current-password" });
    const result = await fill({ forms: [form([el])] });
    assert.equal(el.value, "");
    assert.equal(result.done, false);
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
      assert.deepEqual(result.filled, [role], `${JSON.stringify(props)} → ${role}`);
      assert.notEqual(el.value, "", JSON.stringify(props));
    }
  });

  it("textarea yalnız haqqında/mesaj sözü ilə doldurulur", async () => {
    const bio = textarea({ name: "about_you" });
    assert.deepEqual((await fill({ forms: [form([bio])] })).filled, ["bio"]);
    assert.equal(bio.value, VALUES.bio);

    const other = textarea({ name: "custom_json" });
    assert.equal((await fill({ forms: [form([other])] })).done, false);
  });

  it("axtarış, promo, kupon və məbləğ xanalarına TOXUNULMUR", async () => {
    for (const name of ["search", "q", "promo_code", "coupon", "referral_code", "quantity", "amount"]) {
      const el = input({ name });
      assert.equal((await fill({ forms: [form([el])] })).done, false, name);
      assert.equal(el.value, "", name);
    }
  });

  it("saytın/istifadəçinin yazdığı dəyər üzərindən YAZILMIR (ünvan və parol istisnadır)", async () => {
    const city = input({ name: "city", value: "Baku" });
    const email = input({ type: "email", value: "old@example.com" });
    await fill({ forms: [form([city, email])] });
    assert.equal(city.value, "Baku", "profil xanası qorunur");
    assert.equal(email.value, VALUES.email, "ünvan bizimdir — yenilənir");
  });
});

describe("dəyər forması xananın məhdudiyyətinə uyğunlaşır", () => {
  it("telefon: maxlength 10 olanda yalnız rəqəmlər yazılır", async () => {
    const el = input({ type: "tel", maxLength: 10 });
    await fill({ forms: [form([el])] });
    assert.equal(el.value, VALUES.phoneDigits);
  });

  it("telefon: pattern verilibsə ona uyğun variant seçilir", async () => {
    const el = input({ type: "tel", pattern: "\\+[0-9]{11,13}" });
    await fill({ forms: [form([el])] });
    assert.equal(el.value, VALUES.phone);
  });

  it("ad xanası qısa olarsa kəsilir", async () => {
    const el = input({ name: "username", maxLength: 5 });
    const result = await fill({ forms: [form([el])] });
    assert.equal(el.value, VALUES.username.slice(0, 5));
    assert.deepEqual(result.filled, ["username"]);
  });

  it("kəsilməsi ziyanlı rollar (indeks, parol, kod) uyğun gəlmirsə YAZILMIR", async () => {
    const postal = input({ name: "zip", maxLength: 3 });
    const result = await fill({ forms: [form([postal, input({ name: "city" })])] });
    assert.equal(postal.value, "");
    assert.deepEqual(result.failed, ["postal"]);
    assert.ok(result.filled.includes("city"), "qalan xanalar yenə dolur");
  });

  it("ştat və ölkə üçün qısa kod variantı var", async () => {
    const state = input({ name: "state", maxLength: 2 });
    const country = input({ name: "country", maxLength: 2 });
    await fill({ forms: [form([state, country])] });
    assert.equal(state.value, VALUES.stateCode);
    assert.equal(country.value, VALUES.countryCode);
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
    assert.equal(country.value, "United States");
    assert.equal(state.value, "TX");
    assert.equal(month.value, "July");
    assert.equal(day.value, "17");
    assert.equal(year.value, "1994");
    assert.equal(result.filled.length, 5);
  });

  it("ölkə kodu siyahısı (+1) tanınır", async () => {
    const el = select({ name: "phone_country_code", options: ["", "+90 Turkey", "+1 United States"] });
    await fill({ forms: [form([el])] });
    assert.equal(el.value, "+1 United States");
  });

  it("cins siyahısında neytral variant üstün tutulur", async () => {
    const el = select({ name: "gender", options: ["", "Male", "Female", "Prefer not to say"] });
    await fill({ forms: [form([el])] });
    assert.equal(el.value, "Prefer not to say");
  });

  it("neytral variant yoxdursa profilin cinsi seçilir", async () => {
    const el = select({ name: "gender", options: ["", "Male", "Female"] });
    await fill({ forms: [form([el])] });
    assert.equal(el.value, "Female");
  });

  it("müraciət (Mr/Ms) siyahısı doldurulur", async () => {
    const el = select({ name: "title", options: ["", "Mr", "Ms", "Dr"] });
    await fill({ forms: [form([el])] });
    assert.equal(el.value, "Ms");
  });

  it("rolu tanınmayan MƏCBURİ siyahı ilk həqiqi variantı alır", async () => {
    const el = select({ name: "how_did_you_hear", required: true, options: ["Select an option", "Friend", "Ads"] });
    const result = await fill({ forms: [form([el, input({ type: "email" })])] });
    assert.equal(el.value, "Friend", "yer tutan variant seçilmir");
    assert.equal(result.chosen, 1);
  });

  it("məcburi olmayan naməlum siyahıya toxunulmur", async () => {
    const el = select({ name: "how_did_you_hear", options: ["", "Friend"] });
    const result = await fill({ forms: [form([el, input({ type: "email" })])] });
    assert.equal(el.value, "");
    assert.equal(result.chosen, 0);
  });

  it("siyahıda uyğun variant yoxdursa rol uğursuz sayılır", async () => {
    const el = select({ name: "country", options: ["", "Turkey", "Germany"] });
    const result = await fill({ forms: [form([el, input({ type: "email" })])] });
    assert.equal(el.value, "");
    assert.deepEqual(result.failed, ["country"]);
  });
});

describe("razılıq, yaş və robot xanaları", () => {
  it("şərtlər, məxfilik və 18 yaş xanaları işarələnir", async () => {
    for (const props of [{ boxText: "I agree to the Terms of Service" },
      { boxText: "I accept the Privacy Policy" }, { boxText: "I am over 18 years old" },
      { name: "terms" }, { label: "Şərtləri qəbul edirəm" }, { boxText: "Kullanım koşullarını kabul ediyorum" }]) {
      const box = check(props);
      const result = await fill({ forms: [form([input({ type: "email" }), box])] });
      assert.equal(box.checked, true, JSON.stringify(props));
      assert.equal(result.checked, 1, JSON.stringify(props));
    }
  });

  it('"mən robot deyiləm" xanası işarələnir', async () => {
    const box = check({ boxText: "I'm not a robot" });
    await fill({ forms: [form([input({ type: "email" }), box])] });
    assert.equal(box.checked, true);
  });

  it("marketinq abunəsi məcburi deyilsə İŞARƏLƏNMİR", async () => {
    const box = check({ boxText: "Send me the newsletter and special offers" });
    const result = await fill({ forms: [form([input({ type: "email" }), box])] });
    assert.equal(box.checked, false);
    assert.equal(result.checked, 0);
    assert.ok(result.skipped.includes("marketinq"));
  });

  it("marketinq xanası MƏCBURİ olarsa işarələnir (forma başqa cür göndərilmir)", async () => {
    const box = check({ boxText: "Subscribe to updates", required: true });
    await fill({ forms: [form([input({ type: "email" }), box])] });
    assert.equal(box.checked, true);
  });

  it("naməlum checkbox məcburi deyilsə toxunulmur", async () => {
    const box = check({ name: "make_profile_public" });
    const result = await fill({ forms: [form([input({ type: "email" }), box])] });
    assert.equal(box.checked, false);
    assert.equal(result.checked, 0);
  });

  it("artıq işarələnmiş xana yenidən basılmır", async () => {
    const box = check({ name: "terms", checked: true });
    const result = await fill({ forms: [form([input({ type: "email" }), box])] });
    assert.notEqual(box.clicked, true);
    assert.equal(result.checked, 0);
  });

  it("saytın öz div[role=checkbox] komponenti də işarələnir", async () => {
    const box = custom({ label: "I agree to the terms" });
    const result = await fill({ forms: [form([input({ type: "email" })], [], [box])] });
    assert.equal(box._checked, true);
    assert.equal(result.checked, 1);
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
    assert.equal(box.checked, true, "gizli xana işarələnməli idi");
    assert.equal(label.clicked, true, "klik label-a düşməli idi");
    assert.equal(result.checked, 1);
  });

  it("form atributu ilə bağlı kənar razılıq xanası işarələnir", async () => {
    const box = check({ boxText: "I accept the Privacy Policy" });
    const signup = form([input({ type: "email" }), input({ type: "password", ac: "new-password" })]);
    box.form = signup;
    const result = await fill({
      forms: [signup],
      loose: [box],
    });
    assert.equal(box.checked, true);
    assert.equal(result.checked, 1);
  });

  it("data-state=\"checked\" (Radix/shadcn) artıq işarələnmiş sayılır", async () => {
    const box = stateCheck({ state: "checked" });
    const result = await fill({ forms: [form([input({ type: "email" }), box])] });
    assert.notEqual(box.clicked, true, "təkrar basılmamalı idi");
    assert.equal(result.checked, 0);
  });

  it("data-state=\"unchecked\" olan xana işarələnir", async () => {
    const box = stateCheck({ state: "unchecked" });
    await fill({ forms: [form([input({ type: "email" }), box])] });
    assert.equal(box.checked, true);
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
      assert.equal(box.checked, true, text);
      assert.equal(result.checked, 1, text);
    }
  });

  it("sənədin uzağındaki NAMƏLUM və görünməyən xanaya toxunulmur (məcburi olsa da)", async () => {
    const stray = check({ name: "hidden_feature_flag", required: true, visible: false });
    const result = await fill({
      forms: [form([input({ type: "email" }), input({ type: "password", ac: "new-password" })])],
      loose: [stray],
    });
    assert.notEqual(stray.checked, true);
    assert.equal(result.checked, 0);
  });

  it("formanın İÇİNDƏKİ məcburi naməlum xana yenə işarələnir (yoxsa forma getmir)", async () => {
    const box = check({ name: "confirm_data_accuracy", required: true });
    const result = await fill({ forms: [form([input({ type: "email" }), box])] });
    assert.equal(box.checked, true);
    assert.equal(result.checked, 1);
  });

  it("marketinq xanası gizli olsa da işarələnmir", async () => {
    const { box, label } = hiddenCheck({ id: "news", text: "Send me the newsletter and promotions" });
    const result = await fill({
      forms: [form([input({ type: "email" }), box])],
      labels: [label],
    });
    assert.notEqual(box.checked, true);
    assert.ok(result.skipped.includes("marketinq"));
  });

  it("bir formada bir NEÇƏ razılıq xanası — hamısı işarələnir", async () => {
    const terms = check({ boxText: "I agree to the Terms" });
    const privacy = check({ boxText: "I accept the Privacy Policy" });
    const age = check({ boxText: "I am over 18 years old" });
    const news = check({ boxText: "Subscribe to our newsletter" });
    const result = await fill({ forms: [form([input({ type: "email" }), terms, privacy, age, news])] });
    assert.equal(terms.checked, true);
    assert.equal(privacy.checked, true);
    assert.equal(age.checked, true);
    assert.notEqual(news.checked, true, "marketinq toxunulmamalıdır");
    assert.equal(result.checked, 3);
  });

  it("switch komponenti (role=switch) də işarələnir", async () => {
    const box = custom({ label: "I accept the terms and conditions", role: "switch" });
    const result = await fill({ forms: [form([input({ type: "email" })], [], [box])] });
    assert.equal(box._checked, true);
    assert.equal(result.checked, 1);
  });
});

describe("radio qrupları", () => {
  it("cins qrupunda neytral variant, yoxsa profilin cinsi seçilir", async () => {
    const male = radio({ name: "gender", value: "male", boxText: "Male" });
    const female = radio({ name: "gender", value: "female", boxText: "Female" });
    const other = radio({ name: "gender", value: "other", boxText: "Prefer not to say" });
    await fill({ forms: [form([input({ type: "email" }), male, female, other])] });
    assert.equal(other.checked, true);
    assert.notEqual(male.checked, true);

    const m2 = radio({ name: "gender", value: "male", boxText: "Male" });
    const f2 = radio({ name: "gender", value: "female", boxText: "Female" });
    await fill({ forms: [form([input({ type: "email" }), m2, f2])] });
    assert.equal(f2.checked, true, "profil qadındır");
  });

  it("razılıq qrupunda təsdiq cavabı seçilir", async () => {
    const yes = radio({ name: "terms", value: "yes", boxText: "Yes, I agree to the terms" });
    const no = radio({ name: "terms", value: "no", boxText: "No" });
    await fill({ forms: [form([input({ type: "email" }), yes, no])] });
    assert.equal(yes.checked, true);
    assert.notEqual(no.checked, true);
  });

  it("məcburi naməlum qrupda mənfi olmayan ilk variant seçilir", async () => {
    const no = radio({ name: "plan", value: "no", boxText: "No thanks", required: true });
    const yes = radio({ name: "plan", value: "personal", boxText: "Personal", required: true });
    await fill({ forms: [form([input({ type: "email" }), no, yes])] });
    assert.equal(yes.checked, true);
    assert.notEqual(no.checked, true);
  });

  it("məcburi olmayan naməlum qrupa toxunulmur", async () => {
    const a = radio({ name: "plan", value: "a", boxText: "Plan A" });
    const b = radio({ name: "plan", value: "b", boxText: "Plan B" });
    const result = await fill({ forms: [form([input({ type: "email" }), a, b])] });
    assert.notEqual(a.checked, true);
    assert.notEqual(b.checked, true);
    assert.equal(result.checked, 0);
  });
});

describe("formanın seçilməsi", () => {
  it("giriş formasının yerinə qeydiyyat forması seçilir", async () => {
    const login = form([input({ type: "email", name: "email" }), input({ type: "password", ac: "current-password" })]);
    const signup = form([
      input({ type: "email", name: "reg_email" }),
      input({ type: "password", ac: "new-password", name: "reg_pass" }),
      input({ type: "password", name: "reg_pass_confirm" }),
    ]);
    const result = await fill({ forms: [login, signup] });
    assert.equal(login.fields[0].value, "", "giriş formasına toxunulmamalıdır");
    assert.equal(signup.fields[0].value, VALUES.email);
    assert.ok(result.filled.includes("passwordConfirm"));
  });

  it("çoxsahəli abunə forması qeydiyyat formasını üstələmir (çəki: parol + kod)", async () => {
    const contact = form([input({ name: "full_name" }), input({ type: "email", name: "contact_email" }),
      input({ type: "tel" }), input({ name: "city" }), input({ name: "company" })]);
    const signup = form([input({ type: "email", name: "signup_email" }), input({ type: "password", ac: "new-password" })]);
    await fill({ forms: [contact, signup] });
    assert.equal(signup.fields[0].value, VALUES.email);
    assert.equal(contact.fields[1].value, "");
  });

  it("kod fazasında kod xanasını daşıyan forma seçilir (düymə də oradan)", async () => {
    const create = button({ text: "Create account" });
    const signup = form([input({ type: "email" }), input({ type: "password", ac: "new-password" }),
      input({ type: "password", name: "password_confirmation" })], [create]);
    const verify = button({ text: "Verify" });
    const code = form([input({ name: "verification_code", maxLength: 6 })], [verify]);

    const result = await fill({ forms: [signup, code] }, { code: VALUES.code }, true);
    assert.deepEqual(result.filled, ["code"]);
    assert.equal(result.submitted, "verify");
    assert.equal(verify.clicked, true);
    assert.notEqual(create.clicked, true);
  });

  it("kod gözlənilən vaxt kod xanası olmayan forma SEÇİLMİR", async () => {
    const signup = form([input({ type: "email" }), input({ type: "password", ac: "new-password" }),
      input({ type: "password", name: "password_confirmation" })]);
    const result = await fill({ forms: [signup] }, { code: VALUES.code });
    assert.equal(result.done, false);
    assert.match(result.reason, /uyğun sahə tapılmadı/);
  });

  it("forma olmasa da sənəddəki sahələr doldurulur (React modal)", async () => {
    const email = input({ type: "email" });
    const pass = input({ type: "password", ac: "new-password" });
    const result = await fill({ forms: [], loose: [email, pass] });
    assert.deepEqual(result.filled, ["email", "password"]);
  });

  it("onlyEmpty: doldurulmuş forma yerinə BOŞ xanası olan forma seçilir (2-ci mərhələ)", async () => {
    // Birinci mərhələ artıq doludur; səhifədə həm də GİRİŞ forması var (boş ünvan xanası ilə) —
    // ikinci keçid onu seçməməlidir, çünki ünvan/istifadəçi adı bu keçiddə sayılmır.
    const login = form([input({ type: "email", name: "login_email" }), input({ type: "password", ac: "current-password" })]);
    const done = form([
      input({ type: "email", value: VALUES.email }),
      input({ type: "password", ac: "new-password", value: VALUES.password }),
      input({ name: "city", value: VALUES.city }),
    ]);
    const step2 = form([input({ name: "job_title" }), textarea({ name: "about_you" })]);
    const result = await inPage({ forms: [login, done, step2] },
      () => fillFormInPage(VALUES, { timeoutMs: 30, submitMs: 0, onlyEmpty: true }));
    assert.deepEqual(result.filled, ["jobTitle", "bio"]);
    assert.equal(step2.fields[0].value, VALUES.jobTitle);
    assert.equal(login.fields[0].value, "", "giriş formasına toxunulmur");
    assert.equal(done.fields[0].value, VALUES.email, "birinci mərhələ olduğu kimi qalır");
  });

  it("onlyEmpty: ikinci mərhələdəki PAROL xanası yenə doldurulur", async () => {
    const step2 = form([input({ type: "password", ac: "new-password" }), input({ name: "city" })]);
    const result = await inPage({ forms: [step2] },
      () => fillFormInPage(VALUES, { timeoutMs: 30, submitMs: 0, onlyEmpty: true }));
    assert.deepEqual(result.filled, ["password", "city"]);
  });

  it("promo kodu xanası kod kimi doldurulmur", async () => {
    const promo = input({ name: "promo_code", maxLength: 10 });
    const result = await fill({ forms: [form([promo])] }, { code: VALUES.code });
    assert.equal(promo.value, "");
    assert.equal(result.done, false);
  });

  it("poçt indeksi kod kimi doldurulmur (PIN code)", async () => {
    const pin = input({ name: "pin_code", maxLength: 6 });
    const result = await fill({ forms: [form([pin])] }, { code: VALUES.code });
    assert.equal(pin.value, "");
    assert.equal(result.done, false);
  });
});

describe("görünməyən və bloklanmış sahələr", () => {
  it("gizli, disabled və readonly sahələr atlanılır", async () => {
    for (const props of [{ visible: false }, { disabled: true }, { readOnly: true }]) {
      const el = input({ type: "email", ...props });
      assert.equal((await fill({ forms: [form([el])] })).done, false, JSON.stringify(props));
      assert.equal(el.value, "", JSON.stringify(props));
    }
  });

  it("gizli sahə varsa görünən qardaşı seçilir", async () => {
    const hidden = input({ type: "email", visible: false });
    const shown = input({ type: "email", name: "email2" });
    await fill({ forms: [form([hidden, shown])] });
    assert.equal(hidden.value, "");
    assert.equal(shown.value, VALUES.email);
  });
});

describe("yazma qaydaları", () => {
  it("input və change hadisələri göndərilir (framework state-i alsın)", async () => {
    const email = input({ type: "email" });
    await fill({ forms: [form([email])] });
    assert.deepEqual(email.events, ["input", "change"]);
    assert.equal(email.focused, true);
  });

  it("prototipdəki setter işlədilir: instansiya setter-i yazını udsa da keçir (React)", async () => {
    const email = input({ type: "email" });
    Object.defineProperty(email, "value", { configurable: true, get() { return this._value; }, set() { this.swallowed = true; } });
    email.value = "x";
    assert.equal(email._value, "");
    await fill({ forms: [form([email])] });
    assert.equal(email.value, VALUES.email);
  });

  it("heç bir sahə tapılmasa aydın səbəb qaytarılır (throw etmir)", async () => {
    const result = await fill({ forms: [form([input({ name: "custom_field_xyz" })])] });
    assert.equal(result.done, false);
    assert.match(result.reason, /uyğun sahə tapılmadı/);
  });
});

describe("göndərmə düyməsi", () => {
  const signupForm = (buttons) => form([
    input({ type: "email", name: "email" }),
    input({ type: "password", ac: "new-password" }),
  ], buttons);

  it("qeydiyyat yazısı olan düymə basılır və statusa düşür", async () => {
    for (const text of ["Create account", "Register", "Sign up", "Yarat", "Hesap oluştur",
      "Kaydol", "Üye ol", "Qeydiyyatdan keç", "Join now", "Зарегистрироваться"]) {
      const go = button({ text });
      const result = await fill({ forms: [signupForm([go])] }, VALUES, true);
      assert.equal(go.clicked, true, text);
      assert.equal(result.submitted, text.toLowerCase());
    }
  });

  it("input[type=submit] düyməsinin yazısı value-dandır", async () => {
    const go = button({ tag: "INPUT", type: "submit", value: "Create account", text: "" });
    await fill({ forms: [signupForm([go])] }, VALUES, true);
    assert.equal(go.clicked, true);
  });

  it("giriş, sosial şəbəkə, ödəniş və silmə düymələri BASILMIR", async () => {
    // Bu yazılar formanı GİRİŞ forması kimi damğalamır (sosial, ödəniş, silmə…), ona görə
    // forma yenə doldurulur — sadəcə düyməyə toxunulmur.
    for (const text of ["Continue with Google", "Sign up with Apple", "Cancel", "Delete account",
      "Subscribe", "Pay now", "Resend code", "Already have an account?"]) {
      const go = button({ text });
      const result = await fill({ forms: [signupForm([go])] }, VALUES, true);
      assert.notEqual(go.clicked, true, text);
      assert.equal(result.submitted, undefined, text);
      assert.equal(result.done, true, text);
    }
  });

  // Formanın YEGANƏ düyməsi girişdən danışırsa bu, qeydiyyat forması deyil: ora ünvan/parol
  // yazmaq mənasızdır (istifadəçinin səhifəsini korlayır). Düzgün davranış qeydiyyat
  // səhifəsini tapmaqdır — bunu `openSignupInPage` edir.
  it("GİRİŞ forması ümumiyyətlə doldurulmur", async () => {
    for (const text of ["Sign in", "Log in", "Giriş", "Forgot password"]) {
      const login = signupForm([button({ text })]);
      const result = await fill({ forms: [login] }, VALUES, true);
      assert.equal(result.done, false, text);
      assert.equal(login.fields[0].value, "", text);
      assert.equal(login.fields[1].value, "", text);
      assert.match(result.reason, /uyğun sahə tapılmadı/, text);
    }
  });

  it("giriş və qeydiyyat tabı bir yerdə olanda forma doldurulur (qeydiyyat sözü üstündür)", async () => {
    const go = button({ text: "Create account" });
    const tabs = signupForm([button({ text: "Log in" }), go]);
    const result = await fill({ forms: [tabs] }, VALUES, true);
    assert.equal(result.done, true);
    assert.equal(go.clicked, true);
  });

  it("qadağan sözü söz içində tutulmur (Create Silver account basılır)", async () => {
    const go = button({ text: "Create Silver account" });
    await fill({ forms: [signupForm([go])] }, VALUES, true);
    assert.equal(go.clicked, true);
  });

  it("güclü yazı zəif yazıdan üstündür", async () => {
    const weak = button({ text: "Continue" });
    const strong = button({ text: "Create account" });
    await fill({ forms: [signupForm([weak, strong])] }, VALUES, true);
    assert.equal(strong.clicked, true);
    assert.notEqual(weak.clicked, true);
  });

  it("yazısı tanınmayan submit düyməsi son ehtimaldır", async () => {
    const unknown = button({ text: "→" });
    await fill({ forms: [signupForm([unknown])] }, VALUES, true);
    assert.equal(unknown.clicked, true);
  });

  it("gizli və deaktiv düymə basılmır", async () => {
    for (const props of [{ visible: false }, { disabled: true }, { ariaDisabled: "true" }]) {
      const go = button({ text: "Create account", ...props });
      const result = await fill({ forms: [signupForm([go])] }, VALUES, true);
      assert.notEqual(go.clicked, true, JSON.stringify(props));
      assert.match(result.reason, /düyməsi tapılmadı/);
      assert.equal(result.done, true);
    }
  });

  it("submit rejimi boş sahələr olduqda düyməni basmır", async () => {
    const email = input({ type: "email" });
    const go = button({ text: "Create account" });
    const dom = { forms: [form([email, input({ type: "password", ac: "new-password" })], [go])] };
    const result = await inPage(dom, () => fillFormInPage(VALUES, { timeoutMs: 30, submitMs: 30, mode: "submit" }));
    assert.equal(email.value, "", "doldurma bu rejimdə işləmir");
    assert.notEqual(go.clicked, true);
    assert.equal(result.submitted, undefined);
    assert.match(result.reason, /email/);
  });

  it("submit rejimi əvvəl doldurulmuş və qəbul edilmiş dəyərlərlə işləyir", async () => {
    const email = input({ type: "email", value: VALUES.email });
    const password = input({ type: "password", ac: "new-password", value: VALUES.password });
    const go = button({ text: "Create account" });
    const result = await inPage({ forms: [form([email, password], [go])] },
      () => fillFormInPage(VALUES, { timeoutMs: 30, submitMs: 30, mode: "submit" }));
    assert.equal(go.clicked, true);
    assert.equal(result.submitted, "create account");
    assert.deepEqual(email.events, [], "submit sahələri yenidən yazmır");
  });

  it("sayt dəyəri silsə, dəyişsə və ya etibarsız saysa submit dayanır", async () => {
    for (const state of ["", "old@example.org", VALUES.email]) {
      const email = input({ type: "email", value: state });
      if (state === VALUES.email) email.validity = { valid: false };
      const password = input({ type: "password", ac: "new-password", value: VALUES.password });
      const go = button({ text: "Create account" });
      const result = await inPage({ forms: [form([email, password], [go])] },
        () => fillFormInPage(VALUES, { timeoutMs: 30, submitMs: 30, mode: "submit" }));
      assert.notEqual(go.clicked, true, state);
      assert.match(result.reason, /email/);
    }
  });

  it("qəbul edilməyən parolla qismən doldurulmuş forma göndərilmir", async () => {
    const email = input({ type: "email" });
    const password = input({ type: "password", ac: "new-password", minLength: 40 });
    const go = button({ text: "Create account" });
    const result = await fill({ forms: [form([email, password], [go])] }, VALUES, true);
    assert.equal(email.value, VALUES.email);
    assert.equal(password.value, "");
    assert.notEqual(go.clicked, true);
    assert.match(result.reason, /password/);
  });

  it("tanınmayan məcburi sahə boşdursa submit dayanır", async () => {
    const go = button({ text: "Create account" });
    const signup = signupForm([go]);
    signup.fields.push(input({ name: "required_custom_field", required: true }));
    const result = await fill({ forms: [signup] }, VALUES, true);
    assert.notEqual(go.clicked, true);
    assert.match(result.reason, /məcburi/);
  });

  it("submit istənilməyəndə düyməyə toxunulmur", async () => {
    const go = button({ text: "Create account" });
    const result = await fill({ forms: [signupForm([go])] }, VALUES, false);
    assert.notEqual(go.clicked, true);
    assert.equal(result.submitted, undefined);
  });

  it("forma tapılmayıb sənəd kökü işlədilirsə yalnız GÜCLÜ yazı basılır", async () => {
    const weak = button({ text: "Continue" });
    const loose = [input({ type: "email" }), input({ type: "password", ac: "new-password" })];
    const result = await fill({ forms: [], loose, looseButtons: [weak] }, VALUES, true);
    assert.notEqual(weak.clicked, true);
    assert.match(result.reason, /düyməsi tapılmadı/);

    const strong = button({ text: "Create account" });
    await fill({
      forms: [], loose: [input({ type: "email" }), input({ type: "password", ac: "new-password" })],
      looseButtons: [strong],
    }, VALUES, true);
    assert.equal(strong.clicked, true);
  });

  it("heç nə dolmadısa düymə də basılmır", async () => {
    const go = button({ text: "Create account" });
    const result = await fill({ forms: [form([input({ name: "custom_field_xyz" })], [go])] }, VALUES, true);
    assert.equal(result.done, false);
    assert.notEqual(go.clicked, true);
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
  const mailForm = (buttons) => form([input({ type: "email", name: "email" })], buttons);

  it("kod hələ yoxdursa kod düyməsi qeydiyyat düyməsindən ÜSTÜN tutulur", async () => {
    const send = button({ text: "Send code" });
    const create = button({ text: "Create account" });
    const result = await fill({ forms: [mailForm([create, send])] }, noCode, true);
    assert.equal(send.clicked, true, "kod düyməsi basılmalı idi");
    assert.notEqual(create.clicked, true);
    assert.equal(result.submitted, "send code");
    assert.equal(result.codeRequested, true);
  });

  it("kod düymələrinin bütün adları tanınır", async () => {
    for (const text of ["Send code", "Send the code", "Get code", "Request a code",
      "Send verification code", "Email me a code", "Send OTP", "Send magic link",
      "Kodu göndər", "Kod al", "Doğrulama kodu", "Отправить код", "Получить код"]) {
      const go = button({ text });
      const result = await fill({ forms: [mailForm([go])] }, noCode, true);
      assert.equal(go.clicked, true, text);
      assert.equal(result.codeRequested, true, text);
    }
  });

  it("kod ƏLİMİZDƏ olanda kod düyməsinə TOXUNULMUR (yenisi istənilmir)", async () => {
    const send = button({ text: "Send code" });
    const verify = button({ text: "Verify" });
    const codeForm = form([input({ name: "verification_code", maxLength: 6 })], [send, verify]);
    const result = await fill({ forms: [codeForm] }, { code: VALUES.code }, true);
    assert.equal(verify.clicked, true);
    assert.notEqual(send.clicked, true, "yeni kod istənilməməli idi");
    assert.equal(result.codeRequested, undefined);
  });

  it("kod əlimizdədirsə və səhifədə YALNIZ kod düyməsi varsa heç nə basılmır", async () => {
    const send = button({ text: "Send code" });
    const result = await fill({ forms: [form([input({ name: "otp", maxLength: 6 })], [send])] },
      { code: VALUES.code }, true);
    assert.notEqual(send.clicked, true);
    assert.match(result.reason, /düyməsi tapılmadı/);
  });

  it("aşkarlanan kod düymələri nəticədə sadalanır (istifadəçi görməlidir)", async () => {
    const send = button({ text: "Send code" });
    const result = await fill({ forms: [mailForm([send])] }, noCode, false);
    assert.deepEqual(result.codeButtons, ["send code"]);
  });

  it("forma yoxdursa (React modal) kod düyməsi YENƏ basılır — yazısı birmənalıdır", async () => {
    const send = button({ text: "Send verification code" });
    const result = await fill({
      forms: [], loose: [input({ type: "email" })], looseButtons: [send],
    }, noCode, true);
    assert.equal(send.clicked, true);
    assert.equal(result.codeRequested, true);
  });

  it('"Resend code" basılmır (kod təkrar göndərilməməlidir)', async () => {
    const resend = button({ text: "Resend code" });
    const result = await fill({ forms: [mailForm([resend])] }, noCode, true);
    assert.notEqual(resend.clicked, true);
    assert.equal(result.codeButtons, undefined, "qadağan düymə siyahıya da düşmür");
  });

  it("deaktiv kod düyməsi aktivləşənə qədər gözlənilir, sonra basılır", async () => {
    const send = button({ text: "Send code", disabled: true });
    const dom = { forms: [mailForm([send])] };
    dom.forms[0].fields[0].value = VALUES.email;
    const result = await inPage(dom, async () => {
      const running = fillFormInPage(noCode, { timeoutMs: 30, submitMs: 900, mode: "submit" });
      setTimeout(() => { send.disabled = false; }, 120);
      return running;
    });
    assert.equal(send.clicked, true, "aktivləşəndən sonra basılmalı idi");
    assert.equal(result.codeRequested, true);
  });

  it("kod düyməsi ilə sosial giriş qarışmır (Continue with Google)", async () => {
    const google = button({ text: "Continue with Google" });
    const send = button({ text: "Send code" });
    await fill({ forms: [mailForm([google, send])] }, noCode, true);
    assert.equal(send.clicked, true);
    assert.notEqual(google.clicked, true);
  });

  it("kod düyməsi yoxdursa adi qaydalar işləyir", async () => {
    const create = button({ text: "Create account" });
    const result = await fill({
      forms: [form([input({ type: "email" }), input({ type: "password", ac: "new-password" })], [create])],
    }, noCode, true);
    assert.equal(create.clicked, true);
    assert.equal(result.codeRequested, undefined);
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
  const newsletter = (extra = {}) => form([input({ type: "email", ph: "Enter your email" })],
    [button({ text: "Subscribe" })], [], extra);

  it("ana səhifə: abunə forması + başlıqda 'Sign up' → forma AÇIQ sayılmır", async () => {
    const link = button({ tag: "A", text: "Sign up", type: "", href: "/signup" });
    const result = await inPage({ forms: [newsletter()], looseButtons: [link] },
      () => openSignupInPage(30));
    assert.equal(result.already, undefined, "abunə qutusu qeydiyyat forması sayılmamalıdır");
    assert.equal(link.clicked, true, "qeydiyyat linki basılmalı idi");
  });

  it("ana səhifə: abunə xanasına ünvan YAZILMIR (başqa forma da yoxdursa heç nə edilmir)", async () => {
    const box = newsletter();
    const result = await fill({ forms: [box] });
    assert.equal(box.fields[0].value, "", "abunə xanasına yazılmamalı idi");
    assert.equal(result.done, false);
    assert.match(result.reason, /uyğun sahə tapılmadı/);
  });

  it("abunə forması ilə qeydiyyat forması yanaşı olanda QEYDİYYAT seçilir", async () => {
    const box = newsletter();
    const signup = form([input({ type: "email", name: "reg_email" }),
      input({ type: "password", ac: "new-password" })], [button({ text: "Create account" })]);
    const result = await fill({ forms: [box, signup] });
    assert.equal(box.fields[0].value, "");
    assert.equal(signup.fields[0].value, VALUES.email);
    assert.ok(result.filled.includes("password"));
  });

  it("abunə nişanları: düymə, xananın imzası və formanın action-ı", async () => {
    const cases = [
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
      assert.equal(box.fields[0].value, "", JSON.stringify(box.fields[0].name));
      assert.equal(result.done, false);
    }
  });

  it("QEYDİYYAT forması abunə sayılmır (marketinq xanası olsa da)", async () => {
    // Regresiya qorunması: razılıq/marketinq xanasının mətni bütün formanı damğalamamalıdır
    const signup = form([
      input({ type: "email" }),
      check({ boxText: "Send me the newsletter and product updates" }),
    ], [button({ text: "Create account" })]);
    const result = await fill({ forms: [signup] });
    assert.equal(signup.fields[0].value, VALUES.email);
    assert.equal(result.done, true);
  });

  it("axtarış forması doldurulmur", async () => {
    for (const search of [
      form([input({ type: "search", name: "q" })], [button({ text: "Search" })]),
      form([input({ type: "text", name: "q" })], [button({ text: "Search" })], [], { role: "search" }),
    ]) {
      const result = await fill({ forms: [search] });
      assert.equal(search.fields[0].value, "");
      assert.equal(result.done, false);
    }
  });

  it("sənəd kökündə də abunə xanası sayılmır (forma seçilməyəndə)", async () => {
    // Abunə forması bloklanıbsa onun xanası sənəd kökündə də görünməməlidir
    const box = newsletter();
    const result = await inPage({ forms: [box] }, () => fillFormInPage(VALUES, { timeoutMs: 30, submitMs: 0 }));
    assert.equal(box.fields[0].value, "");
    assert.equal(result.done, false);
  });

  // Eyni qüsur sinfinin qalan halları: poçt xanası olan, amma QEYDİYYAT OLMAYAN formalar.
  it("ƏLAQƏ forması doldurulmur (mesaj xanası var)", async () => {
    const contact = form([
      input({ type: "email", name: "email" }),
      input({ name: "full_name" }),
      textarea({ name: "message" }),
    ], [button({ text: "Send message" })]);
    const result = await fill({ forms: [contact] });
    assert.equal(contact.fields[0].value, "");
    assert.equal(result.done, false);
  });

  it("ŞƏRH forması doldurulmur (WordPress: ad + poçt + şərh)", async () => {
    const comment = form([
      input({ name: "author" }), input({ type: "email", name: "email" }),
      input({ name: "url" }), textarea({ name: "comment" }),
    ], [button({ text: "Post Comment" })]);
    const result = await fill({ forms: [comment] });
    assert.equal(comment.fields[1].value, "");
    assert.equal(result.done, false);
  });

  it("PAROLUN BƏRPASI forması doldurulmur", async () => {
    for (const text of ["Reset password", "Send reset link", "Forgot password", "Восстановить пароль"]) {
      const reset = form([input({ type: "email" })], [button({ text })]);
      const result = await fill({ forms: [reset] });
      assert.equal(reset.fields[0].value, "", text);
      assert.equal(result.done, false, text);
    }
  });

  it("ÖDƏNİŞ/səbət forması doldurulmur (qonaq kimi alış)", async () => {
    for (const text of ["Checkout", "Place order", "Pay now", "Donate"]) {
      const checkout = form([input({ type: "email" }), input({ name: "city" })], [button({ text })]);
      const result = await fill({ forms: [checkout] });
      assert.equal(checkout.fields[0].value, "", text);
      assert.equal(result.done, false, text);
    }
  });

  it("PAROL xanası varsa forma bloklanmır — ödəniş səhifəsində hesab yaradıla bilər", async () => {
    const signupAtCheckout = form([
      input({ type: "email" }), input({ type: "password", ac: "new-password" }),
    ], [button({ text: "Pay now" })]);
    const result = await fill({ forms: [signupAtCheckout] });
    assert.equal(signupAtCheckout.fields[0].value, VALUES.email);
    assert.equal(result.done, true);
  });

  it("qeydiyyat sözü olan düymə bütün blokları LƏĞV edir", async () => {
    // "Sign up" yazan düymə varsa forma qeydiyyat formasıdır — abunə/əlaqə/ticarət sayılmır
    for (const extra of [button({ text: "Subscribe" }), button({ text: "Send message" }),
      button({ text: "Checkout" })]) {
      const signup = form([input({ type: "email" }), textarea({ name: "message" })],
        [extra, button({ text: "Create account" })]);
      const result = await fill({ forms: [signup] });
      assert.equal(signup.fields[0].value, VALUES.email);
      assert.equal(result.done, true);
    }
  });
});
// ===========================================================================================
describe("qeydiyyat açılışının ümumi gecikmə regressiyaları", () => {
  const hide = (el) => Object.assign(el, { offsetParent: null, offsetWidth: 0, offsetHeight: 0 });
  const show = (el) => Object.assign(el, { offsetParent: {}, offsetWidth: 100, offsetHeight: 30 });
  function fixture() {
    const email = hide(input({ type: "email" }));
    const password = hide(input({ type: "password", ac: "new-password" }));
    const signup = form([email, password]);
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
        assert.equal(result.ready, true);
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
      assert.equal(result.ready, true);
      assert.ok(Date.now() - started < 700, "hazır növbəti addım dərhal seçilməlidir");
    });
  });

  it("gec açılan login modalının signup tabı eyni açılışda tapılır", async () => {
    const { signup, reveal } = fixture();
    const login = button({ text: "Log in", type: "button" });
    const tab = hide(button({ text: "Register", type: "button" }));
    let timer;
    login.click = () => { hide(login); timer = setTimeout(() => show(tab), 1200); };
    tab.click = reveal;
    await inPage({ forms: [signup], looseButtons: [login, tab] }, async () => {
      try {
        const result = await openSignupInPage(2700, { navigate: false });
        assert.equal(result.ready, true, "gec modal login kimi doldurmaya ötürülməməlidir");
      } finally { clearTimeout(timer); }
    });
  });

  it("düymənin içindəki yazı yeni addım sayılıb eyni düymə təkrar basılmır", async () => {
    const { signup, reveal } = fixture();
    const start = button({ text: "Sign up", type: "button" });
    let clicks = 0, timer;
    const click = () => { clicks++; timer ??= setTimeout(reveal, 70); };
    start.click = click;
    const caption = textNode("Sign up", click);
    start.children = start.childNodes = [caption];
    start.contains = (el) => el === start || el === caption;
    caption.parentElement = start;
    const body = box("BODY", [start, signup]);
    await inPage({ forms: [signup], looseButtons: [start] }, async () => {
      document.body = body;
      try {
        const result = await openSignupInPage(700, { navigate: false });
        assert.equal(result.ready, true);
        assert.equal(clicks, 1);
      } finally { clearTimeout(timer); }
    });
  });

  it("6000-dən çox elementli səhifədə adi div qeydiyyat düyməsi də tapılır", async () => {
    const { signup, reveal } = fixture();
    const start = textNode("Register", reveal, { decorated: true });
    const body = box("BODY", [...Array.from({ length: 6100 }, () => textNode("Market price")), start, signup]);
    await inPage({ forms: [signup] }, async () => {
      document.body = body;
      const result = await openSignupInPage(700, { navigate: false });
      assert.equal(result.ready, true);
      assert.equal(start.clicked, true);
    });
  });

  it("ilk düymə cavabsız qalanda mövcud ikinci qeydiyyat düyməsi də sınanır", async () => {
    const { signup, reveal } = fixture();
    const inactive = button({ text: "Sign up", type: "button" });
    const working = button({ text: "Register", type: "button" });
    working.click = reveal;
    await inPage({ forms: [signup], looseButtons: [inactive, working] }, async () => {
      const result = await openSignupInPage(900, { navigate: false });
      assert.equal(result.ready, true);
      assert.equal(inactive.clicked, true);
    });
  });
});

describe("qeydiyyat formasının açılması (openSignupInPage)", () => {
  const open = (dom) => inPage(dom, () => openSignupInPage(30));

  // ⚠ Parol xanası TƏK BAŞINA "qeydiyyat forması" demək deyil: giriş forması da parol daşıyır.
  // Əlavə əlamət lazımdır — `new-password`, təsdiq xanası, ad/istifadəçi adı xanası, formanın
  // qeydiyyat düyməsi, ya da /signup marşrutu. Şübhə olanda "açıq deyil" seçilir: onda ən pisi
  // bir artıq klikdir, əksi isə yad formaya yazmaq olardı.
  it("new-password xanası qeydiyyat formasıdır", async () => {
    const result = await open({ forms: [form([input({ type: "password", ac: "new-password" })])] });
    assert.deepEqual(result, { already: true });
  });

  it("parol + təsdiq xanası qeydiyyat formasıdır", async () => {
    const result = await open({
      forms: [form([input({ type: "password" }), input({ type: "password", name: "password_confirmation" })])],
    });
    assert.deepEqual(result, { already: true });
  });

  it("parol + qeydiyyat düyməsi qeydiyyat formasıdır", async () => {
    const result = await open({
      forms: [form([input({ type: "email" }), input({ type: "password" })], [button({ text: "Create account" })])],
    });
    assert.deepEqual(result, { already: true });
  });

  it("parol + istifadəçi adı xanası qeydiyyat formasıdır", async () => {
    const result = await open({
      forms: [form([input({ name: "username" }), input({ type: "password" })])],
    });
    assert.deepEqual(result, { already: true });
  });

  it("TƏK parol xanası (giriş forması ola bilər) açıq forma SAYILMIR", async () => {
    const link = button({ tag: "A", text: "Sign up", type: "" });
    const result = await open({
      forms: [form([input({ type: "email" }), input({ type: "password" })], [button({ text: "Log in" })])],
      looseButtons: [link],
    });
    assert.equal(result.already, undefined);
    assert.equal(link.clicked, true, "qeydiyyat linki axtarılmalı idi");
  });

  it("ünvan xanası + qeydiyyat düyməsi də açıq forma sayılır", async () => {
    const result = await open({ forms: [form([input({ type: "email" })], [button({ text: "Sign up" })])] });
    assert.deepEqual(result, { already: true });
  });

  it("kod xanası varsa forma açıq sayılır", async () => {
    const result = await open({ forms: [form([input({ name: "verification_code", maxLength: 6 })])] });
    assert.deepEqual(result, { already: true });
  });

  it("Sign up / Register / Qeydiyyat linki basılır", async () => {
    for (const text of ["Sign up", "Register", "Create account", "Qeydiyyat", "Kaydol", "Регистрация"]) {
      const link = button({ tag: "A", text, type: "" });
      const result = await open({ forms: [], looseButtons: [link] });
      assert.equal(link.clicked, true, text);
      assert.equal(result.opened, text);
    }
  });

  it("sosial giriş, pul kisəsi və 'artıq hesabım var' düymələri BASILMIR", async () => {
    for (const text of ["Continue with Google", "Continue with Apple", "Continue with Binance",
      "Continue with Wallet", "Sign in with Google", "Already a member?", "Forgot password"]) {
      const link = button({ tag: "A", text, type: "" });
      const result = await open({ forms: [], looseButtons: [link] });
      assert.notEqual(link.clicked, true, text);
      assert.deepEqual(result, { none: true }, text);
    }
  });

  // ⚠ REAL HAL (coinmarketcap.com): başlıqda qeydiyyat düyməsi YOXDUR — yalnız "Log In" var,
  // qeydiyyat tabı onun açdığı modalın içindədir. Ona görə giriş düyməsi SON EHTİMAL kimi
  // basılır: auth səthi açılır, sonra içindəki "Sign Up" tabı basılır.
  it("qeydiyyat düyməsi yoxdursa auth səthi ('Log In') açılır", async () => {
    const login = button({ tag: "A", text: "Log In", type: "" });
    await open({ forms: [], looseButtons: [login] });
    assert.equal(login.clicked, true);
  });

  it("qeydiyyat düyməsi VARSA giriş düyməsinə toxunulmur", async () => {
    const login = button({ tag: "A", text: "Log In", type: "" });
    const signup = button({ tag: "A", text: "Sign up", type: "" });
    await open({ forms: [], looseButtons: [login, signup] });
    assert.equal(signup.clicked, true);
    assert.notEqual(login.clicked, true);
  });

  // Giriş formasının öz "Log in" submit düyməsi auth səthi açmır — basılsa boş forma
  // göndərilərdi (istifadəçi validasiya xətası görərdi).
  it("giriş formasının SUBMIT düyməsi basılmır", async () => {
    const submit = button({ text: "Log in", type: "submit" });
    const login = form([input({ type: "email" }), input({ type: "password" })], [submit]);
    const result = await open({ forms: [login] });
    assert.notEqual(submit.clicked, true);
    assert.deepEqual(result, { none: true });
  });

  it("href-də signup olan link üstün tutulur", async () => {
    const weak = button({ tag: "A", text: "Join", type: "" });
    const strong = button({ tag: "A", text: "Register", type: "", href: "/auth/signup" });
    await open({ forms: [], looseButtons: [weak, strong] });
    assert.equal(strong.clicked, true);
  });

  it("uyğun link yoxdursa heç nə basılmır", async () => {
    const link = button({ tag: "A", text: "Pricing", type: "" });
    const result = await open({ forms: [], looseButtons: [link] });
    assert.deepEqual(result, { none: true });
    assert.notEqual(link.clicked, true);
  });

  it('"Sign up for our newsletter" düyməsi basılmır (abunə qutusudur)', async () => {
    const link = button({ tag: "A", text: "Sign up for our newsletter", type: "" });
    const result = await open({ forms: [], looseButtons: [link] });
    assert.notEqual(link.clicked, true);
    assert.deepEqual(result, { none: true });
  });
});

// ===========================================================================================
// QEYDİYYAT SƏHİFƏSİNİN ÜNVANLA TAPILMASI
// ===========================================================================================
// Basılası element olmaya bilər: menyu gizlidir, düymə JS ilə sonra qurulur, qeydiyyat ayrı
// səhifədədir. Belə halda ünvan saytın ÖZ linklərindən oxunur (görünmə tələb olunmur, çünki
// `href` gizli menyuda da mövcuddur), tapılmasa standart yol təxmin edilir.
describe("qeydiyyat ünvanının tapılması (navigate)", () => {
  const anchor = (href, text = "") => button({ tag: "A", text, type: "", href, visible: false });
  const at = (url, dom) => inPage({ url, ...dom }, () => openSignupInPage(30));

  it("saytın öz /signup linki tapılır (gizli menyuda olsa da)", async () => {
    const result = await at("https://site.example/", { links: [anchor("/signup", "Sign up")] });
    assert.deepEqual(result, { navigate: "https://site.example/signup" });
  });

  it("register, create-account, join və qeydiyyat yolları tanınır", async () => {
    for (const path of ["/register", "/create-account", "/auth/signup", "/users/sign_up",
      "/en/join", "/qeydiyyat", "/uye-ol", "/hesab/kayit-ol"]) {
      const result = await at("https://site.example/", { links: [anchor(path)] });
      assert.equal(result.navigate, "https://site.example" + path, path);
    }
  });

  it("GİRİŞ linkləri seçilmir", async () => {
    for (const path of ["/login", "/signin", "/auth/login", "/forgot-password", "/reset-password"]) {
      const result = await at("https://site.example/", { links: [anchor(path)] });
      assert.notEqual(result.navigate, "https://site.example" + path, path);
    }
  });

  it("BAŞQA saytın linki seçilmir (activeTab icazəsi itərdi)", async () => {
    const result = await at("https://site.example/", { links: [anchor("https://other.example/signup")] });
    assert.equal(result.navigate, undefined);
    assert.deepEqual(result, { none: true });
  });

  it("ən QISA yol üstün tutulur (yardım məqaləsi yerinə əsl səhifə)", async () => {
    const result = await at("https://site.example/", {
      links: [anchor("/help/articles/how-to-register-an-account"), anchor("/register")],
    });
    assert.equal(result.navigate, "https://site.example/register");
  });

  // ⚠ ÜNVAN TƏXMİN EDİLMİR. Əvvəlki versiya link tapmayanda "/signup" kimi standart yolları
  // sınayırdı və coinmarketcap.com-da bu, MÖVCUD OLMAYAN səhifəni açdı (istifadəçi xəta
  // səhifəsi gördü). Ünvan yalnız səhifənin öz `href`-lərindən gəlir.
  it("link yoxdursa ünvan TƏXMİN EDİLMİR", async () => {
    const result = await at("https://site.example/pricing", {});
    assert.equal(result.navigate, undefined);
    assert.deepEqual(result, { none: true });
  });

  it("qeydiyyata aid olmayan linklər ünvan kimi işlədilmir", async () => {
    const result = await at("https://site.example/", {
      links: [anchor("/pricing"), anchor("/about"), anchor("/blog/how-to-join-a-webinar")],
    });
    assert.equal(result.navigate, undefined);
  });

  it("ARTIQ qeydiyyat səhifəsindəyiksə keçid təklif olunmur (dövrə olmasın)", async () => {
    for (const url of ["https://site.example/signup", "https://site.example/auth/register?ref=1"]) {
      const result = await at(url, { links: [anchor("/register")] });
      assert.equal(result.navigate, undefined, url);
      assert.deepEqual(result, { none: true }, url);
    }
  });

  it("naviqasiya söndürüləndə (ikinci cəhd) ünvan qaytarılmır", async () => {
    const result = await inPage({ url: "https://site.example/", links: [anchor("/signup")] },
      () => openSignupInPage(30, { navigate: false }));
    assert.deepEqual(result, { none: true });
  });

  it("basılası düymə VARSA əvvəl o sınanır, keçid isə ehtiyatdır", async () => {
    const link = button({ tag: "A", text: "Sign up", type: "", href: "/signup" });
    const result = await inPage({ url: "https://site.example/", looseButtons: [link], links: [anchor("/register")] },
      () => openSignupInPage(30));
    assert.equal(link.clicked, true, "əvvəl klik sınanmalıdır");
    // Klik forma açmadı → saytın ÖZ linki ilə keçid (standart yol TƏXMİN edilmir)
    assert.equal(result.navigate, "https://site.example/register");
  });

  it("klik forma açmadıqda standart yol TƏXMİN EDİLMİR (klik nəsə açmış ola bilər)", async () => {
    const link = button({ tag: "A", text: "Sign up", type: "" });
    const result = await inPage({ url: "https://site.example/", looseButtons: [link] },
      () => openSignupInPage(30));
    assert.equal(link.clicked, true);
    assert.equal(result.navigate, undefined);
    assert.equal(result.ready, false);
  });

  it("location oxunmasa (test/qorunan mühit) keçid təklif olunmur", async () => {
    const result = await inPage({ links: [anchor("/signup")] }, () => openSignupInPage(30));
    assert.deepEqual(result, { none: true });
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
  function authModal({ active = "login" } = {}) {
    const state = { active };
    const tab = (name, key) => {
      const el = button({ text: name, type: "", tag: "BUTTON" });
      el.getAttribute = (attribute) => {
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
    const modal = form([email, password], [loginTab, signupTab, button({ text: "Continue with Google" })],
      [], { dialog: true });
    return { modal, loginTab, signupTab, state, email, password };
  }

  it("giriş tabı aktiv olanda forma AÇIQ sayılmır (ünvan girişə yazılmazdı)", async () => {
    const { modal } = authModal({ active: "login" });
    const result = await inPage({ forms: [modal] }, () => openSignupInPage(60));
    assert.equal(result.already, undefined);
  });

  it("qeydiyyat tabı basılır və ondan sonra forma açıq sayılır", async () => {
    const { modal, signupTab, state } = authModal({ active: "login" });
    const result = await inPage({ forms: [modal] }, () => openSignupInPage(60));
    assert.equal(signupTab.clicked, true, "Sign Up tabı basılmalı idi");
    assert.equal(state.active, "signup");
    assert.equal(result.ready, true);
    assert.match(result.opened, /Sign Up/);
  });

  it("qeydiyyat tabı ARTIQ aktivdirsə heç nə basılmır", async () => {
    const { modal, signupTab } = authModal({ active: "signup" });
    const result = await inPage({ forms: [modal] }, () => openSignupInPage(60));
    assert.deepEqual(result, { already: true });
    assert.notEqual(signupTab.clicked, true);
  });

  it("modalın sosial düymələrinə toxunulmur", async () => {
    const { modal } = authModal({ active: "login" });
    const google = modal.buttons.find((el) => el.textContent === "Continue with Google");
    await inPage({ forms: [modal] }, () => openSignupInPage(60));
    assert.notEqual(google.clicked, true);
  });

  it("qeydiyyat tabı aktiv olandan sonra forma doldurulur", async () => {
    const { modal, email, password } = authModal({ active: "signup" });
    const result = await inPage({ forms: [modal] }, () => fillFormInPage(VALUES, { timeoutMs: 30, submitMs: 0 }));
    assert.equal(email.value, VALUES.email);
    assert.equal(password.value, VALUES.password);
    assert.equal(result.done, true);
  });

  // Tam ssenari: ana səhifə + abunə qutusu + başlıqda yalnız "Log In".
  // Əvvəl ünvan abunə qutusuna yazılırdı, sonra uydurma /signup açılırdı — hər ikisi yanlışdır.
  it("ANA SƏHİFƏ: abunə qutusu var, başlıqda yalnız 'Log In' → auth modalı açılır", async () => {
    const newsletter = form([input({ type: "email", ph: "Enter your email" })],
      [button({ text: "Subscribe" })]);
    const loginBtn = button({ tag: "BUTTON", text: "Log In", type: "" });
    const result = await inPage({
      url: "https://coinmarketcap.com/",
      forms: [newsletter],
      looseButtons: [loginBtn],
      links: [],
    }, () => openSignupInPage(60));
    assert.equal(newsletter.fields[0].value, "", "abunə xanasına toxunulmamalıdır");
    assert.equal(loginBtn.clicked, true, "auth səthi açılmalı idi");
    assert.equal(result.navigate, undefined, "uydurma ünvan açılmamalıdır");
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
  function loginPanel() {
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
      () => fillFormInPage(VALUES, { timeoutMs: 30, submitMs: 0 }));
    assert.equal(email.value, "", "ünvan giriş formasına yazılmamalı idi");
    assert.equal(password.value, "");
    assert.equal(result.done, false);
  });

  it("giriş paneli açıq olanda forma AÇIQ sayılmır", async () => {
    const { modal } = loginPanel();
    const result = await inPage({ dialogs: [modal], loose: modal.fields },
      () => openSignupInPage(60));
    assert.equal(result.already, undefined);
  });

  it("mətn blokundan ibarət 'Sign Up' tabı tapılıb basılır", async () => {
    const { modal, signupTab, state } = loginPanel();
    await inPage({ dialogs: [modal], loose: modal.fields }, () => openSignupInPage(60));
    assert.equal(signupTab.clicked, true, "tab mətn bloku olsa da basılmalıdır");
    assert.equal(state.active, "signup");
  });

  it("modalın sosial düymələri və giriş submit-i basılmır", async () => {
    const { modal } = loginPanel();
    await inPage({ dialogs: [modal], loose: modal.fields }, () => openSignupInPage(60));
    for (const el of modal.buttons) assert.notEqual(el.clicked, true, el.textContent);
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
      () => fillFormInPage(VALUES, { timeoutMs: 30, submitMs: 0 }));
    assert.equal(email.value, VALUES.email);
    assert.equal(password.value, VALUES.password);
    assert.equal(result.done, true);
    assert.notEqual(consent.checked, true, "marketinq xanası işarələnməməlidir");
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
  function cmcModal({ panel = "login" } = {}) {
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
      () => fillFormInPage(VALUES, { timeoutMs: 30, submitMs: 0 }));
    assert.equal(email.value, "", "ünvan giriş panelinə yazılmamalı idi");
    assert.equal(password.value, "");
    assert.equal(result.done, false);
  });

  it("mətn blokundan ibarət 'Sign Up' tabı valideyn zənciri ilə tapılıb basılır", async () => {
    const { modal, signupTab, state } = cmcModal({ panel: "login" });
    await inPage({
      loose: modal.querySelectorAll(FIELD_SELECTOR),
      looseButtons: modal.querySelectorAll("button"),
    }, () => openSignupInPage(60));
    assert.equal(signupTab.clicked, true, "tab nişansız modalda da tapılmalıdır");
    assert.equal(state.active, "signup");
  });

  it("giriş paneli açıq olanda forma AÇIQ sayılmır", async () => {
    const { modal } = cmcModal({ panel: "login" });
    const result = await inPage({
      loose: modal.querySelectorAll(FIELD_SELECTOR),
      looseButtons: modal.querySelectorAll("button"),
    }, () => openSignupInPage(60));
    assert.equal(result.already, undefined);
  });

  it("sosial düymələr basılmır", async () => {
    const { modal } = cmcModal({ panel: "login" });
    const buttons = modal.querySelectorAll("button");
    await inPage({ loose: modal.querySelectorAll(FIELD_SELECTOR), looseButtons: buttons },
      () => openSignupInPage(60));
    for (const el of buttons.filter((b) => /Continue with/.test(b.textContent))) {
      assert.notEqual(el.clicked, true, el.textContent);
    }
  });

  it("QEYDİYYAT paneli (razılıq xanası + new-password) doldurulur", async () => {
    const { modal, email, password } = cmcModal({ panel: "signup" });
    const result = await inPage({
      loose: modal.querySelectorAll(FIELD_SELECTOR),
      looseButtons: modal.querySelectorAll("button"),
    }, () => fillFormInPage(VALUES, { timeoutMs: 30, submitMs: 0 }));
    assert.equal(email.value, VALUES.email);
    assert.equal(password.value, VALUES.password);
    assert.equal(result.done, true);
  });

  it("qeydiyyat paneli açıq olanda forma AÇIQ sayılır (klik lazım deyil)", async () => {
    const { modal, signupTab } = cmcModal({ panel: "signup" });
    const result = await inPage({
      loose: modal.querySelectorAll(FIELD_SELECTOR),
      looseButtons: modal.querySelectorAll("button"),
    }, () => openSignupInPage(60));
    assert.deepEqual(result, { already: true });
    assert.notEqual(signupTab.clicked, true);
  });

  it("səbəb statusda görünür: hansı xananın niyə buraxıldığı", async () => {
    const { modal } = cmcModal({ panel: "login" });
    const result = await inPage({ loose: modal.querySelectorAll(FIELD_SELECTOR) },
      () => fillFormInPage(VALUES, { timeoutMs: 30, submitMs: 0 }));
    assert.match(result.reason, /giriş panelindədir/);
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
    }, () => fillFormInPage(VALUES, { timeoutMs: 30, submitMs: 0 }));
    assert.equal(regEmail.value, VALUES.email, "qeydiyyat tərəfi doldurulmalıdır");
    assert.equal(regPass.value, VALUES.password);
    assert.equal(loginEmail.value, "", "giriş tərəfinə toxunulmamalıdır");
    assert.equal(loginPass.value, "");
    assert.equal(result.done, true);
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
    }, () => fillFormInPage(VALUES, { timeoutMs: 30, submitMs: 0 }));
    assert.equal(pageMail.value, "", "bülleten xanasına yazılmamalı idi");
    assert.equal(result.done, false);
    assert.match(result.reason, /qeydiyyat konteksti yoxdur|giriş panelindədir/);
  });

  it("qeydiyyat paneli açıq olanda bülleten xanası YENƏ toxunulmur, modal doldurulur", async () => {
    const { modal, email, password } = cmcModal({ panel: "signup" });
    const pageMail = input({ type: "text", ph: "Enter your e-mail address" });
    const footer = box("DIV", [pageMail]);
    const result = await inPage({
      loose: [...modal.querySelectorAll(FIELD_SELECTOR), ...footer.querySelectorAll(FIELD_SELECTOR)],
      looseButtons: modal.querySelectorAll("button"),
    }, () => fillFormInPage(VALUES, { timeoutMs: 30, submitMs: 0 }));
    assert.equal(email.value, VALUES.email);
    assert.equal(password.value, VALUES.password);
    assert.equal(pageMail.value, "", "bülleten xanası boş qalmalıdır");
    assert.equal(result.done, true);
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
    assert.equal(fields[0], pageMail, "sənəd sırası real hesabatla eyni olmalıdır");
    const result = await inPage({
      loose: fields,
      looseButtons: root.querySelectorAll("button"),
      url: "https://coinmarketcap.com/",
    }, () => fillFormInPage(VALUES, { timeoutMs: 30, submitMs: 0 }));
    assert.equal(email.value, VALUES.email, "ünvan modalın xanasına yazılmalıdır");
    assert.equal(password.value, VALUES.password);
    assert.equal(pageMail.value, "", "bülleten xanası boş qalmalıdır");
    assert.equal(result.done, true);
  });

  // Dar kök yalnız sənəd kökü qədər çox şey izah edirsə seçilir: iki qola ayrılmış səhifədə
  // (ortaq valideyn `containersOf` dərinliyindən uzaqda) yarım forma seçilməməlidir.
  it("xanalar uzaq qollarda olsa sənəd kökü qalır (yarım forma seçilmir)", async () => {
    const mail = input({ type: "email", name: "email" });
    const pass = input({ type: "password", ac: "new-password" });
    // Hər xana 9 qat dərinlikdə: ortaq valideyn heç bir xananın valideyn zəncirinə düşmür
    const bury = (el) => {
      let node = el;
      for (let i = 0; i < 9; i += 1) node = box("DIV", [node]);
      return node;
    };
    const root = box("DIV", [bury(mail), bury(pass),
      box("DIV", [button({ text: "Create account", type: "" })])]);
    const result = await inPage({
      loose: root.querySelectorAll(FIELD_SELECTOR),
      looseButtons: root.querySelectorAll("button"),
    }, () => fillFormInPage(VALUES, { timeoutMs: 30, submitMs: 0 }));
    assert.equal(mail.value, VALUES.email, "ünvan yenə doldurulmalıdır");
    assert.equal(pass.value, VALUES.password, "parol yenə doldurulmalıdır");
    assert.equal(result.done, true);
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
    }, () => describePageInPage());

    assert.equal(report.url, "https://coinmarketcap.com/");
    assert.equal(report.fields.length, 2);
    assert.equal(report.fields[0].type, "email");
    assert.equal(report.fields[1].autocomplete, "current-password");
    assert.equal(report.fields[0].inForm, false, "formasız modal olduğu bilinməlidir");
    assert.ok(report.fields[0].chain.length > 0, "valideyn zənciri yazılmalıdır");
  });

  it("mətn bloku olan tablar da hesabata düşür (əsas məsələ məhz budur)", async () => {
    const signupTab = textNode("Sign Up");
    const page = box("DIV", [textNode("Log In"), signupTab, textNode("Pricing")]);
    const report = await inPage({ url: "https://x.example/", loose: [], looseButtons: [] },
      () => {
        globalThis.document.querySelectorAll = (selector) => (selector === "*"
          ? page.querySelectorAll("*")
          : []);
        return describePageInPage();
      });
    const texts = report.clickables.map((item) => item.text);
    assert.ok(texts.includes("Sign Up"), JSON.stringify(texts));
    assert.ok(texts.includes("Log In"));
    assert.equal(texts.includes("Pricing"), false, "aidiyyəti olmayan mətn siyahıya düşməməlidir");
    assert.equal(report.clickables[0].tag, "div", "tab düymə deyil — bu, hesabatda görünməlidir");
  });

  it("location oxunmasa da çökmür", async () => {
    const report = await inPage({}, () => describePageInPage());
    assert.equal(report.url, "");
    assert.ok(Array.isArray(report.fields));
    assert.ok(report.note.some((line) => /location/.test(line)));
  });
});

// ===========================================================================================
// Worker tərəfi: chrome API-si saxtadır — hansı taba, hansı dünyaya müraciət olunduğu və
// xətaların necə mətnə çevrildiyi yoxlanılır.
function withChrome({ session = { started: 1 }, script, tab = { url: "https://x.com/" } }, fn) {
  const previous = globalThis.chrome;
  const calls = [];
  const updates = [];
  const pageState = () => ({ documentId: tab?.documentId ?? `document-${updates.length}`,
    url: updates.at(-1)?.url ?? tab?.url, readyState: "complete" });
  globalThis.chrome = {
    storage: { session: { get: async () => ({ session }) } },
    runtime: { getPlatformInfo: async () => ({}) },
    scripting: { executeScript: async (options) => {
      calls.push(options);
      if (options.func.name === "pageState") return [{ documentId: pageState().documentId, result: pageState() }];
      const result = await script(options);
      return options.func === openSignupInPage && Array.isArray(result)
        ? result.map((frame) => ({ documentId: pageState().documentId, ...frame })) : result;
    } },
    tabs: {
      get: async () => (tab ? { id: 7, status: "complete", ...tab } : Promise.reject(new Error("no tab"))),
      update: async (tabId, options) => { updates.push({ tabId, ...options }); return { id: tabId, ...options }; },
      onUpdated: { addListener() {}, removeListener() {} },
    },
  };
  calls.length = 0;
  return fn(calls, updates).finally(() => {
    if (previous === undefined) delete globalThis.chrome; else globalThis.chrome = previous;
  });
}

const live = { relayTabId: 7, started: 1 };

describe("fillForm — worker tərəfi", () => {
  it("Microsoft ailəsində Azure-dan rəsmi giriş domeninə keçid qeydiyyatı kəsmir", () => {
    const session = { ...live, relaySite: "https://ai.azure.com" };
    return withChrome({ session, tab: { url: "https://login.microsoftonline.com/" },
      script: () => [{ result: { done: true, filled: ["email"] } }] }, async () => {
      const result = await fillForm(session, { email: VALUES.email }, { submit: false });
      assert.equal(result.done, true);
    });
  });
  it("eyni saytın auth iframe-i doldurulur, yad iframe-ə dəyər ötürülmür", () => {
    const session = { ...live, relaySite: "https://www.example.com" };
    return withChrome({ session, tab: { url: session.relaySite }, script: (o) => {
      if (o.func.name === "frameOrigin") return [
        { documentId: "main-doc", frameId: 0, result: "https://www.example.com" },
        { documentId: "auth-doc", frameId: 4, result: "https://auth.example.com" },
        { documentId: "other-doc", frameId: 5, result: "https://unrelated.example" },
      ];
      if (o.target.documentIds?.includes("auth-doc")) {
        assert.ok(o.args[1].allowedOrigins?.includes("https://auth.example.com") || o.args[1].allowedOrigin === "https://auth.example.com");
        return [{ documentId: "auth-doc", frameId: 4, result: o.args[1].mode === "submit"
          ? { submitted: "create account" } : { done: true, filled: ["email"] } }];
      }
      return [{ documentId: "main-doc", frameId: 0, result: { done: false } }];
    } }, async (calls) => {
      const result = await fillForm(session, { email: VALUES.email });
      assert.equal(result.done, true);
      assert.equal(result.submitted, "create account");
      assert.ok(calls.filter((call) => call.func === fillFormInPage).every((call) => !call.target.allFrames && !call.target.documentIds?.includes("other-doc")));
    });
  });
  it("tab başqa sayta keçəndə geniş host icazəsi olsa da doldurmur", () =>
    withChrome({ session: { ...live, relaySite: "https://example.com" }, tab: { url: "https://unrelated.example/" },
      script: () => [{ result: { done: true } }] }, async (calls) => {
      const result = await fillForm({ ...live, relaySite: "https://example.com" }, { email: VALUES.email });
      assert.equal(result.done, false);
      assert.equal(calls.length, 0);
    }));

  it("göndərmə doldurulan sənədə bağlanır, yeni sənəddə başqa düymə basılmır", () =>
    withChrome({ script: (o) => [{ documentId: "filled-document", frameId: 0,
      result: o.args[1].mode === "fill" ? { done: true, filled: ["email"] } : { submitted: "create account" } }] }, async (calls) => {
      await fillForm(live, { email: VALUES.email });
      assert.deepEqual(calls[1].target, { tabId: 7, documentIds: ["filled-document"] });
    }));
  it("doldurma və göndərmə AYRI-AYRI yeridilir (düymə səhifəni dəyişə bilər)", () =>
    withChrome({ script: (o) => [{ result: o.args[1].mode === "fill" ? { done: true, filled: ["email"] } : { submitted: "create account" } }] }, async (calls) => {
      const result = await fillForm(live, { email: VALUES.email, password: "", code: null });
      assert.deepEqual(result, { done: true, filled: ["email"], submitted: "create account" });
      assert.equal(calls.length, 2);
      assert.deepEqual(calls[0].target, { tabId: 7 });
      assert.equal(calls[0].func, fillFormInPage);
      assert.equal(calls[0].world, "MAIN");
      assert.equal(calls[0].injectImmediately, true, "hazır sahələr ağır resursların yüklənməsini gözləməməlidir");
      assert.deepEqual(calls[0].args, [{ email: VALUES.email }, { timeoutMs: FIND_TIMEOUT_MS, mode: "fill", onlyEmpty: false }]);
      assert.equal(calls[1].args[1].mode, "submit");
      assert.equal(calls[1].args[1].submitMs, SUBMIT_TIMEOUT_MS);
    }));

  it("submit: false ötürüləndə ikinci yeridilmə olmur", () =>
    withChrome({ script: () => [{ result: { done: true, filled: ["code"] } }] }, async (calls) => {
      await fillForm(live, { code: VALUES.code }, { submit: false });
      assert.equal(calls.length, 1);
      assert.equal(calls[0].args[1].mode, "fill");
    }));

  it("heç nə dolmasa göndərmə cəhdi edilmir", () =>
    withChrome({ script: () => [{ result: { done: false, reason: "formada uyğun sahə tapılmadı" } }] }, async (calls) => {
      const result = await fillForm(live, { code: VALUES.code });
      assert.equal(result.done, false);
      // İki yeridilmə: əsas frame + bütün frame-lər (iframe ehtimalı). Göndərmə YOXDUR.
      assert.equal(calls.length, 2);
      assert.equal(calls[1].target.allFrames, true);
      assert.ok(calls.every((call) => call.args[1].mode === "fill"));
    }));

  // Bəzi saytlar qeydiyyat formasını eyni origin-li IFRAME-də verir (hostlanmış auth widget-i).
  // Əsas frame-də forma tapılmasa bütün frame-lər sınanır və göndərmə HƏMİN frame-də aparılır.
  it("forma iframe-dədirsə tapılır və göndərmə eyni frame-də aparılır", () =>
    withChrome({
      script: (o) => {
        if (o.target.allFrames) {
          return [
            { frameId: 0, result: { done: false, reason: "formada uyğun sahə tapılmadı" } },
            { frameId: 42, result: { done: true, filled: ["email", "password"] } },
          ];
        }
        if (o.args[1].mode === "submit") return [{ frameId: 42, result: { submitted: "create account" } }];
        return [{ frameId: 0, result: { done: false, reason: "formada uyğun sahə tapılmadı" } }];
      },
    }, async (calls) => {
      const result = await fillForm(live, { email: VALUES.email });
      assert.equal(result.done, true);
      assert.deepEqual(result.filled, ["email", "password"]);
      assert.equal(result.submitted, "create account");
      assert.deepEqual(calls[2].target, { tabId: 7, frameIds: [42] }, "göndərmə eyni frame-də olmalıdır");
    }));

  it("əsas frame işləyəndə frame axtarışı APARILMIR (əlavə yeridilmə yoxdur)", () =>
    withChrome({ script: (o) => [{ result: o.args[1].mode === "fill" ? { done: true, filled: ["email"] } : { submitted: "ok" } }] },
      async (calls) => {
        await fillForm(live, { email: VALUES.email });
        assert.equal(calls.length, 2, "doldurma + göndərmə");
        assert.equal(calls[0].target.allFrames, undefined);
        assert.deepEqual(calls[1].target, { tabId: 7 });
      }));

  it("göndərmə cavabsız qalsa bu, KEÇİD sayılır (doldurmanın nəticəsi qalır)", () =>
    withChrome({
      script: (o) => (o.args[1].mode === "fill"
        ? [{ result: { done: true, filled: ["email", "password"], checked: 1 } }]
        : new Promise(() => {})),          // klik naviqasiya etdi → cavab gəlmir
    }, async () => {
      const result = await fillForm(live, { email: VALUES.email }, { submitMs: 10, graceMs: 30 });
      assert.equal(result.done, true);
      assert.deepEqual(result.filled, ["email", "password"]);
      assert.equal(result.navigated, true);
      assert.equal(result.submitted, undefined);
    }));

  it("yazılacaq dəyər yoxdursa skript yeridilmir", () =>
    withChrome({ script: () => [{ result: { done: true } }] }, async (calls) => {
      assert.match((await fillForm(live, { code: "" })).reason, /dəyər yoxdur/);
      assert.deepEqual(calls, []);
    }));

  it("relay tabı yoxdursa və sessiya dəyişibsə skript yeridilmir", () =>
    withChrome({ session: { started: 2 }, script: () => [{ result: { done: true } }] }, async (calls) => {
      assert.match((await fillForm({ started: 1 }, { code: "1" })).reason, /relay tabı yoxdur/);
      assert.match((await fillForm(live, { code: "1" })).reason, /sessiya dəyişdi/);
      assert.deepEqual(calls, []);
    }));

  it("icazə xətası blocked kimi qaytarılır", () =>
    withChrome({ script: () => { throw new Error('Cannot access contents of url "https://x.com/".'); } }, async () => {
      const result = await fillForm(live, { code: VALUES.code });
      assert.equal(result.blocked, true);
      assert.match(result.reason, /icazə/);
    }));

  it("digər xətalar udulur — kodun çatdırılması bundan asılı olmamalıdır", () =>
    withChrome({ script: () => { throw new Error("No tab with id: 7"); } }, async () => {
      const result = await fillForm(live, { code: VALUES.code });
      assert.equal(result.done, false);
      assert.equal(result.blocked, undefined);
      assert.match(result.reason, /No tab with id/);
    }));
});

describe("openSignup — worker tərəfi", () => {
  it("hazır forma cavabından sonra əlavə sakitləşmə fasiləsi yoxdur", () =>
    withChrome({ script: () => [{ result: { opened: "Sign up", ready: true } }] }, async () => {
      let deadline;
      try {
        const result = await Promise.race([openSignup(live), new Promise((resolve) => {
          deadline = setTimeout(() => resolve({ slow: true }), 400);
        })]);
        assert.equal(result.slow, undefined, "hazır DOM üçün 1,2 saniyə gözlənməməlidir");
        assert.equal(result.opened, "Sign up");
      } finally { clearTimeout(deadline); }
    }));

  it("keçid tamamlananda ölmüş skriptin 10 saniyəlik limiti gözlənmir", () => {
    const tab = { url: "https://x.com/", documentId: "old-document" };
    return withChrome({ tab, script: () => new Promise(() => {}) }, async () => {
      const listeners = new Set();
      chrome.tabs.onUpdated = {
        addListener: (listener) => listeners.add(listener),
        removeListener: (listener) => listeners.delete(listener),
      };
      const running = openSignup(live, { timeoutMs: 900, graceMs: 10 });
      for (let i = 0; i < 10 && !listeners.size; i++) await new Promise(setImmediate);
      assert.ok(listeners.size, "naviqasiya skriptlə paralel izlənməlidir");
      for (const listener of listeners) listener(7, { status: "loading" });
      for (const listener of listeners) listener(99, { status: "complete" });
      tab.documentId = "new-document";
      for (const listener of listeners) listener(7, { status: "complete" });
      let deadline;
      try {
        const result = await Promise.race([running, new Promise((resolve) => {
          deadline = setTimeout(() => resolve({ slow: true }), 400);
        })]);
        assert.equal(result.slow, undefined);
        assert.equal(result.navigated, true);
        assert.equal(listeners.size, 0, "hadisə dinləyicisi təmizlənməlidir");
      } finally { clearTimeout(deadline); }
    });
  });

  it("nəticə olduğu kimi qaytarılır", () =>
    withChrome({ script: () => [{ result: { already: true } }] }, async (calls) => {
      assert.deepEqual(await openSignup(live), { already: true });
      assert.ok(calls.some((call) => call.func === openSignupInPage));
    }));

  it("link açılıbsa ad qaytarılır", () =>
    withChrome({ script: () => [{ result: { opened: "Sign up", ready: true } }] }, async () => {
      const result = await openSignup(live);
      assert.equal(result.opened, "Sign up");
      assert.equal(result.navigated, false);
    }));

  it("skript naviqasiya səbəbindən cavab verməsə bu xəta sayılmır", () =>
    withChrome({ script: () => new Promise(() => {}) }, async () => {
      const result = await openSignup(live, { timeoutMs: 10, graceMs: 30 });
      assert.equal(result.navigated, true);
      assert.equal(result.error, undefined);
    }));

  it("skript ölübsə və URL dəyişibsə də keçid sayılır", () => {
    const tab = { url: "https://x.com/", documentId: "old-document" };
    return withChrome({ tab, script: () => {
      tab.url = "https://x.com/signup";
      tab.documentId = "new-document";
      throw new Error("Frame with ID 0 was removed.");
    } }, async () => {
      const result = await openSignup(live);
      assert.equal(result.navigated, true);
      assert.equal(result.error, undefined);
    });
  });

  it("icazə xətası naviqasiya kimi yozulmur", () =>
    withChrome({ script: () => { throw new Error("Cannot access contents of url"); } }, async () => {
      const result = await openSignup(live);
      assert.equal(result.blocked, true);
      assert.match(result.error, /icazə/);
    }));

  // Səhifə funksiyası `{ navigate }` qaytardıqda tab HƏMİN ünvana aparılır və axtarış BİR DƏFƏ
  // təkrarlanır (ikinci cəhddə naviqasiya qadağandır — dövrə yaranmasın).
  it("navigate: tab qeydiyyat ünvanına aparılır və axtarış təkrarlanır", () =>
    withChrome({
      script: (o) => [{
        result: o.args[1]?.navigate === false
          ? { already: true }
          : { navigate: "https://x.com/signup" },
      }],
    }, async (calls, updates) => {
      const result = await openSignup(live);
      assert.deepEqual(updates, [{ tabId: 7, url: "https://x.com/signup" }]);
      assert.equal(result.navigatedTo, "https://x.com/signup");
      assert.equal(result.ready, true);
      const opens = calls.filter((call) => call.func === openSignupInPage);
      assert.equal(opens.length, 2, "ikinci axtarış aparılmalıdır");
      assert.equal(opens[0].args[1].navigate, true);
      assert.equal(opens[1].args[1].navigate, false, "ikinci cəhddə keçid qadağandır");
    }));

  it("navigate: səhifədə forma tapılmasa nəticə bunu deyir", () =>
    withChrome({
      script: (o) => [{
        result: o.args[1]?.navigate === false
          ? { none: true }
          : { navigate: "https://x.com/register" },
      }],
    }, async () => {
      const result = await openSignup(live);
      assert.equal(result.navigatedTo, "https://x.com/register");
      assert.equal(result.ready, false, "səhifədə forma tapılmadı");
    }));

  it("navigate: keçid alınmasa aydın xəta qaytarılır", () =>
    withChrome({ script: () => [{ result: { navigate: "https://x.com/signup" } }] }, async () => {
      globalThis.chrome.tabs.update = async () => { throw new Error("No tab with id: 7"); };
      const result = await openSignup(live);
      assert.match(result.error, /qeydiyyat səhifəsi açılmadı/);
    }));

  it("allowNavigate: false ötürüləndə səhifə funksiyası da keçid axtarmır", () =>
    withChrome({ script: () => [{ result: { none: true } }] }, async (calls, updates) => {
      await openSignup(live, { allowNavigate: false });
      assert.equal(calls.find((call) => call.func === openSignupInPage).args[1].navigate, false);
      assert.deepEqual(updates, []);
    }));
});

describe("describePage — worker tərəfi", () => {
  it("verilmiş taba yeridilir və hesabatı qaytarır (sessiya tələb olunmur)", () =>
    withChrome({ script: () => [{ result: { url: "https://x.com/", fields: [], clickables: [] } }] },
      async (calls) => {
        const report = await describePage(7);
        assert.equal(report.url, "https://x.com/");
        assert.deepEqual(calls[0].target, { tabId: 7 });
        assert.equal(calls[0].func, describePageInPage);
        assert.equal(calls[0].world, "MAIN");
      }));

  it("tab seçilməyibsə aydın xəta", async () => {
    await assert.rejects(() => describePage(null), /tab seçilməyib/);
  });

  it("icazə xətası istifadəçi dilinə çevrilir", () =>
    withChrome({ script: () => { throw new Error("Cannot access contents of url"); } }, async () => {
      await assert.rejects(() => describePage(7), /icazə/);
    }));
});

describe("signupValues", () => {
  it("profili düzəldir: ünvan, ad və parol sessiyadan gəlir", () => {
    const session = {
      address: "a@b.com", username: "userx", password: "p",
      identity: { email: "old@x.com", username: "old", firstName: "Emily", city: "Austin" },
    };
    assert.deepEqual(signupValues(session), {
      email: "a@b.com", username: "userx", password: "p", firstName: "Emily", city: "Austin",
    });
  });

  it("profil yoxdursa boş sahələr qaytarılır və extra üstündür", () => {
    assert.deepEqual(signupValues(null, { email: "x@y.z" }), { email: "x@y.z", username: "", password: "" });
  });
});

describe("fillNote / filledNote", () => {
  it("rollar istifadəçi dilinə çevrilir", () => {
    assert.equal(filledNote(["email", "username", "firstName", "postal"]),
      "ünvan + istifadəçi adı + ad + poçt indeksi");
    assert.equal(filledNote([]), "");
  });

  it("çox sahə olanda sayı yazılır", () => {
    const filled = ["email", "username", "password", "passwordConfirm", "firstName", "lastName"];
    assert.equal(fillNote({ filled, checked: 2, chosen: 1, submitted: "create account" }),
      '6 xana dolduruldu, 1 seçim, 2 razılıq xanası, "create account" basıldı');
  });

  it("az sahə ad-ad sadalanır, düymə basılmayıbsa səbəb yazılır", () => {
    assert.equal(fillNote({ filled: ["code"], reason: "göndərmə düyməsi tapılmadı" }),
      "kod, göndərmə düyməsi tapılmadı");
    assert.equal(fillNote(null), "");
  });
});
