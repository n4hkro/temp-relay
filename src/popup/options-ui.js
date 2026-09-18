// Seçim forması — provider-in sxemindən AVTOMATİK qurulur.
//
// Popup heç bir saytı tanımır: provider.options.schema-nı oxuyub formanı özü qurur. Yeni sayt
// əlavə olunanda bu fayla və popup-a heç bir sətir yazılmır — deskriptor kifayətdir.
//
// Nəzarət elementləri:
//   flags  — bir neçə seçim işarələnə bilər (çip)
//   toggle — tək açar (çip)
//   choice — tək seçim, açılan siyahı
//
// Çip tipli sahələr (flags və toggle) EYNİ siyahıda düzülür: provider çipləri ilə dot/plus
// bir torda, eyni hizda dayanır. Toggle-ın izahı çipin öz xanasında, altında qalır.
// Sahə tipi dəyişəndə (flags → toggle) araya incə ayırıcı xətt düşür.
//
// read() sxemin tələb etdiyi formanı qaytarır: { [key]: boolean | { [choice]: boolean } | string }.
// Dəyərlər worker-də resolveValues ilə bir daha normallaşdırılır — popup etibarlı mənbə sayılmır.

import { FieldType } from "../shared/options.js";

// Kiçik DOM köməkçisi: className/textContent xassə kimi, qalanı atribut kimi yazılır
function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === "className") node.className = value;
    else if (key === "textContent") node.textContent = value;
    else node.setAttribute(key, value);
  }
  node.append(...children);
  return node;
}

// Sahənin çərçivəsi: başlıq (istəyə bağlı), nəzarət elementi və izah (choice sahəsi üçün)
function frame(label, control, hint) {
  const group = el("div", { className: "opt" });
  if (label) group.append(el("div", { className: "opt-label", textContent: label }));
  group.append(control);
  if (hint) group.append(el("div", { className: "opt-hint", textContent: hint }));
  return group;
}

// Çip: checkbox + yazı. "on" sinfi işarələnəndə əlavə olunur (:has() seçicisinə ehtiyac qalmır)
function chip(box, text, onChange) {
  const node = el("label", { className: "chip" }, [box, el("span", { textContent: text })]);
  const sync = () => node.classList.toggle("on", box.checked);
  sync();
  box.onchange = () => { sync(); onChange(); };
  return node;
}

// Çip siyahısındakı bir xana: çip və (varsa) izahı. Xana torun bir sütununu tutur, ona görə
// hündürlük fərqi (izahlı toggle) qonşu sütunun hizasını pozmur.
function cell(children) {
  return el("div", { className: "opt-cell" }, children);
}

function buildFlags(field, value, onChange, chipList) {
  const list = chipList(field);
  const boxes = new Map();
  // Başlıq toru bölən tam enli sətirdir: çiplər altındakı sütunlarda davam edir
  if (field.label) list.append(el("div", { className: "opt-label span", textContent: field.label }));
  for (const c of field.choices) {
    const box = el("input", { type: "checkbox" });
    box.checked = value?.[c.value] === true;
    boxes.set(c.value, box);
    list.append(cell([chip(box, c.label, onChange)]));
  }
  // Sahə izahı da tam enli sətirdir: xana izahları (toggle) ilə qarışmır
  if (field.hint) list.append(el("div", { className: "opt-hint span", textContent: field.hint }));
  const read = () => Object.fromEntries(field.choices.map((c) => [c.value, boxes.get(c.value).checked]));
  return { read };
}

// Toggle-da ayrıca başlıq yoxdur: çipin özü sahənin adını daşıyır (əks halda ad iki dəfə görünər)
function buildToggle(field, value, onChange, chipList) {
  const box = el("input", { type: "checkbox" });
  box.checked = value === true;
  const children = [chip(box, field.label, onChange)];
  if (field.hint) children.push(el("div", { className: "opt-hint", textContent: field.hint }));
  chipList(field).append(cell(children));
  return { read: () => box.checked };
}

function buildChoice(field, value, onChange) {
  const select = el("select");
  for (const c of field.choices) select.add(new Option(c.label, c.value));
  select.value = value;
  select.onchange = onChange;
  return { node: frame(field.label, select, field.hint), read: () => select.value };
}

const builders = {
  [FieldType.flags]: buildFlags,
  [FieldType.toggle]: buildToggle,
  [FieldType.choice]: buildChoice,
};

// Formanı container-ə qurur. Seçimsiz provider üçün container boşalır və heç nə göstərilmir.
// onChange — hər dəyişiklikdə çağrılır (popup son seçimi yadda saxlayır).
// Çip siyahısı tənbəl qurulur və sxemdəki yerində container-ə düşür: choice sahəsi çiplərdən
// əvvəldirsə əvvəl, sonradırsa sonra görünür; sırf choice sxemində boş tor yer tutmur.
export function renderOptions(container, provider, values, onChange) {
  container.textContent = "";
  const fields = provider?.options?.schema ?? [];
  if (!fields.length) return { read: () => ({}) };

  const readers = new Map();
  let list = null;
  let lastType = null;
  // Siyahı ortaqdır, amma sahə tipləri incə xətlə ayrılır: provider-lər ilə sintaksis
  // açarları (dot/plus) eyni hizda qalır, amma bir qrup kimi görünmür.
  const chipList = (field) => {
    if (!list) {
      list = el("div", { className: "chips" });
      container.append(list);
    }
    if (lastType && lastType !== field.type) list.append(el("div", { className: "opt-sep" }));
    lastType = field.type;
    return list;
  };
  for (const field of fields) {
    const built = builders[field.type](field, values?.[field.key], onChange, chipList);
    readers.set(field.key, built.read);
    if (built.node) container.append(built.node);
  }
  return { read: () => Object.fromEntries([...readers].map(([key, read]) => [key, read()])) };
}
