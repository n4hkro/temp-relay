// Seçim (options) qatının testləri: sxem yoxlaması, dəyərlərin normallaşdırılması,
// istifadəçiyə göstərilən xəta mətnləri və "son seçim" yaddaşı.
//
// Bu qat popup ilə worker-in ORTAQ dilidir. Səhv sxem popup-ı boş göstərər, səhv
// normallaşdırma isə worker-ə göndərilən mesajdan provider-ə çirkli dəyər keçirər —
// ona görə hər iki istiqamət burada bağlanır.
import { describe, expect, it } from "vitest";

import { FieldType, hasOptions, rememberValues, resolveValues, storedValues, validateSchema, validateValues } from "../src/shared/options";
import type { OptionsProvider } from "../src/shared/options";

const at = (suffix: any) => "test" + suffix;

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
const site = (patch = {}) : any => ({ id: "test", name: "test", options: { schema, defaults, ...patch } });
// Seçimsiz provider-lər: yalnız OptionsProvider-in tanıdığı forma yazılır
// (id/name kimi kənar açarlar qata aid deyil)
const sadeProvider: OptionsProvider = { options: undefined };
const emptyProvider: OptionsProvider = { options: { schema: [], defaults: {} } };
const badSchema = (s: any, d: any = defaults) => {
  try { validateSchema(s, d, at); return null; } catch (e) { return (e as Error).message; }
};

describe("validateSchema", () => {
  it("düzgün sxemi qəbul edir", () => {
    expect(badSchema(schema)).toBe(null);
  });

  it("schema massiv, defaults obyekt olmalıdır", () => {
    expect(badSchema(null)).toMatch(/test\.schema massiv olmalıdır/);
    expect(badSchema(schema, null)).toMatch(/test\.defaults obyekt olmalıdır/);
  });

  it("açar, ad və tip məcburidir", () => {
    expect(badSchema([{ ...domain, key: "" }])).toMatch(/schema\.key boş olmayan sətir/);
    expect(badSchema([{ ...domain, label: " " }])).toMatch(/schema\.domain\.label boş olmayan sətir/);
    expect(badSchema([{ ...domain, type: "siyahı" }])).toMatch(/schema\.domain\.type/);
  });

  it("hint istəyə bağlıdır, verilərsə sətir olmalıdır", () => {
    expect(badSchema([{ ...wait, hint: undefined }], { wait: true })).toBe(null);
    expect(badSchema([{ ...wait, hint: 5 }], { wait: true })).toMatch(/schema\.wait\.hint sətir olmalıdır/);
  });

  it("təkrarlanan açar qəbul edilmir", () => {
    expect(badSchema([wait, { ...wait }], { wait: true })).toMatch(/təkrarlanan açar: "wait"/);
  });

  it("flags və choice üçün choices məcburidir, elementləri { value, label } olmalıdır", () => {
    expect(badSchema([{ key: "d", label: "D", type: FieldType.choice }], { d: "a" })).toMatch(/schema\.d\.choices boş olmayan massiv/);
    expect(badSchema([{ ...domain, choices: [{ value: "a", label: "A" }, { value: "a", label: "B" }] }], { domain: "a" })).toMatch(/təkrarlanan dəyər: "a"/);
    expect(badSchema([{ ...domain, choices: [{ value: "a" }] }], { domain: "a" })).toMatch(/hər elementi/);
  });

  it("toggle üçün choices tələb olunmur", () => {
    expect(badSchema([wait], { wait: false })).toBe(null);
  });

  it("min 0 ilə choices sayı arasında tam ədəd olmalıdır", () => {
    expect(badSchema([{ ...boxes, min: 3 }], { boxes: { x: true, y: false } })).toMatch(/schema\.boxes\.min/);
    expect(badSchema([{ ...boxes, min: 1.5 }], { boxes: { x: true, y: false } })).toMatch(/schema\.boxes\.min/);
    expect(badSchema([{ ...boxes, min: 2 }], { boxes: { x: true, y: false } })).toBe(null);
    expect(badSchema([{ ...boxes, min: 0 }], { boxes: { x: true, y: false } })).toBe(null);
  });

  it("hər sahə üçün default lazımdır və tipi düzgün olmalıdır", () => {
    expect(badSchema(schema, { domain: "a.example", boxes: { x: true, y: false } })).toMatch(/schema\.wait üçün defaults dəyəri yoxdur/);
    expect(badSchema(schema, { ...defaults, wait: "bəli" })).toMatch(/schema\.wait default dəyəri boolean olmalıdır/);
    expect(badSchema(schema, { ...defaults, boxes: { x: "bəli", y: false } })).toMatch(/default "x" boolean olmalıdır/);
    expect(badSchema(schema, { ...defaults, boxes: { x: true } })).toMatch(/default "y" boolean olmalıdır/);
    expect(badSchema(schema, { ...defaults, domain: "c.example" })).toMatch(/default "c\.example" choices içində deyil/);
  });

  it("default-da sxemdə olmayan açar qəbul edilmir (həm sahədə, həm kök səviyyədə)", () => {
    expect(badSchema(schema, { ...defaults, boxes: { x: true, y: false, z: true } })).toMatch(/sxemdə olmayan açar var: "z"/);
    expect(badSchema(schema, { ...defaults, artiq: 1 })).toMatch(/test\.defaults sxemdə olmayan açar: "artiq"/);
  });
});

