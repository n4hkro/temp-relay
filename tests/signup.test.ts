// Relay saytında qeydiyyat addımlarının icrası (background/signup.ts).
//
// Bu mexanizm sayta bağlı relay deskriptorları üçündür (`signup` sahəsi). Hazırda reyestrdə
// belə relay YOXDUR — yalnız "bu sayt" var və o, evristika ilə işləyir (background/forms.ts).
// Mexanizm gələcək relay-lar üçün saxlanılır, ona görə testdə deskriptor YERLİ nümunə kimi
// verilir (reyestrdən asılı deyil).
//
// İki hissə var: səhifədə icra olunan `runInPage` (saxta DOM ilə) və worker tərəfi
// `runSignup` (chrome.scripting stub-lanır). Ən vacib iki qayda burada qorunur:
//   1. dəyər PROTOTİPDƏKİ native setter ilə yazılır — React idarə edən xanada instansiya
//      setter-i yazını udur və forma boş dəyər göndərir (real saytlarda məhz belədir);
//   2. `enabled: true` addımı düymənin AKTİVLƏŞMƏSİNİ gözləyir — CAPTCHA (Turnstile) həll
//      olunana qədər "Send code" və "Create account" disabled qalır, sabit sleep etibarsızdır.
import { describe, expect, it } from "vitest";

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
} from "../src/background/signup";
import { createRegistry, validateRelay } from "../src/providers/contract";
import type { SiteRelayDescriptor } from "../src/providers/contract";

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
const registry = createRegistry<SiteRelayDescriptor>("relay", [stepped], validateRelay);
const steppedRelay = registry.get("example-relay");

// --- saxta DOM -----------------------------------------------------------------------------
function makeEl({ visible = true, disabled = false, maxLength = 0, text = "", tag = "input" }: any = {}) {
  const proto: any = {
    set value(v) { this._value = maxLength ? String(v).slice(0, maxLength) : String(v); },
    get value() { return this._value; },
    focus() { this.focused = true; },
    scrollIntoView() { this.scrolled = true; },
    click() { this.clicks++; },
    getAttribute(name: any) : any { return this.attributes[name] ?? null; },
    dispatchEvent(event: any) { this.events.push({ type: event.type, bubbles: event.bubbles }); return true; },
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
function trackLikeReact(el: any) {
  Object.defineProperty(el, "value", {
    configurable: true,
    get() { return this._value; },
    set() { this.swallowed = true; },
  });
  return el;
}

// Səhifə mühiti: document, Event, MutationObserver və taymerlər.
// `mutate` — observer qurulduqdan sonra DOM-u dəyişmək üçün (disabled → false və s.).
async function inPage(map: any, run: any, { mutate }: any = {}) {
  const previous: Record<string, unknown> = {
    document: (globalThis as any).document,
    Event: (globalThis as any).Event,
    MutationObserver: (globalThis as any).MutationObserver,
  };
  const observers: any[] = [];
  (globalThis as any).document = {
    documentElement: {},
    querySelectorAll(selector: any) {
      if (selector.startsWith("!")) throw new SyntaxError("pozulmuş selektor");
      return map[selector] ?? [];
    },
  };
  (globalThis as any).Event = class { declare type: any; constructor(type: any, options: any) { this.type = type; Object.assign(this, options); } };
  (globalThis as any).MutationObserver = class { declare callback: any; declare stopped: boolean;
    constructor(callback: any) { this.callback = callback; observers.push(this); }
    observe() {}
    disconnect() { this.stopped = true; }
  };
  const notify: any = () => { for (const o of observers) if (!o.stopped) o.callback(); };
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
      if (previous[key] === undefined) delete (globalThis as any)[key]; else (globalThis as any)[key] = previous[key];
    }
  }
}

const fillStep = (selector: any, value: any, extra = {}) : any => ({ action: "fill", selector, value, text: null, enabled: false, timeoutMs: 50, ...extra });
const clickStep = (selector: any, extra = {}) : any => ({ action: "click", selector, value: null, text: null, enabled: false, timeoutMs: 50, ...extra });
const waitStep = (selector: any, extra = {}) : any => ({ action: "wait", selector, value: null, text: null, enabled: false, timeoutMs: 50, ...extra });

