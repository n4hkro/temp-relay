// Extension ikonunun üstündəki nişan (badge) və tooltip.
//
// Niyə lazımdır: aktivasiya kodu tapılanda dəyər clipboard-a düşür və bildiriş göndərilir,
// amma sistem bildirişləri söndürülmüş ola bilər (Windows-da "focus assist", brauzer
// ayarları). Nişan HƏMİŞƏ görünür: istifadəçi popup-ı açmadan da kodun gəldiyini bilir.
//
// Həm worker (nişanı qoyur), həm popup (açılanda silir) işlədir, ona görə shared/-dədir.
// Modul `chrome`-a yalnız funksiyaların İÇİNDƏ toxunur — node-da import oluna bilər.

export const DEFAULT_TITLE = "Temp mail + relay";

// Mətn qısa olmalıdır (badge ~4 simvol göstərir). Rənglər popup temasından asılı deyil:
// nişan brauzerin alət panelindədir, orada öz kontrastını saxlamalıdır.
export const BadgeKind = Object.freeze({
  found: "found",   // kod və ya keçid tapıldı — yaşıl ✓
  warn: "warn",     // izləmə boş bitdi və ya qutu oxunmadı — narıncı !
  none: "none",     // nişan yoxdur
} as const);
export type BadgeKindValue = (typeof BadgeKind)[keyof typeof BadgeKind];

const LOOK: Record<BadgeKindValue, { text: string; color: string }> = Object.freeze({
  [BadgeKind.found]: { text: "✓", color: "#059669" },
  [BadgeKind.warn]: { text: "!", color: "#d97706" },
  [BadgeKind.none]: { text: "", color: "#059669" },
});

// Nişanı yazır. Uğursuzluq udulur: bu, yalnız göstərmə qatıdır və əsas axını qırmamalıdır.
export async function setBadge(kind: BadgeKindValue, title?: string | null): Promise<void> {
  const look = LOOK[kind] ?? LOOK[BadgeKind.none];
  try {
    await chrome.action.setBadgeText({ text: look.text });
    if (look.text) await chrome.action.setBadgeBackgroundColor({ color: look.color });
    // Tooltip-də dəyərin özü yazılır: kursoru ikonun üstünə gətirmək kifayətdir
    await chrome.action.setTitle({ title: title ? `${DEFAULT_TITLE} — ${title}` : DEFAULT_TITLE });
  } catch (e) {
    console.warn("nişan yazılmadı:", (e as { message?: unknown } | null)?.message ?? e);
  }
}

export const clearBadge = (): Promise<void> => setBadge(BadgeKind.none);
