// temp.tf provider-inin testləri: saytın API protokolu və seçim qaydaları.
//
// Bu testlər saytı açmadan işləyir — fetch stub-lanır. Məqsəd: sayt qaydalarını (hansı
// provider ilə hansı sintaksis mümkündür) və sorğunun düzgün qurulmasını qorumaq. Qaydalar
// saytın öz client kodundan götürülüb; dəyişsə testlər xəbər verəcək.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { acquireMode, AcquireMode, supportsInbox } from "../src/providers/contract.js";
import { TEMP_MAIL } from "../src/providers/temp-mail/index.js";
import { accountQuery, accountUrl, API_BASE, CHECK_URL, DEFAULT_VALUES, PROVIDER_CHOICES, requestAccount, requestMessages, validate } from "../src/providers/temp-mail/temp-tf/api.js";
import { resolveValues, validateValues } from "../src/shared/options.js";

const provider = TEMP_MAIL.get("temp.tf");

// Seçimləri qısa yazmaq üçün köməkçi: P("gmail","outlook") → providers obyekti
const P = (...names) => Object.fromEntries(PROVIDER_CHOICES.map((c) => [c.value, names.includes(c.value)]));
const values = (providers, dot = false, plus = true) => ({ providers, dot, plus });
const params = (v) => new URLSearchParams(accountQuery(v));

// --- cavab stub-ı ------------------------------------------------------------------------
const jsonResponse = (status, body, headers = {}) => ({
  status,
  ok: status >= 200 && status < 300,
  headers: { get: (name) => headers[name] ?? headers[name.toLowerCase()] ?? null },
  json: async () => body,
});
// JSON-u pozulmuş cavab (server HTML qaytaranda belə olur) — json() rədd edir
const brokenResponse = (status) => ({
  status,
  ok: false,
  headers: { get: () => null },
  json: async () => { throw new SyntaxError("Unexpected token <"); },
});
const rejects = (promise, pattern) => assert.rejects(promise, pattern);

describe("temp.tf deskriptoru", () => {
  it("API rejimindədir — tab açılmır", () => {
    assert.equal(acquireMode(provider), AcquireMode.api);
    assert.equal(typeof provider.fetchAddress, "function");
    assert.equal(provider.newAddress, undefined);
  });

  it("seçim sxemi default dəyərlərlə uyğundur (reyestrə düşüb)", () => {
    assert.deepEqual(TEMP_MAIL.problems, []);
    assert.deepEqual(resolveValues(provider, null), { providers: { outlook: false, hotmail: false, gmail: true, "high.edu.pl": false }, dot: false, plus: true });
    assert.deepEqual(DEFAULT_VALUES.providers, { outlook: false, hotmail: false, gmail: true, "high.edu.pl": false });
  });
});

describe("accountQuery — sorğunun qurulması", () => {
  it("default: yalnız Gmail və Plus", () => {
    const p = params(DEFAULT_VALUES);
    assert.equal(p.get("providers"), "gmail");
    assert.equal(p.get("dot"), "0");
    assert.equal(p.get("plus"), "1");
  });

  it("provider-lər saytın öz ardıcıllığı ilə göndərilir (seçim sırası önəmli deyil)", () => {
    const p = params(values(P("gmail", "outlook", "hotmail"), false, true));
    assert.equal(p.get("providers"), "outlook,hotmail,gmail");
  });

  it("dot və plus birlikdə olar", () => {
    const p = params(values(P("gmail"), true, true));
    assert.equal(p.get("dot"), "1");
    assert.equal(p.get("plus"), "1");
  });

  it("yalnız high.edu.pl seçilibsə dot/plus məcburi 0-dır (edu ünvanlarında sintaksis yoxdur)", () => {
    const p = params(values(P("high.edu.pl"), true, true));
    assert.equal(p.get("providers"), "high.edu.pl");
    assert.equal(p.get("dot"), "0");
    assert.equal(p.get("plus"), "0");
  });

  it("dot-only rejimində siyahı Gmail-ə daralır (dot yalnız Gmail-ə aiddir)", () => {
    const p = params(values(P("gmail", "outlook"), true, false));
    assert.equal(p.get("providers"), "gmail");
    assert.equal(p.get("dot"), "1");
    assert.equal(p.get("plus"), "0");
  });

  it("dot-only + Gmail yoxdursa siyahı daralmır (qayda pozuntusunu validate tutur)", () => {
    const p = params(values(P("outlook"), true, false));
    assert.equal(p.get("providers"), "outlook");
  });

  it("heç nə seçilməyibsə providers boşdur (sxemdəki min:1 buna yol vermir)", () => {
    assert.equal(params(values(P(), false, false)).get("providers"), "");
  });

  it("accountUrl mütləq ünvandır və API_BASE ilə başlayır", () => {
    const url = accountUrl(DEFAULT_VALUES);
    assert.ok(url.startsWith(API_BASE + "/account?"), url);
    assert.equal(new URL(url).searchParams.get("providers"), "gmail");
  });
});

