// Provider kontraktının testləri: createRegistry, acquireMode və validate* funksiyaları.
// Bu modul extension-ın "yeni sayt əlavə etmək" yolunu qoruyur — səhv deskriptor
// səssizcə işləməməlidir.
// İşlətmək: npm test
import { describe, expect, it } from "vitest";

import { AcquireMode, acquireMode, createRegistry, supportsInbox, validateRelay, validateTempMail } from "../src/providers/contract";
import type { FetchAddressArgs, PageAddressArgs, Registry, SiteRelayDescriptor, TempMailDescriptor } from "../src/providers/contract";
import { FieldType } from "../src/shared/options";

// createRegistry uğursuz deskriptorları console.error-e yazır; testdə səs-küy yaratmasın
const quietly = <T>(fn: () => T): T => {
  const original = console.error;
  console.error = () => {};
  try { return fn(); } finally { console.error = original; }
};

// Testlər qəsdən pozulmuş deskriptorlar ötürür (tip sistemi yox, validate* yoxlayır),
// ona görə giriş unknown-dur; çıxış qeydlərə rahat əlçatanlıq üçün boş reyestrdir.
const build = (
  descriptors: readonly unknown[],
  validate: (d: unknown) => void = validateTempMail,
): Registry<Record<string, unknown>> =>
  quietly(() => createRegistry<Record<string, unknown>>("test", descriptors, validate));

// Səhifə rejimi: skript saytın səhifəsinə köçürülür, tab açılır
const goodTemp: TempMailDescriptor = {
  id: "mail.example",
  name: "mail.example",
  url: "https://mail.example/inbox",
  hosts: ["mail.example"],
  options: {
    schema: [
      { key: "domain", label: "Domen", type: FieldType.choice, choices: [{ value: "a.example", label: "a.example" }, { value: "b.example", label: "b.example" }] },
      { key: "wait", label: "Gözlə", type: FieldType.toggle },
    ],
    defaults: { domain: "a.example", wait: true },
  },
  pageConfig: { timeoutMs: 1000 },
  newAddress: async ({ values, config }: PageAddressArgs) => ({ address: `user@${String(values.domain)}`, wait: values.wait, timeoutMs: config?.timeoutMs }),
};

// API rejimi: sorğu worker-dən gedir, tab açılmır
const goodApi: TempMailDescriptor = {
  id: "api.example",
  name: "api.example",
  url: "https://api.example/",
  hosts: ["api.example"],
  fetchAddress: async ({ values, signal }: FetchAddressArgs) => `user@${String(values.domain ?? "api.example")}${signal ? "" : ""}`,
};

const goodRelay: SiteRelayDescriptor = {
  id: "relay.example",
  name: "relay.example",
  url: "https://relay.example/register",
  hosts: ["relay.example", "challenges.cloudflare.com"],
  cleanup: {
    cookieDomains: ["relay.example"],
    storageOrigins: ["https://relay.example"],
    partitionTopLevelSites: ["https://relay.example"],
  },
};

describe("createRegistry", () => {
  it("düzgün deskriptoru qeydə alır", () => {
    const registry = build([goodTemp]);
    expect(registry.problems).toStrictEqual([]);
    expect(registry.ids()).toStrictEqual(["mail.example"]);
    expect(registry.has("mail.example")).toBe(true);
    expect(registry.get("mail.example").name).toBe("mail.example");
    expect(registry.all().length).toBe(1);
  });

  it("deskriptoru dondurur (sonradan dəyişdirmək olmur)", () => {
    const registry = build([goodTemp]);
    expect(() => { "use strict"; registry.get("mail.example").url = "https://evil.example"; }).toThrow(TypeError);
  });

  it("naməlum id üçün mövcud siyahını göstərən xəta atır", () => {
    const registry = build([goodTemp]);
    expect(() => registry.get("yox.example")).toThrow(/naməlum sayt "yox\.example".*mail\.example/);
  });

  it("təkrar id-ni qəbul etmir, birincini saxlayır", () => {
    const registry = build([goodTemp, { ...goodTemp, name: "ikinci" }]);
    expect(registry.problems.length).toBe(1);
    expect(registry.problems[0]).toMatch(/təkrarlanır/);
    expect(registry.all().length).toBe(1);
    expect(registry.get("mail.example").name).toBe("mail.example");
  });

  it("xarab provider digərini pozmur", () => {
    const registry = build([{ id: "x" }, goodTemp, goodApi]);
    expect(registry.problems.length).toBe(1);
    expect(registry.has("mail.example")).toBe(true);
    expect(registry.has("api.example")).toBe(true);
  });

  it("boş reyestr də qurulur (problem siyahısı boşdur)", () => {
    const registry = build([]);
    expect(registry.problems).toStrictEqual([]);
    expect(registry.all()).toStrictEqual([]);
  });
});

