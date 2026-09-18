// Poçt qutusu vəziyyət modelinin (shared/inbox.js) testləri.
// Vəziyyət saf məlumatdır — popup və worker eyni formanı oxuyur, ona görə hər keçid və
// hər mətn burada yoxlanılır. İşlətmək: npm test
import assert from "node:assert/strict";
import { describe, it } from "node:test";

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
} from "../src/shared/inbox.js";

const HIT = { code: "483920", link: null, subject: "Confirm your email", from: "Nexora <no-reply@nexora.example>", reasons: ["göndərən: nexora.example"] };
const LINK_HIT = { code: null, link: "https://nexora.example/verify?k=abc", subject: "Verify", from: "no-reply@nexora.example", reasons: [] };

describe("watchingInbox", () => {
  it("başlanğıc vəziyyəti qurur — kod və keçid hələ boşdur", () => {
    const inbox = watchingInbox("u@gmail.com", { started: 1000 });
    assert.equal(inbox.phase, InboxPhase.watching);
    assert.equal(inbox.address, "u@gmail.com");
    assert.equal(inbox.code, null);
    assert.equal(inbox.link, null);
    assert.deepEqual(inbox.reasons, []);
    assert.equal(inbox.checked, 0);
    assert.equal(inbox.message, null);
    assert.equal(inbox.started, 1000);
    assert.ok(inbox.updated >= 1000);
  });

  it("arqumentsiz çağırılanda öz vaxtını yazır", () => {
    const before = Date.now();
    const inbox = watchingInbox("u@gmail.com");
    assert.ok(inbox.started >= before);
    // started və updated iki ayrı Date.now() çağırışıdır — millisaniyə sərhəddində
    // fərqlənə bilər, ona görə bərabərlik yox, ardıcıllıq yoxlanılır
    assert.ok(inbox.updated >= inbox.started && inbox.updated - inbox.started < 50);
  });

  it("checked ötürülərsə saxlanılır (worker yenidən işə düşəndə say itmir)", () => {
    assert.equal(watchingInbox("u@gmail.com", { checked: 7 }).checked, 7);
  });
});

describe("foundInbox", () => {
  it("tapıntını kodla yazır, başlanğıc vaxtını qoruyur", () => {
    const inbox = watchingInbox("u@gmail.com", { started: 1000, checked: 3 });
    const found = foundInbox(inbox, HIT, { checked: 4 });
    assert.equal(found.phase, InboxPhase.found);
    assert.equal(found.code, "483920");
    assert.equal(found.link, null);
    assert.equal(found.subject, "Confirm your email");
    assert.equal(found.from, "Nexora <no-reply@nexora.example>");
    assert.deepEqual(found.reasons, ["göndərən: nexora.example"]);
    assert.equal(found.message, null);
    assert.equal(found.checked, 4);
    assert.equal(found.started, 1000, "deadline uzanmamalıdır");
    assert.equal(found.address, "u@gmail.com");
    assert.ok(found.updated > 0);
  });

  it("kod yoxdursa keçidi yazır", () => {
    const found = foundInbox(watchingInbox("u@gmail.com"), LINK_HIT);
    assert.equal(found.code, null);
    assert.equal(found.link, "https://nexora.example/verify?k=abc");
  });

  it("checked ötürülməsə köhnə sayı saxlayır", () => {
    assert.equal(foundInbox(watchingInbox("u@gmail.com", { checked: 9 }), HIT).checked, 9);
  });

  it("səhv formalı hit dağılmır", () => {
    const found = foundInbox(watchingInbox("u@gmail.com"), { code: "1", reasons: "sətir" });
    assert.deepEqual(found.reasons, []);
    assert.equal(found.subject, "");
    assert.equal(found.from, "");
  });

  it("köhnə obyektə toxunmur (saxlancdakı forma korlanmır)", () => {
    const inbox = watchingInbox("u@gmail.com");
    foundInbox(inbox, HIT);
    assert.equal(inbox.phase, InboxPhase.watching);
    assert.equal(inbox.code, null);
  });
});

describe("progressInbox və closedInbox", () => {
  it("progress yalnız sayı və vaxtı dəyişir", () => {
    const inbox = watchingInbox("u@gmail.com", { started: 1000, checked: 0 });
    const next = progressInbox(inbox, 5);
    assert.equal(next.checked, 5);
    assert.equal(next.phase, InboxPhase.watching);
    assert.equal(next.started, 1000);
    assert.equal(inbox.checked, 0, "köhnə obyekt dəyişmir");
  });

  it("closed fazanı və səbəbi yazır, started-ı qoruyur", () => {
    const inbox = watchingInbox("u@gmail.com", { started: 1000 });
    const done = closedInbox(inbox, InboxPhase.empty, "5 dəqiqə ərzində məktub gəlmədi");
    assert.equal(done.phase, InboxPhase.empty);
    assert.equal(done.message, "5 dəqiqə ərzində məktub gəlmədi");
    assert.equal(done.started, 1000);
    assert.equal(done.address, "u@gmail.com");
  });
});