describe("validate — saytın öz qaydaları", () => {
  it("default dəyərlər qaydalara uyğundur", () => {
    assert.equal(validate(DEFAULT_VALUES), null);
  });

  it("Gmail/Outlook/Hotmail üçün dot və ya plus lazımdır", () => {
    const error = "Gmail, Outlook və Hotmail üçün Dot və ya Plus işarələnməlidir";
    assert.equal(validate(values(P("gmail"), false, false)), error);
    assert.equal(validate(values(P("outlook"), false, false)), error);
    assert.equal(validate(values(P("hotmail"), false, false)), error);
    assert.equal(validate(values(P("gmail", "outlook"), false, false)), error);
  });

  it("plus varsa bu qayda ödənilmiş sayılır", () => {
    assert.equal(validate(values(P("gmail", "outlook", "hotmail"), false, true)), null);
  });

  it("yalnız high.edu.pl seçilibsə sintaksis tələb olunmur", () => {
    assert.equal(validate(values(P("high.edu.pl"), false, false)), null);
  });

  it("high.edu.pl siyahıdadırsa qayda işə düşmür (edu ünvanı sintaksissiz də alınır)", () => {
    assert.equal(validate(values(P("gmail", "high.edu.pl"), false, false)), null);
  });

  it("dot yalnız Gmail ilə işləyir", () => {
    assert.equal(validate(values(P("outlook"), true, false)), "Dot yalnız Gmail ilə işləyir — Plus-ı işarələyin və ya Gmail seçin");
    assert.equal(validate(values(P("hotmail", "high.edu.pl"), true, false)), "Dot yalnız Gmail ilə işləyir — Plus-ı işarələyin və ya Gmail seçin");
  });

  it("dot + plus birlikdə olsa Gmail tələbi qalmır", () => {
    assert.equal(validate(values(P("outlook"), true, true)), null);
    assert.equal(validate(values(P("gmail"), true, true)), null);
  });

  it("boş siyahını validate yoxlamır (onu sxemdəki min:1 tutur)", () => {
    assert.equal(validate(values(P(), false, false)), null);
    assert.match(validateValues(provider, resolveValues(provider, values(P(), false, false))), /ən azı 1 seçim/);
  });

  it("validateValues provider qaydasını popup-a göndərilə bilən mətn kimi qaytarır", () => {
    assert.match(validateValues(provider, resolveValues(provider, values(P("gmail"), false, false))), /Dot və ya Plus/);
    assert.equal(validateValues(provider, resolveValues(provider, DEFAULT_VALUES)), null);
  });
});

