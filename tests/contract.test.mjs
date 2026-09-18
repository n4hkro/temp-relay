// Provider kontraktının testləri: createRegistry, acquireMode və validate* funksiyaları.
// Bu modul extension-ın "yeni sayt əlavə etmək" yolunu qoruyur — səhv deskriptor
// səssizcə işləməməlidir.
// İşlətmək: npm test
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { AcquireMode, acquireMode, createRegistry, supportsInbox, validateRelay, validateTempMail } from "../src/providers/contract.js";
import { FieldType } from "../src/shared/options.js";

// createRegistry uğursuz deskriptorları console.error-e yazır; testdə səs-küy yaratmasın
const quietly = (fn) => {
  const original = console.error;
  console.error = () => {};
  try { return fn(); } finally { console.error = original; }
};

const build = (descriptors, validate = validateTempMail) => quietly(() => createRegistry("test", descriptors, validate));

// Səhifə rejimi: skript saytın səhifəsinə köçürülür, tab açılır
const goodTemp = {
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
  newAddress: async ({ values, config }) => ({ address: "user@" + values.domain, wait: values.wait, timeoutMs: config?.timeoutMs }),
};

// API rejimi: sorğu worker-dən gedir, tab açılmır
const goodApi = {
  id: "api.example",
  name: "api.example",
  url: "https://api.example/",
  hosts: ["api.example"],
  fetchAddress: async ({ values, signal }) => "user@" + (values?.domain ?? "api.example") + (signal ? "" : ""),
};

const goodRelay = {
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
    assert.deepEqual(registry.problems, []);
    assert.deepEqual(registry.ids(), ["mail.example"]);
    assert.equal(registry.has("mail.example"), true);
    assert.equal(registry.get("mail.example").name, "mail.example");
    assert.equal(registry.all().length, 1);
  });

  it("deskriptoru dondurur (sonradan dəyişdirmək olmur)", () => {
    const registry = build([goodTemp]);
    assert.throws(() => { "use strict"; registry.get("mail.example").url = "https://evil.example"; }, TypeError);
  });

  it("naməlum id üçün mövcud siyahını göstərən xəta atır", () => {
    const registry = build([goodTemp]);
    assert.throws(() => registry.get("yox.example"), /naməlum sayt "yox\.example".*mail\.example/);
  });

  it("təkrar id-ni qəbul etmir, birincini saxlayır", () => {
    const registry = build([goodTemp, { ...goodTemp, name: "ikinci" }]);
    assert.equal(registry.problems.length, 1);
    assert.match(registry.problems[0], /təkrarlanır/);
    assert.equal(registry.all().length, 1);
    assert.equal(registry.get("mail.example").name, "mail.example");
  });

  it("xarab provider digərini pozmur", () => {
    const registry = build([{ id: "x" }, goodTemp, goodApi]);
    assert.equal(registry.problems.length, 1);
    assert.equal(registry.has("mail.example"), true);
    assert.equal(registry.has("api.example"), true);
  });

  it("boş reyestr də qurulur (problem siyahısı boşdur)", () => {
    const registry = build([]);
    assert.deepEqual(registry.problems, []);
    assert.deepEqual(registry.all(), []);
  });
});

describe("acquireMode", () => {
  it("fetchAddress varsa API rejimi seçilir (tab açılmır)", () => {
    assert.equal(acquireMode(goodApi), AcquireMode.api);
  });

  it("newAddress varsa səhifə rejimi seçilir", () => {
    assert.equal(acquireMode(goodTemp), AcquireMode.page);
  });

  it("heç biri yoxdursa kontrakt belə deskriptoru qəbul etmir", () => {
    const { newAddress, ...rest } = goodTemp;
    assert.equal(build([rest]).all().length, 0);
  });
});