describe("inboxPayload", () => {
  it("kod üstündür", () => {
    assert.equal(inboxPayload(foundInbox(watchingInbox("u@gmail.com"), { code: "483920", link: "https://x" })), "483920");
  });

  it("kod yoxdursa keçid", () => {
    assert.equal(inboxPayload(foundInbox(watchingInbox("u@gmail.com"), LINK_HIT)), "https://nexora.example/verify?k=abc");
  });

  it("tapıntı olmayan fazada dəyər yoxdur (clipboard-a heç nə yazılmır)", () => {
    assert.equal(inboxPayload(watchingInbox("u@gmail.com")), null);
    assert.equal(inboxPayload(closedInbox(watchingInbox("u@gmail.com"), InboxPhase.empty, "x")), null);
    assert.equal(inboxPayload(null), null);
  });
});

describe("inboxSummary", () => {
  const watching = watchingInbox("u@gmail.com");

  it("izləmə başlanğıcda", () => {
    assert.match(inboxSummary(watching, watching.updated), /^Poçt izlənilir: aktivasiya kodu/);
  });

  it("yoxlanılan məktubların sayı göstərilir", () => {
    const inbox = progressInbox(watching, 4);
    assert.match(inboxSummary(inbox, inbox.updated), /^Poçt izlənilir: 4 məktub yoxlanıldı/);
  });

  it("tapıntıda kod yazılır", () => {
    assert.equal(inboxSummary(foundInbox(watching, HIT), 0), "Aktivasiya kodu: 483920");
  });

  it("tapıntıda kod yoxdursa keçid yazılır", () => {
    assert.equal(inboxSummary(foundInbox(watching, LINK_HIT), 0), "Aktivasiya keçidi: https://nexora.example/verify?k=abc");
  });

  it("boş nəticədə worker-in yazdığı səbəb göstərilir", () => {
    assert.equal(inboxSummary(closedInbox(watching, InboxPhase.empty, "gözləmə bitdi"), 0), "gözləmə bitdi");
  });

  it("xətada səbəb göstərilir", () => {
    assert.equal(inboxSummary(closedInbox(watching, InboxPhase.error, "server 502"), 0), "server 502");
  });

  it("səbəb yazılmasa belə boş mətn qalmır", () => {
    assert.equal(inboxSummary(closedInbox(watching, InboxPhase.empty, null), 0), "Uyğun məktub gəlmədi");
    assert.equal(inboxSummary(closedInbox(watching, InboxPhase.error, null), 0), "Poçt qutusu oxunmadı");
  });

  it("inbox yoxdursa null", () => {
    assert.equal(inboxSummary(null), null);
  });
});

describe("inboxStale — worker sönsə izləmə dayandığı bildirilir", () => {
  it("təzə watching bayatlamır", () => {
    const inbox = watchingInbox("u@gmail.com", { started: 0 });
    assert.equal(inboxStale(inbox, inbox.updated + INBOX_STALE_MS - 1), false);
  });

  it("nəbz dayanıbsa bayat sayılır", () => {
    const inbox = watchingInbox("u@gmail.com", { started: 0 });
    assert.equal(inboxStale(inbox, inbox.updated + INBOX_STALE_MS + 1), true);
  });

  it("tapıntı və ya bağlanmış izləmə bayatlamır (nəticə hələ doğrudur)", () => {
    const found = foundInbox(watchingInbox("u@gmail.com"), HIT);
    assert.equal(inboxStale(found, found.updated + INBOX_STALE_MS * 100), false);
    const done = closedInbox(watchingInbox("u@gmail.com"), InboxPhase.empty, "x");
    assert.equal(inboxStale(done, done.updated + INBOX_STALE_MS * 100), false);
  });

  it("inbox yoxdursa false", () => {
    assert.equal(inboxStale(null), false);
  });

  it("bayat izləmənin mətni açıq deyir ki, təkrar başlamaq lazımdır", () => {
    const inbox = watchingInbox("u@gmail.com");
    assert.match(inboxSummary(inbox, inbox.updated + INBOX_STALE_MS + 1), /İzləmə dayandı/);
  });
});

describe("inboxDetail", () => {
  it("tapıntıda mövzu və göndərən göstərilir", () => {
    assert.equal(inboxDetail(foundInbox(watchingInbox("u@gmail.com"), HIT)), "Confirm your email — Nexora <no-reply@nexora.example>");
  });

  it("yalnız bir mənbə varsa o yazılır", () => {
    assert.equal(inboxDetail(foundInbox(watchingInbox("u@gmail.com"), { ...HIT, subject: "" })), "Nexora <no-reply@nexora.example>");
  });

  it("keçid tapıntısında da mövzu və göndərən göstərilir", () => {
    assert.equal(inboxDetail(foundInbox(watchingInbox("u@gmail.com"), LINK_HIT)), "Verify — no-reply@nexora.example");
  });

  it("heç nə yoxdursa null", () => {
    assert.equal(inboxDetail(foundInbox(watchingInbox("u@gmail.com"), { ...LINK_HIT, subject: "", from: "" })), null);
  });

  it("tapıntı olmayan fazada null", () => {
    assert.equal(inboxDetail(watchingInbox("u@gmail.com")), null);
    assert.equal(inboxDetail(null), null);
  });
});