describe("requestAccount — HTTP cavabının ünvana çevrilməsi", () => {
  const call = (body, init = {}) => requestAccount(DEFAULT_VALUES, { fetchImpl: async () => body, ...init });

  it("200 → ünvan (trimlənir və kiçik hərflərlə qaytarılır)", async () => {
    assert.equal(await call(jsonResponse(200, { email: " User.Name@Gmail.com " })), "user.name@gmail.com");
  });

  it("signal fetch-ə ötürülür və ünvan sorğunun özündə qurulur", async () => {
    let seen = null;
    const controller = new AbortController();
    await requestAccount(values(P("gmail", "outlook"), true, true), {
      signal: controller.signal,
      fetchImpl: async (url, options) => { seen = { url, options }; return jsonResponse(200, { email: "u+x@gmail.com" }); },
    });
    assert.equal(seen.options.signal, controller.signal);
    assert.deepEqual(seen.options.headers, { Accept: "application/json" });
    const u = new URL(seen.url);
    assert.equal(u.pathname, "/api/account");
    assert.equal(u.searchParams.get("providers"), "outlook,gmail");
    assert.equal(u.searchParams.get("dot"), "1");
  });

  it("400 → serverin öz mesajı saxlanılır (saytın dəqiq sözləridir)", async () => {
    await rejects(call(jsonResponse(400, { error: "Invalid provider combination", email: null })), /Invalid provider combination/);
  });

  it("400 mesajsız → status göstərilir", async () => {
    await rejects(call(jsonResponse(400, { email: null })), /server 400 cavabı qaytardı/);
  });

  it("500 → status göstərilir", async () => {
    await rejects(call(jsonResponse(500, {})), /server 500 cavabı qaytardı/);
  });

  it("429 Retry-After ilə → gözləmə müddəti deyilir", async () => {
    await rejects(call(jsonResponse(429, {}, { "Retry-After": "37" })), /çox sorğu göndərilib, 37 saniyə gözləyin/);
  });

  it("429 Retry-After olmadan → ümumi xəbərdarlıq", async () => {
    await rejects(call(jsonResponse(429, {})), /çox sorğu göndərilib, bir az gözləyin/);
  });

  it("200 amma email null → server etibarlı ünvan qaytarmadı", async () => {
    await rejects(call(jsonResponse(200, { email: null })), /server etibarlı ünvan qaytarmadı/);
  });

  it("200 amma ünvan @-sız → eyni xəta", async () => {
    await rejects(call(jsonResponse(200, { email: "nouser" })), /server etibarlı ünvan qaytarmadı/);
  });

  it("JSON pozulubsa (server HTML qaytarıb) cavab boş obyekt kimi oxunur", async () => {
    await rejects(call(brokenResponse(502)), /server 502 cavabı qaytardı/);
  });

  it("headers.get yoxdursa 429 yenə tutulur (bəzi mühitlərdə başlıq obyekti sadədir)", async () => {
    await rejects(requestAccount(DEFAULT_VALUES, {
      fetchImpl: async () => ({ status: 429, ok: false, json: async () => ({}) }),
    }), /çox sorğu göndərilib, bir az gözləyin/);
  });
});

describe("fetchAddress — deskriptorun sahəsi", () => {
  // Deskriptor worker-də { values, signal } ilə çağrılır. Şəbəkəyə çıxmırıq: əvvəlcədən
  // dayandırılmış signal fetch-i dərval rədd edir, bu da imzanın işlədiyini sübut edir.
  it("dayandırılmış signal ilə çağırıldıqda AbortError kimi rədd olunur", async () => {
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(provider.fetchAddress({ values: DEFAULT_VALUES, signal: controller.signal }), /abort/i);
  });

  it("modulun fetchAddress-ı ilə eyni funksiyadır (deskriptor protokolu təkrarlamır)", async () => {
    const { fetchAddress } = await import("../src/providers/temp-mail/temp-tf/api.js");
    assert.equal(provider.fetchAddress, fetchAddress);
  });
});

// --- poçt qutusu -------------------------------------------------------------------------
// /api/check ünvanı soruşur, sayt cavabında məktubların siyahısını qaytarır. Testdə fetch
// stub-lanır: protokolün özü (sorğunun forması, zərfin oxunuşu, xəta halları) qorunur.
const MAIL = {
  id: "1",
  date: "2026-09-11T10:00:00.000Z",
  from: "Nexora <no-reply@nexora.example>",
  subject: "Confirm your email",
  body: "Kodunuz: 483920",
  bodyContentType: "text",
};

