import { copyFileSync } from "node:fs";
import { defineConfig } from "vite";

// Chrome MV3 extension build: TypeScript → dist/.
// manifest.json-in göstərdiyi yollar dist/ daxilində eyni qalır
// (src/background/background.ts, src/popup/popup.html, rules/…).
// Yükləmə: chrome://extensions → "Load unpacked" → dist/ qovluğu.
// İnkişaf: npm run dev (dəyişiklikdə avtomatik yenidən yığır).
export default defineConfig({
  publicDir: "public",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "es2022",
    // Extension kodu debug olunur — minify oxunaqlılığı öldürür, qazancı isə
    // popup/service worker ölçüsündə əhəmiyyətsizdir.
    minify: false,
    rollupOptions: {
      input: {
        "src/background/background": "src/background/background.ts",
        "src/popup/popup": "src/popup/popup.html",
        "src/offscreen/clipboard": "src/offscreen/clipboard.html",
      },
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "src/shared/chunk-[hash].js",
        assetFileNames: "src/bundled/[name]-[hash][extname]",
      },
    },
  },
  plugins: [
    {
      name: "copy-manifest",
      writeBundle() {
        copyFileSync("manifest.json", "dist/manifest.json");
      },
    },
  ],
});
