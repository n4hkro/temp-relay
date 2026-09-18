// emailnator.com provider-inin testləri: saytın API protokolu.
//
// Bu testlər saytı açmadan işləyir — fetch stub-lanır. Məqsəd protokolu qorumaq: sorğuların
// forması, cavabın məktub siyahısına çevrilməsi, gövdə sorğularının keşlənməsi və long-poll
// emulyasiyası (sayt `wait` dəstəkləmir, pauza provider-dədir).
//
// DİQQƏT: api.js modul səviyyəsində keş saxlayır (gövdələr + ünvan başına son id-lər), ona
// görə hər test öz təkrarsız ünvanı və id-ləri ilə işləyir — testlər bir-birinə qarışmır.
import { describe, expect, it } from "vitest";

import { acquireMode, AcquireMode, supportsInbox } from "../src/providers/contract";
import {
  API_BASE,
  DEFAULT_VALUES,
  GENERATE_URL,
  LIST_LIMIT,
  MAX_BODIES,
  MESSAGE_LIST_URL,
  messageUrl,
  requestAccount,
  requestMessages,
  TYPE_CHOICES,
  TYPE_IDS,
  typeIds,
} from "../src/providers/temp-mail/emailnator/api";
import { TEMP_MAIL } from "../src/providers/temp-mail/index";
import { resolveValues, validateValues } from "../src/shared/options";

const provider = TEMP_MAIL.get("emailnator.com");

// Təkrarsız ad/id üçün sayğac: modul keşi testlər arasında yaşayır
let counter = 0;
const uid = (prefix: any) => `${prefix}-${++counter}`;
const address = () => `${uid("box")}@gmail.com`;

// Seçimləri qısa yazmaq üçün: T("dotGmail") → types obyekti
const T = (...names: any[]) : any => ({ types: Object.fromEntries(TYPE_CHOICES.map((c) => [c.value, names.includes(c.value)])) });

// --- cavab stub-ları ----------------------------------------------------------------------
const jsonResponse = (status: any, body: any, headers: any = {}) : any => ({
  status,
  ok: status >= 200 && status < 300,
  headers: { get: (name: any) => headers[name] ?? headers[name.toLowerCase()] ?? null },
  json: async () => body,
});
// JSON-u pozulmuş cavab (server HTML qaytaranda belə olur)
const brokenResponse: any = (status: any) : any => ({
  status,
  ok: status >= 200 && status < 300,
  headers: { get: () => null },
  json: async () : Promise<any> => { throw new SyntaxError("Unexpected token <"); },
});
const rejects = (promise: Promise<unknown>, pattern: RegExp) => expect(promise).rejects.toThrow(pattern);

// Poçt sorğularını marşrutlayan stub: siyahı bir ünvana, gövdə /api/message/<id>-ə gedir.
//   list   — massiv, ya da (çağırışın nömrəsi) => massiv
//   bodies — { [id]: HTML }, ya da { [id]: () => cavab }
function mailStub({ list = [], bodies = {} }: any = {}) : any {
  const calls: any = { list: 0, bodies: [], options: [] };
  const fetchImpl = async (url: any, options: any) => {
    calls.options.push({ url, options });
    if (url === MESSAGE_LIST_URL) {
      calls.list++;
      const entries = typeof list === "function" ? list(calls.list) : list;
      if (entries instanceof Object && entries.status !== undefined && entries.json !== undefined) return entries;
      return jsonResponse(200, { status: "success", messages: entries, message_count: entries.length });
    }
    const id = decodeURIComponent(url.slice(`${API_BASE}/message/`.length));
    calls.bodies.push(id);
    const value = bodies[id];
    if (typeof value === "function") return value();
    return jsonResponse(200, { id, content: value ?? "", has_attachments: false });
  };
  return { calls, fetchImpl };
}

// Siyahı elementi (saytın forması: gövdə YOXDUR, tarix unix saniyədir)
const entry = (id: any, extra = {}) : any => ({
  id,
  from: "Nexora <no-reply@nexora.example>",
  subject: "Nexora Email Verification",
  timestamp: 1789291932,
  time_ago: "1 min ago",
  ...extra,
});

