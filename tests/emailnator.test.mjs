// emailnator.com provider-inin testləri: saytın API protokolu.
//
// Bu testlər saytı açmadan işləyir — fetch stub-lanır. Məqsəd protokolu qorumaq: sorğuların
// forması, cavabın məktub siyahısına çevrilməsi, gövdə sorğularının keşlənməsi və long-poll
// emulyasiyası (sayt `wait` dəstəkləmir, pauza provider-dədir).
//
// DİQQƏT: api.js modul səviyyəsində keş saxlayır (gövdələr + ünvan başına son id-lər), ona
// görə hər test öz təkrarsız ünvanı və id-ləri ilə işləyir — testlər bir-birinə qarışmır.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { acquireMode, AcquireMode, supportsInbox } from "../src/providers/contract.js";
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
} from "../src/providers/temp-mail/emailnator/api.js";
import { TEMP_MAIL } from "../src/providers/temp-mail/index.js";
import { resolveValues, validateValues } from "../src/shared/options.js";

const provider = TEMP_MAIL.get("emailnator.com");

// Təkrarsız ad/id üçün sayğac: modul keşi testlər arasında yaşayır
let counter = 0;
const uid = (prefix) => `${prefix}-${++counter}`;
const address = () => `${uid("box")}@gmail.com`;

// Seçimləri qısa yazmaq üçün: T("dotGmail") → types obyekti
const T = (...names) => ({ types: Object.fromEntries(TYPE_CHOICES.map((c) => [c.value, names.includes(c.value)])) });

// --- cavab stub-ları ----------------------------------------------------------------------
const jsonResponse = (status, body, headers = {}) => ({
  status,
  ok: status >= 200 && status < 300,
  headers: { get: (name) => headers[name] ?? headers[name.toLowerCase()] ?? null },
  json: async () => body,
});
// JSON-u pozulmuş cavab (server HTML qaytaranda belə olur)
const brokenResponse = (status) => ({
  status,
  ok: status >= 200 && status < 300,
  headers: { get: () => null },
  json: async () => { throw new SyntaxError("Unexpected token <"); },
});
const rejects = (promise, pattern) => assert.rejects(promise, pattern);

