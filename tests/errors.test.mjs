// Xəta səviyyələrinin testləri: saytın və ya istifadəçinin xətası XƏBƏRDARLIQ, extension-ın
// öz qüsuru isə XƏTA kimi görünməlidir.
//
// Niyə vacibdir: chrome://extensions səhvlər səhifəsinə yalnız console.error düşür və sətirlər
// extension yenilənəndə təmizlənmir. Saytın 429 limiti orada proqram xətası kimi görünəndə əsl
// qüsurlar itib-batırdı. Bu testlər bölgünün pozulmasını tutur: həm təsnifatı (isExpected),
// həm console-a yazılan səviyyəni (logFailure), həm də istifadəçiyə çatan status və bildirişi
// (reportFailure) yoxlayır.
import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import { fetchFromApi } from "../src/background/address-api.js";
import { reportFailure } from "../src/background/notify.js";
import { waitForLoad } from "../src/background/tabs.js";
import { describeFailure, ExpectedError, isExpected, logFailure } from "../src/shared/errors.js";
import { Message, send } from "../src/shared/messages.js";
import { readStatus, StatusLevel } from "../src/shared/state.js";

// console.warn / console.error çağırışlarını yığır: səhvlər səhifəsinə nəyin düşəcəyini onlar müəyyən edir.
function captureConsole() {
  const rows = { warn: [], error: [] };
  const real = { warn: console.warn, error: console.error };
  console.warn = (...args) => rows.warn.push(args);
  console.error = (...args) => rows.error.push(args);
  return { rows, restore() { console.warn = real.warn; console.error = real.error; } };
}

// chrome.storage.session + notifications + runtime.getURL: reportFailure-in ehtiyac duyduğu
// minimum. Real chrome kimi dəyərləri klonlayır — testlər istinad paylaşmır.
function memoryArea() {
  const data = new Map();
  return {
    data,
    get: async (key) => (data.has(key) ? { [key]: structuredClone(data.get(key)) } : {}),
    set: async (items) => { for (const [key, value] of Object.entries(items)) data.set(key, structuredClone(value)); },
    remove: async (key) => { data.delete(key); },
  };
}

let notifications = [];

beforeEach(() => {
  notifications = [];
  globalThis.chrome = {
    storage: { session: memoryArea(), local: memoryArea() },
    notifications: { create: async (options) => { notifications.push(options); return "id"; } },
    runtime: { getURL: (path) => "chrome-extension://test/" + path },
  };
});

describe("ExpectedError", () => {
  it("adi Error kimi davranır, amma adı fərqlidir", () => {
    const e = new ExpectedError("temp.tf: çox sorğu göndərilib");
    assert.equal(e.name, "ExpectedError");
    assert.equal(e.message, "temp.tf: çox sorğu göndərilib");
    assert.ok(e instanceof Error);
    assert.ok(e instanceof ExpectedError);
    assert.ok(typeof e.stack === "string" && e.stack.length > 0);
  });

  it("əsl səbəbi cause-da saxlayır: istifadəçiyə aydın mətn çatır, detal itmir", () => {
    const cause = new TypeError("Cannot read properties of undefined");
    const e = new ExpectedError("temp.tf: cavab oxunmadı", { cause });
    assert.equal(e.cause, cause);
  });
});

describe("isExpected", () => {
  it("ExpectedError və AbortError gözləniləndir", () => {
    assert.equal(isExpected(new ExpectedError("sayt limiti")), true);
    assert.equal(isExpected(Object.assign(new Error("aborted"), { name: "AbortError" })), true);
    // DOMException real mühitdə belə gəlir: həlledici instanceof yox, addır
    assert.equal(isExpected({ name: "AbortError", message: "The user aborted a request." }), true);
  });

  it("proqram qüsuru gözlənilən DEYİL", () => {
    assert.equal(isExpected(new Error("naməlum sayt")), false);
    assert.equal(isExpected(new TypeError("x is not a function")), false);
    assert.equal(isExpected(null), false);
    assert.equal(isExpected(undefined), false);
    assert.equal(isExpected("sətir xətası"), false);
  });
});

