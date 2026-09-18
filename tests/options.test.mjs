// Seçim (options) qatının testləri: sxem yoxlaması, dəyərlərin normallaşdırılması,
// istifadəçiyə göstərilən xəta mətnləri və "son seçim" yaddaşı.
//
// Bu qat popup ilə worker-in ORTAQ dilidir. Səhv sxem popup-ı boş göstərər, səhv
// normallaşdırma isə worker-ə göndərilən mesajdan provider-ə çirkli dəyər keçirər —
// ona görə hər iki istiqamət burada bağlanır.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { FieldType, hasOptions, rememberValues, resolveValues, storedValues, validateSchema, validateValues } from "../src/shared/options.js";

const at = (suffix) => "test" + suffix;

// Nümunə sayt: tək seçim + çoxlu seçim + tək açar
const domain = {
  key: "domain",
  label: "Domen",
  type: FieldType.choice,
  choices: [{ value: "a.example", label: "a.example" }, { value: "b.example", label: "b.example" }],
};
const boxes = {
  key: "boxes",
  label: "Qutular",
  type: FieldType.flags,
  choices: [{ value: "x", label: "X" }, { value: "y", label: "Y" }],
  min: 1,
};
const wait = { key: "wait", label: "Gözlə", type: FieldType.toggle, hint: "poçt gələnə qədər" };

const schema = [domain, boxes, wait];
const defaults = { domain: "a.example", boxes: { x: true, y: false }, wait: true };

// provider deskriptorunun yalnız options hissəsi lazımdır — qat dəyərləri oradan oxuyur
const site = (patch = {}) => ({ id: "test", name: "test", options: { schema, defaults, ...patch } });
const badSchema = (s, d = defaults) => {
  try { validateSchema(s, d, at); return null; } catch (e) { return e.message; }
};

describe("validateSchema", () => {
  it("düzgün sxemi qəbul edir", () => {
    assert.equal(badSchema(schema), null);
  });

  it("schema massiv, defaults obyekt olmalıdır", () => {
    assert.match(badSchema(null), /test\.schema massiv olmalıdır/);
    assert.match(badSchema(schema, null), /test\.defaults obyekt olmalıdır/);
  });

  it("açar, ad və tip məcburidir", () => {
    assert.match(badSchema([{ ...domain, key: "" }]), /schema\.key boş olmayan sətir/);
    assert.match(badSchema([{ ...domain, label: " " }]), /schema\.domain\.label boş olmayan sətir/);
    assert.match(badSchema([{ ...domain, type: "siyahı" }]), /schema\.domain\.type/);
  });

  it("hint istəyə bağlıdır, verilərsə sətir olmalıdır", () => {
    assert.equal(badSchema([{ ...wait, hint: undefined }], { wait: true }), null);
    assert.match(badSchema([{ ...wait, hint: 5 }], { wait: true }), /schema\.wait\.hint sətir olmalıdır/);
  });

  it("təkrarlanan açar qəbul edilmir", () => {
    assert.match(badSchema([wait, { ...wait }], { wait: true }), /təkrarlanan açar: "wait"/);
  });

  it("flags və choice üçün choices məcburidir, elementləri { value, label } olmalıdır", () => {
    assert.match(badSchema([{ key: "d", label: "D", type: FieldType.choice }], { d: "a" }), /schema\.d\.choices boş olmayan massiv/);
    assert.match(badSchema([{ ...domain, choices: [{ value: "a", label: "A" }, { value: "a", label: "B" }] }], { domain: "a" }), /təkrarlanan dəyər: "a"/);
    assert.match(badSchema([{ ...domain, choices: [{ value: "a" }] }], { domain: "a" }), /hər elementi/);
  });

  it("toggle üçün choices tələb olunmur", () => {
    assert.equal(badSchema([wait], { wait: false }), null);
  });

  it("min 0 ilə choices sayı arasında tam ədəd olmalıdır", () => {
    assert.match(badSchema([{ ...boxes, min: 3 }], { boxes: { x: true, y: false } }), /schema\.boxes\.min/);
    assert.match(badSchema([{ ...boxes, min: 1.5 }], { boxes: { x: true, y: false } }), /schema\.boxes\.min/);
    assert.equal(badSchema([{ ...boxes, min: 2 }], { boxes: { x: true, y: false } }), null);
    assert.equal(badSchema([{ ...boxes, min: 0 }], { boxes: { x: true, y: false } }), null);
  });

  it("hər sahə üçün default lazımdır və tipi düzgün olmalıdır", () => {
    assert.match(badSchema(schema, { domain: "a.example", boxes: { x: true, y: false } }), /schema\.wait üçün defaults dəyəri yoxdur/);
    assert.match(badSchema(schema, { ...defaults, wait: "bəli" }), /schema\.wait default dəyəri boolean olmalıdır/);
    assert.match(badSchema(schema, { ...defaults, boxes: { x: "bəli", y: false } }), /default "x" boolean olmalıdır/);
    assert.match(badSchema(schema, { ...defaults, boxes: { x: true } }), /default "y" boolean olmalıdır/);
    assert.match(badSchema(schema, { ...defaults, domain: "c.example" }), /default "c\.example" choices içində deyil/);
  });

  it("default-da sxemdə olmayan açar qəbul edilmir (həm sahədə, həm kök səviyyədə)", () => {
    assert.match(badSchema(schema, { ...defaults, boxes: { x: true, y: false, z: true } }), /sxemdə olmayan açar var: "z"/);
    assert.match(badSchema(schema, { ...defaults, artiq: 1 }), /test\.defaults sxemdə olmayan açar: "artiq"/);
  });
});

