// Relay saytında qeydiyyat addımlarının icrası (background/signup.js).
//
// Bu mexanizm sayta bağlı relay deskriptorları üçündür (`signup` sahəsi). Hazırda reyestrdə
// belə relay YOXDUR — yalnız "bu sayt" var və o, evristika ilə işləyir (background/forms.js).
// Mexanizm gələcək relay-lar üçün saxlanılır, ona görə testdə deskriptor YERLİ nümunə kimi
// verilir (reyestrdən asılı deyil).
//
// İki hissə var: səhifədə icra olunan `runInPage` (saxta DOM ilə) və worker tərəfi
// `runSignup` (chrome.scripting stub-lanır). Ən vacib iki qayda burada qorunur:
//   1. dəyər PROTOTİPDƏKİ native setter ilə yazılır — React idarə edən xanada instansiya
//      setter-i yazını udur və forma boş dəyər göndərir (real saytlarda məhz belədir);
//   2. `enabled: true` addımı düymənin AKTİVLƏŞMƏSİNİ gözləyir — CAPTCHA (Turnstile) həll
//      olunana qədər "Send code" və "Create account" disabled qalır, sabit sleep etibarsızdır.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ENABLED_TIMEOUT_MS,
  FIND_TIMEOUT_MS,
  resolveSteps,
  runInPage,
  runSignup,
  SignupPhase,
  signupSteps,
  supportsSignup,
  usesPassword,
} from "../src/background/signup.js";
import { createRegistry, validateRelay } from "../src/providers/contract.js";

// Addımlı relay-in nümunəsi: KONTRAKTDAN keçir (reyestr qurulur), yəni forma real
// deskriptorun tələblərinə uyğundur.
const stepped = {
  id: "example-relay",
  name: "example-relay",
  url: "https://relay.example.com/sign-up",
  hosts: ["relay.example.com", "challenges.cloudflare.com"],
  cleanup: {
    cookieDomains: ["relay.example.com"],
    partitionTopLevelSites: ["https://relay.example.com"],
    storageOrigins: ["https://relay.example.com"],
  },
  signup: {
    password: { length: 16 },
    afterAddress: [
      { click: 'button[aria-label="Continue with email"]' },
      { fill: 'input[name="username"]', value: "address" },
      { waitValue: 'input[name="cf-turnstile-response"]', timeoutMs: 25000 },
      { click: "button", text: "Send code", enabled: true },
    ],
    afterCode: [
      { fill: "#registration-verification-code", value: "code" },
      { fill: 'input[name="password"]', value: "password" },
      { click: 'button[type="submit"]', text: "Create account", enabled: true },
    ],
  },
};
const registry = createRegistry("relay", [stepped], validateRelay);
const steppedRelay = registry.get("example-relay");

// --- saxta DOM -----------------------------------------------------------------------------
function makeEl({ visible = true, disabled = false, maxLength = 0, text = "", tag = "input" } = {}) {
  const proto = {
    set value(v) { this._value = maxLength ? String(v).slice(0, maxLength) : String(v); },
    get value() { return this._value; },
    focus() { this.focused = true; },
    scrollIntoView() { this.scrolled = true; },
    click() { this.clicks++; },
    getAttribute(name) { return this.attributes[name] ?? null; },
    dispatchEvent(event) { this.events.push({ type: event.type, bubbles: event.bubbles }); return true; },
  };
  return Object.assign(Object.create(proto), {
    _value: "", events: [], clicks: 0, attributes: {}, textContent: text, tag,
    disabled,
    offsetParent: visible ? {} : null,
    offsetWidth: visible ? 120 : 0,
    offsetHeight: visible ? 30 : 0,
  });
}

// React value tracker: instansiyada dəyəri UDAN setter
function trackLikeReact(el) {
  Object.defineProperty(el, "value", {
    configurable: true,
    get() { return this._value; },
    set() { this.swallowed = true; },
  });
  return el;
}