describe("describeFailure", () => {
  it("AbortError-ı istifadəçinin başa düşəcəyi mətnə çevirir", () => {
    assert.equal(
      describeFailure(Object.assign(new Error("signal is aborted without reason"), { name: "AbortError" })),
      "sorğu vaxtı bitdi (sayt cavab vermədi)",
    );
  });

  it("qalan hallarda mesajı olduğu kimi verir, mesaj yoxdursa dəyəri stringify edir", () => {
    assert.equal(describeFailure(new Error("429")), "429");
    assert.equal(describeFailure("xətadır"), "xətadır");
    assert.equal(describeFailure(null), "null");
  });
});

describe("logFailure", () => {
  it("saytın xətasını warn kimi yazır və stack-i göstərmir", () => {
    const log = captureConsole();
    try {
      logFailure("axın pozuldu:", new ExpectedError("temp.tf: çox sorğu göndərilib"));
    } finally { log.restore(); }
    assert.equal(log.rows.error.length, 0);
    assert.deepEqual(log.rows.warn, [["axın pozuldu:", "temp.tf: çox sorğu göndərilib"]]);
  });

  it("proqram qüsurunu error kimi yazır — obyektin özü gedir ki, stack görünsün", () => {
    const defect = new TypeError("readSession is not defined");
    const log = captureConsole();
    try {
      logFailure("axın pozuldu:", defect);
    } finally { log.restore(); }
    assert.equal(log.rows.warn.length, 0);
    assert.equal(log.rows.error.length, 1);
    assert.equal(log.rows.error[0][0], "axın pozuldu:");
    assert.equal(log.rows.error[0][1], defect);
  });
});

describe("fetchFromApi — sayt sərhədi", () => {
  const provider = (fetchAddress) => ({ name: "TestMail", fetchAddress });

  it("uğurlu cavabı olduğu kimi qaytarır", async () => {
    const address = await fetchFromApi(provider(async () => "user@test.mail"), { domain: "test.mail" });
    assert.equal(address, "user@test.mail");
  });

  it("saytın xətasını ExpectedError-a çevirir və saytın adını əvvəlinə yazır", async () => {
    const original = new Error("çox sorğu göndərilib, 30 saniyə gözləyin");
    const e = await fetchFromApi(provider(async () => { throw original; }), {}).catch((err) => err);
    assert.ok(e instanceof ExpectedError);
    assert.equal(e.message, "TestMail: çox sorğu göndərilib, 30 saniyə gözləyin");
    assert.equal(e.cause, original);
  });

  it("vaxt limiti (AbortError) da gözlənilən xətdir", async () => {
    const abort = Object.assign(new Error("aborted"), { name: "AbortError" });
    const e = await fetchFromApi(provider(async () => { throw abort; }), {}).catch((err) => err);
    assert.ok(e instanceof ExpectedError);
    assert.equal(e.message, "TestMail: sorğu vaxtı bitdi (sayt cavab vermədi)");
  });

  it("signal-ı provider-ə ötürür", async () => {
    let seen = null;
    await fetchFromApi(provider(async ({ signal }) => { seen = signal; return "a@b.c"; }), {});
    assert.ok(seen instanceof AbortSignal);
  });
});

describe("waitForLoad — yüklənməyən tab", () => {
  it("tab yoxdursa gözlənilən xəta atır: sayt açılmayıb, bu extension-ın qüsuru deyil", async () => {
    globalThis.chrome.tabs = {
      get: async () => { throw new Error("No tab with id: 7"); },
      onUpdated: { addListener() {}, removeListener() {} },
    };
    const e = await waitForLoad(7, "https://mail.example/", 50).catch((err) => err);
    assert.ok(e instanceof ExpectedError);
    assert.equal(e.message, "tab yüklənmədi: https://mail.example/");
  });
});

