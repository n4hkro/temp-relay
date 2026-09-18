// Qeydiyyat forması üçün BÜTÖV şəxs profili.
//
// Niyə lazımdır: saytlar ünvan və paroldan başqa çox şey soruşur — ad, soyad, telefon, ölkə,
// şəhər, poçt indeksi, doğum tarixi… Boş qalan xana formanın göndərilməsini dayandırır, təsadüfi
// simvol yığını isə saytın yoxlamasını keçmir ("ad rəqəm ola bilməz", "indeks 5 rəqəmdir",
// "telefon yanlışdır"). Ona görə dəyərlər HƏQİQƏTƏ BƏNZƏR və bir-biri ilə UZLAŞAN olmalıdır:
// şəhər ↔ ştat ↔ poçt indeksi ↔ telefonun sahə kodu eyni yerə aiddir.
//
// Niyə determinist: eyni ünvan üçün həmişə eyni şəxs alınır. Forma iki mərhələdə (ünvan fazası,
// kod fazası) doldurulur və worker arada sönə bilər — dəyərlər dəyişsə sayt "məlumat uyğun
// gəlmir" deyərdi. Toxum ünvanın özüdür, ona görə saxlanca yazmaq da tələb olunmur.
//
// Niyə ABŞ məlumatı: forma yoxlamalarının ən çox dəstəklədiyi format ABŞ-dır (5 rəqəmli indeks,
// NANP telefonu, ştat siyahısı). Şəhərlərin indeksi və sahə kodu HƏQİQİDİR — uydurma indeks
// "belə şəhər yoxdur" xətası verə bilər.
//
// Bu fayl `chrome`-a toxunmur (node-da test olunur) və heç bir təsadüfi mənbə işlətmir.

import { usernameFromAddress } from "./username.js";

// --- məlumat bazası ------------------------------------------------------------------------
// Adlar qəsdən sadə latın hərfləri ilədir: diakritika bəzi saytda "yanlış simvol" sayılır.
// Uzunluq 3…9 — həm "çox qısa", həm "çox uzun" xətasından kənarda.
const FIRST = ["James", "Emily", "Daniel", "Sophia", "Michael", "Olivia", "Ethan", "Hannah",
  "Nathan", "Chloe", "Adrian", "Laura", "Victor", "Nora", "Simon", "Clara", "Owen", "Julia",
  "Marcus", "Diana", "Felix", "Ivy", "Leo", "Mia"];
const LAST = ["Carter", "Hayes", "Bennett", "Foster", "Rivera", "Preston", "Barnes", "Dalton",
  "Sinclair", "Mercer", "Whitman", "Ellis", "Sutton", "Marsh", "Norton", "Vaughn", "Keller",
  "Lawson", "Pierce", "Reyes", "Sheridan", "Winters", "Abbott", "Grayson"];

// Şəhər ↔ ştat ↔ indeks ↔ telefon sahə kodu HƏQİQİ cütlərdir (uydurma deyil).
const PLACES = [
  { city: "Austin", state: "Texas", stateCode: "TX", postal: "78701", area: "512" },
  { city: "Denver", state: "Colorado", stateCode: "CO", postal: "80202", area: "303" },
  { city: "Portland", state: "Oregon", stateCode: "OR", postal: "97205", area: "503" },
  { city: "Columbus", state: "Ohio", stateCode: "OH", postal: "43215", area: "614" },
  { city: "Seattle", state: "Washington", stateCode: "WA", postal: "98101", area: "206" },
  { city: "Madison", state: "Wisconsin", stateCode: "WI", postal: "53703", area: "608" },
  { city: "Raleigh", state: "North Carolina", stateCode: "NC", postal: "27601", area: "919" },
  { city: "Tucson", state: "Arizona", stateCode: "AZ", postal: "85701", area: "520" },
];

const STREETS = ["Cedar", "Maple", "Bridge", "Harbor", "Linden", "Chestnut", "Willow", "Franklin",
  "Sunset", "Meadow", "Riverside", "Ashwood"];
const STREET_KIND = ["Street", "Avenue", "Road", "Lane", "Drive"];
const UNIT = ["Apt 3B", "Apt 12", "Suite 200", "Unit 7", "Apt 5A"];