describe("resolveValues — dəyərlərin normallaşdırılması", () => {
  const provider = site();

  it("heç nə verilməyibsə default-ları qaytarır", () => {
    assert.deepEqual(resolveValues(provider, null), defaults);
    assert.deepEqual(resolveValues(provider, undefined), defaults);
    assert.deepEqual(resolveValues(provider, "sətir"), defaults);
  });

  it("saxlanılan dəyərlər default-dan üstündür", () => {
    assert.deepEqual(resolveValues(provider, { domain: "b.example", boxes: { x: false, y: true }, wait: false }),
      { domain: "b.example", boxes: { x: false, y: true }, wait: false });
  });

  it("naməlum açarlar atılır (köhnə versiyadan qalan zibil provider-ə keçmir)", () => {
    const resolved = resolveValues(provider, { ...defaults, artiq: "x", boxes: { x: true, y: false, z: true } });
    assert.deepEqual(Object.keys(resolved).sort(), ["boxes", "domain", "wait"]);
    assert.deepEqual(resolved.boxes, { x: true, y: false });
  });

  it("çatışmayan sahə default ilə doldurulur", () => {
    assert.deepEqual(resolveValues(provider, { domain: "b.example" }),
      { domain: "b.example", boxes: { x: true, y: false }, wait: true });
  });

  it("tip pozuntusu default-a düşür (worker mesajdan gələnə etibar etmir)", () => {
    assert.deepEqual(resolveValues(provider, { domain: "yox.example", wait: "bəli", boxes: "hamısı" }), defaults);
  });

  it("flags-da dəyər yalnız true olduqda işarəli sayılır", () => {
    assert.deepEqual(resolveValues(provider, { boxes: { x: 1, y: "bəli" } }).boxes, { x: false, y: false });
  });

  it("seçimsiz provider üçün boş obyekt qaytarır", () => {
    assert.deepEqual(resolveValues({ id: "sade", name: "sade" }, { domain: "a.example" }), {});
  });
});