describe("runInPage — fill addımı", () => {
  it("xanaya dəyəri yazır və hadisələri göndərir", async () => {
    const el = makeEl();
    const result = await inPage({ "#code": [el] }, () => runInPage([fillStep("#code", "483920")]));
    expect(result).toStrictEqual({ done: true, at: 1 });
    expect(el.value).toBe("483920");
    expect(el.events).toStrictEqual([{ type: "input", bubbles: true }, { type: "change", bubbles: true }]);
    expect(el.focused).toBe(true);
    expect(el.scrolled).toBe(true);
  });

  it("dəyər PROTOTİPDƏKİ setter ilə yazılır (React value tracker keçilir)", async () => {
    const el = trackLikeReact(makeEl());
    el.value = "000000";                       // naiv yol udulur
    expect(el._value).toBe("");
    const result = await inPage({ "#code": [el] }, () => runInPage([fillStep("#code", "483920")]));
    expect(result.done).toBe(true);
    expect(el.value).toBe("483920");
  });

  it("maxlength dəyəri kəsirsə addım uğursuzdur (yarım kod göndərilməməlidir)", async () => {
    const el = makeEl({ maxLength: 4 });
    const result = await inPage({ "#code": [el] }, () => runInPage([fillStep("#code", "483920")]));
    expect(result.done).toBe(false);
    expect(result.at).toBe(0);
    expect(result.reason).toMatch(/saxlamadı/);
  });

  it("prototipdə setter yoxdursa adi mənimsətmə ilə yazılır", async () => {
    const el = { value: "", disabled: false, offsetWidth: 10, offsetHeight: 10, offsetParent: {}, textContent: "", getAttribute: () => null, dispatchEvent: () => true };
    const result = await inPage({ "#code": [el] }, () => runInPage([fillStep("#code", "483920")]));
    expect(result.done).toBe(true);
    expect(el.value).toBe("483920");
  });
});

describe("runInPage — click addımı", () => {
  it("elementi kliklər", async () => {
    const el = makeEl();
    const result = await inPage({ "#go": [el] }, () => runInPage([clickStep("#go")]));
    expect(result).toStrictEqual({ done: true, at: 1 });
    expect(el.clicks).toBe(1);
  });

  it("mətnlə tapır (sabit atributu olmayan düymə)", async () => {
    const other = makeEl({ text: "Create account" });
    const send = makeEl({ text: "Send code" });
    const result = await inPage({ button: [other, send] }, () => runInPage([clickStep("button", { text: "Send code" })]));
    expect(result.done).toBe(true);
    expect(send.clicks).toBe(1);
    expect(other.clicks).toBe(0);
  });

  it("dəqiq uyğunluq qismi uyğunluğun üstündə tutulur", async () => {
    const partial = makeEl({ text: "Send code again later" });
    const exact = makeEl({ text: "Send code" });
    await inPage({ button: [partial, exact] }, () => runInPage([clickStep("button", { text: "send CODE" })]));
    expect(exact.clicks).toBe(1);
    expect(partial.clicks).toBe(0);
  });

  it("mətn uyğun gəlmirsə element tapılmadı sayılır", async () => {
    const el = makeEl({ text: "Create account" });
    const result = await inPage({ button: [el] }, () => runInPage([clickStep("button", { text: "Send code" })]));
    expect(result.done).toBe(false);
    expect(result.reason).toMatch(/element tapılmadı: button \("Send code"\)/);
    expect(el.clicks).toBe(0);
  });
});

