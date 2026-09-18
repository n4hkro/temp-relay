// temp.tf provider-inin testləri: saytın API protokolu və seçim qaydaları.
//
// Bu testlər saytı açmadan işləyir — fetch stub-lanır. Məqsəd: sayt qaydalarını (hansı
// provider ilə hansı sintaksis mümkündür) və sorğunun düzgün qurulmasını qorumaq. Qaydalar
// saytın öz client kodundan götürülüb; dəyişsə testlər xəbər verəcək.
import { describe, expect, it } from "vitest";

import { acquireMode, AcquireMode, supportsInbox } from "../src/providers/contract";
import { TEMP_MAIL } from "../src/providers/temp-mail/index";
import { accountQuery, accountUrl, API_BASE, CHECK_URL, DEFAULT_VALUES, PROVIDER_CHOICES, requestAccount, requestMessages, validate } from "../src/providers/temp-mail/temp-tf/api";
import { resolveValues, validateValues } from "../src/shared/options";

const provider = TEMP_MAIL.get("temp.tf");

// Seçimləri qısa yazmaq üçün köməkçi: P("gmail","outlook") → providers obyekti
const P = (...names: any[]) => Object.fromEntries(PROVIDER_CHOICES.map((c) => [c.value, names.includes(c.value)]));
const values = (providers: any, dot = false, plus = true) : any => ({ providers, dot, plus });
const params = (v: any) => new URLSearchParams(accountQuery(v));

// --- cavab stub-ı ------------------------------------------------------------------------
const jsonResponse = (status: number, body: unknown, headers: Record<string, string> = {}) => ({
  status,
  ok: status >= 200 && status < 300,
  headers: { get: (name: string) => headers[name] ?? headers[name.toLowerCase()] ?? null },
  json: async () => body,
});
// JSON-u pozulmuş cavab (server HTML qaytaranda belə olur) — json() rədd edir
const brokenResponse: any = (status: any) : any => ({
  status,
  ok: false,
  headers: { get: () => null },
  json: async () : Promise<any> => { throw new SyntaxError("Unexpected token <"); },
});
const rejects = (promise: Promise<unknown>, pattern: RegExp) => expect(promise).rejects.toThrow(pattern);

describe("temp.tf deskriptoru", () => {
  it("API rejimindədir — tab açılmır", () => {
    expect(acquireMode(provider)).toBe(AcquireMode.api);
    expect(typeof provider.fetchAddress).toBe("function");
    expect(provider.newAddress).toBe(undefined);
  });

  it("seçim sxemi default dəyərlərlə uyğundur (reyestrə düşüb)", () => {
    expect(TEMP_MAIL.problems).toStrictEqual([]);
    expect(resolveValues(provider, null)).toStrictEqual({ providers: { outlook: false, hotmail: false, gmail: true, "high.edu.pl": false }, dot: false, plus: true });
    expect(DEFAULT_VALUES.providers).toStrictEqual({ outlook: false, hotmail: false, gmail: true, "high.edu.pl": false });
  });
});

describe("accountQuery — sorğunun qurulması", () => {
  it("default: yalnız Gmail və Plus", () => {
    const p = params(DEFAULT_VALUES);
    expect(p.get("providers")).toBe("gmail");
    expect(p.get("dot")).toBe("0");
    expect(p.get("plus")).toBe("1");
  });

  it("provider-lər saytın öz ardıcıllığı ilə göndərilir (seçim sırası önəmli deyil)", () => {
    const p = params(values(P("gmail", "outlook", "hotmail"), false, true));
    expect(p.get("providers")).toBe("outlook,hotmail,gmail");
  });

  it("dot və plus birlikdə olar", () => {
    const p = params(values(P("gmail"), true, true));
    expect(p.get("dot")).toBe("1");
    expect(p.get("plus")).toBe("1");
  });

  it("yalnız high.edu.pl seçilibsə dot/plus məcburi 0-dır (edu ünvanlarında sintaksis yoxdur)", () => {
    const p = params(values(P("high.edu.pl"), true, true));
    expect(p.get("providers")).toBe("high.edu.pl");
    expect(p.get("dot")).toBe("0");
    expect(p.get("plus")).toBe("0");
  });

  it("dot-only rejimində siyahı Gmail-ə daralır (dot yalnız Gmail-ə aiddir)", () => {
    const p = params(values(P("gmail", "outlook"), true, false));
    expect(p.get("providers")).toBe("gmail");
    expect(p.get("dot")).toBe("1");
    expect(p.get("plus")).toBe("0");
  });

  it("dot-only + Gmail yoxdursa siyahı daralmır (qayda pozuntusunu validate tutur)", () => {
    const p = params(values(P("outlook"), true, false));
    expect(p.get("providers")).toBe("outlook");
  });

  it("heç nə seçilməyibsə providers boşdur (sxemdəki min:1 buna yol vermir)", () => {
    expect(params(values(P(), false, false)).get("providers")).toBe("");
  });

  it("accountUrl mütləq ünvandır və API_BASE ilə başlayır", () => {
    const url = accountUrl(DEFAULT_VALUES);
    expect(url.startsWith(API_BASE + "/account?"), url).toBeTruthy();
    expect(new URL(url).searchParams.get("providers")).toBe("gmail");
  });
});