describe("requestMessages — sorğunun qurulması", () => {
  // Hər çağırışda fetch-ə gedən (url, options) cütünü qaytarır
  const spy = (body) => {
    const seen = {};
    const fetchImpl = async (url, options) => { Object.assign(seen, { url, options }); return jsonResponse(200, body); };
    return { seen, fetchImpl };
  };

  it("POST /api/check, JSON gövdəsi { email, wait }", async () => {
    const { seen, fetchImpl } = spy({ data: [] });
    await requestMessages("user@gmail.com", { fetchImpl });
    assert.equal(seen.url, CHECK_URL);
    assert.equal(new URL(seen.url).pathname, "/api/check");
    assert.equal(seen.options.method, "POST");
    assert.deepEqual(JSON.parse(seen.options.body), { email: "user@gmail.com", wait: true });
  });

  it("wait default true-dir (uzun sorğu — server poçt gələnə qədər saxlayır)", async () => {
    const { seen, fetchImpl } = spy({ data: [] });
    await requestMessages("u@gmail.com", { fetchImpl });
    assert.equal(JSON.parse(seen.options.body).wait, true);
  });

  it("wait:false göndərilə bilər (dərhal cavab, boş qutu = boş siyahı)", async () => {
    const { seen, fetchImpl } = spy({ data: [] });
    await requestMessages("u@gmail.com", { wait: false, fetchImpl });
    assert.equal(JSON.parse(seen.options.body).wait, false);
  });

  it("başlıqlar və signal fetch-ə ötürülür (Dayandır sorğunu kəsir)", async () => {
    const controller = new AbortController();
    const { seen, fetchImpl } = spy({ data: [] });
    await requestMessages("u@gmail.com", { signal: controller.signal, fetchImpl });
    assert.equal(seen.options.signal, controller.signal);
    assert.deepEqual(seen.options.headers, { Accept: "application/json", "Content-Type": "application/json" });
  });
});

describe("requestMessages — cavabın oxunuşu", () => {
  // call(cavab) — cavab ya jsonResponse(...), ya da brokenResponse(...) olur
  const call = (response, init = {}) => requestMessages("u@gmail.com", { wait: false, fetchImpl: async () => response, ...init });
  const ok = (body) => call(jsonResponse(200, body));

  it("zərf { data: [...] } — siyahı normallaşdırılıb qaytarılır", async () => {
    const messages = await ok({ data: [MAIL], totalReceived: 42 });
    assert.equal(messages.length, 1);
    assert.deepEqual(messages[0], { ...MAIL, text: "" });
  });

  it("totalReceived cavabdan oxunmur (sayt üzrə ümumi sayğacdır, poçt qutusuna aid deyil)", async () => {
    assert.deepEqual(await ok({ data: [], totalReceived: 9999 }), []);
  });

  it("çılpaq massiv də qəbul olunur (sayt zərfi dəyişsə axın qırılmasın)", async () => {
    assert.equal((await ok([MAIL])).length, 1);
  });

  it("boş qutu xəta deyil — boş siyahı qaytarılır", async () => {
    assert.deepEqual(await ok({ data: [], totalReceived: 3 }), []);
  });

  it("təkrar id-lər düşür, məktublar tarixə görə azalan sıralanır", async () => {
    const older = { ...MAIL, id: "2", date: "2026-09-11T09:00:00.000Z", subject: "köhnə" };
    const messages = await ok({ data: [MAIL, older, { ...MAIL }] });
    assert.deepEqual(messages.map((m) => m.id), ["1", "2"]);
  });

  it("pozulmuş zərf (data sətirdir) boş siyahı kimi oxunur", async () => {
    assert.deepEqual(await ok({ data: "sətir" }), []);
  });

  it("siyahıdakı qeyri-obyekt elementlər atılır", async () => {
    assert.equal((await ok({ data: [null, "x", MAIL] })).length, 1);
  });

  it("server HTML qaytarsa (JSON pozulubsa) status xətası göstərilir", async () => {
    await rejects(call(brokenResponse(502)), /server 502 cavabı qaytardı/);
  });

  it("429 → gözləmə müddəti deyilir", async () => {
    await rejects(call(jsonResponse(429, {}, { "Retry-After": "12" })), /çox sorğu göndərilib, 12 saniyə gözləyin/);
  });

  it("400 → serverin öz mesajı saxlanılır", async () => {
    await rejects(call(jsonResponse(400, { error: "Invalid email" })), /Invalid email/);
  });

  it("500 → status göstərilir", async () => {
    await rejects(call(jsonResponse(500, {})), /server 500 cavabı qaytardı/);
  });
});

describe("fetchMessages — deskriptorun sahəsi", () => {
  it("poçt qutusu imkanı açıqdır", () => {
    assert.equal(supportsInbox(provider), true);
  });

  it("worker-də { email, wait, signal } imzası ilə çağrılır", async () => {
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(provider.fetchMessages({ email: "u@gmail.com", wait: false, signal: controller.signal }), /abort/i);
  });

  it("modulun fetchMessages-ı ilə eyni funksiyadır", async () => {
    const { fetchMessages } = await import("../src/providers/temp-mail/temp-tf/api.js");
    assert.equal(provider.fetchMessages, fetchMessages);
  });
});
