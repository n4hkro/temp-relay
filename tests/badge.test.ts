// İkon nişanı (badge): kod tapılanda popup-ı açmadan da görünməlidir.
//
// Niyə testlənir: nişan sistem bildirişlərinin əvəzidir (onlar söndürülmüş ola bilər), ona
// görə mətn və rəng səhv olsa istifadəçi kodun gəldiyini bilməz. Uğursuzluq isə əsas axını
// qırmamalıdır — chrome.action bəzi mühitlərdə əlçatan olmaya bilər.
import { describe, expect, it } from "vitest";

import { BadgeKind, clearBadge, DEFAULT_TITLE, setBadge } from "../src/shared/badge";

function withChrome(action?: any) : any {
  const previous = (globalThis as any).chrome;
  const calls: any = { text: [], color: [], title: [] };
  (globalThis as any).chrome = {
    action: action ?? {
      setBadgeText: async (o: any) => { calls.text.push(o.text); },
      setBadgeBackgroundColor: async (o: any) => { calls.color.push(o.color); },
      setTitle: async (o: any) => { calls.title.push(o.title); },
    },
  };
  const restore = () => { if (previous === undefined) delete (globalThis as any).chrome; else (globalThis as any).chrome = previous; };
  return { calls, restore };
}

describe("setBadge", () => {
  it("tapıntıda yaşıl ✓ qoyulur", async () => {
    const env: any = withChrome();
    try {
      await setBadge(BadgeKind.found, "Aktivasiya kodu: 483920");
      expect(env.calls.text).toStrictEqual(["✓"]);
      expect(env.calls.color).toStrictEqual(["#059669"]);
      expect(env.calls.title).toStrictEqual([`${DEFAULT_TITLE} — Aktivasiya kodu: 483920`]);
    } finally { env.restore(); }
  });

  it("uğursuz izləmədə narıncı ! qoyulur", async () => {
    const env: any = withChrome();
    try {
      await setBadge(BadgeKind.warn, "məktub gəlmədi");
      expect(env.calls.text).toStrictEqual(["!"]);
      expect(env.calls.color).toStrictEqual(["#d97706"]);
    } finally { env.restore(); }
  });

  it("nişan silinəndə mətn boşalır və rəng yazılmır", async () => {
    const env: any = withChrome();
    try {
      await clearBadge();
      expect(env.calls.text).toStrictEqual([""]);
      expect(env.calls.color, "boş nişan üçün rəng yazmaq mənasızdır").toStrictEqual([]);
      expect(env.calls.title, "tooltip default-a qayıdır").toStrictEqual([DEFAULT_TITLE]);
    } finally { env.restore(); }
  });

  it("naməlum növ nişanı silir (səssiz qalmaqdan yaxşıdır)", async () => {
    const env: any = withChrome();
    try {
      await setBadge("naməlum" as any);
      expect(env.calls.text).toStrictEqual([""]);
    } finally { env.restore(); }
  });

  it("başlıq verilməsə tooltip default qalır", async () => {
    const env: any = withChrome();
    try {
      await setBadge(BadgeKind.found);
      expect(env.calls.title).toStrictEqual([DEFAULT_TITLE]);
    } finally { env.restore(); }
  });

  it("chrome.action xəta atsa udulur — əsas axın qırılmamalıdır", async () => {
    const env: any = withChrome({
      setBadgeText: async () : Promise<any> => { throw new Error("no action API"); },
      setBadgeBackgroundColor: async () => {},
      setTitle: async () => {},
    });
    const original = console.warn;
    console.warn = () => {};
    try {
      await setBadge(BadgeKind.found, "kod");   // throw etməməlidir
    } finally { console.warn = original; env.restore(); }
  });
});