describe("acquireMode", () => {
  it("fetchAddress varsa API rejimi seçilir (tab açılmır)", () => {
    expect(acquireMode(goodApi)).toBe(AcquireMode.api);
  });

  it("newAddress varsa səhifə rejimi seçilir", () => {
    expect(acquireMode(goodTemp)).toBe(AcquireMode.page);
  });

  it("heç biri yoxdursa kontrakt belə deskriptoru qəbul etmir", () => {
    const { newAddress, ...rest } = goodTemp;
    expect(build([rest]).all().length).toBe(0);
  });
});

describe("validateTempMail — ümumi sahələr", () => {
  const rejected = (patch: Record<string, unknown>, pattern: RegExp, label: string) => {
    it(label, () => {
      const registry = build([{ ...goodTemp, ...patch }]);
      expect(registry.problems.length).toBe(1);
      expect(registry.problems[0]).toMatch(pattern);
      expect(registry.all().length).toBe(0);
    });
  };

  rejected({ url: "http://mail.example/" }, /https:\/\/ ilə başlamalıdır/, "http url qəbul edilmir");
  rejected({ url: "https://other.example/" }, /hostunu .* əhatə etmir/, "hosts url-in hostunu əhatə etməlidir");
  rejected({ hosts: [] }, /ən azı bir host/, "boş hosts qəbul edilmir");
  rejected({ hosts: ["mail.example", "mail.example"] }, /təkrarlanan host/, "təkrarlanan host qəbul edilmir");
  rejected({ name: "" }, /boş olmayan sətir/, "boş ad qəbul edilmir");
});

describe("validateTempMail — rejim seçimi", () => {
  it("heç bir rejim funksiyası yoxdursa qəbul edilmir", () => {
    const { newAddress, ...rest } = goodTemp;
    const registry = build([rest]);
    expect(registry.problems[0]).toMatch(/fetchAddress \(API\), ya da newAddress \(səhifə\)/);
  });

  it("hər iki rejim bir yerdə ola bilməz (hansı işləyəcək birmənalı deyil)", () => {
    const registry = build([{ ...goodTemp, fetchAddress: goodApi.fetchAddress }]);
    expect(registry.problems[0]).toMatch(/bir rejim seçin/);
    expect(registry.all().length).toBe(0);
  });

  it("newAddress funksiya deyilsə qəbul edilmir", () => {
    const registry = build([{ ...goodTemp, newAddress: null }]);
    expect(registry.problems[0]).toMatch(/newAddress funksiya olmalıdır/);
  });

  it("fetchAddress funksiya deyilsə qəbul edilmir", () => {
    const registry = build([{ ...goodApi, fetchAddress: "sətir" }]);
    expect(registry.problems[0]).toMatch(/fetchAddress funksiya olmalıdır/);
  });

  it("API rejimi qəbul olunur, pageConfig tələb olunmur", () => {
    expect(build([goodApi]).problems).toStrictEqual([]);
  });

  it("pageConfig verilərsə obyekt olmalıdır", () => {
    const registry = build([{ ...goodTemp, pageConfig: "timeoutMs=5" }]);
    expect(registry.problems[0]).toMatch(/pageConfig obyekt olmalıdır/);
  });

  it("fetchAddress chrome.* işlədə bilməz (provider node-da test olunmalıdır)", () => {
    const registry = build([{ ...goodApi, fetchAddress: async () => (globalThis as unknown as { chrome: { storage: { session: { get: () => Promise<unknown> } } } }).chrome.storage.session.get() }]);
    expect(registry.problems[0]).toMatch(/chrome\.\*\/browser\.\* işlədə bilməz/);
  });
});

