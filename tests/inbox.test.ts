// Poçt qutusu vəziyyət modelinin (shared/inbox.ts) testləri.
// Vəziyyət saf məlumatdır — popup və worker eyni formanı oxuyur, ona görə hər keçid və
// hər mətn burada yoxlanılır. İşlətmək: npm test
import { describe, expect, it } from "vitest";

import {
  INBOX_STALE_MS,
  InboxPhase,
  closedInbox,
  deliveryNote,
  foundInbox,
  inboxDetail,
  inboxLabel,
  inboxNotification,
  inboxPayload,
  inboxStale,
  inboxSummary,
  progressInbox,
  watchingInbox,
} from "../src/shared/inbox";

const HIT = { code: "483920", link: null, subject: "Confirm your email", from: "Nexora <no-reply@nexora.example>", reasons: ["göndərən: nexora.example"] };
const LINK_HIT: any = { code: null, link: "https://nexora.example/verify?k=abc", subject: "Verify", from: "no-reply@nexora.example", reasons: [] };

describe("watchingInbox", () => {
  it("başlanğıc vəziyyəti qurur — kod və keçid hələ boşdur", () => {
    const inbox = watchingInbox("u@gmail.com", { started: 1000 });
    expect(inbox.phase).toBe(InboxPhase.watching);
    expect(inbox.address).toBe("u@gmail.com");
    expect(inbox.code).toBe(null);
    expect(inbox.link).toBe(null);
    expect(inbox.reasons).toStrictEqual([]);
    expect(inbox.checked).toBe(0);
    expect(inbox.message).toBe(null);
    expect(inbox.started).toBe(1000);
    expect(inbox.updated >= 1000).toBeTruthy();
  });

  it("arqumentsiz çağırılanda öz vaxtını yazır", () => {
    const before = Date.now();
    const inbox = watchingInbox("u@gmail.com");
    expect(inbox.started >= before).toBeTruthy();
    // started və updated iki ayrı Date.now() çağırışıdır — millisaniyə sərhəddində
    // fərqlənə bilər, ona görə bərabərlik yox, ardıcıllıq yoxlanılır
    expect(inbox.updated >= inbox.started && inbox.updated - inbox.started < 50).toBeTruthy();
  });

  it("checked ötürülərsə saxlanılır (worker yenidən işə düşəndə say itmir)", () => {
    expect(watchingInbox("u@gmail.com", { checked: 7 }).checked).toBe(7);
  });
});

describe("foundInbox", () => {
  it("tapıntını kodla yazır, başlanğıc vaxtını qoruyur", () => {
    const inbox = watchingInbox("u@gmail.com", { started: 1000, checked: 3 });
    const found = foundInbox(inbox, HIT, { checked: 4 });
    expect(found.phase).toBe(InboxPhase.found);
    expect(found.code).toBe("483920");
    expect(found.link).toBe(null);
    expect(found.subject).toBe("Confirm your email");
    expect(found.from).toBe("Nexora <no-reply@nexora.example>");
    expect(found.reasons).toStrictEqual(["göndərən: nexora.example"]);
    expect(found.message).toBe(null);
    expect(found.checked).toBe(4);
    expect(found.started, "deadline uzanmamalıdır").toBe(1000);
    expect(found.address).toBe("u@gmail.com");
    expect(found.updated > 0).toBeTruthy();
  });

  it("kod yoxdursa keçidi yazır", () => {
    const found = foundInbox(watchingInbox("u@gmail.com"), LINK_HIT);
    expect(found.code).toBe(null);
    expect(found.link).toBe("https://nexora.example/verify?k=abc");
  });

  it("checked ötürülməsə köhnə sayı saxlayır", () => {
    expect(foundInbox(watchingInbox("u@gmail.com", { checked: 9 }), HIT).checked).toBe(9);
  });

  it("səhv formalı hit dağılmır", () => {
    const found = foundInbox(watchingInbox("u@gmail.com"), { code: "1", reasons: "sətir" } as any);
    expect(found.reasons).toStrictEqual([]);
    expect(found.subject).toBe("");
    expect(found.from).toBe("");
  });

  it("köhnə obyektə toxunmur (saxlancdakı forma korlanmır)", () => {
    const inbox = watchingInbox("u@gmail.com");
    foundInbox(inbox, HIT);
    expect(inbox.phase).toBe(InboxPhase.watching);
    expect(inbox.code).toBe(null);
  });
});

