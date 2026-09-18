// Vəziyyət qatının (shared/state.ts) testləri: sessiya və poçt qutusu. Sessiya tərəfi
// "Dayandır uzun axının ortasında basılsa nə olur?" sualının cavabını qoruyur: köhnə axın
// sessiyanı diriltməməlidir. state.ts chrome.storage-a baxdığı üçün burada yaddaş-daxili
// stub qurulur; real chrome.storage kimi dəyərləri klonlayır (istinad paylaşmır) — testlər
// məhz buna arxalanır.
import { beforeEach, describe, expect, it } from "vitest";

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
} from "../src/shared/state";

// chrome.storage sahəsinin yaddaş-daxili əvəzi
function memoryArea() : any {
  const data = new Map();
  return {
    data,
    get: async (key: any) => (data.has(key) ? { [key]: structuredClone(data.get(key)) } : {}),
    set: async (items: any) => { for (const [key, value] of Object.entries(items)) data.set(key, structuredClone(value)); },
    remove: async (key: any) => { data.delete(key); },
  };
}

const session = () : any => ({ tempId: "temp.tf", relayId: "nexora.example", tempTabId: 1, relayTabId: 2, windowId: 10, started: 1000 });

beforeEach(() => {
  const sessionArea = memoryArea();
  const localArea = memoryArea();
  const listeners = new Set();
  (globalThis as any).chrome = {
    storage: {
      session: sessionArea,
      local: localArea,
      onChanged: {
        addListener: (fn: any) => listeners.add(fn),
        removeListener: (fn: any) => listeners.delete(fn),
      },
    },
  };
  (globalThis as any).__areas = { session: sessionArea, local: localArea, listeners };
});

describe("session oxu/yazı", () => {
  it("boş saxlancdan null qaytarır", async () => {
    expect(await readSession()).toBe(null);
  });

  it("yazılan sessiyanı olduğu kimi qaytarır", async () => {
    await writeSession(session());
    expect(await readSession()).toStrictEqual(session());
  });

  it("clearSession sessiyanı silir", async () => {
    await writeSession(session());
    await clearSession();
    expect(await readSession()).toBe(null);
  });

  it("saxlanc klon saxlayır — çağıranın obyekti sonradan dəyişsə, yazılan dəyişmir", async () => {
    const live = session();
    await writeSession(live);
    live.relayTabId = 999;
    expect((await readSession())!.relayTabId).toBe(2);
  });
});

describe("isLiveSession", () => {
  it("eyni sessiya aktivdirsə true", async () => {
    await writeSession(session());
    expect(await isLiveSession(session())).toBe(true);
  });

  it("sessiya yoxdursa false", async () => {
    expect(await isLiveSession(session())).toBe(false);
  });

  it("Dayandır-dan sonra false", async () => {
    await writeSession(session());
    await clearSession();
    expect(await isLiveSession(session())).toBe(false);
  });

  it("başqa (yeni) sessiya başlayıbsa false — started fərqlidir", async () => {
    await writeSession({ ...session(), started: 2000 });
    expect(await isLiveSession(session())).toBe(false);
  });
});