describe("validateTempMail — səhifə skriptinin serializasiyası", () => {
  it("chrome.* işlədən page skripti qəbul edilmir", () => {
    const registry = build([{ ...goodTemp, newAddress: async (): Promise<{ address: string }> => ({ address: (globalThis as unknown as { chrome: { runtime: { id: string } } }).chrome.runtime.id }) }]);
    expect(registry.all().length).toBe(0);
    expect(registry.problems[0]).toMatch(/chrome\.\*\/browser\.\* işlədə bilməz/);
  });

  it("import() işlədən page skripti qəbul edilmir", () => {
    // new Function ilə: vite `import()`-u mənbədə `__vite_ssr_dynamic_import__`-a
    // çevirir, amma yoxlama funksiyanın mətnində `import(` axtarır.
    const newAddress: unknown = new Function(`return async () => ({ address: (await import("./x.js")).default })`)();
    const registry = build([{ ...goodTemp, newAddress }]);
    expect(registry.problems[0]).toMatch(/heç nə idxal edə bilməz/);
  });

  it("metod qısa yazılışı (serializasiyada sınan) qəbul edilmir", () => {
    const holder = { async newAddress(): Promise<Record<string, unknown>> { return {}; } };
    const registry = build([{ ...goodTemp, newAddress: holder.newAddress }]);
    expect(registry.all().length).toBe(0);
    expect(registry.problems[0]).toMatch(/arrow\/function ifadəsi/);
  });

  it("adi function ifadəsi qəbul olunur", () => {
    const registry = build([{ ...goodTemp, newAddress: function ({ values }: PageAddressArgs): { address: string } { return { address: String(values.domain) }; } }]);
    expect(registry.problems).toStrictEqual([]);
  });
});

describe("validateTempMail — seçim sxemi", () => {
  it("options olmadan da qəbul olunur (seçimsiz sayt)", () => {
    const { options, ...rest } = goodTemp;
    expect(build([rest]).problems).toStrictEqual([]);
  });

  it("options obyekt olmalıdır", () => {
    const registry = build([{ ...goodTemp, options: "sətir" }]);
    expect(registry.problems[0]).toMatch(/options obyekt olmalıdır/);
  });

  it("schema massiv olmalıdır", () => {
    const registry = build([{ ...goodTemp, options: { defaults: {} } }]);
    expect(registry.problems[0]).toMatch(/options\.schema massiv olmalıdır/);
  });

  it("səhv sxem provider-i reyestrdən çıxarır (xəta sahənin yolunu da göstərir)", () => {
    const registry = build([{
      ...goodTemp,
      options: {
        schema: [{ key: "domain", label: "Domen", type: FieldType.choice, choices: [{ value: "a", label: "A" }] }],
        defaults: { domain: "b" },
      },
    }]);
    expect(registry.problems[0]).toMatch(/options\.schema\.domain default "b" choices içində deyil/);
    expect(registry.all().length).toBe(0);
  });

  it("defaults-da sxemdə olmayan açar qəbul edilmir", () => {
    const registry = build([{
      ...goodTemp,
      options: {
        schema: [{ key: "wait", label: "Gözlə", type: FieldType.toggle }],
        defaults: { wait: true, artiq: 1 },
      },
    }]);
    expect(registry.problems[0]).toMatch(/sxemdə olmayan açar: "artiq"/);
  });

  it("options.validate verilərsə funksiya olmalıdır", () => {
    const registry = build([{ ...goodTemp, options: { ...goodTemp.options, validate: "yox" } }]);
    expect(registry.problems[0]).toMatch(/options\.validate funksiya olmalıdır/);
  });

  it("flags sahəsi üçün min seçimlərin sayından böyük ola bilməz", () => {
    const registry = build([{
      ...goodTemp,
      options: {
        schema: [{ key: "p", label: "P", type: FieldType.flags, choices: [{ value: "a", label: "A" }], min: 2 }],
        defaults: { p: { a: true } },
      },
    }]);
    expect(registry.problems[0]).toMatch(/options\.schema\.p\.min/);
  });

  it("təkrarlanan açar qəbul edilmir", () => {
    const field = { key: "wait", label: "Gözlə", type: FieldType.toggle };
    const registry = build([{ ...goodTemp, options: { schema: [field, field], defaults: { wait: true } } }]);
    expect(registry.problems[0]).toMatch(/təkrarlanan açar: "wait"/);
  });
});