describe("validateValues — istifadəçiyə göstərilən xəta mətni", () => {
  it("düzgün dəyərlər üçün null", () => {
    assert.equal(validateValues(site(), defaults), null);
  });

  it("flags min pozuntusu sahənin adını və tələbi göstərir", () => {
    assert.equal(validateValues(site(), { ...defaults, boxes: { x: false, y: false } }), "Qutular: ən azı 1 seçim işarələnməlidir");
  });

  it("choice üçün etibarsız dəyər göstərilir", () => {
    assert.equal(validateValues(site(), { ...defaults, domain: "yox.example" }), 'Domen: "yox.example" etibarlı seçim deyil');
  });

  it("min:0 olduqda boş seçim də keçərlidir", () => {
    const provider = site({ schema: [{ ...boxes, min: 0 }] });
    assert.equal(validateValues(provider, { boxes: { x: false, y: false } }), null);
  });

  it("provider-in öz qaydası sxem qaydalarından SONRA işə düşür", () => {
    const calls = [];
    const provider = site({ validate: (values) => { calls.push(values); return "sayt belə istəmir"; } });
    assert.equal(validateValues(provider, { ...defaults, boxes: { x: false, y: false } }), "Qutular: ən azı 1 seçim işarələnməlidir");
    assert.deepEqual(calls, [], "sxem qaydası pozulubsa provider funksiyası çağrılmamalıdır");
    assert.equal(validateValues(provider, defaults), "sayt belə istəmir");
    assert.equal(calls.length, 1);
  });

  it("options.validate null qaytarsa xəta yoxdur", () => {
    assert.equal(validateValues(site({ validate: () => null }), defaults), null);
  });

  it("seçimsiz provider həmişə keçərlidir", () => {
    assert.equal(validateValues({ id: "sade", name: "sade" }, {}), null);
  });
});

describe("hasOptions", () => {
  it("sxemi olan provider-də true, olmayanında false", () => {
    assert.equal(hasOptions(site()), true);
    assert.equal(hasOptions({ id: "sade", name: "sade" }), false);
    assert.equal(hasOptions({ id: "bos", name: "bos", options: { schema: [], defaults: {} } }), false);
    assert.equal(hasOptions(null), false);
  });
});

describe("storedValues / rememberValues — sayt başına ayrı saxlanan son seçim", () => {
  const gmail = { domain: "a.example", boxes: { x: true, y: false }, wait: true };
  const other = { domain: "b.example" };

  it("yaddaş boşdursa null qaytarır (resolveValues default-a düşəcək)", () => {
    assert.equal(storedValues(null, "test"), null);
    assert.equal(storedValues({}, "test"), null);
    assert.equal(storedValues({ tempId: "test", relayId: "r" }, "test"), null);
    assert.equal(storedValues({ options: { başqa: gmail } }, "test"), null);
    assert.equal(storedValues({ options: "sətir" }, "test"), null);
  });

  it("rememberValues yalnız həmin saytı yazır, qalanını saxlayır", () => {
    const choice = { tempId: "test", relayId: "relay.example", options: { başqa: other } };
    const next = rememberValues(choice, "test", gmail);
    assert.deepEqual(next, { tempId: "test", relayId: "relay.example", options: { başqa: other, test: gmail } });
  });

  it("köhnə obyektə toxunmur (saxlancdakı nüsxə dəyişmir)", () => {
    const choice = { tempId: "test", options: { test: other } };
    const next = rememberValues(choice, "test", gmail);
    assert.deepEqual(choice.options.test, other);
    assert.notEqual(next, choice);
    assert.notEqual(next.options, choice.options);
  });

  it("boş və ya xarab choice-dan da düzgün obyekt qurur", () => {
    assert.deepEqual(rememberValues(null, "test", gmail), { options: { test: gmail } });
    assert.deepEqual(rememberValues("sətir", "test", gmail), { options: { test: gmail } });
    assert.deepEqual(rememberValues({ tempId: "x", options: "sətir" }, "test", gmail), { tempId: "x", options: { test: gmail } });
  });

  it("yazıb oxumaq dövrü: bir saytı dəyişmək digərinin seçimini pozmur", () => {
    let choice = rememberValues(null, "temp.tf", gmail);
    choice = rememberValues(choice, "başqa.site", other);
    choice = rememberValues(choice, "temp.tf", { ...gmail, wait: false });
    assert.deepEqual(storedValues(choice, "temp.tf"), { ...gmail, wait: false });
    assert.deepEqual(storedValues(choice, "başqa.site"), other);
  });
});
