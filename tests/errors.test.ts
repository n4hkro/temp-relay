// Xəta səviyyələrinin testləri: saytın və ya istifadəçinin xətası XƏBƏRDARLIQ, extension-ın
// öz qüsuru isə XƏTA kimi görünməlidir.
//
// Niyə vacibdir: chrome://extensions səhvlər səhifəsinə yalnız console.error düşür və sətirlər
// extension yenilənəndə təmizlənmir. Saytın 429 limiti orada proqram xətası kimi görünəndə əsl
// qüsurlar itib-batırdı. Bu testlər bölgünün pozulmasını tutur: həm təsnifatı (isExpected),
// həm console-a yazılan səviyyəni (logFailure), həm də istifadəçiyə çatan status və bildirişi
// (reportFailure) yoxlayır.
import { beforeEach, describe, expect, it } from "vitest";

import { fetchFromApi } from "../src/background/address-api";
import { reportFailure } from "../src/background/notify";
import { waitForLoad } from "../src/background/tabs";
import { describeFailure, ExpectedError, isExpected, logFailure } from "../src/shared/errors";
import { Message, send } from "../src/shared/messages";
import { readStatus, StatusLevel } from "../src/shared/state";

// console.warn / console.error çağırışlarını yığır: səhvlər səhifəsinə nəyin düşəcəyini onlar müəyyən edir.
function captureConsole() : any {
  const rows: any = { warn: [], error: [] };
  const real = { warn: console.warn, error: console.error };
  console.warn = (...args) => rows.warn.push(args);
  console.error = (...args) => rows.error.push(args);
  return { rows, restore() { console.warn = real.warn; console.error = real.error; } };
}

// chrome.storage.session + notifications + runtime.getURL: reportFailure-in ehtiyac duyduğu
// minimum. Real chrome kimi dəyərləri klonlayır — testlər istinad paylaşmır.
function memoryArea() : any {
  const data = new Map();
  return {
    data,
    get: async (key: any) => (data.has(key) ? { [key]: structuredClone(data.get(key)) } : {}),
    set: async (items: any) => { for (const [key, value] of Object.entries(items)) data.set(key, structuredClone(value)); },
    remove: async (key: any) => { data.delete(key); },
  };
}

let notifications: any[] = [];

beforeEach(() => {
  notifications = [];
  (globalThis as any).chrome = {
    storage: { session: memoryArea(), local: memoryArea() },
    notifications: { create: async (options: any) => { notifications.push(options); return "id"; } },
    runtime: { getURL: (path: any) => "chrome-extension://test/" + path },
  };
});

describe("ExpectedError", () => {
  it("adi Error kimi davranır, amma adı fərqlidir", () => {
    const e = new ExpectedError("temp.tf: çox sorğu göndərilib");
    expect(e.name).toBe("ExpectedError");
    expect(e.message).toBe("temp.tf: çox sorğu göndərilib");
    expect(e instanceof Error).toBeTruthy();
    expect(e instanceof ExpectedError).toBeTruthy();
    expect(typeof e.stack === "string" && e.stack.length > 0).toBeTruthy();
  });

  it("əsl səbəbi cause-da saxlayır: istifadəçiyə aydın mətn çatır, detal itmir", () => {
    const cause = new TypeError("Cannot read properties of undefined");
    const e = new ExpectedError("temp.tf: cavab oxunmadı", { cause });
    expect(e.cause).toBe(cause);
  });
});

describe("isExpected", () => {
  it("ExpectedError və AbortError gözləniləndir", () => {
    expect(isExpected(new ExpectedError("sayt limiti"))).toBe(true);
    expect(isExpected(Object.assign(new Error("aborted"), { name: "AbortError" }))).toBe(true);
    // DOMException real mühitdə belə gəlir: həlledici instanceof yox, addır
    expect(isExpected({ name: "AbortError", message: "The user aborted a request." })).toBe(true);
  });

  it("proqram qüsuru gözlənilən DEYİL", () => {
    expect(isExpected(new Error("naməlum sayt"))).toBe(false);
    expect(isExpected(new TypeError("x is not a function"))).toBe(false);
    expect(isExpected(null)).toBe(false);
    expect(isExpected(undefined)).toBe(false);
    expect(isExpected("sətir xətası")).toBe(false);
  });
});