describe("validateRelay", () => {
  const buildRelay = (descriptors: readonly unknown[]) => build(descriptors, validateRelay);

  it("düzgün relay deskriptorunu qəbul edir", () => {
    expect(buildRelay([goodRelay]).problems).toStrictEqual([]);
  });

  it("cleanup olmadan qəbul etmir", () => {
    const { cleanup, ...rest } = goodRelay;
    const registry = buildRelay([rest]);
    expect(registry.problems[0]).toMatch(/cleanup obyekti olmalıdır/);
  });

  it("storageOrigins origin formatında olmalıdır (yol olmaz)", () => {
    const registry = buildRelay([{ ...goodRelay, cleanup: { ...goodRelay.cleanup, storageOrigins: ["https://relay.example/register"] } }]);
    expect(registry.problems[0]).toMatch(/origin formatında/);
  });

  it("partitionTopLevelSites istəyə bağlıdır, verilərsə origin olmalıdır", () => {
    const { partitionTopLevelSites, ...cleanup } = goodRelay.cleanup;
    expect(buildRelay([{ ...goodRelay, cleanup }]).problems).toStrictEqual([]);
    const registry = buildRelay([{ ...goodRelay, cleanup: { ...cleanup, partitionTopLevelSites: ["relay.example"] } }]);
    expect(registry.problems[0]).toMatch(/partitionTopLevelSites origin formatında/);
  });

  it("cookieDomains boş ola bilməz", () => {
    const registry = buildRelay([{ ...goodRelay, cleanup: { ...goodRelay.cleanup, cookieDomains: [] } }]);
    expect(registry.problems[0]).toMatch(/cookieDomains/);
  });
});

describe("validateTempMail — poçt qutusu (fetchMessages)", () => {
  it("fetchMessages olmadan da qəbul olunur (imkan istəyə bağlıdır)", () => {
    expect(build([goodTemp]).problems).toStrictEqual([]);
    expect(supportsInbox(goodTemp)).toBe(false);
  });

  it("fetchMessages varsa supportsInbox true qaytarır", () => {
    const provider: TempMailDescriptor = { ...goodApi, fetchMessages: async () => [] };
    expect(build([provider]).problems).toStrictEqual([]);
    expect(supportsInbox(provider)).toBe(true);
  });

  it("funksiya olmayan fetchMessages qəbul edilmir", () => {
    const registry = build([{ ...goodApi, fetchMessages: "/api/check" }]);
    expect(registry.problems[0]).toMatch(/fetchMessages funksiya olmalıdır/);
  });

  it("chrome.* işlədən fetchMessages qəbul edilmir (node-da test oluna bilməz)", () => {
    const registry = build([{ ...goodApi, fetchMessages: async () => (globalThis as unknown as { chrome: { storage: { session: { get: () => Promise<unknown> } } } }).chrome.storage.session.get() }]);
    expect(registry.problems[0]).toMatch(/chrome\.\*\/browser\.\* işlədə bilməz/);
  });

  it("səhifə rejimindəki sayta da fetchMessages əlavə oluna bilər (rejim dəyişmir)", () => {
    const provider: TempMailDescriptor = { ...goodTemp, fetchMessages: async () => [] };
    expect(build([provider]).problems).toStrictEqual([]);
    expect(acquireMode(provider)).toBe(AcquireMode.page);
    expect(supportsInbox(provider)).toBe(true);
  });
});

describe("validateRelay — poçt ipuçları (mail)", () => {
  const buildRelay = (descriptors: readonly unknown[]) => build(descriptors, validateRelay);
  const patched = (mail: unknown) => buildRelay([{ ...goodRelay, mail }]);

  it("mail olmadan qəbul olunur — ipuçları url və name-dən törədilir", () => {
    expect(buildRelay([goodRelay]).problems).toStrictEqual([]);
  });

  it("düzgün mail qəbul olunur", () => {
    expect(patched({ fromDomains: ["nexora.example"], keywords: ["Nexora"] }).problems).toStrictEqual([]);
  });

  it("mail obyekt olmalıdır", () => {
    expect(patched("nexora.example").problems[0]).toMatch(/mail obyekt olmalıdır/);
  });

  it("boş mail obyekti qəbul edilmir (sahəni silmək daha aydındır)", () => {
    expect(patched({}).problems[0]).toMatch(/boş ola bilməz/);
  });

  it("naməlum açar qəbul edilmir, icazəli siyahı göstərilir", () => {
    expect(patched({ domains: ["a.com"] }).problems[0]).toMatch(/naməlum açar var: "domains"/);
  });

  it("fromDomains origin yox, host adları olmalıdır", () => {
    expect(patched({ fromDomains: ["https://nexora.example"] }).problems[0]).toMatch(/mail\.fromDomains host adları/);
  });

  it("keywords sətir massivi olmalıdır", () => {
    expect(patched({ keywords: ["a", ""] }).problems[0]).toMatch(/mail\.keywords sətir massivi/);
  });
});


