// Qeydiyyat üçün güclü parol yaradılması.
//
// Niyə extension yaradır: Chrome-un "Suggest strong password" pəncərəsini kənardan açmaq
// mümkün deyil (o, brauzerin öz UI-ıdır). Ona görə parol burada yaradılır və forma
// göndəriləndə Chrome-un parol menecerinə adi qeydiyyat kimi düşür — "Save password"
// təklifi yenə çıxır.
//
// Bu fayl `chrome`-a toxunmur: `crypto.getRandomValues` həm service worker-də, həm node-da var.

// Səhv oxunan simvollar çıxarılıb (l/I/1, O/0): parol lazım gələndə əl ilə də yazıla bilməlidir.
const LOWER = "abcdefghijkmnopqrstuvwxyz";
const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const DIGITS = "23456789";
const ALL = LOWER + UPPER + DIGITS;

// TAM BİR xüsusi simvol. Niyə bir dənə: saytların çoxu "ən azı 1 simvol" tələb edir və bu şərt
// olmadan forma rədd edilir; çox simvol isə əks tərəfə keçir — bəzi saytlar simvolları
// məhdudlaşdırır. Siyahı DAR seçilib: dırnaq, tərs kəsik, boşluq, `<`, `>`, `&` yoxdur —
// onlar formada, HTML-də və kopyalamada problem yaradır.
const SYMBOLS = "!@#$%*";

// Saytların ən yayğın qaydası: 8 simvol, ən azı bir kiçik, bir böyük hərf, bir rəqəm və bir
// simvol. Uzunluq məhz 8-dir, çünki bəzi saytlar yuxarı hədd qoyur (8-16, 8-20) və qısa parol
// hər iki tərəfdən keçir. Tərkib: 1 simvol (HƏMİŞƏ tam bir), qalan 7 simvol hərf/rəqəm —
// içində ən azı bir kiçik, bir böyük və bir rəqəm zəmanətlidir, artığı isə təsadüfidir.
export const PASSWORD_LENGTH = 8;

const bytes = (count) => crypto.getRandomValues(new Uint8Array(count));

// Modulo meyli olmayan seçim: 256-nın alfabet uzunluğuna bölünməyən quyruğu atılır.
function pick(alphabet, random) {
  const limit = 256 - (256 % alphabet.length);
  for (let guard = 0; guard < 1000; guard++) {
    const [byte] = random(1);
    if (byte < limit) return alphabet[byte % alphabet.length];
  }
  // Praktikada baş vermir (hər cəhdin uğur şansı > 93%); sonsuz döngüyə qarşı qoruyucu
  throw new Error("təsadüfi simvol seçilə bilmədi");
}

// 0…n-1 aralığında meylsiz təsadüfi indeks
function index(n, random) {
  if (n <= 1) return 0;
  const limit = 256 - (256 % n);
  for (let guard = 0; guard < 1000; guard++) {
    const [byte] = random(1);
    if (byte < limit) return byte % n;
  }
  throw new Error("təsadüfi simvol seçilə bilmədi");
}

// Fisher-Yates: sinif təminatı üçün əvvəldə duran simvollar sabit yerdə qalmasın
function shuffle(chars, random) {
  for (let i = chars.length - 1; i > 0; i--) {
    const j = index(i + 1, random);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars;
}

// Ən azı bir kiçik, bir böyük hərf, bir rəqəm və DƏQİQ bir xüsusi simvol zəmanətlidir —
// saytların adi qaydası budur. `random` testdə determinist funksiya ilə əvəzlənir.
export function generatePassword(length = PASSWORD_LENGTH, random = bytes) {
  if (!Number.isInteger(length) || length < 8) throw new Error("parol uzunluğu ən azı 8 olmalıdır");
  const chars = [pick(LOWER, random), pick(UPPER, random), pick(DIGITS, random)];
  while (chars.length < length - 1) chars.push(pick(ALL, random));
  shuffle(chars, random);
  // Simvol İÇƏRİDƏ yerləşdirilir: bəzi yoxlayıcılar parolun simvolla başlamasını və ya
  // bitməsini qəbul etmir, üstəlik sondaki simvol kopyalamada asan itir.
  chars.splice(1 + index(length - 2, random), 0, pick(SYMBOLS, random));
  return chars.join("");
}
