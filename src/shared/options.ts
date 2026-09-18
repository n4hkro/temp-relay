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
} as const);
export type FieldTypeValue = (typeof FieldType)[keyof typeof FieldType];

export interface FieldChoice {
  value: string;
  label: string;
}

export interface OptionField {
  key: string;
  label: string;
  type: FieldTypeValue;
  hint?: string;
  choices?: FieldChoice[];
  min?: number;
}

// Bir sahənin dəyəri: flags → { [choice]: boolean }, toggle → boolean, choice → sətir
export type OptionValue = Record<string, boolean> | boolean | string;
export type OptionValues = Record<string, OptionValue>;

export interface ProviderOptions {
  schema: OptionField[];
  defaults: OptionValues;
  validate?: (values: OptionValues) => string | null;
}

// options qatını işlədən provider-in minimal forması (deskriptorun qalanı burada bilinmir)
export interface OptionsProvider {
  options?: ProviderOptions;
}

const isNonEmptyString = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";
const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function require(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

// --- sxem yoxlaması --------------------------------------------------------------------
// contract.ts bunu import anında çağırır: səhv sxem reyestrə düşmür, səbəb console-a yazılır.

function validateChoices(field: OptionField, path: (suffix: string) => string): void {
  require(Array.isArray(field.choices) && field.choices.length > 0, path(".choices") + " boş olmayan massiv olmalıdır");
  const seen = new Set<string>();
  for (const c of field.choices) {
    require(isPlainObject(c) && isNonEmptyString(c.value) && isNonEmptyString(c.label),
      path(".choices") + ' hər elementi { value, label } olmalıdır');
    require(!seen.has(c.value), path(".choices") + ` təkrarlanan dəyər: "${c.value}"`);
    seen.add(c.value);
  }
}

// `at` — xəta mesajının əvvəlinə yazılan yol ("temp-mail: \"temp.tf\" → options")
export function validateSchema(
  schema: OptionField[],
  defaults: OptionValues,
  at: (suffix: string) => string,
): void {
  require(Array.isArray(schema), at(".schema") + " massiv olmalıdır");
  require(isPlainObject(defaults), at(".defaults") + " obyekt olmalıdır");

  const keys = new Set<string>();
  for (const field of schema) {
    require(isPlainObject(field), at(".schema") + " hər elementi obyekt olmalıdır");
    const path = (suffix: string): string => `${at(".schema")}.${field?.key ?? "?"}${suffix}`;
    require(isNonEmptyString(field.key), at(".schema") + ".key boş olmayan sətir olmalıdır");
    require(!keys.has(field.key), at(".schema") + ` təkrarlanan açar: "${field.key}"`);
    keys.add(field.key);
    require(isNonEmptyString(field.label), path(".label") + " boş olmayan sətir olmalıdır");
    require(Object.values(FieldType).includes(field.type as FieldTypeValue), path(".type") + ` flags | toggle | choice olmalıdır`);
    if (field.hint !== undefined) require(isNonEmptyString(field.hint), path(".hint") + " sətir olmalıdır");

    if (field.type === FieldType.flags || field.type === FieldType.choice) validateChoices(field, path);
    if (field.type === FieldType.flags && field.min !== undefined) {
      require(Number.isInteger(field.min) && field.min >= 0 && field.min <= (field.choices ?? []).length,
        path(".min") + " 0 ilə choices sayı arasında tam ədəd olmalıdır");
    }

    // default dəyər sxemin tələb etdiyi formada olmalıdır — əks halda popup boş görünər
    require(field.key in defaults, path("") + " üçün defaults dəyəri yoxdur");
    const value = defaults[field.key];
    if (field.type === FieldType.flags) {
      require(isPlainObject(value), path("") + " default dəyəri obyekt olmalıdır");
      for (const c of field.choices ?? []) require(typeof value[c.value] === "boolean", path("") + ` default "${c.value}" boolean olmalıdır`);
      for (const key of Object.keys(value)) require((field.choices ?? []).some((c) => c.value === key), path("") + ` default-da sxemdə olmayan açar var: "${key}"`);
    } else if (field.type === FieldType.toggle) {
      require(typeof value === "boolean", path("") + " default dəyəri boolean olmalıdır");
    } else {
      require((field.choices ?? []).some((c) => c.value === value), path("") + ` default "${value}" choices içində deyil`);
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

function coerce(field: OptionField, stored: unknown, fallback: OptionValue): OptionValue {
  if (field.type === FieldType.flags) {
    const out: Record<string, boolean> = {};
    const fallbackFlags = fallback as Record<string, unknown>;
    const storedFlags = isPlainObject(stored) ? stored : {};
    for (const c of field.choices!) {
      const value = c.value in storedFlags ? storedFlags[c.value] : fallbackFlags[c.value];
      out[c.value] = value === true;
    }
    return out;
  }
  if (field.type === FieldType.toggle) return stored === true || stored === false ? stored : fallback;
  return field.choices!.some((c) => c.value === stored) ? (stored as string) : fallback;
}

export function resolveValues(
  provider: OptionsProvider | null | undefined,
  stored: unknown,
): OptionValues {
  const schema = provider?.options?.schema ?? [];
  const defaults = provider?.options?.defaults ?? {};
  const source = isPlainObject(stored) ? stored : {};
  const values: OptionValues = {};
  for (const field of schema) values[field.key] = coerce(field, source[field.key], defaults[field.key]);
  return values;
}

// --- yoxlama ----------------------------------------------------------------------------
// Xəta mətni (istifadəçiyə göstərilir) və ya null. Əvvəl sxemin öz qaydaları, sonra
// provider-in sayt xüsusi qaydaları (options.validate) — məs. "dot yalnız Gmail ilə".

export function validateValues(
  provider: OptionsProvider | null | undefined,
  values: OptionValues | null | undefined,
): string | null {
  for (const field of provider?.options?.schema ?? []) {
    const value = values?.[field.key];
    if (field.type === FieldType.flags && field.min) {
      const chosen = field.choices!.filter(
        (c) => (value as Record<string, unknown> | null | undefined)?.[c.value] === true,
      ).length;
      if (chosen < field.min) return `${field.label}: ən azı ${field.min} seçim işarələnməlidir`;
    }
    if (field.type === FieldType.choice && !field.choices!.some((c) => c.value === value)) {
      return `${field.label}: "${value ?? ""}" etibarlı seçim deyil`;
    }
  }
  return provider?.options?.validate?.(values as OptionValues) ?? null;
}

export const hasOptions = (provider: OptionsProvider | null | undefined): boolean =>
  (provider?.options?.schema ?? []).length > 0;

// --- son seçimin yaddaşı ----------------------------------------------------------------
// choice = { tempId, relayId, options: { [tempId]: values } }. Hər saytın parametrləri ayrı
// saxlanılır: istifadəçi temp.tf-də Gmail seçib başqa sayta keçəndə ora öz default-ları ilə
// açılır, geri qayıdanda isə Gmail yenə işarəli olur.

export interface Choice {
  tempId?: string;
  relayId?: string;
  options?: Record<string, OptionValues>;
}

// Saxlancdan gələn dəyərlər (yoxdursa null → resolveValues default-ları işlədəcək)
export function storedValues(
  choice: Choice | null | undefined,
  tempId: string,
): OptionValues | null {
  const all = choice?.options;
  return isPlainObject(all) && isPlainObject(all[tempId]) ? (all[tempId] as OptionValues) : null;
}

// choice-a bu saytın dəyərlərini yazan YENİ obyekt qaytarır (saxlancdakı köhnəsinə toxunmur)
export function rememberValues(
  choice: Choice | null | undefined,
  tempId: string,
  values: OptionValues,
): Choice {
  const prev: Choice = isPlainObject(choice) ? choice : {};
  const all: Record<string, OptionValues> = isPlainObject(prev.options) ? prev.options : {};
  return { ...prev, options: { ...all, [tempId]: values } };
}