describe("validate — saytın öz qaydaları", () => {
  it("default dəyərlər qaydalara uyğundur", () => {
    expect(validate(DEFAULT_VALUES)).toBe(null);
  });

  it("Gmail/Outlook/Hotmail üçün dot və ya plus lazımdır", () => {
    const error = "Gmail, Outlook və Hotmail üçün Dot və ya Plus işarələnməlidir";
    expect(validate(values(P("gmail"), false, false))).toBe(error);
    expect(validate(values(P("outlook"), false, false))).toBe(error);
    expect(validate(values(P("hotmail"), false, false))).toBe(error);
    expect(validate(values(P("gmail", "outlook"), false, false))).toBe(error);
  });

  it("plus varsa bu qayda ödənilmiş sayılır", () => {
    expect(validate(values(P("gmail", "outlook", "hotmail"), false, true))).toBe(null);
  });

  it("yalnız high.edu.pl seçilibsə sintaksis tələb olunmur", () => {
    expect(validate(values(P("high.edu.pl"), false, false))).toBe(null);
  });

  it("high.edu.pl siyahıdadırsa qayda işə düşmür (edu ünvanı sintaksissiz də alınır)", () => {
    expect(validate(values(P("gmail", "high.edu.pl"), false, false))).toBe(null);
  });

  it("dot yalnız Gmail ilə işləyir", () => {
    expect(validate(values(P("outlook"), true, false))).toBe("Dot yalnız Gmail ilə işləyir — Plus-ı işarələyin və ya Gmail seçin");
    expect(validate(values(P("hotmail", "high.edu.pl"), true, false))).toBe("Dot yalnız Gmail ilə işləyir — Plus-ı işarələyin və ya Gmail seçin");
  });

  it("dot + plus birlikdə olsa Gmail tələbi qalmır", () => {
    expect(validate(values(P("outlook"), true, true))).toBe(null);
    expect(validate(values(P("gmail"), true, true))).toBe(null);
  });

  it("boş siyahını validate yoxlamır (onu sxemdəki min:1 tutur)", () => {
    expect(validate(values(P(), false, false))).toBe(null);
    expect(validateValues(provider, resolveValues(provider, values(P(), false, false)))).toMatch(/ən azı 1 seçim/);
  });

  it("validateValues provider qaydasını popup-a göndərilə bilən mətn kimi qaytarır", () => {
    expect(validateValues(provider, resolveValues(provider, values(P("gmail"), false, false)))).toMatch(/Dot və ya Plus/);
    expect(validateValues(provider, resolveValues(provider, DEFAULT_VALUES))).toBe(null);
  });
});

describe("requestAccount — HTTP cavabının ünvana çevrilməsi", () => {
  const call = (body: any, init = {}) => requestAccount(DEFAULT_VALUES, { fetchImpl: async () => body, ...init });

  it("200 → ünvan (trimlənir və kiçik hərflərlə qaytarılır)", async () => {
    expect(await call(jsonResponse(200, { email: " User.Name@Gmail.com " }))).toBe("user.name@gmail.com");
  });

  it("signal fetch-ə ötürülür və ünvan sorğunun özündə qurulur", async () => {
    let seen = null;
    const controller = new AbortController();
    await requestAccount(values(P("gmail", "outlook"), true, true), {
      signal: controller.signal,
      fetchImpl: async (url, options) => { seen = { url, options }; return jsonResponse(200, { email: "u+x@gmail.com" }) as unknown as Response; },
    });
    expect(seen!.options.signal).toBe(controller.signal);
    expect(seen!.options.headers).toStrictEqual({ Accept: "application/json" });
    const u = new URL(seen!.url);
    expect(u.pathname).toBe("/api/account");
    expect(u.searchParams.get("providers")).toBe("outlook,gmail");
    expect(u.searchParams.get("dot")).toBe("1");
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
      fetchImpl: async () : Promise<any> => ({ status: 429, ok: false, json: async () : Promise<any> => ({}) }),
    }), /çox sorğu göndərilib, bir az gözləyin/);
  });
});

