// Xəta növləri və onların worker console-a yazılma qaydası.
//
// Niyə ayrılır: chrome://extensions səhvlər səhifəsinə YALNIZ console.error düşür və oradakı
// sətirlər extension yenilənəndə təmizlənmir. Saytın limiti (429) orada "proqram xətası" kimi
// görünürdü və əsl qüsurları gizlədirdi. Ona görə iki növ var:
//
//   ExpectedError — səbəb extension-ın kodunda DEYİL: saytın cavabı (429/400/500), cavabsız
//                   sorğu, saytın DOM-u, istifadəçinin yanlış seçimi. Mesaj artıq status və
//                   bildiriş ilə istifadəçiyə çatır → console-a warn kimi yazılır.
//   qalanı        — proqram qüsuru (TypeError, naməlum provider id, pozulmuş kontrakt) →
//                   console.error, yəni səhvlər səhifəsində görünür.
//
// Qayda: istifadəçiyə göstərilə bilən aydın mətn atırsan → ExpectedError. Gözləmirsənsə və
// mesajı istifadəçiyə heç nə demirsə → adi Error.

export class ExpectedError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "ExpectedError";
  }
}

// Xətanın istifadəçiyə çatdırıla bilən mətni. AbortError texniki detaldır: sorğunu ya bizim
// vaxt limitimiz kəsib, ya da Dayandır — hər ikisi gözlənilən haldır, səbəbini biz bilirik.
export const describeFailure = (e) =>
  e?.name === "AbortError" ? "sorğu vaxtı bitdi (sayt cavab vermədi)" : e?.message ?? String(e);

// AbortError bizim öz vaxt limitimizdən (address-api, inbox) və ya Dayandır-dan gəlir:
// hər ikisi gözlənilən haldır — sayt cavab vermədi və ya sorğunu özümüz kəsdik.
export const isExpected = (e) => e instanceof ExpectedError || e?.name === "AbortError";

// Xətanı console-a yazır. `context` — harada baş verdiyini deyən qısa mətn ("axın pozuldu:").
// Gözlənilən xətdə yalnız mətn qalır (stack extension-ın qüsuru olmadığı üçün faydasızdır),
// gözlənilməzdə isə bütün obyekt yazılır: stack real səbəbi göstərir.
export function logFailure(context, e) {
  if (isExpected(e)) console.warn(context, describeFailure(e));
  else console.error(context, e);
}