// Poçt sorğularını marşrutlayan stub: siyahı bir ünvana, gövdə /api/message/<id>-ə gedir.
//   list   — massiv, ya da (çağırışın nömrəsi) => massiv
//   bodies — { [id]: HTML }, ya da { [id]: () => cavab }
function mailStub({ list = [], bodies = {} } = {}) {
  const calls = { list: 0, bodies: [], options: [] };
  const fetchImpl = async (url, options) => {
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
const entry = (id, extra = {}) => ({
  id,
  from: "Nexora <no-reply@nexora.example>",
  subject: "Nexora Email Verification",
  timestamp: 1789291932,
  time_ago: "1 min ago",
  ...extra,
});

// Saxta saat + pauza: gerçək gözləmə olmadan pəncərənin hesablanmasını yoxlayır
const clock = () => {
  let time = 0;
  const seen = [];
  return {
    seen,
    nowImpl: () => time,
    sleepImpl: async (ms, signal) => { seen.push({ ms, signal }); time += ms; },
  };
};

describe("emailnator deskriptoru", () => {
  it("API rejimindədir — tab açılmır", () => {
    assert.equal(acquireMode(provider), AcquireMode.api);
    assert.equal(typeof provider.fetchAddress, "function");
    assert.equal(provider.newAddress, undefined);
  });

  it("poçt qutusu imkanı açıqdır", () => {
    assert.equal(supportsInbox(provider), true);
  });

  it("seçim sxemi default dəyərlərlə uyğundur (reyestrə düşüb)", () => {
    assert.deepEqual(TEMP_MAIL.problems, []);
    assert.deepEqual(resolveValues(provider, null), { types: { domain: false, plusGmail: false, dotGmail: true, googleMail: false } });
  });

  it("default yalnız .Gmail-dir (əsl gmail.com ünvanı — qeydiyyat formaları qəbul edir)", () => {
    assert.deepEqual(DEFAULT_VALUES.types, { domain: false, plusGmail: false, dotGmail: true, googleMail: false });
  });

  it("heç nə işarələnməyəndə sxem xəbərdarlıq edir (min:1)", () => {
    assert.match(validateValues(provider, resolveValues(provider, T())), /ən azı 1 seçim/);
    assert.equal(validateValues(provider, resolveValues(provider, DEFAULT_VALUES)), null);
  });

  it("modulun funksiyaları ilə eynidir (deskriptor protokolu təkrarlamır)", async () => {
    const api = await import("../src/providers/temp-mail/emailnator/api.js");
    assert.equal(provider.fetchAddress, api.fetchAddress);
    assert.equal(provider.fetchMessages, api.fetchMessages);
  });
});

describe("typeIds — sorğunun ids massivi", () => {
  it("saytın öz cədvəli ilə uyğundur", () => {
    assert.deepEqual(TYPE_IDS, { domain: 1, plusGmail: 2, dotGmail: 3, googleMail: 8 });
  });

  it("default → [3] (.Gmail)", () => {
    assert.deepEqual(typeIds(DEFAULT_VALUES), [3]);
  });

  it("seçim sırası deyil, saytın ardıcıllığı işlənir", () => {
    assert.deepEqual(typeIds(T("googleMail", "domain", "dotGmail")), [1, 3, 8]);
  });

  it("heç nə seçilməyibsə boş massiv (sxemdəki min:1 buna yol vermir)", () => {
    assert.deepEqual(typeIds(T()), []);
  });

  it("naməlum və pozulmuş dəyərlər nəzərə alınmır", () => {
    assert.deepEqual(typeIds({ types: { dotGmail: "hə", nosuch: true } }), []);
    assert.deepEqual(typeIds(null), []);
  });
});

describe("requestAccount — ünvanın alınması", () => {
  const call = (response, init = {}) => requestAccount(DEFAULT_VALUES, { fetchImpl: async () => response, ...init });

  it("POST /api/generate-email, JSON gövdəsi { ids }", async () => {
    let seen = null;
    const controller = new AbortController();
    await requestAccount(T("dotGmail", "plusGmail"), {
      signal: controller.signal,
      fetchImpl: async (url, options) => { seen = { url, options }; return jsonResponse(200, { email: "a.b@gmail.com" }); },
    });
    assert.equal(seen.url, GENERATE_URL);
    assert.equal(new URL(seen.url).pathname, "/api/generate-email");
    assert.equal(seen.options.method, "POST");
    assert.deepEqual(JSON.parse(seen.options.body), { ids: [2, 3] });
    assert.deepEqual(seen.options.headers, { Accept: "application/json", "Content-Type": "application/json" });
    assert.equal(seen.options.signal, controller.signal);
  });

  it("200 → ünvan (trimlənir və kiçik hərflərlə qaytarılır)", async () => {
    assert.equal(await call(jsonResponse(200, { status: "success", email: " James.AND.Family@Gmail.com " })), "james.and.family@gmail.com");
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
      fetchImpl: async () => ({ status: 429, ok: false, json: async () => ({}) }),
    }), /çox sorğu göndərilib, bir az gözləyin/);
  });
});