// Səhifə mühiti: document, Event, MutationObserver və taymerlər.
// `mutate` — observer qurulduqdan sonra DOM-u dəyişmək üçün (disabled → false və s.).
async function inPage(map, run, { mutate } = {}) {
  const previous = {
    document: globalThis.document,
    Event: globalThis.Event,
    MutationObserver: globalThis.MutationObserver,
  };
  const observers = [];
  globalThis.document = {
    documentElement: {},
    querySelectorAll(selector) {
      if (selector.startsWith("!")) throw new SyntaxError("pozulmuş selektor");
      return map[selector] ?? [];
    },
  };
  globalThis.Event = class { constructor(type, options) { this.type = type; Object.assign(this, options); } };
  globalThis.MutationObserver = class {
    constructor(callback) { this.callback = callback; observers.push(this); }
    observe() {}
    disconnect() { this.stopped = true; }
  };
  const notify = () => { for (const o of observers) if (!o.stopped) o.callback(); };
  try {
    const pending = run();
    if (mutate) {
      // Növbəti mikrotaskda dəyişiklik edib observer-i işə salırıq
      await Promise.resolve();
      mutate();
      notify();
    }
    return await pending;
  } finally {
    for (const key of ["document", "Event", "MutationObserver"]) {
      if (previous[key] === undefined) delete globalThis[key]; else globalThis[key] = previous[key];
    }
  }
}

const fillStep = (selector, value, extra = {}) => ({ action: "fill", selector, value, text: null, enabled: false, timeoutMs: 50, ...extra });
const clickStep = (selector, extra = {}) => ({ action: "click", selector, value: null, text: null, enabled: false, timeoutMs: 50, ...extra });
const waitStep = (selector, extra = {}) => ({ action: "wait", selector, value: null, text: null, enabled: false, timeoutMs: 50, ...extra });

describe("runInPage — fill addımı", () => {
  it("xanaya dəyəri yazır və hadisələri göndərir", async () => {
    const el = makeEl();
    const result = await inPage({ "#code": [el] }, () => runInPage([fillStep("#code", "483920")]));
    assert.deepEqual(result, { done: true, at: 1 });
    assert.equal(el.value, "483920");
    assert.deepEqual(el.events, [{ type: "input", bubbles: true }, { type: "change", bubbles: true }]);
    assert.equal(el.focused, true);
    assert.equal(el.scrolled, true);
  });

  it("dəyər PROTOTİPDƏKİ setter ilə yazılır (React value tracker keçilir)", async () => {
    const el = trackLikeReact(makeEl());
    el.value = "000000";                       // naiv yol udulur
    assert.equal(el._value, "");
    const result = await inPage({ "#code": [el] }, () => runInPage([fillStep("#code", "483920")]));
    assert.equal(result.done, true);
    assert.equal(el.value, "483920");
  });

  it("maxlength dəyəri kəsirsə addım uğursuzdur (yarım kod göndərilməməlidir)", async () => {
    const el = makeEl({ maxLength: 4 });
    const result = await inPage({ "#code": [el] }, () => runInPage([fillStep("#code", "483920")]));
    assert.equal(result.done, false);
    assert.equal(result.at, 0);
    assert.match(result.reason, /saxlamadı/);
  });

  it("prototipdə setter yoxdursa adi mənimsətmə ilə yazılır", async () => {
    const el = { value: "", disabled: false, offsetWidth: 10, offsetHeight: 10, offsetParent: {}, textContent: "", getAttribute: () => null, dispatchEvent: () => true };
    const result = await inPage({ "#code": [el] }, () => runInPage([fillStep("#code", "483920")]));
    assert.equal(result.done, true);
    assert.equal(el.value, "483920");
  });
});

