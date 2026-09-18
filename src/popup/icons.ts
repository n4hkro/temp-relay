// Popup ikonları — inline SVG.
//
// Niyə fayl kimi deyil, sətir kimi: ikonlar düymələrin içinə vəziyyətə görə yazılır
// (başlat ↔ dayandır, gün ↔ ay), yəni <img> ilə hər dəfə fayl yükləmək mənasızdır.
// Hamısı `currentColor` işlədir, ona görə tema dəyişəndə ayrıca iş görmək lazım gəlmir.

const svg = (body: string, { fill = "none" }: { fill?: string } = {}): string =>
  `<svg viewBox="0 0 24 24" width="18" height="18" fill="${fill}" stroke="${fill === "none" ? "currentColor" : "none"}"`
  + ` stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const Icon: Record<string, string> = Object.freeze({
  // Başlat/dayandır: qalan ikonlar kimi KONTURLU (dolğun deyil) — cərgədə eyni çəkidə görünsün
  play: svg('<path d="M8 5v14l11-7z"/>'),
  stop: svg('<rect x="6.5" y="6.5" width="11" height="11" rx="2"/>'),
  refresh: svg('<path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v5h-5"/>'),
  link: svg('<path d="M9 17H7A5 5 0 0 1 7 7h2"/><path d="M15 7h2a5 5 0 0 1 0 10h-2"/><path d="M8 12h8"/>'),
  copy: svg('<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>'),
  open: svg('<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1 2-2h6"/>'),
  sun: svg('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'),
  moon: svg('<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4 8.5 8.5 0 1 0 20 14.5z"/>'),
  trash: svg('<path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/><path d="M18.5 6l-.9 13.1A2 2 0 0 1 15.6 21H8.4a2 2 0 0 1-2-1.9L5.5 6"/>'),
  sliders: svg('<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>'),
  mail: svg('<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m3 7 9 6 9-6"/>'),
  // Qalxan — izləyici bloklaması; qlobus — proxy (şəbəkə çıxışı)
  shield: svg('<path d="M12 3l8 3v6c0 5-3.4 8.1-8 9-4.6-.9-8-4-8-9V6l8-3z"/>'),
  globe: svg('<circle cx="12" cy="12" r="9"/><path d="M3.6 9h16.8M3.6 15h16.8"/><path d="M12 3a14 14 0 0 0 0 18 14 14 0 0 0 0-18z"/>'),
  plug: svg('<path d="M9 2v6M15 2v6"/><path d="M6 8h12v3a6 6 0 0 1-12 0V8z"/><path d="M12 17v5"/>'),
  // Fayldan yükləmə (toplu proxy əlavəsi)
  upload: svg('<path d="M12 16V4"/><path d="m7 9 5-5 5 5"/><path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  x: svg('<path d="M18 6 6 18M6 6l12 12"/>'),
  check: svg('<path d="M20 6 9 17l-5-5"/>'),
  alert: svg('<path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>'),
});
