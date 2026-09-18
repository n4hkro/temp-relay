# Build və alətlər (TypeScript + Vite)

1.30.0-dan etibarən kod TypeScript-dir və Vite ilə `dist/`-ə yığılır.
Məntiq dəyişməyib — yalnız stack dəyişib (bax: `docs/ARCHITECTURE.md` → "Niyə TypeScript + Vite?").

## Quraşdırma

```sh
npm install
```

## Əmrlər

| Əmr | Nə edir |
| --- | --- |
| `npm run dev` | `dist/`-ə yığır və dəyişiklikdə avtomatik yenidən yığır |
| `npm run build` | `dist/`-ə birdəfəlik yığır |
| `npm run typecheck` | `tsc --noEmit` — tip yoxlaması |
| `npm run check` | `tools/check.ts` — provider ↔ manifest uyğunluğu (dist varsa oradakı built fayllar) |
| `npm run test` | Vitest — unit testlər (`tests/**/*.test.ts`) |
| `npm run test:e2e` | Playwright — `tests/e2e/` (real Chromium-da smoke test) |
| `npm run update:psl` | PSL snapshot-ını yeniləyir → `src/shared/public-suffix-rules.ts` |
| `npm run verify` | typecheck + check + test + build — hamısı birdən |

## Extension-ın yüklənməsi

`chrome://extensions` → Developer mode → **Load unpacked** → `dist/` qovluğunu seç.
Mənbəni (`src/`) yox, `dist/`-i yüklə — brauzer yığılmış JS-i oxuyur.

`npm run dev` işləyərkən kodda dəyişiklik avtomatik `dist/`-ə düşür;
sonra extension səhifəsində ↻ (yenilə) düyməsini basmaq kifayətdir.

## Quruluş

```
src/**/*.ts          mənbə (TypeScript)
manifest.json         manifest (mənbə — build-də dist/manifest.json-a köçürülür)
public/rules/        DNR ruleset-ləri (dəyişməz köçürülür)
public/assets/       ikonlar (dəyişməz köçürülür)
dist/                yığılmış extension (Load unpacked bura göstərilir)
tests/**/*.test.ts   unit testlər (Vitest)
tests/e2e/*.spec.ts  brauzer testləri (Playwright)
tools/*.ts           check / update-psl / browser-qa (tsx ilə işləyir)
```

## Qeydlər

- Import-lar uzantısız yazılır (`from "./state"`) — Vite, tsx və Vitest həll edir.
- `chrome.*` tipləri `@types/chrome`-dəndir.
- `minify: false` — extension kodu debug olunur, oxunaqlılıq saxlanılır.
- `strict: true` — `any` yoxdur; yeni kodda tip annotasiyası məcburidir.