describe("fetchAddress — deskriptorun sahəsi", () => {
  // Deskriptor worker-də { values, signal } ilə çağrılır. Şəbəkəyə çıxmırıq: əvvəlcədən
  // dayandırılmış signal fetch-i dərval rədd edir, bu da imzanın işlədiyini sübut edir.
  it("dayandırılmış signal ilə çağırıldıqda AbortError kimi rədd olunur", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(provider.fetchAddress!({ values: DEFAULT_VALUES, signal: controller.signal })).rejects.toThrow(/abort/i);
  });

  it("modulun fetchAddress-ı ilə eyni funksiyadır (deskriptor protokolu təkrarlamır)", async () => {
    const { fetchAddress } = await import("../src/providers/temp-mail/temp-tf/api");
    expect(provider.fetchAddress).toBe(fetchAddress);
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
  const spy = (body: any) : any => {
    const seen = {};
    const fetchImpl = async (url: any, options: any) => { Object.assign(seen, { url, options }); return jsonResponse(200, body); };
    return { seen, fetchImpl };
  };

  it("POST /api/check, JSON gövdəsi { email, wait }", async () => {
    const { seen, fetchImpl } = spy({ data: [] });
    await requestMessages("user@gmail.com", { fetchImpl });
    expect(seen.url).toBe(CHECK_URL);
    expect(new URL(seen.url).pathname).toBe("/api/check");
    expect(seen.options.method).toBe("POST");
    expect(JSON.parse(seen.options.body)).toStrictEqual({ email: "user@gmail.com", wait: true });
  });

  it("wait default true-dir (uzun sorğu — server poçt gələnə qədər saxlayır)", async () => {
    const { seen, fetchImpl } = spy({ data: [] });
    await requestMessages("u@gmail.com", { fetchImpl });
    expect(JSON.parse(seen.options.body).wait).toBe(true);
  });

  it("wait:false göndərilə bilər (dərhal cavab, boş qutu = boş siyahı)", async () => {
    const { seen, fetchImpl } = spy({ data: [] });
    await requestMessages("u@gmail.com", { wait: false, fetchImpl });
    expect(JSON.parse(seen.options.body).wait).toBe(false);
  });

  it("başlıqlar və signal fetch-ə ötürülür (Dayandır sorğunu kəsir)", async () => {
    const controller = new AbortController();
    const { seen, fetchImpl } = spy({ data: [] });
    await requestMessages("u@gmail.com", { signal: controller.signal, fetchImpl });
    expect(seen.options.signal).toBe(controller.signal);
    expect(seen.options.headers).toStrictEqual({ Accept: "application/json", "Content-Type": "application/json" });
  });
});

describe("requestMessages — cavabın oxunuşu", () => {
  // call(cavab) — cavab ya jsonResponse(...), ya da brokenResponse(...) olur
  const call = (response: any, init = {}) => requestMessages("u@gmail.com", { wait: false, fetchImpl: async () => response, ...init });
  const ok = (body: any) => call(jsonResponse(200, body));

  it("zərf { data: [...] } — siyahı normallaşdırılıb qaytarılır", async () => {
    const messages = await ok({ data: [MAIL], totalReceived: 42 });
    expect(messages.length).toBe(1);
    expect(messages[0]).toStrictEqual({ ...MAIL, text: "" });
  });

  it("totalReceived cavabdan oxunmur (sayt üzrə ümumi sayğacdır, poçt qutusuna aid deyil)", async () => {
    expect(await ok({ data: [], totalReceived: 9999 })).toStrictEqual([]);
  });

  it("çılpaq massiv də qəbul olunur (sayt zərfi dəyişsə axın qırılmasın)", async () => {
    expect((await ok([MAIL])).length).toBe(1);
  });

  it("boş qutu xəta deyil — boş siyahı qaytarılır", async () => {
    expect(await ok({ data: [], totalReceived: 3 })).toStrictEqual([]);
  });

  it("təkrar id-lər düşür, məktublar tarixə görə azalan sıralanır", async () => {
    const older = { ...MAIL, id: "2", date: "2026-09-11T09:00:00.000Z", subject: "köhnə" };
    const messages = await ok({ data: [MAIL, older, { ...MAIL }] });
    expect(messages.map((m) => m.id)).toStrictEqual(["1", "2"]);
  });

  it("pozulmuş zərf (data sətirdir) boş siyahı kimi oxunur", async () => {
    expect(await ok({ data: "sətir" })).toStrictEqual([]);
  });

  it("siyahıdakı qeyri-obyekt elementlər atılır", async () => {
    expect((await ok({ data: [null, "x", MAIL] })).length).toBe(1);
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
    expect(supportsInbox(provider)).toBe(true);
  });

  it("worker-də { email, wait, signal } imzası ilə çağrılır", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(provider.fetchMessages!({ email: "u@gmail.com", wait: false, signal: controller.signal })).rejects.toThrow(/abort/i);
  });

  it("modulun fetchMessages-ı ilə eyni funksiyadır", async () => {
    const { fetchMessages } = await import("../src/providers/temp-mail/temp-tf/api");
    expect(provider.fetchMessages).toBe(fetchMessages);
  });
});