describe("validateTempMail — ümumi sahələr", () => {
  const rejected = (patch, pattern, label) => {
    it(label, () => {
      const registry = build([{ ...goodTemp, ...patch }]);
      assert.equal(registry.problems.length, 1);
      assert.match(registry.problems[0], pattern);
      assert.equal(registry.all().length, 0);
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
    assert.match(registry.problems[0], /fetchAddress \(API\), ya da newAddress \(səhifə\)/);
  });

  it("hər iki rejim bir yerdə ola bilməz (hansı işləyəcək birmənalı deyil)", () => {
    const registry = build([{ ...goodTemp, fetchAddress: goodApi.fetchAddress }]);
    assert.match(registry.problems[0], /bir rejim seçin/);
    assert.equal(registry.all().length, 0);
  });

  it("newAddress funksiya deyilsə qəbul edilmir", () => {
    const registry = build([{ ...goodTemp, newAddress: null }]);
    assert.match(registry.problems[0], /newAddress funksiya olmalıdır/);
  });

  it("fetchAddress funksiya deyilsə qəbul edilmir", () => {
    const registry = build([{ ...goodApi, fetchAddress: "sətir" }]);
    assert.match(registry.problems[0], /fetchAddress funksiya olmalıdır/);
  });

  it("API rejimi qəbul olunur, pageConfig tələb olunmur", () => {
    assert.deepEqual(build([goodApi]).problems, []);
  });

  it("pageConfig verilərsə obyekt olmalıdır", () => {
    const registry = build([{ ...goodTemp, pageConfig: "timeoutMs=5" }]);
    assert.match(registry.problems[0], /pageConfig obyekt olmalıdır/);
  });

  it("fetchAddress chrome.* işlədə bilməz (provider node-da test olunmalıdır)", () => {
    const registry = build([{ ...goodApi, fetchAddress: async () => chrome.storage.session.get() }]);
    assert.match(registry.problems[0], /chrome\.\*\/browser\.\* işlədə bilməz/);
  });
});

describe("validateTempMail — səhifə skriptinin serializasiyası", () => {
  it("chrome.* işlədən page skripti qəbul edilmir", () => {
    const registry = build([{ ...goodTemp, newAddress: async () => ({ address: chrome.runtime.id }) }]);
    assert.equal(registry.all().length, 0);
    assert.match(registry.problems[0], /chrome\.\*\/browser\.\* işlədə bilməz/);
  });

  it("import() işlədən page skripti qəbul edilmir", () => {
    const registry = build([{ ...goodTemp, newAddress: async () => ({ address: (await import("./x.js")).default }) }]);
    assert.match(registry.problems[0], /heç nə idxal edə bilməz/);
  });

  it("metod qısa yazılışı (serializasiyada sınan) qəbul edilmir", () => {
    const holder = { async newAddress() { return {}; } };
    const registry = build([{ ...goodTemp, newAddress: holder.newAddress }]);
    assert.equal(registry.all().length, 0);
    assert.match(registry.problems[0], /arrow\/function ifadəsi/);
  });

  it("adi function ifadəsi qəbul olunur", () => {
    const registry = build([{ ...goodTemp, newAddress: function ({ values }) { return { address: values.domain }; } }]);
    assert.deepEqual(registry.problems, []);
  });
});

describe("validateTempMail — seçim sxemi", () => {
  it("options olmadan da qəbul olunur (seçimsiz sayt)", () => {
    const { options, ...rest } = goodTemp;
    assert.deepEqual(build([rest]).problems, []);
  });

  it("options obyekt olmalıdır", () => {
    const registry = build([{ ...goodTemp, options: "sətir" }]);
    assert.match(registry.problems[0], /options obyekt olmalıdır/);
  });

  it("schema massiv olmalıdır", () => {
    const registry = build([{ ...goodTemp, options: { defaults: {} } }]);
    assert.match(registry.problems[0], /options\.schema massiv olmalıdır/);
  });

  it("səhv sxem provider-i reyestrdən çıxarır (xəta sahənin yolunu da göstərir)", () => {
    const registry = build([{
      ...goodTemp,
      options: {
        schema: [{ key: "domain", label: "Domen", type: FieldType.choice, choices: [{ value: "a", label: "A" }] }],
        defaults: { domain: "b" },
      },
    }]);
    assert.match(registry.problems[0], /options\.schema\.domain default "b" choices içində deyil/);
    assert.equal(registry.all().length, 0);
  });

  it("defaults-da sxemdə olmayan açar qəbul edilmir", () => {
    const registry = build([{
      ...goodTemp,
      options: {
        schema: [{ key: "wait", label: "Gözlə", type: FieldType.toggle }],
        defaults: { wait: true, artiq: 1 },
      },
    }]);
    assert.match(registry.problems[0], /sxemdə olmayan açar: "artiq"/);
  });

  it("options.validate verilərsə funksiya olmalıdır", () => {
    const registry = build([{ ...goodTemp, options: { ...goodTemp.options, validate: "yox" } }]);
    assert.match(registry.problems[0], /options\.validate funksiya olmalıdır/);
  });

  it("flags sahəsi üçün min seçimlərin sayından böyük ola bilməz", () => {
    const registry = build([{
      ...goodTemp,
      options: {
        schema: [{ key: "p", label: "P", type: FieldType.flags, choices: [{ value: "a", label: "A" }], min: 2 }],
        defaults: { p: { a: true } },
      },
    }]);
    assert.match(registry.problems[0], /options\.schema\.p\.min/);
  });

  it("təkrarlanan açar qəbul edilmir", () => {
    const field = { key: "wait", label: "Gözlə", type: FieldType.toggle };
    const registry = build([{ ...goodTemp, options: { schema: [field, field], defaults: { wait: true } } }]);
    assert.match(registry.problems[0], /təkrarlanan açar: "wait"/);
  });
});

describe("validateRelay", () => {
  const buildRelay = (descriptors) => build(descriptors, validateRelay);

  it("düzgün relay deskriptorunu qəbul edir", () => {
    assert.deepEqual(buildRelay([goodRelay]).problems, []);
  });

  it("cleanup olmadan qəbul etmir", () => {
    const { cleanup, ...rest } = goodRelay;
    const registry = buildRelay([rest]);
    assert.match(registry.problems[0], /cleanup obyekti olmalıdır/);
  });

  it("storageOrigins origin formatında olmalıdır (yol olmaz)", () => {
    const registry = buildRelay([{ ...goodRelay, cleanup: { ...goodRelay.cleanup, storageOrigins: ["https://relay.example/register"] } }]);
    assert.match(registry.problems[0], /origin formatında/);
  });

  it("partitionTopLevelSites istəyə bağlıdır, verilərsə origin olmalıdır", () => {
    const { partitionTopLevelSites, ...cleanup } = goodRelay.cleanup;
    assert.deepEqual(buildRelay([{ ...goodRelay, cleanup }]).problems, []);
    const registry = buildRelay([{ ...goodRelay, cleanup: { ...cleanup, partitionTopLevelSites: ["relay.example"] } }]);
    assert.match(registry.problems[0], /partitionTopLevelSites origin formatında/);
  });

  it("cookieDomains boş ola bilməz", () => {
    const registry = buildRelay([{ ...goodRelay, cleanup: { ...goodRelay.cleanup, cookieDomains: [] } }]);
    assert.match(registry.problems[0], /cookieDomains/);
  });
});

describe("validateTempMail — poçt qutusu (fetchMessages)", () => {
  it("fetchMessages olmadan da qəbul olunur (imkan istəyə bağlıdır)", () => {
    assert.deepEqual(build([goodTemp]).problems, []);
    assert.equal(supportsInbox(goodTemp), false);
  });

  it("fetchMessages varsa supportsInbox true qaytarır", () => {
    const provider = { ...goodApi, fetchMessages: async () => [] };
    assert.deepEqual(build([provider]).problems, []);
    assert.equal(supportsInbox(provider), true);
  });

  it("funksiya olmayan fetchMessages qəbul edilmir", () => {
    const registry = build([{ ...goodApi, fetchMessages: "/api/check" }]);
    assert.match(registry.problems[0], /fetchMessages funksiya olmalıdır/);
  });

  it("chrome.* işlədən fetchMessages qəbul edilmir (node-da test oluna bilməz)", () => {
    const registry = build([{ ...goodApi, fetchMessages: async () => chrome.storage.session.get() }]);
    assert.match(registry.problems[0], /chrome\.\*\/browser\.\* işlədə bilməz/);
  });

  it("səhifə rejimindəki sayta da fetchMessages əlavə oluna bilər (rejim dəyişmir)", () => {
    const provider = { ...goodTemp, fetchMessages: async () => [] };
    assert.deepEqual(build([provider]).problems, []);
    assert.equal(acquireMode(provider), AcquireMode.page);
    assert.equal(supportsInbox(provider), true);
  });
});

describe("validateRelay — poçt ipuçları (mail)", () => {
  const buildRelay = (descriptors) => build(descriptors, validateRelay);
  const patched = (mail) => buildRelay([{ ...goodRelay, mail }]);

  it("mail olmadan qəbul olunur — ipuçları url və name-dən törədilir", () => {
    assert.deepEqual(buildRelay([goodRelay]).problems, []);
  });

  it("düzgün mail qəbul olunur", () => {
    assert.deepEqual(patched({ fromDomains: ["nexora.example"], keywords: ["Nexora"] }).problems, []);
  });

  it("mail obyekt olmalıdır", () => {
    assert.match(patched("nexora.example").problems[0], /mail obyekt olmalıdır/);
  });

  it("boş mail obyekti qəbul edilmir (sahəni silmək daha aydındır)", () => {
    assert.match(patched({}).problems[0], /boş ola bilməz/);
  });

  it("naməlum açar qəbul edilmir, icazəli siyahı göstərilir", () => {
    assert.match(patched({ domains: ["a.com"] }).problems[0], /naməlum açar var: "domains"/);
  });

  it("fromDomains origin yox, host adları olmalıdır", () => {
    assert.match(patched({ fromDomains: ["https://nexora.example"] }).problems[0], /mail\.fromDomains host adları/);
  });

  it("keywords sətir massivi olmalıdır", () => {
    assert.match(patched({ keywords: ["a", ""] }).problems[0], /mail\.keywords sətir massivi/);
  });
});


// requestOrigin — sayt yalnız öz origin-i ilə gələn sorğuları qəbul edirsə (emailnator).
// Worker-in fetch-i `Origin: chrome-extension://<id>` göndərir; başlıq declarativeNetRequest
// ilə əvəzlənir, ona görə dəyər saytın ÖZ origin-i olmalıdır — başqa saytın adından
// sorğu göndərməyə imkan verməməlidir.
describe("requestOrigin — Origin başlığının əvəzlənməsi", () => {
  const problems = (patch, descriptor = goodApi, validate = validateTempMail) =>
    build([{ ...descriptor, ...patch }], validate).problems;

  it("yazılmaya bilər (əksər saytlarda lazım deyil)", () => {
    assert.deepEqual(problems({}), []);
  });

  it("saytın öz origin-i qəbul olunur", () => {
    assert.deepEqual(problems({ requestOrigin: "https://api.example" }), []);
  });

  it("alt-domen də olar (www kimi)", () => {
    assert.deepEqual(problems({ requestOrigin: "https://www.api.example" }), []);
  });

  it("relay deskriptorunda da işləyir", () => {
    assert.deepEqual(problems({ requestOrigin: "https://relay.example" }, goodRelay, validateRelay), []);
  });

  it("origin formatında olmalıdır — yol olmaz", () => {
    assert.match(problems({ requestOrigin: "https://api.example/api" })[0], /requestOrigin origin formatında/);
  });

  it("http qəbul olunmur", () => {
    assert.match(problems({ requestOrigin: "http://api.example" })[0], /requestOrigin origin formatında/);
  });

  it("sətir olmalıdır", () => {
    assert.match(problems({ requestOrigin: 5 })[0], /requestOrigin origin formatında/);
  });

  it("hosts siyahısında olmayan host rədd olunur", () => {
    assert.match(problems({ requestOrigin: "https://evil.example" })[0], /hosts siyahısında əhatə olunmayıb/);
  });

  it("üçüncü tərəf hostun origin-i də rədd olunur (saytın özü olmalıdır)", () => {
    assert.match(
      problems({ requestOrigin: "https://challenges.cloudflare.com" }, goodRelay, validateRelay)[0],
      /saytın öz origin-i olmalıdır/,
    );
  });
});



// signup — relay saytında qeydiyyat addımları (background/signup.js onları icra edir).
// Yazılmasa kod yalnız clipboard-a düşür və formanı istifadəçi özü doldurur.
describe("relay signup — qeydiyyat addımları", () => {
  const patched = (signup) => build([{ ...goodRelay, signup }], validateRelay).problems;
  const steps = { afterCode: [{ fill: "#code", value: "code" }] };

  it("yazılmaya bilər (sahə istəyə bağlıdır)", () => {
    assert.deepEqual(build([goodRelay], validateRelay).problems, []);
  });

  it("düzgün addımlar qəbul olunur", () => {
    assert.deepEqual(patched({
      password: { length: 16 },
      afterAddress: [{ click: 'button[aria-label="Continue with email"]' }, { fill: "#email", value: "address" }, { click: "button", text: "Send code", enabled: true }],
      afterCode: [{ fill: "#code", value: "code" }, { fill: "#pass", value: "password" }, { click: '[type="submit"]', enabled: true, timeoutMs: 15000 }],
    }), []);
  });

  it("obyekt olmalıdır", () => {
    assert.match(patched([{ click: "#a" }])[0], /signup obyekt olmalıdır/);
  });

  it("naməlum açar rədd olunur", () => {
    assert.match(patched({ ...steps, afterLogin: [] })[0], /signup içində naməlum açar var: "afterLogin"/);
  });

  it("boş obyekt rədd olunur (lazım deyilsə sahə silinməlidir)", () => {
    assert.match(patched({})[0], /signup boş ola bilməz/);
  });

  it("faza massiv olmalı və boş olmamalıdır", () => {
    assert.match(patched({ afterCode: [] })[0], /afterCode ən azı bir addımı olan massiv/);
    assert.match(patched({ afterCode: "#code" })[0], /afterCode ən azı bir addımı olan massiv/);
  });

  it("addım ya click, ya fill, ya waitValue daşımalıdır — yalnız biri", () => {
    assert.match(patched({ afterCode: [{ text: "Göndər" }] })[0], /ya click, ya fill, ya waitValue/);
    assert.match(patched({ afterCode: [{ click: "#a", fill: "#b", value: "code" }] })[0], /yalnız biri; hazırda: click, fill/);
    assert.match(patched({ afterCode: [{ waitValue: "#ts", click: "#a" }] })[0], /yalnız biri/);
  });

  it("waitValue addımı qəbul olunur (Turnstile token-i)", () => {
    assert.deepEqual(patched({ afterAddress: [{ waitValue: 'input[name="cf-turnstile-response"]', timeoutMs: 25000 }] }), []);
  });

  it("waitValue-da value və enabled olmaz", () => {
    assert.match(patched({ afterCode: [{ waitValue: "#ts", value: "code" }] })[0], /value yalnız fill addımında olur/);
    assert.match(patched({ afterCode: [{ waitValue: "#ts", enabled: true }] })[0], /enabled yalnız click addımında olur/);
  });

  it("selektor boş olmayan sətir olmalıdır", () => {
    assert.match(patched({ afterCode: [{ click: "" }] })[0], /\.click boş olmayan CSS selektoru/);
    assert.match(patched({ afterCode: [{ fill: 5, value: "code" }] })[0], /\.fill boş olmayan CSS selektoru/);
  });

  it("fill addımının value adı icazəli siyahıdan olmalıdır", () => {
    assert.match(patched({ afterCode: [{ fill: "#code" }] })[0], /value address \| username \| code \| password olmalıdır/);
    assert.match(patched({ afterCode: [{ fill: "#code", value: "email" }] })[0], /value address \| username \| code \| password olmalıdır/);
  });

  it("click addımında value olmaz", () => {
    assert.match(patched({ afterCode: [{ click: "#go", value: "code" }] })[0], /value yalnız fill addımında olur/);
  });

  it("afterAddress fazasında code dəyəri ola bilməz (kod hələ gəlməyib)", () => {
    assert.match(patched({ afterAddress: [{ fill: "#code", value: "code" }] })[0], /code dəyəri ola bilməz/);
  });

  it("enabled yalnız true ola bilər (gözləmə deməkdir)", () => {
    assert.match(patched({ afterCode: [{ click: "#go", enabled: false }] })[0], /enabled yalnız true ola bilər/);
  });

  it("text boş olmayan sətir olmalıdır", () => {
    assert.match(patched({ afterCode: [{ click: "button", text: "" }] })[0], /\.text boş olmayan sətir/);
  });

  it("timeoutMs worker limitindən böyük ola bilməz", () => {
    assert.match(patched({ afterCode: [{ click: "#go", timeoutMs: 60000 }] })[0], /1 ilə 25000 arasında/);
    assert.match(patched({ afterCode: [{ click: "#go", timeoutMs: 0 }] })[0], /1 ilə 25000 arasında/);
  });

  it("password obyektdir və uzunluğu məhduddur", () => {
    assert.match(patched({ ...steps, password: 16 })[0], /password obyekt olmalıdır/);
    assert.match(patched({ ...steps, password: { length: 4 } })[0], /8 ilə 64 arasında/);
    assert.match(patched({ ...steps, password: { length: 128 } })[0], /8 ilə 64 arasında/);
    assert.deepEqual(patched({ ...steps, password: {} }), []);
  });

  it("xəta mesajı addımın nömrəsini göstərir", () => {
    assert.match(patched({ afterCode: [{ fill: "#a", value: "code" }, { click: 5 }] })[0], /afterCode\[1\]/);
  });
});
