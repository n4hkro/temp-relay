// Real brauzer smoke testi: built `dist/` unpacked extension kimi yüklənir,
// service worker-in açılması və popup səhifəsinin render olunması yoxlanılır.
// Heç bir real hesab/mail/proxy dəyişdirilmir — yalnız oxuma əməliyyatları.
import { test, expect, chromium } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../dist");

test("extension real Chromium-da açılır: service worker + popup", async () => {
  // Extension yalnız tam Chromium-da yüklənir (headless shell dəstəkləmir),
  // ona görə headed rejim + xvfb-run ilə işlədilir.
  const context = await chromium.launchPersistentContext("", {
    headless: false,
    args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
  });
  try {
    // 1) Service worker işə düşməlidir (artıq qalxmış da ola bilər — əvvəlcə siyahıya baxılır)
    let worker = context.serviceWorkers().find((w) => w.url().includes("/background/"));
    worker ??= await context.waitForEvent("serviceworker", { timeout: 30000 });
    const extensionId = new URL(worker.url()).host;
    expect(extensionId.length).toBeGreaterThan(0);

    // 2) Manifest versiyası gözləniləndir (yalnız oxuma)
    const version = await worker.evaluate(() => chrome.runtime.getManifest().version);
    expect(version).toBe("1.30.0");

    // 3) Popup səhifəsi render olunur (yalnız oxuma — heç bir düymə basılmır)
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/src/popup/popup.html`);
    await expect(popup.locator("#run")).toBeVisible({ timeout: 15000 });
    await expect(popup.locator("#mail-toggle")).toBeVisible();
    await expect(popup.locator("#relay-toggle")).toBeVisible();
    await popup.close();
  } finally {
    await context.close();
  }
});