describe("requestMessages — sorğuların qurulması", () => {
  it("POST /api/message-list, gövdə { email, limit }", async () => {
    const email = address();
    const { calls, fetchImpl } = mailStub({ list: [] });
    await requestMessages(email, { wait: false, fetchImpl });
    const listCall = calls.options.find((c) => c.url === MESSAGE_LIST_URL);
    assert.equal(new URL(listCall.url).pathname, "/api/message-list");
    assert.equal(listCall.options.method, "POST");
    assert.deepEqual(JSON.parse(listCall.options.body), { email, limit: LIST_LIMIT });
    assert.deepEqual(listCall.options.headers, { Accept: "application/json", "Content-Type": "application/json" });
  });

  it("gövdə GET /api/message/<id> ilə oxunur, id kodlanır", async () => {
    const id = uid("gp1.a/b+c");
    const { calls, fetchImpl } = mailStub({ list: [entry(id)], bodies: { [id]: "<p>Kod: 483920</p>" } });
    await requestMessages(address(), { wait: false, fetchImpl });
    const bodyCall = calls.options.find((c) => c.url !== MESSAGE_LIST_URL);
    assert.equal(bodyCall.url, messageUrl(id));
    assert.ok(bodyCall.url.includes(encodeURIComponent(id)), bodyCall.url);
    assert.equal(bodyCall.options.method, undefined);
    assert.deepEqual(bodyCall.options.headers, { Accept: "application/json" });
  });

  it("signal həm siyahı, həm gövdə sorğusuna ötürülür (Dayandır ikisini də kəsir)", async () => {
    const id = uid("m");
    const controller = new AbortController();
    const { calls, fetchImpl } = mailStub({ list: [entry(id)], bodies: { [id]: "x" } });
    await requestMessages(address(), { wait: false, signal: controller.signal, fetchImpl });
    assert.equal(calls.options.length, 2);
    for (const call of calls.options) assert.equal(call.options.signal, controller.signal);
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
    assert.match(second[0].body, /483920/);
  });

  it("həddən böyük tarix bütün qutunun oxunmasını dayandırmır", async () => {
    const id = uid("bad-date");
    const { fetchImpl } = mailStub({ list: [entry(id, { timestamp: 1e300 })], bodies: { [id]: "code: 483920" } });
    assert.equal((await requestMessages(address(), { wait: false, fetchImpl }))[0].date, "");
  });
  it("siyahı + gövdə birləşdirilir: HTML `body`, tarix ISO olur", async () => {
    const id = uid("m");
    const { fetchImpl } = mailStub({
      list: [entry(id, { timestamp: 1789291932 })],
      bodies: { [id]: "<p>Your verification code is <b>483920</b></p>" },
    });
    const messages = await requestMessages(address(), { wait: false, fetchImpl });
    assert.equal(messages.length, 1);
    assert.deepEqual(messages[0], {
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
    assert.deepEqual(messages.map((m) => m.id), [fresh]);
    assert.deepEqual(calls.bodies, [fresh]);
  });

  it("boş qutu xəta deyil — boş siyahı, gövdə sorğusu yoxdur", async () => {
    const { calls, fetchImpl } = mailStub({ list: [] });
    assert.deepEqual(await requestMessages(address(), { wait: false, fetchImpl }), []);
    assert.deepEqual(calls.bodies, []);
  });

  it("məktublar tarixə görə azalan sıralanır, təkrar id-lər düşür", async () => {
    const [a, b] = [uid("m"), uid("m")];
    const { fetchImpl } = mailStub({
      list: [entry(a, { timestamp: 1000 }), entry(b, { timestamp: 2000 }), entry(a, { timestamp: 1000 })],
      bodies: { [a]: "a", [b]: "b" },
    });
    const messages = await requestMessages(address(), { wait: false, fetchImpl });
    assert.deepEqual(messages.map((m) => m.id), [b, a]);
  });

  it("id-siz və pozulmuş elementlər atılır", async () => {
    const id = uid("m");
    const { fetchImpl } = mailStub({ list: [null, "sətir", entry(undefined), entry(""), entry(id)], bodies: { [id]: "x" } });
    assert.deepEqual((await requestMessages(address(), { wait: false, fetchImpl })).map((m) => m.id), [id]);
  });

  it("pozulmuş zərf (messages sətirdir) boş siyahı kimi oxunur", async () => {
    const { fetchImpl } = mailStub({ list: () => jsonResponse(200, { status: "success", messages: "sətir" }) });
    assert.deepEqual(await requestMessages(address(), { wait: false, fetchImpl }), []);
  });

  it("qutuda MAX_BODIES-dən çox məktub olsa yalnız ən təzələri oxunur", async () => {
    const ids = Array.from({ length: MAX_BODIES + 4 }, () => uid("m"));
    const bodies = Object.fromEntries(ids.map((id) => [id, "x"]));
    const { calls, fetchImpl } = mailStub({ list: ids.map((id, i) => entry(id, { timestamp: 9000 - i })), bodies });
    const messages = await requestMessages(address(), { wait: false, fetchImpl });
    assert.equal(messages.length, MAX_BODIES);
    assert.deepEqual(calls.bodies, ids.slice(0, MAX_BODIES));
  });

  it("eyni məktubun gövdəsi bir dəfə oxunur (keş)", async () => {
    const email = address();
    const id = uid("m");
    const { calls, fetchImpl } = mailStub({ list: [entry(id)], bodies: { [id]: "<p>kod</p>" } });
    await requestMessages(email, { wait: false, fetchImpl });
    await requestMessages(email, { wait: false, fetchImpl });
    assert.equal(calls.list, 2);
    assert.deepEqual(calls.bodies, [id], "gövdə ikinci sorğuda keşdən gəlməli idi");
  });

  it("silinmiş məktub (404) boş gövdə ilə keçir və təkrar sorğulanmır", async () => {
    const email = address();
    const id = uid("m");
    const { calls, fetchImpl } = mailStub({ list: [entry(id)], bodies: { [id]: () => jsonResponse(404, { message: "Not found" }) } });
    const messages = await requestMessages(email, { wait: false, fetchImpl });
    assert.equal(messages[0].body, "");
    await requestMessages(email, { wait: false, fetchImpl });
    assert.deepEqual(calls.bodies, [id]);
  });

  it("404 siyahı cavabı → ünvan hovuzda yoxdur (serverin mesajı ilə)", async () => {
    const { fetchImpl } = mailStub({ list: () => jsonResponse(404, { status: "error", message: "Email not found" }) });
    await rejects(requestMessages(address(), { wait: false, fetchImpl }), /Email not found/);
  });

  it("422 və 429 siyahı cavabları da aydın mətnə çevrilir", async () => {
    const bad = mailStub({ list: () => jsonResponse(422, { message: "The email field must be a valid email address." }) });
    await rejects(requestMessages(address(), { wait: false, fetchImpl: bad.fetchImpl }), /must be a valid email address/);
    const limited = mailStub({ list: () => jsonResponse(429, {}, { "Retry-After": "9" }) });
    await rejects(requestMessages(address(), { wait: false, fetchImpl: limited.fetchImpl }), /9 saniyə gözləyin/);
  });

  it("gövdə sorğusunun 500-ü udulmur (qutu yarımçıq göstərilməməlidir)", async () => {
    const id = uid("m");
    const { fetchImpl } = mailStub({ list: [entry(id)], bodies: { [id]: () => jsonResponse(500, {}) } });
    await rejects(requestMessages(address(), { wait: false, fetchImpl }), /server 500 cavabı qaytardı/);
  });
});

// Sayt long-poll vermir: `wait: true` olanda pauza provider-dədir, yoxsa worker-in izləmə
// döngüsü fasiləsiz sorğu göndərərdi (background/inbox.js uğurlu sorğudan sonra gözləmir).
describe("requestMessages — long-poll emulyasiyası", () => {
  it("wait:false → yalnız bir siyahı sorğusu, pauza yoxdur", async () => {
    const { seen, sleepImpl, nowImpl } = clock();
    const { calls, fetchImpl } = mailStub({ list: [] });
    await requestMessages(address(), { wait: false, fetchImpl, sleepImpl, nowImpl });
    assert.equal(calls.list, 1);
    assert.deepEqual(seen, []);
  });

  it("ünvan ilk dəfə oxunanda wait:true də dərhal qaytarır (qutudakı məktub gözlədilməsin)", async () => {
    const { seen, sleepImpl, nowImpl } = clock();
    const { calls, fetchImpl } = mailStub({ list: [] });
    await requestMessages(address(), { wait: true, fetchImpl, sleepImpl, nowImpl });
    assert.equal(calls.list, 1);
    assert.deepEqual(seen, []);
  });

  it("qutu dəyişməyibsə pəncərə bitənə qədər təkrar sorğulanır", async () => {
    const email = address();
    const { seen, sleepImpl, nowImpl } = clock();
    const { calls, fetchImpl } = mailStub({ list: [] });
    await requestMessages(email, { wait: false, fetchImpl, sleepImpl, nowImpl });   // yaddaşı qurur
    await requestMessages(email, { wait: true, fetchImpl, sleepImpl, nowImpl, waitWindowMs: 12000, gapMs: 6000 });
    assert.equal(calls.list, 3, "1 (yaddaşı quran sorğu) + 2 (pəncərə içində)");
    assert.deepEqual(seen.map((s) => s.ms), [6000]);
  });

  it("pəncərə default dəyərlərlə də sonsuz döngüyə düşmür", async () => {
    const email = address();
    const { seen, sleepImpl, nowImpl } = clock();
    const { calls, fetchImpl } = mailStub({ list: [] });
    await requestMessages(email, { wait: false, fetchImpl, sleepImpl, nowImpl });
    await requestMessages(email, { wait: true, fetchImpl, sleepImpl, nowImpl });
    assert.ok(calls.list <= 4, `çox sorğu göndərildi: ${calls.list}`);
    assert.ok(seen.length >= 1, "pauza verilmədi — döngü fasiləsiz sorğu göndərərdi");
  });

  it("yeni məktub görünən kimi dərhal qaytarır (pauza kəsilir)", async () => {
    const email = address();
    const fresh = uid("m");
    const { seen, sleepImpl, nowImpl } = clock();
    const { calls, fetchImpl } = mailStub({
      list: (n) => (n >= 3 ? [entry(fresh)] : []),
      bodies: { [fresh]: "<p>Nexora kod: 483920</p>" },
    });
    await requestMessages(email, { wait: false, fetchImpl, sleepImpl, nowImpl });   // yaddaşı qurur (boş)
    const messages = await requestMessages(email, { wait: true, fetchImpl, sleepImpl, nowImpl, waitWindowMs: 60000, gapMs: 6000 });
    assert.deepEqual(messages.map((m) => m.id), [fresh]);
    assert.equal(calls.list, 3, "yeni id tapılan kimi döngü bitməli idi");
    assert.equal(seen.length, 1);
  });

  it("pauza signal-ı sleep-ə ötürür (Dayandır gözləməni kəsir)", async () => {
    const email = address();
    const controller = new AbortController();
    const { seen, sleepImpl, nowImpl } = clock();
    const { fetchImpl } = mailStub({ list: [] });
    await requestMessages(email, { wait: false, fetchImpl, sleepImpl, nowImpl });
    await requestMessages(email, { wait: true, signal: controller.signal, fetchImpl, sleepImpl, nowImpl, waitWindowMs: 12000, gapMs: 6000 });
    assert.equal(seen[0].signal, controller.signal);
  });

  it("real sleep dayandırılmış signal ilə AbortError verir", async () => {
    const { sleep } = await import("../src/providers/temp-mail/emailnator/api.js");
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(sleep(50000, controller.signal), (e) => e.name === "AbortError");
    // gözləmə ortasında dayandırılanda da eyni nəticə
    const late = new AbortController();
    const pending = sleep(50000, late.signal);
    late.abort();
    await assert.rejects(pending, (e) => e.name === "AbortError");
  });
});

describe("deskriptorun sahələri worker imzası ilə çağrılır", () => {
  it("fetchAddress dayandırılmış signal ilə rədd olunur", async () => {
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(provider.fetchAddress({ values: DEFAULT_VALUES, signal: controller.signal }), /abort/i);
  });

  it("fetchMessages dayandırılmış signal ilə rədd olunur", async () => {
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(provider.fetchMessages({ email: address(), wait: false, signal: controller.signal }), /abort/i);
  });
});