describe("inboxNotification", () => {
  it("kod tapılanda bildiriş qurulur", () => {
    assert.deepEqual(inboxNotification(foundInbox(watchingInbox("u@gmail.com"), HIT)), {
      title: "Aktivasiya kodu",
      message: "483920 — Confirm your email",
    });
  });

  it("mövzu yoxdursa bildirişdə yalnız kod olur", () => {
    const notification = inboxNotification(foundInbox(watchingInbox("u@gmail.com"), { ...HIT, subject: "" }));
    assert.equal(notification.message, "483920");
  });

  it("keçid tapılanda başlıq fərqlidir", () => {
    assert.deepEqual(inboxNotification(foundInbox(watchingInbox("u@gmail.com"), LINK_HIT)), {
      title: "Aktivasiya keçidi",
      message: "https://nexora.example/verify?k=abc",
    });
  });

  it("digər fazalarda bildiriş göndərilmir", () => {
    assert.equal(inboxNotification(watchingInbox("u@gmail.com")), null);
    assert.equal(inboxNotification(closedInbox(watchingInbox("u@gmail.com"), InboxPhase.empty, "x")), null);
    assert.equal(inboxNotification(null), null);
  });
});

describe("inboxLabel", () => {
  it("kod tapıntısında başlıq 'Aktivasiya kodu'-dur", () => {
    assert.equal(inboxLabel(foundInbox(watchingInbox("u@gmail.com"), HIT)), "Aktivasiya kodu");
  });

  it("keçid tapıntısında başlıq 'Aktivasiya keçidi'-dir", () => {
    assert.equal(inboxLabel(foundInbox(watchingInbox("u@gmail.com"), LINK_HIT)), "Aktivasiya keçidi");
  });

  it("kod və keçid bir yerdədirsə kod üstündür (payload ilə eyni qərar)", () => {
    const both = foundInbox(watchingInbox("u@gmail.com"), { ...HIT, link: LINK_HIT.link });
    assert.equal(inboxLabel(both), "Aktivasiya kodu");
    assert.equal(inboxPayload(both), HIT.code);
  });

  it("digər fazalarda başlıq yoxdur", () => {
    assert.equal(inboxLabel(watchingInbox("u@gmail.com")), null);
    assert.equal(inboxLabel(closedInbox(watchingInbox("u@gmail.com"), InboxPhase.empty, "x")), null);
    assert.equal(inboxLabel(null), null);
  });

  it("summary başlıq və dəyərdən qurulur — iki yerdə eyni mətn təkrarlanmır", () => {
    const inbox = foundInbox(watchingInbox("u@gmail.com"), HIT);
    assert.equal(inboxSummary(inbox), `${inboxLabel(inbox)}: ${inboxPayload(inbox)}`);
    const linked = foundInbox(watchingInbox("u@gmail.com"), LINK_HIT);
    assert.equal(inboxSummary(linked), `${inboxLabel(linked)}: ${inboxPayload(linked)}`);
  });

  it("bildirişin başlığı da eyni etiketdir", () => {
    const inbox = foundInbox(watchingInbox("u@gmail.com"), LINK_HIT);
    assert.equal(inboxNotification(inbox).title, inboxLabel(inbox));
  });
});


// deliveryNote — tapıntı ilə nə edildiyinin status quyruğu. Mətn burada qurulur ki,
// worker (background/inbox.js → deliver) və status eyni sözü işlətsin.
describe("deliveryNote", () => {
  it("forma doldurulub və kopyalanıb", () => {
    assert.equal(deliveryNote({ filled: true, copied: true }), " — forma dolduruldu, kopyalandı");
  });

  it("yalnız forma doldurulub", () => {
    assert.equal(deliveryNote({ filled: true }), " — forma dolduruldu");
  });

  it("göndərmə düyməsi basılıbsa onun yazısı görünür", () => {
    assert.equal(deliveryNote({ filled: true, submitted: "create account", copied: true }),
      ' — forma dolduruldu, "create account" basıldı, kopyalandı');
    assert.equal(deliveryNote({ filled: true, submitted: "" }), " — forma dolduruldu");
  });

  it("yalnız kopyalanıb (sayt qeydiyyat addımı vermir)", () => {
    assert.equal(deliveryNote({ copied: true }), " — kopyalandı");
  });

  it("heç biri alınmasa səbəb göstərilir — dəyər paneldə qalır", () => {
    assert.equal(deliveryNote({ reason: "kod xanası tapılmadı" }), " — çatdırılmadı: kod xanası tapılmadı");
  });

  it("səbəb də yoxdursa quyruq boşdur (status mətni təmiz qalır)", () => {
    assert.equal(deliveryNote(), "");
    assert.equal(deliveryNote({}), "");
  });

  it("uğur varsa səbəb yazılmır", () => {
    assert.equal(deliveryNote({ copied: true, reason: "kod xanası tapılmadı" }), " — kopyalandı");
  });
});