const COMPANY_KIND = ["Studio", "Labs", "Works", "Group", "Systems", "Media", "Partners"];
const JOBS = ["Marketing Specialist", "Project Coordinator", "Software Developer",
  "Content Editor", "Data Analyst", "Product Designer", "Support Engineer", "Account Manager"];
const HOBBIES = ["reading", "hiking", "photography", "cycling", "cooking", "chess", "running",
  "gardening"];

const MONTHS = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];

// --- determinist təsadüfilik ---------------------------------------------------------------
// FNV-1a: qısa, dövrsüz, kitabxanasız. Toxum ünvandan alınır.
function seedOf(text) {
  let hash = 0x811c9dc5;
  for (const char of String(text ?? "")) {
    hash ^= char.codePointAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash || 0x9e3779b9;
}

// mulberry32: 32 bitlik, sürətli, keyfiyyəti bu iş üçün bol
function prng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const two = (value) => String(value).padStart(2, "0");

// Yaş 24…38: 18-dən aşağı yaş bir çox saytda rədd olunur, 60+ isə "tarix yanlışdır"
// yoxlamalarına düşə bilir. `now` testdə sabitlənir.
export const MIN_AGE = 24;
export const MAX_AGE = 38;

// Ünvan → bütöv profil. Bütün dəyərlər hazır sətirlərdir: səhifəyə köçürülən skript yalnız
// hansı xanaya hansı açarı yazacağını bilir, məzmun haqqında qərar vermir.
export function buildIdentity(address, { now = Date.now(), usernameMaxLength } = {}) {
  const random = prng(seedOf(address));
  const pick = (list) => list[Math.floor(random() * list.length)];
  const between = (min, max) => min + Math.floor(random() * (max - min + 1));

  const firstName = pick(FIRST);
  const lastName = pick(LAST);
  const middleName = pick(FIRST);
  const place = pick(PLACES);

  // NANP qaydası: mərkəz kodu (exchange) 2…9 ilə başlayır, ardınca 6 rəqəm
  const exchange = String(between(200, 989));
  const line = String(between(1000, 9999));
  const phoneDigits = `${place.area}${exchange}${line}`;

  const age = between(MIN_AGE, MAX_AGE);
  const year = new Date(now).getUTCFullYear() - age;
  const month = between(1, 12);
  // 28-dən yuxarı gün fevralda mövcud olmur — tarix yoxlamasına düşməmək üçün 1…28
  const day = between(1, 28);

  const username = usernameFromAddress(address, {
    maxLength: usernameMaxLength,
    random: (count) => Uint8Array.from({ length: count }, () => Math.floor(random() * 256)),
  });

  return {
    firstName,
    lastName,
    middleName,
    fullName: `${firstName} ${lastName}`,
    username,
    email: String(address ?? ""),

    // Telefon üç formada: sayt hansını istəyirsə (beynəlxalq, milli, yalnız rəqəm)
    phone: `+1${phoneDigits}`,
    phoneNational: `(${place.area}) ${exchange}-${line}`,
    phoneDigits,
    phoneCountryCode: "+1",

    street: `${between(100, 9899)} ${pick(STREETS)} ${pick(STREET_KIND)}`,
    street2: pick(UNIT),
    city: place.city,
    state: place.state,
    stateCode: place.stateCode,
    postal: place.postal,
    country: "United States",
    countryCode: "US",

    birthIso: `${year}-${two(month)}-${two(day)}`,
    birthYear: String(year),
    birthMonth: two(month),
    birthMonthName: MONTHS[month - 1],
    birthDay: two(day),
    age: String(age),

    // Cins: sayt seçim tələb edirsə göstərici lazımdır; "demək istəmirəm" varsa forms.js onu
    // üstün tutur (bax: background/forms.js → GENDER_NEUTRAL).
    gender: FIRST.indexOf(firstName) % 2 === 0 ? "male" : "female",

    company: `${pick(STREETS)} ${pick(COMPANY_KIND)}`,
    jobTitle: pick(JOBS),
    website: `https://${username}.example.com`,
    bio: `Hi, I'm ${firstName}. I work as a ${pick(JOBS).toLowerCase()} and enjoy ${pick(HOBBIES)} in my free time.`,
  };
}