describe("runInPage — click addımı", () => {
  it("elementi kliklər", async () => {
    const el = makeEl();
    const result = await inPage({ "#go": [el] }, () => runInPage([clickStep("#go")]));
    assert.deepEqual(result, { done: true, at: 1 });
    assert.equal(el.clicks, 1);
  });

  it("mətnlə tapır (sabit atributu olmayan düymə)", async () => {
    const other = makeEl({ text: "Create account" });
    const send = makeEl({ text: "Send code" });
    const result = await inPage({ button: [other, send] }, () => runInPage([clickStep("button", { text: "Send code" })]));
    assert.equal(result.done, true);
    assert.equal(send.clicks, 1);
    assert.equal(other.clicks, 0);
  });

  it("dəqiq uyğunluq qismi uyğunluğun üstündə tutulur", async () => {
    const partial = makeEl({ text: "Send code again later" });
    const exact = makeEl({ text: "Send code" });
    await inPage({ button: [partial, exact] }, () => runInPage([clickStep("button", { text: "send CODE" })]));
    assert.equal(exact.clicks, 1);
    assert.equal(partial.clicks, 0);
  });

  it("mətn uyğun gəlmirsə element tapılmadı sayılır", async () => {
    const el = makeEl({ text: "Create account" });
    const result = await inPage({ button: [el] }, () => runInPage([clickStep("button", { text: "Send code" })]));
    assert.equal(result.done, false);
    assert.match(result.reason, /element tapılmadı: button \("Send code"\)/);
    assert.equal(el.clicks, 0);
  });
});

