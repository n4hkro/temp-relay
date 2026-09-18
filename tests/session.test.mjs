// Vəziyyət qatının (shared/state.js) testləri: sessiya və poçt qutusu. Sessiya tərəfi
// "Dayandır uzun axının ortasında basılsa nə olur?" sualının cavabını qoruyur: köhnə axın
// sessiyanı diriltməməlidir. state.js chrome.storage-a baxdığı üçün burada yaddaş-daxili
// stub qurulur; real chrome.storage kimi dəyərləri klonlayır (istinad paylaşmır) — testlər
// məhz buna arxalanır.
import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import {
  clearInbox,
  clearSession,
  isLiveSession,
  readInbox,
  readSession,
  readStatus,
  StatusLevel,
  subscribeToSessionArea,
  updateSession,
  writeInbox,
  writeSession,
  writeStatus,
} from "../src/shared/state.js";

// chrome.storage sahəsinin yaddaş-daxili əvəzi
function memoryArea() {
  const data = new Map();
  return {
    data,
    get: async (key) => (data.has(key) ? { [key]: structuredClone(data.get(key)) } : {}),
    set: async (items) => { for (const [key, value] of Object.entries(items)) data.set(key, structuredClone(value)); },
    remove: async (key) => { data.delete(key); },
  };
}

const session = () => ({ tempId: "temp.tf", relayId: "nexora.example", tempTabId: 1, relayTabId: 2, windowId: 10, started: 1000 });

beforeEach(() => {
  const sessionArea = memoryArea();
  const localArea = memoryArea();
  const listeners = new Set();
  globalThis.chrome = {
    storage: {
      session: sessionArea,
      local: localArea,
      onChanged: {
        addListener: (fn) => listeners.add(fn),
        removeListener: (fn) => listeners.delete(fn),
      },
    },
  };
  globalThis.__areas = { session: sessionArea, local: localArea, listeners };
});

describe("session oxu/yazı", () => {
  it("boş saxlancdan null qaytarır", async () => {
    assert.equal(await readSession(), null);
  });

  it("yazılan sessiyanı olduğu kimi qaytarır", async () => {
    await writeSession(session());
    assert.deepEqual(await readSession(), session());
  });

  it("clearSession sessiyanı silir", async () => {
    await writeSession(session());
    await clearSession();
    assert.equal(await readSession(), null);
  });

  it("saxlanc klon saxlayır — çağıranın obyekti sonradan dəyişsə, yazılan dəyişmir", async () => {
    const live = session();
    await writeSession(live);
    live.relayTabId = 999;
    assert.equal((await readSession()).relayTabId, 2);
  });
});

describe("isLiveSession", () => {
  it("eyni sessiya aktivdirsə true", async () => {
    await writeSession(session());
    assert.equal(await isLiveSession(session()), true);
  });

  it("sessiya yoxdursa false", async () => {
    assert.equal(await isLiveSession(session()), false);
  });

  it("Dayandır-dan sonra false", async () => {
    await writeSession(session());
    await clearSession();
    assert.equal(await isLiveSession(session()), false);
  });

  it("başqa (yeni) sessiya başlayıbsa false — started fərqlidir", async () => {
    await writeSession({ ...session(), started: 2000 });
    assert.equal(await isLiveSession(session()), false);
  });
});