describe("progressInbox və closedInbox", () => {
  it("progress yalnız sayı və vaxtı dəyişir", () => {
    const inbox = watchingInbox("u@gmail.com", { started: 1000, checked: 0 });
    const next = progressInbox(inbox, 5);
    expect(next.checked).toBe(5);
    expect(next.phase).toBe(InboxPhase.watching);
    expect(next.started).toBe(1000);
    expect(inbox.checked, "köhnə obyekt dəyişmir").toBe(0);
  });

  it("closed fazanı və səbəbi yazır, started-ı qoruyur", () => {
    const inbox = watchingInbox("u@gmail.com", { started: 1000 });
    const done = closedInbox(inbox, InboxPhase.empty, "5 dəqiqə ərzində məktub gəlmədi");
    expect(done.phase).toBe(InboxPhase.empty);
    expect(done.message).toBe("5 dəqiqə ərzində məktub gəlmədi");
    expect(done.started).toBe(1000);
    expect(done.address).toBe("u@gmail.com");
  });
});

describe("inboxPayload", () => {
  it("kod üstündür", () => {
    expect(inboxPayload(foundInbox(watchingInbox("u@gmail.com"), { code: "483920", link: "https://x" }))).toBe("483920");
  });

  it("kod yoxdursa keçid", () => {
    expect(inboxPayload(foundInbox(watchingInbox("u@gmail.com"), LINK_HIT))).toBe("https://nexora.example/verify?k=abc");
  });

  it("tapıntı olmayan fazada dəyər yoxdur (clipboard-a heç nə yazılmır)", () => {
    expect(inboxPayload(watchingInbox("u@gmail.com"))).toBe(null);
    expect(inboxPayload(closedInbox(watchingInbox("u@gmail.com"), InboxPhase.empty, "x"))).toBe(null);
    expect(inboxPayload(null)).toBe(null);
  });
});

describe("inboxSummary", () => {
  const watching = watchingInbox("u@gmail.com");

  it("izləmə başlanğıcda", () => {
    expect(inboxSummary(watching, watching.updated)).toMatch(/^Poçt izlənilir: aktivasiya kodu/);
  });

  it("yoxlanılan məktubların sayı göstərilir", () => {
    const inbox = progressInbox(watching, 4);
    expect(inboxSummary(inbox, inbox.updated)).toMatch(/^Poçt izlənilir: 4 məktub yoxlanıldı/);
  });

  it("tapıntıda kod yazılır", () => {
    expect(inboxSummary(foundInbox(watching, HIT), 0)).toBe("Aktivasiya kodu: 483920");
  });

  it("tapıntıda kod yoxdursa keçid yazılır", () => {
    expect(inboxSummary(foundInbox(watching, LINK_HIT), 0)).toBe("Aktivasiya keçidi: https://nexora.example/verify?k=abc");
  });

  it("boş nəticədə worker-in yazdığı səbəb göstərilir", () => {
    expect(inboxSummary(closedInbox(watching, InboxPhase.empty, "gözləmə bitdi"), 0)).toBe("gözləmə bitdi");
  });

  it("xətada səbəb göstərilir", () => {
    expect(inboxSummary(closedInbox(watching, InboxPhase.error, "server 502"), 0)).toBe("server 502");
  });

  it("səbəb yazılmasa belə boş mətn qalmır", () => {
    expect(inboxSummary(closedInbox(watching, InboxPhase.empty, null), 0)).toBe("Uyğun məktub gəlmədi");
    expect(inboxSummary(closedInbox(watching, InboxPhase.error, null), 0)).toBe("Poçt qutusu oxunmadı");
  });

  it("inbox yoxdursa null", () => {
    expect(inboxSummary(null)).toBe(null);
  });
});