// Saxta saat + pauza: gerçək gözləmə olmadan pəncərənin hesablanmasını yoxlayır
const clock: any = () : any => {
  let time = 0;
  const seen: any[] = [];
  return {
    seen,
    nowImpl: () => time,
    sleepImpl: async (ms: any, signal: any) => { seen.push({ ms, signal }); time += ms; },
  };
};

describe("emailnator deskriptoru", () => {
  it("API rejimindədir — tab açılmır", () => {
    expect(acquireMode(provider)).toBe(AcquireMode.api);
    expect(typeof provider.fetchAddress).toBe("function");
    expect(provider.newAddress).toBe(undefined);
  });

  it("poçt qutusu imkanı açıqdır", () => {
    expect(supportsInbox(provider)).toBe(true);
  });

  it("seçim sxemi default dəyərlərlə uyğundur (reyestrə düşüb)", () => {
    expect(TEMP_MAIL.problems).toStrictEqual([]);
    expect(resolveValues(provider, null)).toStrictEqual({ types: { domain: false, plusGmail: false, dotGmail: true, googleMail: false } });
  });

  it("default yalnız .Gmail-dir (əsl gmail.com ünvanı — qeydiyyat formaları qəbul edir)", () => {
    expect(DEFAULT_VALUES.types).toStrictEqual({ domain: false, plusGmail: false, dotGmail: true, googleMail: false });
  });

  it("heç nə işarələnməyəndə sxem xəbərdarlıq edir (min:1)", () => {
    expect(validateValues(provider, resolveValues(provider, T()))).toMatch(/ən azı 1 seçim/);
    expect(validateValues(provider, resolveValues(provider, DEFAULT_VALUES))).toBe(null);
  });

  it("modulun funksiyaları ilə eynidir (deskriptor protokolu təkrarlamır)", async () => {
    const api = await import("../src/providers/temp-mail/emailnator/api");
    expect(provider.fetchAddress).toBe(api.fetchAddress);
    expect(provider.fetchMessages).toBe(api.fetchMessages);
  });
});

describe("typeIds — sorğunun ids massivi", () => {
  it("saytın öz cədvəli ilə uyğundur", () => {
    expect(TYPE_IDS).toStrictEqual({ domain: 1, plusGmail: 2, dotGmail: 3, googleMail: 8 });
  });

  it("default → [3] (.Gmail)", () => {
    expect(typeIds(DEFAULT_VALUES)).toStrictEqual([3]);
  });

  it("seçim sırası deyil, saytın ardıcıllığı işlənir", () => {
    expect(typeIds(T("googleMail", "domain", "dotGmail"))).toStrictEqual([1, 3, 8]);
  });

  it("heç nə seçilməyibsə boş massiv (sxemdəki min:1 buna yol vermir)", () => {
    expect(typeIds(T())).toStrictEqual([]);
  });

  it("naməlum və pozulmuş dəyərlər nəzərə alınmır", () => {
    expect(typeIds({ types: { dotGmail: "hə", nosuch: true } } as any)).toStrictEqual([]);
    expect(typeIds(null as any)).toStrictEqual([]);
  });
});

