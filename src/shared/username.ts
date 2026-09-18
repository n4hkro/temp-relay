// Qeydiyyat üçün istifadəçi adı (username / kullanıcı adı).
//
// Niyə ünvandan törədilir və təsadüfi söz seçilmir: ad HESABIN AÇARIDIR — istifadəçi sonra
// onunla giriş edir. Ünvana bağlı olsa ikisi bir-birini xatırladır ("bu ad hansı poçtundur?"
// sualı qalmır); üstəlik temp mail ünvanının lokal hissəsi onsuz da təkrarsızdır, yəni ad da
// təkrarsız olur və saytın "bu ad tutulub" xətası nadir hala düşür.
//
// Saytların adi qaydaları nəzərə alınıb: yalnız hərf/rəqəm (nöqtə, `+`, `_` və `-` atılır),
// hərflə başlayır, ən azı 6, ən çoxu 20 simvol.
//
// Bu fayl `chrome`-a toxunmur: `crypto.getRandomValues` həm service worker-də, həm node-da var.

export const USERNAME_MIN = 6;
export const USERNAME_MAX = 20;

const DIGITS = "23456789";           // səhv oxunan 0/1 yoxdur (shared/password.ts ilə eyni qayda)
const LETTERS = "abcdefghijkmnopqrstuvwxyz";

export type RandomBytes = (count: number) => Uint8Array;

const bytes: RandomBytes = (count) => crypto.getRandomValues(new Uint8Array(count));

// Modulo meylsiz seçim (shared/password.ts → pick ilə eyni üsul)
function pick(alphabet: string, random: RandomBytes): string {
  const limit = 256 - (256 % alphabet.length);
  for (let guard = 0; guard < 1000; guard++) {
    const [byte] = random(1);
    if (byte < limit) return alphabet[byte % alphabet.length];
  }
  throw new Error("təsadüfi simvol seçilə bilmədi");
}

export interface UsernameOptions {
  maxLength?: number;
  random?: RandomBytes;
}

// Ünvan → istifadəçi adı. "yavas.huseyin15+2t0t8@gmail.com" → "yavashuseyin152t0t8"
// `maxLength` xananın öz `maxlength` atributundan gələ bilər (forms.ts onu ötürür).
// `random` testdə determinist funksiya ilə əvəzlənir.
export function usernameFromAddress(
  address: string | null | undefined,
  { maxLength = USERNAME_MAX, random = bytes }: UsernameOptions = {},
): string {
  const local = String(address ?? "").split("@")[0].toLowerCase();
  let name = local.replace(/[^a-z0-9]/g, "");
  // Rəqəmlə başlayan adı bəzi saytlar rədd edir; boş qalıbsa da hərf lazımdır
  if (!/^[a-z]/.test(name)) name = pick(LETTERS, random) + name;

  const cap = Number.isInteger(maxLength) && maxLength >= USERNAME_MIN ? Math.min(maxLength, USERNAME_MAX) : USERNAME_MAX;
  // Qısa adlar tutulmuş olur: təsadüfi rəqəmlərlə minimuma qədər uzadılır
  while (name.length < Math.min(USERNAME_MIN, cap)) name += pick(DIGITS, random);
  return name.slice(0, cap);
}