describe("inboxStale — worker sönsə izləmə dayandığı bildirilir", () => {
  it("təzə watching bayatlamır", () => {
    const inbox = watchingInbox("u@gmail.com", { started: 0 });
    expect(inboxStale(inbox, inbox.updated + INBOX_STALE_MS - 1)).toBe(false);
  });

  it("nəbz dayanıbsa bayat sayılır", () => {
    const inbox = watchingInbox("u@gmail.com", { started: 0 });
    expect(inboxStale(inbox, inbox.updated + INBOX_STALE_MS + 1)).toBe(true);
  });

  it("tapıntı və ya bağlanmış izləmə bayatlamır (nəticə hələ doğrudur)", () => {
    const found = foundInbox(watchingInbox("u@gmail.com"), HIT);
    expect(inboxStale(found, found.updated + INBOX_STALE_MS * 100)).toBe(false);
    const done = closedInbox(watchingInbox("u@gmail.com"), InboxPhase.empty, "x");
    expect(inboxStale(done, done.updated + INBOX_STALE_MS * 100)).toBe(false);
  });

  it("inbox yoxdursa false", () => {
    expect(inboxStale(null)).toBe(false);
  });

  it("bayat izləmənin mətni açıq deyir ki, təkrar başlamaq lazımdır", () => {
    const inbox = watchingInbox("u@gmail.com");
    expect(inboxSummary(inbox, inbox.updated + INBOX_STALE_MS + 1)).toMatch(/İzləmə dayandı/);
  });
});

describe("inboxDetail", () => {
  it("tapıntıda mövzu və göndərən göstərilir", () => {
    expect(inboxDetail(foundInbox(watchingInbox("u@gmail.com"), HIT))).toBe("Confirm your email — Nexora <no-reply@nexora.example>");
  });

  it("yalnız bir mənbə varsa o yazılır", () => {
    expect(inboxDetail(foundInbox(watchingInbox("u@gmail.com"), { ...HIT, subject: "" }))).toBe("Nexora <no-reply@nexora.example>");
  });

  it("keçid tapıntısında da mövzu və göndərən göstərilir", () => {
    expect(inboxDetail(foundInbox(watchingInbox("u@gmail.com"), LINK_HIT))).toBe("Verify — no-reply@nexora.example");
  });

  it("heç nə yoxdursa null", () => {
    expect(inboxDetail(foundInbox(watchingInbox("u@gmail.com"), { ...LINK_HIT, subject: "", from: "" }))).toBe(null);
  });

  it("tapıntı olmayan fazada null", () => {
    expect(inboxDetail(watchingInbox("u@gmail.com"))).toBe(null);
    expect(inboxDetail(null)).toBe(null);
  });
});

describe("inboxNotification", () => {
  it("kod tapılanda bildiriş qurulur", () => {
    expect(inboxNotification(foundInbox(watchingInbox("u@gmail.com"), HIT))).toStrictEqual({
      title: "Aktivasiya kodu",
      message: "483920 — Confirm your email",
    });
  });

  it("mövzu yoxdursa bildirişdə yalnız kod olur", () => {
    const notification = inboxNotification(foundInbox(watchingInbox("u@gmail.com"), { ...HIT, subject: "" }));
    expect(notification!.message).toBe("483920");
  });

  it("keçid tapılanda başlıq fərqlidir", () => {
    expect(inboxNotification(foundInbox(watchingInbox("u@gmail.com"), LINK_HIT))).toStrictEqual({
      title: "Aktivasiya keçidi",
      message: "https://nexora.example/verify?k=abc",
    });
  });

  it("digər fazalarda bildiriş göndərilmir", () => {
    expect(inboxNotification(watchingInbox("u@gmail.com"))).toBe(null);
    expect(inboxNotification(closedInbox(watchingInbox("u@gmail.com"), InboxPhase.empty, "x"))).toBe(null);
    expect(inboxNotification(null)).toBe(null);
  });
});