describe("requestAccount — ünvanın alınması", () => {
  const call = (response: any, init = {}) => requestAccount(DEFAULT_VALUES, { fetchImpl: async () => response, ...init });

  it("POST /api/generate-email, JSON gövdəsi { ids }", async () => {
    let seen = null;
    const controller = new AbortController();
    await requestAccount(T("dotGmail", "plusGmail"), {
      signal: controller.signal,
      fetchImpl: async (url, options) => { seen = { url, options }; return jsonResponse(200, { email: "a.b@gmail.com" }); },
    });
    expect(seen!.url).toBe(GENERATE_URL);
    expect(new URL(seen!.url).pathname).toBe("/api/generate-email");
    expect(seen!.options.method).toBe("POST");
    expect(JSON.parse(seen!.options.body)).toStrictEqual({ ids: [2, 3] });
    expect(seen!.options.headers).toStrictEqual({ Accept: "application/json", "Content-Type": "application/json" });
    expect(seen!.options.signal).toBe(controller.signal);
  });

  it("200 → ünvan (trimlənir və kiçik hərflərlə qaytarılır)", async () => {
    expect(await call(jsonResponse(200, { status: "success", email: " James.AND.Family@Gmail.com " }))).toBe("james.and.family@gmail.com");
  });

  it("403 NO_ACCESSIBLE_TYPES → serverin öz mesajı saxlanılır", async () => {
    await rejects(call(jsonResponse(403, { status: "error", code: "NO_ACCESSIBLE_TYPES", message: "No accessible email types found." })),
      /No accessible email types found/);
  });

  it("422 → validasiya mesajı saxlanılır", async () => {
    await rejects(call(jsonResponse(422, { message: "The selected ids.0 is invalid." })), /The selected ids\.0 is invalid/);
  });

  it("429 Retry-After ilə → gözləmə müddəti deyilir", async () => {
    await rejects(call(jsonResponse(429, {}, { "Retry-After": "37" })), /çox sorğu göndərilib, 37 saniyə gözləyin/);
  });

  it("429 Retry-After olmadan → ümumi xəbərdarlıq", async () => {
    await rejects(call(jsonResponse(429, {})), /çox sorğu göndərilib, bir az gözləyin/);
  });

  it("500 mesajsız → status göstərilir", async () => {
    await rejects(call(jsonResponse(500, {})), /server 500 cavabı qaytardı/);
  });

  it("server HTML qaytarsa (JSON pozulubsa) status xətası göstərilir", async () => {
    await rejects(call(brokenResponse(502)), /server 502 cavabı qaytardı/);
  });

  it('200 amma { status: "error" } → sayt sorğunu qəbul etmədi', async () => {
    await rejects(call(jsonResponse(200, { status: "error", message: "Rate limited" })), /Rate limited/);
  });

  it("200 amma ünvan yoxdur / @-sızdır → aydın xəta", async () => {
    await rejects(call(jsonResponse(200, { email: null })), /server etibarlı ünvan qaytarmadı/);
    await rejects(call(jsonResponse(200, { email: "nouser" })), /server etibarlı ünvan qaytarmadı/);
  });

  it("headers.get yoxdursa 429 yenə tutulur", async () => {
    await rejects(requestAccount(DEFAULT_VALUES, {
      fetchImpl: async () : Promise<any> => ({ status: 429, ok: false, json: async () : Promise<any> => ({}) }),
    }), /çox sorğu göndərilib, bir az gözləyin/);
  });
});

describe("requestMessages — sorğuların qurulması", () => {
  it("POST /api/message-list, gövdə { email, limit }", async () => {
    const email = address();
    const { calls, fetchImpl } = mailStub({ list: [] });
    await requestMessages(email, { wait: false, fetchImpl });
    const listCall = calls.options.find((c: any) => c.url === MESSAGE_LIST_URL);
    expect(new URL(listCall!.url).pathname).toBe("/api/message-list");
    expect(listCall!.options.method).toBe("POST");
    expect(JSON.parse(listCall!.options.body)).toStrictEqual({ email, limit: LIST_LIMIT });
    expect(listCall!.options.headers).toStrictEqual({ Accept: "application/json", "Content-Type": "application/json" });
  });

  it("gövdə GET /api/message/<id> ilə oxunur, id kodlanır", async () => {
    const id = uid("gp1.a/b+c");
    const { calls, fetchImpl } = mailStub({ list: [entry(id)], bodies: { [id]: "<p>Kod: 483920</p>" } });
    await requestMessages(address(), { wait: false, fetchImpl });
    const bodyCall = calls.options.find((c: any) => c.url !== MESSAGE_LIST_URL);
    expect(bodyCall!.url).toBe(messageUrl(id));
    expect(bodyCall!.url.includes(encodeURIComponent(id)), bodyCall!.url).toBeTruthy();
    expect(bodyCall!.options.method).toBe(undefined);
    expect(bodyCall!.options.headers).toStrictEqual({ Accept: "application/json" });
  });

  it("signal həm siyahı, həm gövdə sorğusuna ötürülür (Dayandır ikisini də kəsir)", async () => {
    const id = uid("m");
    const controller = new AbortController();
    const { calls, fetchImpl } = mailStub({ list: [entry(id)], bodies: { [id]: "x" } });
    await requestMessages(address(), { wait: false, signal: controller.signal, fetchImpl });
    expect(calls.options.length).toBe(2);
    for (const call of calls.options) expect(call.options.signal).toBe(controller.signal);
  });
});