describe("updateSession", () => {
  it("paralel yeniləmələr bir-birinin sahələrini itirmir", async () => {
    await writeSession(session());
    await Promise.all([
      updateSession(session(), { address: "new@example.com" }),
      updateSession(session(), { password: "new-password" }),
    ]);
    assert.equal((await readSession()).address, "new@example.com");
    assert.equal((await readSession()).password, "new-password");
  });

  it("davam edən yeniləmədən sonra Dayandır sessiyanı diriltmir", async () => {
    await writeSession(session());
    await Promise.all([updateSession(session(), { address: "late@example.com" }), clearSession()]);
    assert.equal(await readSession(), null);
  });

  it("eyni millisaniyədə başlayan fərqli sessiyalar qarışmır", async () => {
    await writeSession({ ...session(), id: "new-session" });
    assert.equal(await isLiveSession({ ...session(), id: "old-session" }), false);
    assert.equal(await updateSession({ ...session(), id: "old-session" }, { address: "old@example.com" }), false);
  });

  it("sahələri həm saxlanca, həm çağıranın canlı obyektinə yazır", async () => {
    await writeSession(session());
    const live = session();
    assert.equal(await updateSession(live, { relayTabId: 77, windowId: 20 }), true);
    assert.equal(live.relayTabId, 77, "canlı obyekt təzələnmədi");
    assert.deepEqual(await readSession(), { ...session(), relayTabId: 77, windowId: 20 });
  });

  it("digər sahələri qoruyur (yalnız patch-i əvəz edir)", async () => {
    await writeSession(session());
    await updateSession(session(), { relayTabId: 77 });
    const stored = await readSession();
    assert.equal(stored.tempTabId, 1);
    assert.equal(stored.tempId, "temp.tf");
  });

  it("sessiya silinibsə false qaytarır və HEÇ NƏ yazmır (Dayandır qalib gəlir)", async () => {
    await clearSession();
    assert.equal(await updateSession(session(), { relayTabId: 77 }), false);
    assert.equal(await readSession(), null, "köhnə axın sessiyanı diriltdi");
  });

  it("yeni sessiya başlayıbsa false qaytarır və onu pozmur", async () => {
    const newer = { ...session(), started: 2000, relayTabId: 5 };
    await writeSession(newer);
    assert.equal(await updateSession(session(), { relayTabId: 77 }), false);
    assert.deepEqual(await readSession(), newer, "köhnə axın yeni sessiyanı pozdu");
  });

  it("false qaytaranda çağıranın canlı obyektini dəyişmir", async () => {
    const live = session();
    await updateSession(live, { relayTabId: 77 });
    assert.equal(live.relayTabId, 2);
  });
});

describe("status", () => {
  it("level, text və time ilə yazılır", async () => {
    await writeStatus(StatusLevel.error, "nəsə pozuldu");
    const status = await readStatus();
    assert.equal(status.level, "error");
    assert.equal(status.text, "nəsə pozuldu");
    assert.equal(typeof status.time, "number");
  });

  it("boş saxlancdan null qaytarır", async () => {
    assert.equal(await readStatus(), null);
  });
});

describe("subscribeToSessionArea", () => {
  const fire = (area) => { for (const fn of globalThis.__areas.listeners) fn({}, area); };

  it("yalnız session sahəsinin dəyişiyində çağrılır", () => {
    let calls = 0;
    subscribeToSessionArea(() => { calls++; });
    fire("local");
    assert.equal(calls, 0);
    fire("session");
    assert.equal(calls, 1);
  });

  it("qaytarılan funksiya dinləyicini geri çıxarır", () => {
    let calls = 0;
    const unsubscribe = subscribeToSessionArea(() => { calls++; });
    unsubscribe();
    fire("session");
    assert.equal(calls, 0);
  });
});

// --- poçt qutusu vəziyyəti --------------------------------------------------------------
// Formanı shared/inbox.js qurur, state.js isə onu saxlanca yazır: worker hər addımda yazır,
// popup paneli isə eyni açarı oxuyur. Ona görə dəyərin klonlanması və sahənin seçimi
// (session — brauzer bağlananda silinir) burada yoxlanılır.
describe("inbox oxu/yazı", () => {
  const inbox = () => ({ phase: "watching", address: "u@gmail.com", seen: ["1"], checked: 3, started: 1000, updated: 1000 });

  it("boş saxlancdan null qaytarır", async () => {
    assert.equal(await readInbox(), null);
  });

  it("yazılan vəziyyəti olduğu kimi qaytarır", async () => {
    await writeInbox(inbox());
    assert.deepEqual(await readInbox(), inbox());
  });

  it("dəyər klonlanır: worker obyekti sonradan dəyişsə saxlanc pozulmur", async () => {
    const current = inbox();
    await writeInbox(current);
    current.checked = 99;
    assert.equal((await readInbox()).checked, 3);
  });

  it("clearInbox silir — Dayandır və yeni ünvan paneldə köhnə kodu qoymur", async () => {
    await writeInbox(inbox());
    await clearInbox();
    assert.equal(await readInbox(), null);
  });

  it("session sahəsinə yazılır, local (choice) təmiz qalır", async () => {
    await writeInbox(inbox());
    assert.equal(globalThis.__areas.session.data.has("inbox"), true);
    assert.equal(globalThis.__areas.local.data.size, 0);
  });

  it("sessiya ilə eyni sahədədir: sessiya yazılanda inbox silinmir", async () => {
    await writeInbox(inbox());
    await writeSession(session());
    assert.deepEqual(await readInbox(), inbox());
    assert.deepEqual(await readSession(), session());
  });
});