describe("reportFailure — status, bildiriş və console bir yerdə", () => {
  it("saytın xətası: sarı status, xəbərdarlıq bildirişi, warn — səhvlər səhifəsinə düşmür", async () => {
    const log = captureConsole();
    try {
      await reportFailure(new ExpectedError("temp.tf: çox sorğu göndərilib, 30 saniyə gözləyin"));
    } finally { log.restore(); }

    assert.equal(log.rows.error.length, 0);
    assert.equal(log.rows.warn.length, 1);
    const status = await readStatus();
    assert.equal(status.level, StatusLevel.warn);
    assert.equal(status.text, "temp.tf: çox sorğu göndərilib, 30 saniyə gözləyin");
    assert.equal(notifications.length, 1);
    assert.equal(notifications[0].title, "Temp mail + relay: xəbərdarlıq");
    assert.equal(notifications[0].message, status.text);
  });

  it("proqram qüsuru: qırmızı status, xəta bildirişi, error", async () => {
    const log = captureConsole();
    try {
      await reportFailure(new TypeError("readSession is not defined"));
    } finally { log.restore(); }

    assert.equal(log.rows.warn.length, 0);
    assert.equal(log.rows.error.length, 1);
    const status = await readStatus();
    assert.equal(status.level, StatusLevel.error);
    assert.equal(status.text, "readSession is not defined");
    assert.equal(notifications[0].title, "Temp mail + relay: xəta");
  });

  it("vaxt limiti də xəbərdarlıqdır — istifadəçi sayt cavab vermədi görür", async () => {
    const log = captureConsole();
    try {
      await reportFailure(Object.assign(new Error("aborted"), { name: "AbortError" }));
    } finally { log.restore(); }

    assert.equal(log.rows.error.length, 0);
    assert.equal((await readStatus()).level, StatusLevel.warn);
    assert.equal(notifications[0].title, "Temp mail + relay: xəbərdarlıq");
  });

  it("mesajsız dəyər də statusa düşür — xəta udulmur", async () => {
    const log = captureConsole();
    try {
      await reportFailure("gözlənilməz sətir");
    } finally { log.restore(); }

    assert.equal(log.rows.error.length, 1);
    assert.equal((await readStatus()).text, "gözlənilməz sətir");
  });
});

describe("send — xətanın növü mesaj sərhədini keçir", () => {
  // Sinif sendMessage-dən keçə bilmir: worker növü `expected` nişanı ilə bildirir, popup
  // tərəfdə isə həmin nişandan ExpectedError qurulur. Nəticə: saytın xətası sarı, qüsur qırmızı.
  const replyWith = (reply) => { globalThis.chrome.runtime.sendMessage = async () => reply; };

  it("expected:true → ExpectedError (popup sarı göstərir)", async () => {
    replyWith({ ok: false, error: "temp.tf: çox sorğu göndərilib", expected: true });
    const e = await send(Message.stop()).catch((err) => err);
    assert.ok(e instanceof ExpectedError);
    assert.equal(isExpected(e), true);
    assert.equal(e.message, "temp.tf: çox sorğu göndərilib");
  });

  it("expected göstərilməyibsə adi Error-dır (popup qırmızı göstərir)", async () => {
    replyWith({ ok: false, error: "naməlum əmr: null" });
    const e = await send(Message.stop()).catch((err) => err);
    assert.ok(!(e instanceof ExpectedError));
    assert.equal(isExpected(e), false);
    assert.equal(e.message, "naməlum əmr: null");
  });

  it("worker cavab verməyəndə də xəta atılır", async () => {
    replyWith(undefined);
    const e = await send(Message.stop()).catch((err) => err);
    assert.equal(e.message, "service worker cavab vermədi");
  });

  it("uğurlu cavab olduğu kimi qaytarılır", async () => {
    replyWith({ ok: true });
    assert.deepEqual(await send(Message.stop()), { ok: true });
  });
});