describe("requestMessages — cavabın oxunuşu", () => {
  it("müvəqqəti boş gövdə növbəti sorğuda yenidən oxunur", async () => {
    const email = address(), id = uid("late-body");
    let bodyCalls = 0;
    const { fetchImpl } = mailStub({ list: [entry(id)], bodies: { [id]: () => jsonResponse(200,
      { content: ++bodyCalls === 1 ? "" : "Your verification code: 483920" }) } });
    await requestMessages(email, { wait: false, fetchImpl });
    const second = await requestMessages(email, { wait: false, fetchImpl });
    expect(second[0].body).toMatch(/483920/);
  });

  it("həddən böyük tarix bütün qutunun oxunmasını dayandırmır", async () => {
    const id = uid("bad-date");
    const { fetchImpl } = mailStub({ list: [entry(id, { timestamp: 1e300 })], bodies: { [id]: "code: 483920" } });
    expect((await requestMessages(address(), { wait: false, fetchImpl }))[0].date).toBe("");
  });
  it("siyahı + gövdə birləşdirilir: HTML `body`, tarix ISO olur", async () => {
    const id = uid("m");
    const { fetchImpl } = mailStub({
      list: [entry(id, { timestamp: 1789291932 })],
      bodies: { [id]: "<p>Your verification code is <b>483920</b></p>" },
    });
    const messages = await requestMessages(address(), { wait: false, fetchImpl });
    expect(messages.length).toBe(1);
    expect(messages[0]).toStrictEqual({
      id,
      date: new Date(1789291932 * 1000).toISOString(),
      from: "Nexora <no-reply@nexora.example>",
      subject: "Nexora Email Verification",
      body: "<p>Your verification code is <b>483920</b></p>",
      bodyContentType: "html",
      text: "",
    });
  });

  it("locked məktublar süzülür — gövdəsi boşdur, sorğu da göndərilmir", async () => {
    const fresh = uid("m");
    const old = uid("m");
    const { calls, fetchImpl } = mailStub({
      list: [entry(fresh), entry(old, { locked: true, from: "Locked sender", subject: "Upgrade to Premium…" })],
      bodies: { [fresh]: "<p>kod</p>" },
    });
    const messages = await requestMessages(address(), { wait: false, fetchImpl });
    expect(messages.map((m) => m.id)).toStrictEqual([fresh]);
    expect(calls.bodies).toStrictEqual([fresh]);
  });

  it("boş qutu xəta deyil — boş siyahı, gövdə sorğusu yoxdur", async () => {
    const { calls, fetchImpl } = mailStub({ list: [] });
    expect(await requestMessages(address(), { wait: false, fetchImpl })).toStrictEqual([]);
    expect(calls.bodies).toStrictEqual([]);
  });

  it("məktublar tarixə görə azalan sıralanır, təkrar id-lər düşür", async () => {
    const [a, b] = [uid("m"), uid("m")];
    const { fetchImpl } = mailStub({
      list: [entry(a, { timestamp: 1000 }), entry(b, { timestamp: 2000 }), entry(a, { timestamp: 1000 })],
      bodies: { [a]: "a", [b]: "b" },
    });
    const messages = await requestMessages(address(), { wait: false, fetchImpl });
    expect(messages.map((m) => m.id)).toStrictEqual([b, a]);
  });

  it("id-siz və pozulmuş elementlər atılır", async () => {
    const id = uid("m");
    const { fetchImpl } = mailStub({ list: [null, "sətir", entry(undefined), entry(""), entry(id)], bodies: { [id]: "x" } });
    expect((await requestMessages(address(), { wait: false, fetchImpl })).map((m) => m.id)).toStrictEqual([id]);
  });

  it("pozulmuş zərf (messages sətirdir) boş siyahı kimi oxunur", async () => {
    const { fetchImpl } = mailStub({ list: () => jsonResponse(200, { status: "success", messages: "sətir" }) });
    expect(await requestMessages(address(), { wait: false, fetchImpl })).toStrictEqual([]);
  });

  it("qutuda MAX_BODIES-dən çox məktub olsa yalnız ən təzələri oxunur", async () => {
    const ids = Array.from({ length: MAX_BODIES + 4 }, () => uid("m"));
    const bodies = Object.fromEntries(ids.map((id) => [id, "x"]));
    const { calls, fetchImpl } = mailStub({ list: ids.map((id, i) => entry(id, { timestamp: 9000 - i })), bodies });
    const messages = await requestMessages(address(), { wait: false, fetchImpl });
    expect(messages.length).toBe(MAX_BODIES);
    expect(calls.bodies).toStrictEqual(ids.slice(0, MAX_BODIES));
  });

  it("eyni məktubun gövdəsi bir dəfə oxunur (keş)", async () => {
    const email = address();
    const id = uid("m");
    const { calls, fetchImpl } = mailStub({ list: [entry(id)], bodies: { [id]: "<p>kod</p>" } });
    await requestMessages(email, { wait: false, fetchImpl });
    await requestMessages(email, { wait: false, fetchImpl });
    expect(calls.list).toBe(2);
    expect(calls.bodies, "gövdə ikinci sorğuda keşdən gəlməli idi").toStrictEqual([id]);
  });

  it("silinmiş məktub (404) boş gövdə ilə keçir və təkrar sorğulanmır", async () => {
    const email = address();
    const id = uid("m");
    const { calls, fetchImpl } = mailStub({ list: [entry(id)], bodies: { [id]: () => jsonResponse(404, { message: "Not found" }) } });
    const messages = await requestMessages(email, { wait: false, fetchImpl });
    expect(messages[0].body).toBe("");
    await requestMessages(email, { wait: false, fetchImpl });
    expect(calls.bodies).toStrictEqual([id]);
  });

  it("404 siyahı cavabı → ünvan hovuzda yoxdur (serverin mesajı ilə)", async () => {
    const { fetchImpl } = mailStub({ list: () => jsonResponse(404, { status: "error", message: "Email not found" }) });
    await rejects(requestMessages(address(), { wait: false, fetchImpl }), /Email not found/);
  });

  it("422 və 429 siyahı cavabları da aydın mətnə çevrilir", async () => {
    const bad: any = mailStub({ list: () => jsonResponse(422, { message: "The email field must be a valid email address." }) });
    await rejects(requestMessages(address(), { wait: false, fetchImpl: bad.fetchImpl }), /must be a valid email address/);
    const limited: any = mailStub({ list: () => jsonResponse(429, {}, { "Retry-After": "9" }) });
    await rejects(requestMessages(address(), { wait: false, fetchImpl: limited.fetchImpl }), /9 saniyə gözləyin/);
  });

  it("gövdə sorğusunun 500-ü udulmur (qutu yarımçıq göstərilməməlidir)", async () => {
    const id = uid("m");
    const { fetchImpl } = mailStub({ list: [entry(id)], bodies: { [id]: () => jsonResponse(500, {}) } });
    await rejects(requestMessages(address(), { wait: false, fetchImpl }), /server 500 cavabı qaytardı/);
  });
});