describe("describeFailure", () => {
  it("AbortError-ı istifadəçinin başa düşəcəyi mətnə çevirir", () => {
    expect(describeFailure(Object.assign(new Error("signal is aborted without reason"), { name: "AbortError" })), ).toBe("sorğu vaxtı bitdi (sayt cavab vermədi)");
  });

  it("qalan hallarda mesajı olduğu kimi verir, mesaj yoxdursa dəyəri stringify edir", () => {
    expect(describeFailure(new Error("429"))).toBe("429");
    expect(describeFailure("xətadır")).toBe("xətadır");
    expect(describeFailure(null)).toBe("null");
  });
});

describe("logFailure", () => {
  it("saytın xətasını warn kimi yazır və stack-i göstərmir", () => {
    const log: any = captureConsole();
    try {
      logFailure("axın pozuldu:", new ExpectedError("temp.tf: çox sorğu göndərilib"));
    } finally { log.restore(); }
    expect(log.rows.error.length).toBe(0);
    expect(log.rows.warn).toStrictEqual([["axın pozuldu:", "temp.tf: çox sorğu göndərilib"]]);
  });

  it("proqram qüsurunu error kimi yazır — obyektin özü gedir ki, stack görünsün", () => {
    const defect = new TypeError("readSession is not defined");
    const log: any = captureConsole();
    try {
      logFailure("axın pozuldu:", defect);
    } finally { log.restore(); }
    expect(log.rows.warn.length).toBe(0);
    expect(log.rows.error.length).toBe(1);
    expect(log.rows.error[0][0]).toBe("axın pozuldu:");
    expect(log.rows.error[0][1]).toBe(defect);
  });
});

describe("fetchFromApi — sayt sərhədi", () => {
  const provider = (fetchAddress: any) : any => ({ name: "TestMail", fetchAddress });

  it("uğurlu cavabı olduğu kimi qaytarır", async () => {
    const address = await fetchFromApi(provider(async () => "user@test.mail"), { domain: "test.mail" });
    expect(address).toBe("user@test.mail");
  });

  it("saytın xətasını ExpectedError-a çevirir və saytın adını əvvəlinə yazır", async () => {
    const original = new Error("çox sorğu göndərilib, 30 saniyə gözləyin");
    const e = await fetchFromApi(provider(async () : Promise<any> => { throw original; }), {}).catch((err) => err);
    expect(e instanceof ExpectedError).toBeTruthy();
    expect(e.message).toBe("TestMail: çox sorğu göndərilib, 30 saniyə gözləyin");
    expect(e.cause).toBe(original);
  });

  it("vaxt limiti (AbortError) da gözlənilən xətdir", async () => {
    const abort = Object.assign(new Error("aborted"), { name: "AbortError" });
    const e = await fetchFromApi(provider(async () : Promise<any> => { throw abort; }), {}).catch((err) => err);
    expect(e instanceof ExpectedError).toBeTruthy();
    expect(e.message).toBe("TestMail: sorğu vaxtı bitdi (sayt cavab vermədi)");
  });

  it("signal-ı provider-ə ötürür", async () => {
    let seen: any = null;
    await fetchFromApi(provider(async ({ signal }: any) => { seen = signal; return "a@b.c"; }), {});
    expect(seen instanceof AbortSignal).toBeTruthy();
  });
});

describe("waitForLoad — yüklənməyən tab", () => {
  it("tab yoxdursa gözlənilən xəta atır: sayt açılmayıb, bu extension-ın qüsuru deyil", async () => {
    (globalThis as any).chrome.tabs = {
      get: async () : Promise<any> => { throw new Error("No tab with id: 7"); },
      onUpdated: { addListener() {}, removeListener() {} },
    };
    const e = await waitForLoad(7, "https://mail.example/", 50).catch((err) => err);
    expect(e instanceof ExpectedError).toBeTruthy();
    expect(e.message).toBe("tab yüklənmədi: https://mail.example/");
  });
});