describe("runInPage — waitValue addımı (Turnstile token)", () => {
  it("dəyər hazırdırsa dərhal keçir", async () => {
    const token = makeEl({ visible: false });
    token._value = "0.abc";
    const result = await inPage({ "#ts": [token] }, () => runInPage([waitStep("#ts")]));
    expect(result).toStrictEqual({ done: true, at: 1 });
  });

  it("GİZLİ element də qəbul olunur (token hidden input-dadır)", async () => {
    const token = makeEl({ visible: false });
    token._value = "0.abc";
    expect((await inPage({ "#ts": [token] }, () => runInPage([waitStep("#ts")]))).done).toBe(true);
  });

  it("dəyər sonra gəlirsə gözlənilir", async () => {
    const token = makeEl({ visible: false });
    const result = await inPage(
      { "#ts": [token] },
      () => runInPage([waitStep("#ts", { timeoutMs: 2000 })]),
      { mutate: () => { token._value = "0.token"; } },
    );
    expect(result.done).toBe(true);
  });

  it("boş və yalnız boşluqdan ibarət dəyər hazır sayılmır", async () => {
    const token = makeEl({ visible: false });
    token._value = "   ";
    const result = await inPage({ "#ts": [token] }, () => runInPage([waitStep("#ts")]));
    expect(result.done).toBe(false);
    expect(result.reason).toMatch(/dəyər gözlənildi, gəlmədi: #ts/);
  });

  it("element ümumiyyətlə yoxdursa da gözləmə ilə bitir", async () => {
    const result = await inPage({}, () => runInPage([waitStep("#ts")]));
    expect(result.done).toBe(false);
    expect(result.reason).toMatch(/dəyər gözlənildi/);
  });

  it("gözləmə uğursuzdursa sonrakı addımlar icra OLUNMUR (cəhd itməsin)", async () => {
    const token = makeEl({ visible: false });
    const send = makeEl({ text: "Send code" });
    const result = await inPage({ "#ts": [token], button: [send] }, () =>
      runInPage([waitStep("#ts"), clickStep("button", { text: "Send code" })]));
    expect(result.at).toBe(0);
    expect(send.clicks, "token gəlmədən Send code kliklənməməlidir").toBe(0);
  });

  it("token gələndən sonra Send code kliklənir", async () => {
    const token = makeEl({ visible: false });
    const send = makeEl({ text: "Send code", disabled: true });
    const result = await inPage(
      { "#ts": [token], button: [send] },
      () => runInPage([waitStep("#ts", { timeoutMs: 2000 }), clickStep("button", { text: "Send code", enabled: true, timeoutMs: 2000 })]),
      { mutate: () => { token._value = "0.token"; send.disabled = false; } },
    );
    expect(result.done).toBe(true);
    expect(send.clicks).toBe(1);
  });
});

describe("runInPage — gözləmə və uğursuzluqlar", () => {
  it("görünməyən element seçilmir", async () => {
    const hidden = makeEl({ visible: false });
    const visible = makeEl();
    await inPage({ "#code": [hidden, visible] }, () => runInPage([fillStep("#code", "1234")]));
    expect(visible.value).toBe("1234");
    expect(hidden.value).toBe("");
  });

  it("element tapılmasa vaxt bitir və addımın nömrəsi qaytarılır", async () => {
    const el = makeEl();
    const result = await inPage({ "#a": [el] }, () => runInPage([clickStep("#a"), clickStep("#yoxdur")]));
    expect({ done: result.done, at: result.at }).toStrictEqual({ done: false, at: 1 });
    expect(result.reason).toMatch(/element tapılmadı: #yoxdur/);
  });

  it("enabled:true — disabled düymə gözlənilir, aktivləşəndə kliklənir (Turnstile)", async () => {
    const el = makeEl({ text: "Send code", disabled: true });
    const result = await inPage(
      { button: [el] },
      () => runInPage([clickStep("button", { text: "Send code", enabled: true, timeoutMs: 2000 })]),
      { mutate: () => { el.disabled = false; } },
    );
    expect(result.done).toBe(true);
    expect(el.clicks).toBe(1);
  });

  it("enabled:true — aktivləşməsə aydın səbəb qaytarılır", async () => {
    const el = makeEl({ text: "Send code", disabled: true });
    const result = await inPage({ button: [el] }, () => runInPage([clickStep("button", { text: "Send code", enabled: true })]));
    expect(result.done).toBe(false);
    expect(result.reason).toMatch(/aktiv element gözlənildi/);
    expect(el.clicks).toBe(0);
  });

  it("aria-disabled=true da aktiv sayılmır", async () => {
    const el = makeEl();
    el.attributes["aria-disabled"] = "true";
    const result = await inPage({ "#go": [el] }, () => runInPage([clickStep("#go", { enabled: true })]));
    expect(result.done).toBe(false);
    expect(el.clicks).toBe(0);
  });

  it("enabled olmayan addım disabled elementi də kliklər (sayt özü qərar verir)", async () => {
    const el = makeEl({ disabled: true });
    const result = await inPage({ "#go": [el] }, () => runInPage([clickStep("#go")]));
    expect(result.done).toBe(true);
    expect(el.clicks).toBe(1);
  });

  it("pozulmuş selektor sınmır, addım uğursuz kimi bitir", async () => {
    const result = await inPage({}, () => runInPage([clickStep("!yanlış(")]));
    expect(result.done).toBe(false);
    expect(result.reason).toMatch(/element tapılmadı/);
  });

  it("uğursuz addımdan sonrakılar icra olunmur", async () => {
    const later = makeEl();
    const result = await inPage({ "#sonra": [later] }, () => runInPage([clickStep("#yoxdur"), clickStep("#sonra")]));
    expect(result.at).toBe(0);
    expect(later.clicks).toBe(0);
  });

  it("boş addım siyahısı uğur sayılır", async () => {
    expect(await inPage({}, () => runInPage([]))).toStrictEqual({ done: true, at: 0 });
  });

  it("addımlar YAZILDIĞI sıra ilə icra olunur", async () => {
    const order: any[] = [];
    const email = makeEl();
    const send = makeEl({ text: "Send code" });
    email.dispatchEvent = () => { order.push("fill"); return true; };
    send.click = () => { order.push("click"); };
    await inPage({ "#email": [email], button: [send] }, () =>
      runInPage([fillStep("#email", "a@b.com"), clickStep("button", { text: "Send code" })]));
    expect(order).toStrictEqual(["fill", "fill", "click"]);   // input + change, sonra klik
  });
});

// --- deskriptordan icraya ------------------------------------------------------------------
describe("resolveSteps — dəyər adlarının doldurulması", () => {
  const slots = { address: "user@gmail.com", code: "483920", password: "Ab3xKm9pQr2sTv5w" };

  it("fill addımının value adı konkret dəyərlə əvəzlənir", () => {
    const { steps } = resolveSteps([{ fill: "#email", value: "address" }], slots);
    expect(steps).toStrictEqual([{ action: "fill", selector: "#email", text: null, value: "user@gmail.com", enabled: false, timeoutMs: FIND_TIMEOUT_MS }]);
  });

  it("click addımı selektoru və mətni saxlayır", () => {
    const { steps } = resolveSteps([{ click: "button", text: "Send code", enabled: true }], slots);
    expect(steps).toStrictEqual([{ action: "click", selector: "button", text: "Send code", value: null, enabled: true, timeoutMs: ENABLED_TIMEOUT_MS }]);
  });

  it("waitValue addımı wait əməliyyatına çevrilir və uzun limit alır", () => {
    const { steps } = resolveSteps([{ waitValue: "#ts" }], slots);
    expect(steps).toStrictEqual([{ action: "wait", selector: "#ts", text: null, value: null, enabled: false, timeoutMs: ENABLED_TIMEOUT_MS }]);
  });

  it("enabled addımının gözləmə limiti daha uzundur (Turnstile)", () => {
    expect(ENABLED_TIMEOUT_MS > FIND_TIMEOUT_MS).toBeTruthy();
  });

  it("deskriptordaki timeoutMs default-u əvəz edir", () => {
    const { steps } = resolveSteps([{ click: "#go", timeoutMs: 1234 }], slots);
    expect(steps![0].timeoutMs).toBe(1234);
  });

  it("dəyər hazır deyilsə heç bir addım icra olunmur", () => {
    const { error, steps } = resolveSteps([{ fill: "#code", value: "code" }], { code: null });
    expect(steps).toBe(undefined);
    expect(error).toMatch(/"code" dəyəri hazır deyil/);
  });

  it("boş sətir də hazır sayılmır (parol yaradılmayıbsa forma pozulmasın)", () => {
    expect(resolveSteps([{ fill: "#p", value: "password" }], { password: "" }).error).toMatch(/password/);
  });
});

describe("signupSteps / supportsSignup / usesPassword", () => {
  it("addımlı relay hər iki fazanı daşıyır", () => {
    expect(registry.problems, "nümunə deskriptor kontraktdan keçmir").toStrictEqual([]);
    expect(supportsSignup(steppedRelay, SignupPhase.afterAddress)).toBe(true);
    expect(supportsSignup(steppedRelay, SignupPhase.afterCode)).toBe(true);
    expect(signupSteps(steppedRelay, SignupPhase.afterAddress).length >= 3).toBeTruthy();
  });

  it("addımlı relay parol tələb edir", () => {
    expect(usesPassword(steppedRelay)).toBe(true);
  });

  it("addım yazılmayan relay üçün imkan yoxdur", () => {
    expect(supportsSignup({}, SignupPhase.afterCode)).toBe(false);
    expect(supportsSignup({ signup: {} }, SignupPhase.afterCode)).toBe(false);
    expect(supportsSignup(null, SignupPhase.afterCode)).toBe(false);
    expect(signupSteps(null, SignupPhase.afterCode)).toStrictEqual([]);
    expect(usesPassword({ signup: { afterCode: [{ fill: "#c", value: "code" }] } })).toBe(false);
  });
});

// --- worker tərəfi -------------------------------------------------------------------------
function withChrome({ session = { started: 1 }, script }: any, fn: any) {
  const previous = (globalThis as any).chrome;
  const calls: any[] = [];
  (globalThis as any).chrome = {
    storage: { session: { get: async () : Promise<any> => ({ session }) } },
    runtime: { getPlatformInfo: async () : Promise<any> => ({}) },
    scripting: { executeScript: async (options: any) => { calls.push(options); return script(options); } },
  };
  return fn(calls).finally(() => {
    if (previous === undefined) delete (globalThis as any).chrome; else (globalThis as any).chrome = previous;
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
    withChrome({ script: () => [{ result: { done: true, at: 2 } }] }, async (calls: any) => {
      expect(await runSignup(live, relay, SignupPhase.afterCode, slots)).toStrictEqual({ done: true, at: 2 });
      expect(calls.length).toBe(1);
      expect(calls[0].target).toStrictEqual({ tabId: 7 });
      expect(calls[0].func).toBe(runInPage);
      expect(calls[0].world).toBe("MAIN");
      expect(calls[0].args[0][0].value).toBe("483920");
      expect(calls[0].args[0][1].action).toBe("click");
    }));

  it("faza yazılmayıbsa skript yeridilmir", () =>
    withChrome({ script: () => [{ result: { done: true } }] }, async (calls: any) => {
      const result = await runSignup(live, relay, SignupPhase.afterAddress, slots);
      expect(result.reason).toMatch(/addım yazılmayıb/);
      expect(calls).toStrictEqual([]);
    }));

  it("relay tabı yoxdursa skript yeridilmir", () =>
    withChrome({ script: () => [{ result: { done: true } }] }, async (calls: any) => {
      expect((await runSignup({ started: 1 }, relay, SignupPhase.afterCode, slots)).reason).toMatch(/relay tabı yoxdur/);
      expect(calls).toStrictEqual([]);
    }));

  it("sessiya dəyişibsə başqasının tabına toxunulmur", () =>
    withChrome({ session: { started: 2 }, script: () => [{ result: { done: true } }] }, async (calls: any) => {
      expect(await runSignup(live, relay, SignupPhase.afterCode, slots)).toStrictEqual({ done: false, reason: "sessiya dəyişdi" });
      expect(calls).toStrictEqual([]);
    }));

  it("dəyər hazır deyilsə skript yeridilmir (yarım forma göndərilməsin)", () =>
    withChrome({ script: () => [{ result: { done: true } }] }, async (calls: any) => {
      expect((await runSignup(live, relay, SignupPhase.afterCode, {})).reason).toMatch(/"code" dəyəri hazır deyil/);
      expect(calls).toStrictEqual([]);
    }));

  it("tab bağlanıbsa xəta udulur — kodun çatdırılması bundan asılı olmamalıdır", () =>
    withChrome({ script: () : any => { throw new Error("No tab with id: 7"); } }, async () => {
      const result = await runSignup(live, relay, SignupPhase.afterCode, slots);
      expect(result.done).toBe(false);
      expect(result.reason).toMatch(/No tab with id/);
    }));

  it("səhifə nəticə qaytarmasa aydın səbəb yazılır", () =>
    withChrome({ script: () : any => [] }, async () => {
      expect((await runSignup(live, relay, SignupPhase.afterCode, slots)).reason).toMatch(/səhifə cavab qaytarmadı/);
    }));

  it("səhifənin öz uğursuzluğu olduğu kimi qaytarılır", () =>
    withChrome({ script: () => [{ result: { done: false, at: 1, reason: "aktiv element gözlənildi: #go" } }] }, async () => {
      expect(await runSignup(live, relay, SignupPhase.afterCode, slots)).toStrictEqual({ done: false, at: 1, reason: "aktiv element gözlənildi: #go" });
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
    expect(waitAt >= 0 && clickAt > waitAt, "token gözləməsi klikdən əvvəl olmalıdır").toBeTruthy();
  });

  it("addımların hamısı resolveSteps-dən keçir", () => {
    const slots = { address: "u@gmail.com", code: "483920", password: "Ab3xKm9pQr2sTv5w" };
    for (const phase of Object.values(SignupPhase)) {
      const { error } = resolveSteps(signupSteps(steppedRelay, phase), slots);
      expect(error, `${phase}: ${error}`).toBe(undefined);
    }
  });
});