// Sayt long-poll vermir: `wait: true` olanda pauza provider-dədir, yoxsa worker-in izləmə
// döngüsü fasiləsiz sorğu göndərərdi (background/inbox.ts uğurlu sorğudan sonra gözləmir).
describe("requestMessages — long-poll emulyasiyası", () => {
  it("wait:false → yalnız bir siyahı sorğusu, pauza yoxdur", async () => {
    const { seen, sleepImpl, nowImpl } = clock();
    const { calls, fetchImpl } = mailStub({ list: [] });
    await requestMessages(address(), { wait: false, fetchImpl, sleepImpl, nowImpl });
    expect(calls.list).toBe(1);
    expect(seen).toStrictEqual([]);
  });

  it("ünvan ilk dəfə oxunanda wait:true də dərhal qaytarır (qutudakı məktub gözlədilməsin)", async () => {
    const { seen, sleepImpl, nowImpl } = clock();
    const { calls, fetchImpl } = mailStub({ list: [] });
    await requestMessages(address(), { wait: true, fetchImpl, sleepImpl, nowImpl });
    expect(calls.list).toBe(1);
    expect(seen).toStrictEqual([]);
  });

  it("qutu dəyişməyibsə pəncərə bitənə qədər təkrar sorğulanır", async () => {
    const email = address();
    const { seen, sleepImpl, nowImpl } = clock();
    const { calls, fetchImpl } = mailStub({ list: [] });
    await requestMessages(email, { wait: false, fetchImpl, sleepImpl, nowImpl });   // yaddaşı qurur
    await requestMessages(email, { wait: true, fetchImpl, sleepImpl, nowImpl, waitWindowMs: 12000, gapMs: 6000 });
    expect(calls.list, "1 (yaddaşı quran sorğu) + 2 (pəncərə içində)").toBe(3);
    expect(seen.map((s: any) => s.ms)).toStrictEqual([6000]);
  });

  it("pəncərə default dəyərlərlə də sonsuz döngüyə düşmür", async () => {
    const email = address();
    const { seen, sleepImpl, nowImpl } = clock();
    const { calls, fetchImpl } = mailStub({ list: [] });
    await requestMessages(email, { wait: false, fetchImpl, sleepImpl, nowImpl });
    await requestMessages(email, { wait: true, fetchImpl, sleepImpl, nowImpl });
    expect(calls.list <= 4, `çox sorğu göndərildi: ${calls.list}`).toBeTruthy();
    expect(seen.length >= 1, "pauza verilmədi — döngü fasiləsiz sorğu göndərərdi").toBeTruthy();
  });

  it("yeni məktub görünən kimi dərhal qaytarır (pauza kəsilir)", async () => {
    const email = address();
    const fresh = uid("m");
    const { seen, sleepImpl, nowImpl } = clock();
    const { calls, fetchImpl } = mailStub({
      list: (n: any) => (n >= 3 ? [entry(fresh)] : []),
      bodies: { [fresh]: "<p>Nexora kod: 483920</p>" },
    });
    await requestMessages(email, { wait: false, fetchImpl, sleepImpl, nowImpl });   // yaddaşı qurur (boş)
    const messages = await requestMessages(email, { wait: true, fetchImpl, sleepImpl, nowImpl, waitWindowMs: 60000, gapMs: 6000 });
    expect(messages.map((m) => m.id)).toStrictEqual([fresh]);
    expect(calls.list, "yeni id tapılan kimi döngü bitməli idi").toBe(3);
    expect(seen.length).toBe(1);
  });

  it("pauza signal-ı sleep-ə ötürür (Dayandır gözləməni kəsir)", async () => {
    const email = address();
    const controller = new AbortController();
    const { seen, sleepImpl, nowImpl } = clock();
    const { fetchImpl } = mailStub({ list: [] });
    await requestMessages(email, { wait: false, fetchImpl, sleepImpl, nowImpl });
    await requestMessages(email, { wait: true, signal: controller.signal, fetchImpl, sleepImpl, nowImpl, waitWindowMs: 12000, gapMs: 6000 });
    expect(seen[0].signal).toBe(controller.signal);
  });

  it("real sleep dayandırılmış signal ilə AbortError verir", async () => {
    const { sleep } = await import("../src/providers/temp-mail/emailnator/api");
    const controller = new AbortController();
    controller.abort();
    await sleep(50000, controller.signal).then(
      () : any => { throw new Error("gözlənilən rədd cavabı gəlmədi"); },
      (e) => { expect((e as Error).name).toBe("AbortError"); },
    );
    // gözləmə ortasında dayandırılanda da eyni nəticə
    const late = new AbortController();
    const pending = sleep(50000, late.signal);
    late.abort();
    await pending.then(
      () : any => { throw new Error("gözlənilən rədd cavabı gəlmədi"); },
      (e) => { expect((e as Error).name).toBe("AbortError"); },
    );
  });
});

describe("deskriptorun sahələri worker imzası ilə çağrılır", () => {
  it("fetchAddress dayandırılmış signal ilə rədd olunur", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(provider.fetchAddress!({ values: DEFAULT_VALUES, signal: controller.signal })).rejects.toThrow(/abort/i);
  });

  it("fetchMessages dayandırılmış signal ilə rədd olunur", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(provider.fetchMessages!({ email: address(), wait: false, signal: controller.signal })).rejects.toThrow(/abort/i);
  });
});