// requestOrigin — sayt yalnız öz origin-i ilə gələn sorğuları qəbul edirsə (emailnator).
// Worker-in fetch-i `Origin: chrome-extension://<id>` göndərir; başlıq declarativeNetRequest
// ilə əvəzlənir, ona görə dəyər saytın ÖZ origin-i olmalıdır — başqa saytın adından
// sorğu göndərməyə imkan verməməlidir.
describe("requestOrigin — Origin başlığının əvəzlənməsi", () => {
  const problems = (
    patch: Record<string, unknown>,
    descriptor: unknown = goodApi,
    validate: (d: unknown) => void = validateTempMail,
  ) =>
    build([{ ...(descriptor as Record<string, unknown>), ...patch }], validate).problems;

  it("yazılmaya bilər (əksər saytlarda lazım deyil)", () => {
    expect(problems({})).toStrictEqual([]);
  });

  it("saytın öz origin-i qəbul olunur", () => {
    expect(problems({ requestOrigin: "https://api.example" })).toStrictEqual([]);
  });

  it("alt-domen də olar (www kimi)", () => {
    expect(problems({ requestOrigin: "https://www.api.example" })).toStrictEqual([]);
  });

  it("relay deskriptorunda da işləyir", () => {
    expect(problems({ requestOrigin: "https://relay.example" }, goodRelay, validateRelay)).toStrictEqual([]);
  });

  it("origin formatında olmalıdır — yol olmaz", () => {
    expect(problems({ requestOrigin: "https://api.example/api" })[0]).toMatch(/requestOrigin origin formatında/);
  });

  it("http qəbul olunmur", () => {
    expect(problems({ requestOrigin: "http://api.example" })[0]).toMatch(/requestOrigin origin formatında/);
  });

  it("sətir olmalıdır", () => {
    expect(problems({ requestOrigin: 5 })[0]).toMatch(/requestOrigin origin formatında/);
  });

  it("hosts siyahısında olmayan host rədd olunur", () => {
    expect(problems({ requestOrigin: "https://evil.example" })[0]).toMatch(/hosts siyahısında əhatə olunmayıb/);
  });

  it("üçüncü tərəf hostun origin-i də rədd olunur (saytın özü olmalıdır)", () => {
    expect(problems({ requestOrigin: "https://challenges.cloudflare.com" }, goodRelay, validateRelay)[0], ).toMatch(/saytın öz origin-i olmalıdır/);
  });
});



