// Seçim (options) qatı — provider-in popup-da göstərilən parametrləri.
//
// Hər saytın imkanları fərqlidir (biri yalnız domeni seçməyə verir, biri dot/plus sintaksisini,
// biri heç nə). Ona görə parametrlər kodla deyil, SXEMLƏ təsvir olunur: popup sxemi oxuyub
// formanı özü qurur, worker isə eyni sxemlə dəyərləri normallaşdırıb yoxlayır. Yeni sayt
// əlavə olunanda popup-a heç nə yazılmır.
//
// Bu fayl `chrome`-a toxunmur: həm extension, həm node (testlər, tools/check.mjs) import edir.

export const FieldType = Object.freeze({
  flags: "flags",     // çoxlu seçim — { [choice]: boolean }
  toggle: "toggle",   // tək açar — boolean
  choice: "choice",   // tək seçim — sətir (choices içindən)
});

const isNonEmptyString = (v) => typeof v === "string" && v.trim() !== "";
const isPlainObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);

function require(condition, message) {
  if (!condition) throw new Error(message);
}

// --- sxem yoxlaması --------------------------------------------------------------------
// contract.js bunu import anında çağırır: səhv sxem reyestrə düşmür, səbəb console-a yazılır.

function validateChoices(field, path) {
  require(Array.isArray(field.choices) && field.choices.length > 0, path(".choices") + " boş olmayan massiv olmalıdır");
  const seen = new Set();
  for (const c of field.choices) {
    require(isPlainObject(c) && isNonEmptyString(c.value) && isNonEmptyString(c.label),
      path(".choices") + ' hər elementi { value, label } olmalıdır');
    require(!seen.has(c.value), path(".choices") + ` təkrarlanan dəyər: "${c.value}"`);
    seen.add(c.value);
  }
}

// `at` — xəta mesajının əvvəlinə yazılan yol ("temp-mail: \"temp.tf\" → options")
export function validateSchema(schema, defaults, at) {
  require(Array.isArray(schema), at(".schema") + " massiv olmalıdır");
  require(isPlainObject(defaults), at(".defaults") + " obyekt olmalıdır");

  const keys = new Set();
  for (const field of schema) {
    require(isPlainObject(field), at(".schema") + " hər elementi obyekt olmalıdır");
    const path = (suffix) => `${at(".schema")}.${field?.key ?? "?"}${suffix}`;
    require(isNonEmptyString(field.key), at(".schema") + ".key boş olmayan sətir olmalıdır");
    require(!keys.has(field.key), at(".schema") + ` təkrarlanan açar: "${field.key}"`);
    keys.add(field.key);
    require(isNonEmptyString(field.label), path(".label") + " boş olmayan sətir olmalıdır");
    require(Object.values(FieldType).includes(field.type), path(".type") + ` flags | toggle | choice olmalıdır`);
    if (field.hint !== undefined) require(isNonEmptyString(field.hint), path(".hint") + " sətir olmalıdır");

    if (field.type === FieldType.flags || field.type === FieldType.choice) validateChoices(field, path);
    if (field.type === FieldType.flags && field.min !== undefined) {
      require(Number.isInteger(field.min) && field.min >= 0 && field.min <= field.choices.length,
        path(".min") + " 0 ilə choices sayı arasında tam ədəd olmalıdır");
    }

    // default dəyər sxemin tələb etdiyi formada olmalıdır — əks halda popup boş görünər
    require(field.key in defaults, path("") + " üçün defaults dəyəri yoxdur");
    const value = defaults[field.key];
    if (field.type === FieldType.flags) {
      require(isPlainObject(value), path("") + " default dəyəri obyekt olmalıdır");
      for (const c of field.choices) require(typeof value[c.value] === "boolean", path("") + ` default "${c.value}" boolean olmalıdır`);
      for (const key of Object.keys(value)) require(field.choices.some((c) => c.value === key), path("") + ` default-da sxemdə olmayan açar var: "${key}"`);
    } else if (field.type === FieldType.toggle) {
      require(typeof value === "boolean", path("") + " default dəyəri boolean olmalıdır");
    } else {
      require(field.choices.some((c) => c.value === value), path("") + ` default "${value}" choices içində deyil`);
    }
  }

  for (const key of Object.keys(defaults)) {
    require(keys.has(key), at(".defaults") + ` sxemdə olmayan açar: "${key}"`);
  }
}

// --- dəyərlərin normallaşdırılması -----------------------------------------------------
// Saxlancdan (və ya mesajdan) gələn dəyər nə olursa olsun, sxemə uyğun təmiz forma qaytarır:
// naməlum açarlar atılır, çatışmayanlar default ilə doldurulur, tip pozuntusu default-a düşür.
// Buna görə worker popup-dan gələnə kor-koranə etibar etmir.

function coerce(field, stored, fallback) {
  if (field.type === FieldType.flags) {
    const out = {};
    for (const c of field.choices) {
      const value = isPlainObject(stored) && c.value in stored ? stored[c.value] : fallback[c.value];
      out[c.value] = value === true;
    }
    return out;
  }
  if (field.type === FieldType.toggle) return stored === true || stored === false ? stored : fallback;
  return field.choices.some((c) => c.value === stored) ? stored : fallback;
}

export function resolveValues(provider, stored) {
  const schema = provider?.options?.schema ?? [];
  const defaults = provider?.options?.defaults ?? {};
  const source = isPlainObject(stored) ? stored : {};
  const values = {};
  for (const field of schema) values[field.key] = coerce(field, source[field.key], defaults[field.key]);
  return values;
}

// --- yoxlama ----------------------------------------------------------------------------
// Xəta mətni (istifadəçiyə göstərilir) və ya null. Əvvəl sxemin öz qaydaları, sonra
// provider-in sayt xüsusi qaydaları (options.validate) — məs. "dot yalnız Gmail ilə".

export function validateValues(provider, values) {
  for (const field of provider?.options?.schema ?? []) {
    const value = values?.[field.key];
    if (field.type === FieldType.flags && field.min) {
      const chosen = field.choices.filter((c) => value?.[c.value] === true).length;
      if (chosen < field.min) return `${field.label}: ən azı ${field.min} seçim işarələnməlidir`;
    }
    if (field.type === FieldType.choice && !field.choices.some((c) => c.value === value)) {
      return `${field.label}: "${value ?? ""}" etibarlı seçim deyil`;
    }
  }
  return provider?.options?.validate?.(values) ?? null;
}

export const hasOptions = (provider) => (provider?.options?.schema ?? []).length > 0;

// --- son seçimin yaddaşı ----------------------------------------------------------------
// choice = { tempId, relayId, options: { [tempId]: values } }. Hər saytın parametrləri ayrı
// saxlanılır: istifadəçi temp.tf-də Gmail seçib başqa sayta keçəndə ora öz default-ları ilə
// açılır, geri qayıdanda isə Gmail yenə işarəli olur.

// Saxlancdan gələn dəyərlər (yoxdursa null → resolveValues default-ları işlədəcək)
export function storedValues(choice, tempId) {
  const all = choice?.options;
  return isPlainObject(all) && isPlainObject(all[tempId]) ? all[tempId] : null;
}

// choice-a bu saytın dəyərlərini yazan YENİ obyekt qaytarır (saxlancdakı köhnəsinə toxunmur)
export function rememberValues(choice, tempId, values) {
  const prev = isPlainObject(choice) ? choice : {};
  const all = isPlainObject(prev.options) ? prev.options : {};
  return { ...prev, options: { ...all, [tempId]: values } };
}