describe("reportFailure — status, bildiriş və console bir yerdə", () => {
  it("saytın xətası: sarı status, xəbərdarlıq bildirişi, warn — səhvlər səhifəsinə düşmür", async () => {
    const log: any = captureConsole();
    try {
      await reportFailure(new ExpectedError("temp.tf: çox sorğu göndərilib, 30 saniyə gözləyin"));
    } finally { log.restore(); }

    expect(log.rows.error.length).toBe(0);
    expect(log.rows.warn.length).toBe(1);
    const status = await readStatus();
    expect(status!.level).toBe(StatusLevel.warn);
    expect(status!.text).toBe("temp.tf: çox sorğu göndərilib, 30 saniyə gözləyin");
    expect(notifications.length).toBe(1);
    expect(notifications[0].title).toBe("Temp mail + relay: xəbərdarlıq");
    expect(notifications[0].message).toBe(status!.text);
  });

  it("proqram qüsuru: qırmızı status, xəta bildirişi, error", async () => {
    const log: any = captureConsole();
    try {
      await reportFailure(new TypeError("readSession is not defined"));
    } finally { log.restore(); }

    expect(log.rows.warn.length).toBe(0);
    expect(log.rows.error.length).toBe(1);
    const status = await readStatus();
    expect(status!.level).toBe(StatusLevel.error);
    expect(status!.text).toBe("readSession is not defined");
    expect(notifications[0].title).toBe("Temp mail + relay: xəta");
  });

  it("vaxt limiti də xəbərdarlıqdır — istifadəçi sayt cavab vermədi görür", async () => {
    const log: any = captureConsole();
    try {
      await reportFailure(Object.assign(new Error("aborted"), { name: "AbortError" }));
    } finally { log.restore(); }

    expect(log.rows.error.length).toBe(0);
    expect((await readStatus())!.level).toBe(StatusLevel.warn);
    expect(notifications[0].title).toBe("Temp mail + relay: xəbərdarlıq");
  });

  it("mesajsız dəyər də statusa düşür — xəta udulmur", async () => {
    const log: any = captureConsole();
    try {
      await reportFailure("gözlənilməz sətir");
    } finally { log.restore(); }

    expect(log.rows.error.length).toBe(1);
    expect((await readStatus())!.text).toBe("gözlənilməz sətir");
  });
});

describe("send — xətanın növü mesaj sərhədini keçir", () => {
  // Sinif sendMessage-dən keçə bilmir: worker növü `expected` nişanı ilə bildirir, popup
  // tərəfdə isə həmin nişandan ExpectedError qurulur. Nəticə: saytın xətası sarı, qüsur qırmızı.
  const replyWith = (reply: any) => { (globalThis as any).chrome.runtime.sendMessage = async () => reply; };

  it("expected:true → ExpectedError (popup sarı göstərir)", async () => {
    replyWith({ ok: false, error: "temp.tf: çox sorğu göndərilib", expected: true });
    const e = await send(Message.stop()).catch((err) => err);
    expect(e instanceof ExpectedError).toBeTruthy();
    expect(isExpected(e)).toBe(true);
    expect(e.message).toBe("temp.tf: çox sorğu göndərilib");
  });

  it("expected göstərilməyibsə adi Error-dır (popup qırmızı göstərir)", async () => {
    replyWith({ ok: false, error: "naməlum əmr: null" });
    const e = await send(Message.stop()).catch((err) => err);
    expect(!(e instanceof ExpectedError)).toBeTruthy();
    expect(isExpected(e)).toBe(false);
    expect(e.message).toBe("naməlum əmr: null");
  });

  it("worker cavab verməyəndə də xəta atılır", async () => {
    replyWith(undefined);
    const e = await send(Message.stop()).catch((err) => err);
    expect(e.message).toBe("service worker cavab vermədi");
  });

  it("uğurlu cavab olduğu kimi qaytarılır", async () => {
    replyWith({ ok: true });
    expect(await send(Message.stop())).toStrictEqual({ ok: true });
  });
});