// signup — relay saytında qeydiyyat addımları (background/signup.ts onları icra edir).
// Yazılmasa kod yalnız clipboard-a düşür və formanı istifadəçi özü doldurur.
describe("relay signup — qeydiyyat addımları", () => {
  const patched = (signup: unknown) => build([{ ...goodRelay, signup }], validateRelay).problems;
  const steps = { afterCode: [{ fill: "#code", value: "code" }] };

  it("yazılmaya bilər (sahə istəyə bağlıdır)", () => {
    expect(build([goodRelay], validateRelay).problems).toStrictEqual([]);
  });

  it("düzgün addımlar qəbul olunur", () => {
    expect(patched({
      password: { length: 16 },
      afterAddress: [{ click: 'button[aria-label="Continue with email"]' }, { fill: "#email", value: "address" }, { click: "button", text: "Send code", enabled: true }],
      afterCode: [{ fill: "#code", value: "code" }, { fill: "#pass", value: "password" }, { click: '[type="submit"]', enabled: true, timeoutMs: 15000 }],
    })).toStrictEqual([]);
  });

  it("obyekt olmalıdır", () => {
    expect(patched([{ click: "#a" }])[0]).toMatch(/signup obyekt olmalıdır/);
  });

  it("naməlum açar rədd olunur", () => {
    expect(patched({ ...steps, afterLogin: [] })[0]).toMatch(/signup içində naməlum açar var: "afterLogin"/);
  });

  it("boş obyekt rədd olunur (lazım deyilsə sahə silinməlidir)", () => {
    expect(patched({})[0]).toMatch(/signup boş ola bilməz/);
  });

  it("faza massiv olmalı və boş olmamalıdır", () => {
    expect(patched({ afterCode: [] })[0]).toMatch(/afterCode ən azı bir addımı olan massiv/);
    expect(patched({ afterCode: "#code" })[0]).toMatch(/afterCode ən azı bir addımı olan massiv/);
  });

  it("addım ya click, ya fill, ya waitValue daşımalıdır — yalnız biri", () => {
    expect(patched({ afterCode: [{ text: "Göndər" }] })[0]).toMatch(/ya click, ya fill, ya waitValue/);
    expect(patched({ afterCode: [{ click: "#a", fill: "#b", value: "code" }] })[0]).toMatch(/yalnız biri; hazırda: click, fill/);
    expect(patched({ afterCode: [{ waitValue: "#ts", click: "#a" }] })[0]).toMatch(/yalnız biri/);
  });

  it("waitValue addımı qəbul olunur (Turnstile token-i)", () => {
    expect(patched({ afterAddress: [{ waitValue: 'input[name="cf-turnstile-response"]', timeoutMs: 25000 }] })).toStrictEqual([]);
  });

  it("waitValue-da value və enabled olmaz", () => {
    expect(patched({ afterCode: [{ waitValue: "#ts", value: "code" }] })[0]).toMatch(/value yalnız fill addımında olur/);
    expect(patched({ afterCode: [{ waitValue: "#ts", enabled: true }] })[0]).toMatch(/enabled yalnız click addımında olur/);
  });

  it("selektor boş olmayan sətir olmalıdır", () => {
    expect(patched({ afterCode: [{ click: "" }] })[0]).toMatch(/\.click boş olmayan CSS selektoru/);
    expect(patched({ afterCode: [{ fill: 5, value: "code" }] })[0]).toMatch(/\.fill boş olmayan CSS selektoru/);
  });

  it("fill addımının value adı icazəli siyahıdan olmalıdır", () => {
    expect(patched({ afterCode: [{ fill: "#code" }] })[0]).toMatch(/value address \| username \| code \| password olmalıdır/);
    expect(patched({ afterCode: [{ fill: "#code", value: "email" }] })[0]).toMatch(/value address \| username \| code \| password olmalıdır/);
  });

  it("click addımında value olmaz", () => {
    expect(patched({ afterCode: [{ click: "#go", value: "code" }] })[0]).toMatch(/value yalnız fill addımında olur/);
  });

  it("afterAddress fazasında code dəyəri ola bilməz (kod hələ gəlməyib)", () => {
    expect(patched({ afterAddress: [{ fill: "#code", value: "code" }] })[0]).toMatch(/code dəyəri ola bilməz/);
  });

  it("enabled yalnız true ola bilər (gözləmə deməkdir)", () => {
    expect(patched({ afterCode: [{ click: "#go", enabled: false }] })[0]).toMatch(/enabled yalnız true ola bilər/);
  });

  it("text boş olmayan sətir olmalıdır", () => {
    expect(patched({ afterCode: [{ click: "button", text: "" }] })[0]).toMatch(/\.text boş olmayan sətir/);
  });

  it("timeoutMs worker limitindən böyük ola bilməz", () => {
    expect(patched({ afterCode: [{ click: "#go", timeoutMs: 60000 }] })[0]).toMatch(/1 ilə 25000 arasında/);
    expect(patched({ afterCode: [{ click: "#go", timeoutMs: 0 }] })[0]).toMatch(/1 ilə 25000 arasında/);
  });

  it("password obyektdir və uzunluğu məhduddur", () => {
    expect(patched({ ...steps, password: 16 })[0]).toMatch(/password obyekt olmalıdır/);
    expect(patched({ ...steps, password: { length: 4 } })[0]).toMatch(/8 ilə 64 arasında/);
    expect(patched({ ...steps, password: { length: 128 } })[0]).toMatch(/8 ilə 64 arasında/);
    expect(patched({ ...steps, password: {} })).toStrictEqual([]);
  });

  it("xəta mesajı addımın nömrəsini göstərir", () => {
    expect(patched({ afterCode: [{ fill: "#a", value: "code" }, { click: 5 }] })[0]).toMatch(/afterCode\[1\]/);
  });
});