describe("updateSession", () => {
  it("paralel yeniləmələr bir-birinin sahələrini itirmir", async () => {
    await writeSession(session());
    await Promise.all([
      updateSession(session(), { address: "new@example.com" }),
      updateSession(session(), { password: "new-password" }),
    ]);
    expect((await readSession())!.address).toBe("new@example.com");
    expect((await readSession())!.password).toBe("new-password");
  });

  it("davam edən yeniləmədən sonra Dayandır sessiyanı diriltmir", async () => {
    await writeSession(session());
    await Promise.all([updateSession(session(), { address: "late@example.com" }), clearSession()]);
    expect(await readSession()).toBe(null);
  });

  it("eyni millisaniyədə başlayan fərqli sessiyalar qarışmır", async () => {
    await writeSession({ ...session(), id: "new-session" });
    expect(await isLiveSession({ ...session(), id: "old-session" })).toBe(false);
    expect(await updateSession({ ...session(), id: "old-session" }, { address: "old@example.com" })).toBe(false);
  });

  it("sahələri həm saxlanca, həm çağıranın canlı obyektinə yazır", async () => {
    await writeSession(session());
    const live = session();
    expect(await updateSession(live, { relayTabId: 77, windowId: 20 })).toBe(true);
    expect(live.relayTabId, "canlı obyekt təzələnmədi").toBe(77);
    expect(await readSession()).toStrictEqual({ ...session(), relayTabId: 77, windowId: 20 });
  });

  it("digər sahələri qoruyur (yalnız patch-i əvəz edir)", async () => {
    await writeSession(session());
    await updateSession(session(), { relayTabId: 77 });
    const stored = await readSession();
    expect(stored!.tempTabId).toBe(1);
    expect(stored!.tempId).toBe("temp.tf");
  });

  it("sessiya silinibsə false qaytarır və HEÇ NƏ yazmır (Dayandır qalib gəlir)", async () => {
    await clearSession();
    expect(await updateSession(session(), { relayTabId: 77 })).toBe(false);
    expect(await readSession(), "köhnə axın sessiyanı diriltdi").toBe(null);
  });

  it("yeni sessiya başlayıbsa false qaytarır və onu pozmur", async () => {
    const newer = { ...session(), started: 2000, relayTabId: 5 };
    await writeSession(newer);
    expect(await updateSession(session(), { relayTabId: 77 })).toBe(false);
    expect(await readSession(), "köhnə axın yeni sessiyanı pozdu").toStrictEqual(newer);
  });

  it("false qaytaranda çağıranın canlı obyektini dəyişmir", async () => {
    const live = session();
    await updateSession(live, { relayTabId: 77 });
    expect(live.relayTabId).toBe(2);
  });
});

describe("status", () => {
  it("level, text və time ilə yazılır", async () => {
    await writeStatus(StatusLevel.error, "nəsə pozuldu");
    const status = await readStatus();
    expect(status!.level).toBe("error");
    expect(status!.text).toBe("nəsə pozuldu");
    expect(typeof status!.time).toBe("number");
  });

  it("boş saxlancdan null qaytarır", async () => {
    expect(await readStatus()).toBe(null);
  });
});

describe("subscribeToSessionArea", () => {
  const fire = (area: any) => { for (const fn of (globalThis as any).__areas.listeners) fn({}, area); };

  it("yalnız session sahəsinin dəyişiyində çağrılır", () => {
    let calls = 0;
    subscribeToSessionArea(() => { calls++; });
    fire("local");
    expect(calls).toBe(0);
    fire("session");
    expect(calls).toBe(1);
  });

  it("qaytarılan funksiya dinləyicini geri çıxarır", () => {
    let calls = 0;
    const unsubscribe = subscribeToSessionArea(() => { calls++; });
    unsubscribe();
    fire("session");
    expect(calls).toBe(0);
  });
});

// --- poçt qutusu vəziyyəti --------------------------------------------------------------
// Formanı shared/inbox.ts qurur, state.ts isə onu saxlanca yazır: worker hər addımda yazır,
// popup paneli isə eyni açarı oxuyur. Ona görə dəyərin klonlanması və sahənin seçimi
// (session — brauzer bağlananda silinir) burada yoxlanılır.
describe("inbox oxu/yazı", () => {
  const inbox = () : any => ({ phase: "watching", address: "u@gmail.com", seen: ["1"], checked: 3, started: 1000, updated: 1000 });

  it("boş saxlancdan null qaytarır", async () => {
    expect(await readInbox()).toBe(null);
  });

  it("yazılan vəziyyəti olduğu kimi qaytarır", async () => {
    await writeInbox(inbox());
    expect(await readInbox()).toStrictEqual(inbox());
  });

  it("dəyər klonlanır: worker obyekti sonradan dəyişsə saxlanc pozulmur", async () => {
    const current = inbox();
    await writeInbox(current);
    current.checked = 99;
    expect((await readInbox())!.checked).toBe(3);
  });

  it("clearInbox silir — Dayandır və yeni ünvan paneldə köhnə kodu qoymur", async () => {
    await writeInbox(inbox());
    await clearInbox();
    expect(await readInbox()).toBe(null);
  });

  it("session sahəsinə yazılır, local (choice) təmiz qalır", async () => {
    await writeInbox(inbox());
    expect((globalThis as any).__areas.session.data.has("inbox")).toBe(true);
    expect((globalThis as any).__areas.local.data.size).toBe(0);
  });

  it("sessiya ilə eyni sahədədir: sessiya yazılanda inbox silinmir", async () => {
    await writeInbox(inbox());
    await writeSession(session());
    expect(await readInbox()).toStrictEqual(inbox());
    expect(await readSession()).toStrictEqual(session());
  });
});