describe("resolveValues — dəyərlərin normallaşdırılması", () => {
  const provider = site();

  it("heç nə verilməyibsə default-ları qaytarır", () => {
    expect(resolveValues(provider, null)).toStrictEqual(defaults);
    expect(resolveValues(provider, undefined)).toStrictEqual(defaults);
    expect(resolveValues(provider, "sətir")).toStrictEqual(defaults);
  });

  it("saxlanılan dəyərlər default-dan üstündür", () => {
    expect(resolveValues(provider, { domain: "b.example", boxes: { x: false, y: true }, wait: false })).toStrictEqual({ domain: "b.example", boxes: { x: false, y: true }, wait: false });
  });

  it("naməlum açarlar atılır (köhnə versiyadan qalan zibil provider-ə keçmir)", () => {
    const resolved = resolveValues(provider, { ...defaults, artiq: "x", boxes: { x: true, y: false, z: true } });
    expect(Object.keys(resolved).sort()).toStrictEqual(["boxes", "domain", "wait"]);
    expect(resolved.boxes).toStrictEqual({ x: true, y: false });
  });

  it("çatışmayan sahə default ilə doldurulur", () => {
    expect(resolveValues(provider, { domain: "b.example" })).toStrictEqual({ domain: "b.example", boxes: { x: true, y: false }, wait: true });
  });

  it("tip pozuntusu default-a düşür (worker mesajdan gələnə etibar etmir)", () => {
    expect(resolveValues(provider, { domain: "yox.example", wait: "bəli", boxes: "hamısı" })).toStrictEqual(defaults);
  });

  it("flags-da dəyər yalnız true olduqda işarəli sayılır", () => {
    expect(resolveValues(provider, { boxes: { x: 1, y: "bəli" } }).boxes).toStrictEqual({ x: false, y: false });
  });

  it("seçimsiz provider üçün boş obyekt qaytarır", () => {
    expect(resolveValues(sadeProvider, { domain: "a.example" })).toStrictEqual({});
  });
});