describe("runInPage — waitValue addımı (Turnstile token)", () => {
  it("dəyər hazırdırsa dərhal keçir", async () => {
    const token = makeEl({ visible: false });
    token._value = "0.abc";
    const result = await inPage({ "#ts": [token] }, () => runInPage([waitStep("#ts")]));
    assert.deepEqual(result, { done: true, at: 1 });
  });

  it("GİZLİ element də qəbul olunur (token hidden input-dadır)", async () => {
    const token = makeEl({ visible: false });
    token._value = "0.abc";
    assert.equal((await inPage({ "#ts": [token] }, () => runInPage([waitStep("#ts")]))).done, true);
  });

  it("dəyər sonra gəlirsə gözlənilir", async () => {
    const token = makeEl({ visible: false });
    const result = await inPage(
      { "#ts": [token] },
      () => runInPage([waitStep("#ts", { timeoutMs: 2000 })]),
      { mutate: () => { token._value = "0.token"; } },
    );
    assert.equal(result.done, true);
  });

  it("boş və yalnız boşluqdan ibarət dəyər hazır sayılmır", async () => {
    const token = makeEl({ visible: false });
    token._value = "   ";
    const result = await inPage({ "#ts": [token] }, () => runInPage([waitStep("#ts")]));
    assert.equal(result.done, false);
    assert.match(result.reason, /dəyər gözlənildi, gəlmədi: #ts/);
  });

  it("element ümumiyyətlə yoxdursa da gözləmə ilə bitir", async () => {
    const result = await inPage({}, () => runInPage([waitStep("#ts")]));
    assert.equal(result.done, false);
    assert.match(result.reason, /dəyər gözlənildi/);
  });

  it("gözləmə uğursuzdursa sonrakı addımlar icra OLUNMUR (cəhd itməsin)", async () => {
    const token = makeEl({ visible: false });
    const send = makeEl({ text: "Send code" });
    const result = await inPage({ "#ts": [token], button: [send] }, () =>
      runInPage([waitStep("#ts"), clickStep("button", { text: "Send code" })]));
    assert.equal(result.at, 0);
    assert.equal(send.clicks, 0, "token gəlmədən Send code kliklənməməlidir");
  });

  it("token gələndən sonra Send code kliklənir", async () => {
    const token = makeEl({ visible: false });
    const send = makeEl({ text: "Send code", disabled: true });
    const result = await inPage(
      { "#ts": [token], button: [send] },
      () => runInPage([waitStep("#ts", { timeoutMs: 2000 }), clickStep("button", { text: "Send code", enabled: true, timeoutMs: 2000 })]),
      { mutate: () => { token._value = "0.token"; send.disabled = false; } },
    );
    assert.equal(result.done, true);
    assert.equal(send.clicks, 1);
  });
});

describe("runInPage — gözləmə və uğursuzluqlar", () => {
  it("görünməyən element seçilmir", async () => {
    const hidden = makeEl({ visible: false });
    const visible = makeEl();
    await inPage({ "#code": [hidden, visible] }, () => runInPage([fillStep("#code", "1234")]));
    assert.equal(visible.value, "1234");
    assert.equal(hidden.value, "");
  });

  it("element tapılmasa vaxt bitir və addımın nömrəsi qaytarılır", async () => {
    const el = makeEl();
    const result = await inPage({ "#a": [el] }, () => runInPage([clickStep("#a"), clickStep("#yoxdur")]));
    assert.deepEqual({ done: result.done, at: result.at }, { done: false, at: 1 });
    assert.match(result.reason, /element tapılmadı: #yoxdur/);
  });

  it("enabled:true — disabled düymə gözlənilir, aktivləşəndə kliklənir (Turnstile)", async () => {
    const el = makeEl({ text: "Send code", disabled: true });
    const result = await inPage(
      { button: [el] },
      () => runInPage([clickStep("button", { text: "Send code", enabled: true, timeoutMs: 2000 })]),
      { mutate: () => { el.disabled = false; } },
    );
    assert.equal(result.done, true);
    assert.equal(el.clicks, 1);
  });

  it("enabled:true — aktivləşməsə aydın səbəb qaytarılır", async () => {
    const el = makeEl({ text: "Send code", disabled: true });
    const result = await inPage({ button: [el] }, () => runInPage([clickStep("button", { text: "Send code", enabled: true })]));
    assert.equal(result.done, false);
    assert.match(result.reason, /aktiv element gözlənildi/);
    assert.equal(el.clicks, 0);
  });

  it("aria-disabled=true da aktiv sayılmır", async () => {
    const el = makeEl();
    el.attributes["aria-disabled"] = "true";
    const result = await inPage({ "#go": [el] }, () => runInPage([clickStep("#go", { enabled: true })]));
    assert.equal(result.done, false);
    assert.equal(el.clicks, 0);
  });

  it("enabled olmayan addım disabled elementi də kliklər (sayt özü qərar verir)", async () => {
    const el = makeEl({ disabled: true });
    const result = await inPage({ "#go": [el] }, () => runInPage([clickStep("#go")]));
    assert.equal(result.done, true);
    assert.equal(el.clicks, 1);
  });

  it("pozulmuş selektor sınmır, addım uğursuz kimi bitir", async () => {
    const result = await inPage({}, () => runInPage([clickStep("!yanlış(")]));
    assert.equal(result.done, false);
    assert.match(result.reason, /element tapılmadı/);
  });

  it("uğursuz addımdan sonrakılar icra olunmur", async () => {
    const later = makeEl();
    const result = await inPage({ "#sonra": [later] }, () => runInPage([clickStep("#yoxdur"), clickStep("#sonra")]));
    assert.equal(result.at, 0);
    assert.equal(later.clicks, 0);
  });

  it("boş addım siyahısı uğur sayılır", async () => {
    assert.deepEqual(await inPage({}, () => runInPage([])), { done: true, at: 0 });
  });

  it("addımlar YAZILDIĞI sıra ilə icra olunur", async () => {
    const order = [];
    const email = makeEl();
    const send = makeEl({ text: "Send code" });
    email.dispatchEvent = () => { order.push("fill"); return true; };
    send.click = () => { order.push("click"); };
    await inPage({ "#email": [email], button: [send] }, () =>
      runInPage([fillStep("#email", "a@b.com"), clickStep("button", { text: "Send code" })]));
    assert.deepEqual(order, ["fill", "fill", "click"]);   // input + change, sonra klik
  });
});

// --- deskriptordan icraya ------------------------------------------------------------------
describe("resolveSteps — dəyər adlarının doldurulması", () => {
  const slots = { address: "user@gmail.com", code: "483920", password: "Ab3xKm9pQr2sTv5w" };

  it("fill addımının value adı konkret dəyərlə əvəzlənir", () => {
    const { steps } = resolveSteps([{ fill: "#email", value: "address" }], slots);
    assert.deepEqual(steps, [{ action: "fill", selector: "#email", text: null, value: "user@gmail.com", enabled: false, timeoutMs: FIND_TIMEOUT_MS }]);
  });

  it("click addımı selektoru və mətni saxlayır", () => {
    const { steps } = resolveSteps([{ click: "button", text: "Send code", enabled: true }], slots);
    assert.deepEqual(steps, [{ action: "click", selector: "button", text: "Send code", value: null, enabled: true, timeoutMs: ENABLED_TIMEOUT_MS }]);
  });

  it("waitValue addımı wait əməliyyatına çevrilir və uzun limit alır", () => {
    const { steps } = resolveSteps([{ waitValue: "#ts" }], slots);
    assert.deepEqual(steps, [{ action: "wait", selector: "#ts", text: null, value: null, enabled: false, timeoutMs: ENABLED_TIMEOUT_MS }]);
  });

  it("enabled addımının gözləmə limiti daha uzundur (Turnstile)", () => {
    assert.ok(ENABLED_TIMEOUT_MS > FIND_TIMEOUT_MS);
  });

  it("deskriptordaki timeoutMs default-u əvəz edir", () => {
    const { steps } = resolveSteps([{ click: "#go", timeoutMs: 1234 }], slots);
    assert.equal(steps[0].timeoutMs, 1234);
  });

  it("dəyər hazır deyilsə heç bir addım icra olunmur", () => {
    const { error, steps } = resolveSteps([{ fill: "#code", value: "code" }], { code: null });
    assert.equal(steps, undefined);
    assert.match(error, /"code" dəyəri hazır deyil/);
  });

  it("boş sətir də hazır sayılmır (parol yaradılmayıbsa forma pozulmasın)", () => {
    assert.match(resolveSteps([{ fill: "#p", value: "password" }], { password: "" }).error, /password/);
  });
});

describe("signupSteps / supportsSignup / usesPassword", () => {
  it("addımlı relay hər iki fazanı daşıyır", () => {
    assert.deepEqual(registry.problems, [], "nümunə deskriptor kontraktdan keçmir");
    assert.equal(supportsSignup(steppedRelay, SignupPhase.afterAddress), true);
    assert.equal(supportsSignup(steppedRelay, SignupPhase.afterCode), true);
    assert.ok(signupSteps(steppedRelay, SignupPhase.afterAddress).length >= 3);
  });

  it("addımlı relay parol tələb edir", () => {
    assert.equal(usesPassword(steppedRelay), true);
  });

  it("addım yazılmayan relay üçün imkan yoxdur", () => {
    assert.equal(supportsSignup({}, SignupPhase.afterCode), false);
    assert.equal(supportsSignup({ signup: {} }, SignupPhase.afterCode), false);
    assert.equal(supportsSignup(null, SignupPhase.afterCode), false);
    assert.deepEqual(signupSteps(null, SignupPhase.afterCode), []);
    assert.equal(usesPassword({ signup: { afterCode: [{ fill: "#c", value: "code" }] } }), false);
  });
});

// --- worker tərəfi -------------------------------------------------------------------------
function withChrome({ session = { started: 1 }, script }, fn) {
  const previous = globalThis.chrome;
  const calls = [];
  globalThis.chrome = {
    storage: { session: { get: async () => ({ session }) } },
    runtime: { getPlatformInfo: async () => ({}) },
    scripting: { executeScript: async (options) => { calls.push(options); return script(options); } },
  };
  return fn(calls).finally(() => {
    if (previous === undefined) delete globalThis.chrome; else globalThis.chrome = previous;
  });
}

const relay = {
  id: "r",
  signup: { afterCode: [{ fill: "#code", value: "code" }, { click: "#go", enabled: true }] },
};
const live = { relayTabId: 7, started: 1 };
const slots = { code: "483920" };

describe("runSignup — worker tərəfi", () => {
  it("addımları relay tabında icra edir: tabId, funksiya, MAIN dünyası", () =>
    withChrome({ script: () => [{ result: { done: true, at: 2 } }] }, async (calls) => {
      assert.deepEqual(await runSignup(live, relay, SignupPhase.afterCode, slots), { done: true, at: 2 });
      assert.equal(calls.length, 1);
      assert.deepEqual(calls[0].target, { tabId: 7 });
      assert.equal(calls[0].func, runInPage);
      assert.equal(calls[0].world, "MAIN");
      assert.equal(calls[0].args[0][0].value, "483920");
      assert.equal(calls[0].args[0][1].action, "click");
    }));

  it("faza yazılmayıbsa skript yeridilmir", () =>
    withChrome({ script: () => [{ result: { done: true } }] }, async (calls) => {
      const result = await runSignup(live, relay, SignupPhase.afterAddress, slots);
      assert.match(result.reason, /addım yazılmayıb/);
      assert.deepEqual(calls, []);
    }));

  it("relay tabı yoxdursa skript yeridilmir", () =>
    withChrome({ script: () => [{ result: { done: true } }] }, async (calls) => {
      assert.match((await runSignup({ started: 1 }, relay, SignupPhase.afterCode, slots)).reason, /relay tabı yoxdur/);
      assert.deepEqual(calls, []);
    }));

  it("sessiya dəyişibsə başqasının tabına toxunulmur", () =>
    withChrome({ session: { started: 2 }, script: () => [{ result: { done: true } }] }, async (calls) => {
      assert.deepEqual(await runSignup(live, relay, SignupPhase.afterCode, slots), { done: false, reason: "sessiya dəyişdi" });
      assert.deepEqual(calls, []);
    }));

  it("dəyər hazır deyilsə skript yeridilmir (yarım forma göndərilməsin)", () =>
    withChrome({ script: () => [{ result: { done: true } }] }, async (calls) => {
      assert.match((await runSignup(live, relay, SignupPhase.afterCode, {})).reason, /"code" dəyəri hazır deyil/);
      assert.deepEqual(calls, []);
    }));

  it("tab bağlanıbsa xəta udulur — kodun çatdırılması bundan asılı olmamalıdır", () =>
    withChrome({ script: () => { throw new Error("No tab with id: 7"); } }, async () => {
      const result = await runSignup(live, relay, SignupPhase.afterCode, slots);
      assert.equal(result.done, false);
      assert.match(result.reason, /No tab with id/);
    }));

  it("səhifə nəticə qaytarmasa aydın səbəb yazılır", () =>
    withChrome({ script: () => [] }, async () => {
      assert.match((await runSignup(live, relay, SignupPhase.afterCode, slots)).reason, /səhifə cavab qaytarmadı/);
    }));

  it("səhifənin öz uğursuzluğu olduğu kimi qaytarılır", () =>
    withChrome({ script: () => [{ result: { done: false, at: 1, reason: "aktiv element gözlənildi: #go" } }] }, async () => {
      assert.deepEqual(await runSignup(live, relay, SignupPhase.afterCode, slots),
        { done: false, at: 1, reason: "aktiv element gözlənildi: #go" });
    }));
});

// --- addım dəstinin bütövlüyü --------------------------------------------------------------
// Sayta bağlı relay silinib, ona görə konkret selektorlar artıq yoxlanmır. Qalan qayda ümumidir
// və yeni relay yazılanda pozulmamalıdır: addım dəsti resolveSteps-dən keçməlidir və kod
// istəyən klik CAPTCHA token-i gözlədikdən SONRA gəlməlidir.
describe("addım dəstinin bütövlüyü", () => {
  const address = signupSteps(steppedRelay, SignupPhase.afterAddress);

  it("kod istəyən klik token gözləməsindən SONRA gəlir (yoxsa sayt cəhdi rədd edir)", () => {
    const waitAt = address.findIndex((s) => typeof s.waitValue === "string");
    const clickAt = address.findIndex((s) => s.text === "Send code");
    assert.ok(waitAt >= 0 && clickAt > waitAt, "token gözləməsi klikdən əvvəl olmalıdır");
  });

  it("addımların hamısı resolveSteps-dən keçir", () => {
    const slots = { address: "u@gmail.com", code: "483920", password: "Ab3xKm9pQr2sTv5w" };
    for (const phase of Object.values(SignupPhase)) {
      const { error } = resolveSteps(signupSteps(steppedRelay, phase), slots);
      assert.equal(error, undefined, `${phase}: ${error}`);
    }
  });
});
