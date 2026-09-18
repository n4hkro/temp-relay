// İkon nişanı (badge): kod tapılanda popup-ı açmadan da görünməlidir.
//
// Niyə testlənir: nişan sistem bildirişlərinin əvəzidir (onlar söndürülmüş ola bilər), ona
// görə mətn və rəng səhv olsa istifadəçi kodun gəldiyini bilməz. Uğursuzluq isə əsas axını
// qırmamalıdır — chrome.action bəzi mühitlərdə əlçatan olmaya bilər.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BadgeKind, clearBadge, DEFAULT_TITLE, setBadge } from "../src/shared/badge.js";

function withChrome(action) {
  const previous = globalThis.chrome;
  const calls = { text: [], color: [], title: [] };
  globalThis.chrome = {
    action: action ?? {
      setBadgeText: async (o) => { calls.text.push(o.text); },
      setBadgeBackgroundColor: async (o) => { calls.color.push(o.color); },
      setTitle: async (o) => { calls.title.push(o.title); },
    },
  };
  const restore = () => { if (previous === undefined) delete globalThis.chrome; else globalThis.chrome = previous; };
  return { calls, restore };
}

describe("setBadge", () => {
  it("tapıntıda yaşıl ✓ qoyulur", async () => {
    const env = withChrome();
    try {
      await setBadge(BadgeKind.found, "Aktivasiya kodu: 483920");
      assert.deepEqual(env.calls.text, ["✓"]);
      assert.deepEqual(env.calls.color, ["#059669"]);
      assert.deepEqual(env.calls.title, [`${DEFAULT_TITLE} — Aktivasiya kodu: 483920`]);
    } finally { env.restore(); }
  });

  it("uğursuz izləmədə narıncı ! qoyulur", async () => {
    const env = withChrome();
    try {
      await setBadge(BadgeKind.warn, "məktub gəlmədi");
      assert.deepEqual(env.calls.text, ["!"]);
      assert.deepEqual(env.calls.color, ["#d97706"]);
    } finally { env.restore(); }
  });

  it("nişan silinəndə mətn boşalır və rəng yazılmır", async () => {
    const env = withChrome();
    try {
      await clearBadge();
      assert.deepEqual(env.calls.text, [""]);
      assert.deepEqual(env.calls.color, [], "boş nişan üçün rəng yazmaq mənasızdır");
      assert.deepEqual(env.calls.title, [DEFAULT_TITLE], "tooltip default-a qayıdır");
    } finally { env.restore(); }
  });

  it("naməlum növ nişanı silir (səssiz qalmaqdan yaxşıdır)", async () => {
    const env = withChrome();
    try {
      await setBadge("naməlum");
      assert.deepEqual(env.calls.text, [""]);
    } finally { env.restore(); }
  });

  it("başlıq verilməsə tooltip default qalır", async () => {
    const env = withChrome();
    try {
      await setBadge(BadgeKind.found);
      assert.deepEqual(env.calls.title, [DEFAULT_TITLE]);
    } finally { env.restore(); }
  });

  it("chrome.action xəta atsa udulur — əsas axın qırılmamalıdır", async () => {
    const env = withChrome({
      setBadgeText: async () => { throw new Error("no action API"); },
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