describe("validateValues — istifadəçiyə göstərilən xəta mətni", () => {
  it("düzgün dəyərlər üçün null", () => {
    expect(validateValues(site(), defaults)).toBe(null);
  });

  it("flags min pozuntusu sahənin adını və tələbi göstərir", () => {
    expect(validateValues(site(), { ...defaults, boxes: { x: false, y: false } })).toBe("Qutular: ən azı 1 seçim işarələnməlidir");
  });

  it("choice üçün etibarsız dəyər göstərilir", () => {
    expect(validateValues(site(), { ...defaults, domain: "yox.example" })).toBe('Domen: "yox.example" etibarlı seçim deyil');
  });

  it("min:0 olduqda boş seçim də keçərlidir", () => {
    const provider = site({ schema: [{ ...boxes, min: 0 }] });
    expect(validateValues(provider, { boxes: { x: false, y: false } })).toBe(null);
  });

  it("provider-in öz qaydası sxem qaydalarından SONRA işə düşür", () => {
    const calls: any[] = [];
    const provider = site({ validate: (values: any) => { calls.push(values); return "sayt belə istəmir"; } });
    expect(validateValues(provider, { ...defaults, boxes: { x: false, y: false } })).toBe("Qutular: ən azı 1 seçim işarələnməlidir");
    expect(calls, "sxem qaydası pozulubsa provider funksiyası çağrılmamalıdır").toStrictEqual([]);
    expect(validateValues(provider, defaults)).toBe("sayt belə istəmir");
    expect(calls.length).toBe(1);
  });

  it("options.validate null qaytarsa xəta yoxdur", () => {
    expect(validateValues(site({ validate: () => null }), defaults)).toBe(null);
  });

  it("seçimsiz provider həmişə keçərlidir", () => {
    expect(validateValues(sadeProvider, {})).toBe(null);
  });
});

describe("hasOptions", () => {
  it("sxemi olan provider-də true, olmayanında false", () => {
    expect(hasOptions(site())).toBe(true);
    expect(hasOptions(sadeProvider)).toBe(false);
    expect(hasOptions(emptyProvider)).toBe(false);
    expect(hasOptions(null)).toBe(false);
  });
});

describe("storedValues / rememberValues — sayt başına ayrı saxlanan son seçim", () => {
  const gmail = { domain: "a.example", boxes: { x: true, y: false }, wait: true };
  const other = { domain: "b.example" };

  it("yaddaş boşdursa null qaytarır (resolveValues default-a düşəcək)", () => {
    expect(storedValues(null, "test")).toBe(null);
    expect(storedValues({}, "test")).toBe(null);
    expect(storedValues({ tempId: "test", relayId: "r" }, "test")).toBe(null);
    expect(storedValues({ options: { başqa: gmail } }, "test")).toBe(null);
    expect(storedValues({ options: "sətir" } as any, "test")).toBe(null);
  });

  it("rememberValues yalnız həmin saytı yazır, qalanını saxlayır", () => {
    const choice = { tempId: "test", relayId: "relay.example", options: { başqa: other } };
    const next = rememberValues(choice, "test", gmail);
    expect(next).toStrictEqual({ tempId: "test", relayId: "relay.example", options: { başqa: other, test: gmail } });
  });

  it("köhnə obyektə toxunmur (saxlancdakı nüsxə dəyişmir)", () => {
    const choice = { tempId: "test", options: { test: other } };
    const next = rememberValues(choice, "test", gmail);
    expect(choice.options.test).toStrictEqual(other);
    expect(next).not.toBe(choice);
    expect(next.options).not.toBe(choice.options);
  });

  it("boş və ya xarab choice-dan da düzgün obyekt qurur", () => {
    expect(rememberValues(null, "test", gmail)).toStrictEqual({ options: { test: gmail } });
    expect(rememberValues("sətir" as any, "test", gmail)).toStrictEqual({ options: { test: gmail } });
    expect(rememberValues({ tempId: "x", options: "sətir" } as any, "test", gmail)).toStrictEqual({ tempId: "x", options: { test: gmail } });
  });

  it("yazıb oxumaq dövrü: bir saytı dəyişmək digərinin seçimini pozmur", () => {
    let choice = rememberValues(null, "temp.tf", gmail);
    choice = rememberValues(choice, "başqa.site", other);
    choice = rememberValues(choice, "temp.tf", { ...gmail, wait: false });
    expect(storedValues(choice, "temp.tf")).toStrictEqual({ ...gmail, wait: false });
    expect(storedValues(choice, "başqa.site")).toStrictEqual(other);
  });
});