describe("inboxLabel", () => {
  it("kod tapıntısında başlıq 'Aktivasiya kodu'-dur", () => {
    expect(inboxLabel(foundInbox(watchingInbox("u@gmail.com"), HIT))).toBe("Aktivasiya kodu");
  });

  it("keçid tapıntısında başlıq 'Aktivasiya keçidi'-dir", () => {
    expect(inboxLabel(foundInbox(watchingInbox("u@gmail.com"), LINK_HIT))).toBe("Aktivasiya keçidi");
  });

  it("kod və keçid bir yerdədirsə kod üstündür (payload ilə eyni qərar)", () => {
    const both = foundInbox(watchingInbox("u@gmail.com"), { ...HIT, link: LINK_HIT.link });
    expect(inboxLabel(both)).toBe("Aktivasiya kodu");
    expect(inboxPayload(both)).toBe(HIT.code);
  });

  it("digər fazalarda başlıq yoxdur", () => {
    expect(inboxLabel(watchingInbox("u@gmail.com"))).toBe(null);
    expect(inboxLabel(closedInbox(watchingInbox("u@gmail.com"), InboxPhase.empty, "x"))).toBe(null);
    expect(inboxLabel(null)).toBe(null);
  });

  it("summary başlıq və dəyərdən qurulur — iki yerdə eyni mətn təkrarlanmır", () => {
    const inbox = foundInbox(watchingInbox("u@gmail.com"), HIT);
    expect(inboxSummary(inbox)).toBe(`${inboxLabel(inbox)}: ${inboxPayload(inbox)}`);
    const linked = foundInbox(watchingInbox("u@gmail.com"), LINK_HIT);
    expect(inboxSummary(linked)).toBe(`${inboxLabel(linked)}: ${inboxPayload(linked)}`);
  });

  it("bildirişin başlığı da eyni etiketdir", () => {
    const inbox = foundInbox(watchingInbox("u@gmail.com"), LINK_HIT);
    expect(inboxNotification(inbox)!.title).toBe(inboxLabel(inbox));
  });
});


// deliveryNote — tapıntı ilə nə edildiyinin status quyruğu. Mətn burada qurulur ki,
// worker (background/inbox.ts → deliver) və status eyni sözü işlətsin.
describe("deliveryNote", () => {
  it("forma doldurulub və kopyalanıb", () => {
    expect(deliveryNote({ filled: true, copied: true })).toBe(" — forma dolduruldu, kopyalandı");
  });

  it("yalnız forma doldurulub", () => {
    expect(deliveryNote({ filled: true })).toBe(" — forma dolduruldu");
  });

  it("göndərmə düyməsi basılıbsa onun yazısı görünür", () => {
    expect(deliveryNote({ filled: true, submitted: "create account", copied: true })).toBe(' — forma dolduruldu, "create account" basıldı, kopyalandı');
    expect(deliveryNote({ filled: true, submitted: "" })).toBe(" — forma dolduruldu");
  });

  it("yalnız kopyalanıb (sayt qeydiyyat addımı vermir)", () => {
    expect(deliveryNote({ copied: true })).toBe(" — kopyalandı");
  });

  it("heç biri alınmasa səbəb göstərilir — dəyər paneldə qalır", () => {
    expect(deliveryNote({ reason: "kod xanası tapılmadı" })).toBe(" — çatdırılmadı: kod xanası tapılmadı");
  });

  it("səbəb də yoxdursa quyruq boşdur (status mətni təmiz qalır)", () => {
    expect(deliveryNote()).toBe("");
    expect(deliveryNote({})).toBe("");
  });

  it("uğur varsa səbəb yazılmır", () => {
    expect(deliveryNote({ copied: true, reason: "kod xanası tapılmadı" })).toBe(" — kopyalandı");
  });
});
