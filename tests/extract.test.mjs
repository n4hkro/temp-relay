// Poçt təhlili qatının testləri (src/shared/extract.js).
// Bu modul "gələn məktublardan yalnız bizə lazım olanı çıxar" vədini qoruyur: uyğunluq
// qiymətləndirməsi, keçid süzgəci və kod axtarışı — hamısı saf funksiyadır.
// İşlətmək: npm test
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  MIN_RELEVANCE,
  bestLink,
  cleanUrl,
  decodeEntities,
  extractFromMessage,
  findCode,
  harvestLinks,
  hostMatches,
  htmlToText,
  mailHints,
  messageText,
  normalizeMessages,
  pickFromMessages,
  registrableDomain,
  relevance,
} from "../src/shared/extract.js";

// Relay deskriptoru kimi: nexora.example (mail sahəsi yazılmayıb → domendən törədilir)
const hints = mailHints({ id: "nexora", name: "Nexora", url: "https://nexora.example/register" });

const html = (body) => ({ body, bodyContentType: "html" });

// Real aktivasiya məktubuna bənzər nümunə: keçid düyməsi, kod, footer-də reklam linkləri
const ACTIVATION = {
  id: "m1",
  date: "2026-09-11T10:00:00.000Z",
  from: "Nexora <no-reply@nexora.example>",
  subject: "Nexora — confirm your email address",
  bodyContentType: "html",
  body: [
    "<html><body><h2>Welcome to Nexora</h2>",
    '<p>Your verification code is <strong>483920</strong>. It expires in 10 minutes.</p>',
    '<p><a href="https://nexora.example/confirm?token=a91fQ2&amp;uid=7731">Confirm my account</a></p>',
    '<p style="font-size:11px">© 2026 Nexora. <a href="https://nexora.example/privacy">Privacy</a> · ',
    '<a href="https://list-manage.com/unsubscribe?u=1">Unsubscribe</a> · ',
    '<a href="https://facebook.com/nexora">Facebook</a></p>',
    "</body></html>",
  ].join(""),
};

describe("decodeEntities / htmlToText", () => {
  it("adlandırılmış və rəqəmli entity-ləri açır", () => {
    assert.equal(decodeEntities("a &amp; b &#53; &#x41; &nbsp;"), "a & b 5 A  ");
  });

  it("naməlum entity-yə toxunmur, surrogat aralığını qaytarmır", () => {
    assert.equal(decodeEntities("&unknown; &#xD800;"), "&unknown; &#xD800;");
  });

  it("style/script bloklarını atır, sözləri birləşdirmir", () => {
    const text = htmlToText("<style>a{color:red}</style><p>bir</p><p>iki</p>");
    assert.equal(text.includes("color"), false);
    assert.match(text, /bir\niki/);
  });

  it("bodyContentType html deyilsə body olduğu kimi oxunur", () => {
    assert.equal(messageText({ body: "salam <b>", bodyContentType: "text" }), "salam <b>");
    assert.equal(messageText(html("salam <b>")), "salam");
  });
});

describe("domen uyğunluğu", () => {
  it("registrableDomain son iki etiketi götürür", () => {
    assert.equal(registrableDomain("mail.nexora.example"), "nexora.example");
    assert.equal(registrableDomain("NEXORA.EXAMPLE"), "nexora.example");
  });

  // Cookie silməsi bu dəyərlə aparılır: "co.uk" qaytarılsa `chrome.cookies.getAll({domain})`
  // BÜTÜN .co.uk saytlarının cookie-lərini gətirər və hamısı silinərdi.
  it("çox etiketli ictimai şəkilçi kəsilmir (co.uk, com.tr, github.io…)", () => {
    assert.equal(registrableDomain("shop.example.co.uk"), "example.co.uk");
    assert.equal(registrableDomain("example.co.uk"), "example.co.uk");
    assert.equal(registrableDomain("www.firma.com.tr"), "firma.com.tr");
    assert.equal(registrableDomain("blog.user.github.io"), "user.github.io");
    assert.equal(registrableDomain("app.proje.vercel.app"), "proje.vercel.app");
    assert.equal(registrableDomain("bucket.s3.amazonaws.com"), "bucket.s3.amazonaws.com");
  });

  it("adi domenlərdə davranış dəyişmir", () => {
    assert.equal(registrableDomain("login.microsoftonline.com"), "microsoftonline.com");
    assert.equal(registrableDomain("a.b.c.example.com"), "example.com");
    assert.equal(registrableDomain("example.com"), "example.com");
    assert.equal(registrableDomain("localhost"), "localhost");
  });

  it("IP ünvanı kəsilmir (127.0.0.1 → 0.1 olsaydı cookie silinməzdi)", () => {
    assert.equal(registrableDomain("127.0.0.1"), "127.0.0.1");
    assert.equal(registrableDomain("192.168.1.10"), "192.168.1.10");
    assert.equal(registrableDomain("[::1]"), "[::1]");
  });

  it("hostMatches alt-domenləri də əhatə edir", () => {
    assert.equal(hostMatches("no-reply.mail.nexora.example", "nexora.example"), true);
    assert.equal(hostMatches("nonexora.example", "nexora.example"), false);
    assert.equal(hostMatches("nexora.example.evil.example", "nexora.example"), false);
  });

  it("mailHints url-dən domen və açar söz törədir, ümumi sözləri atır", () => {
    assert.deepEqual(hints.domains, ["nexora.example"]);
    assert.deepEqual(hints.keywords, ["nexora"]);
  });

  it("mailHints deskriptordakı mail sahəsini üstün tutur", () => {
    const custom = mailHints({
      url: "https://relay.example/register",
      mail: { fromDomains: ["mailer.example"], keywords: ["Relay Example", "ab"], },
    });
    assert.deepEqual(custom.domains, ["mailer.example", "relay.example"]);
    assert.ok(custom.keywords.includes("mailer"));          // domendən törəyən
    assert.ok(custom.keywords.includes("relay example"));   // deskriptorda yazılan olduğu kimi qalır
    assert.equal(custom.keywords.includes("ab"), false);    // 3 hərfdən qısa olan atılır
  });
});

describe("uyğunluq (relevance)", () => {
  it("saytın öz məktubu eşiyi keçir", () => {
    const { score, reasons } = relevance(ACTIVATION, hints);
    assert.ok(score >= MIN_RELEVANCE, `xal ${score} azdır`);
    assert.ok(reasons.length > 0);
  });

  it("yad saytın məktubu keçmir", () => {
    const foreign = {
      ...ACTIVATION,
      from: "Shop <news@shop.example>",
      subject: "Your discount code inside",
      body: '<p>Save 20% with code 554433. <a href="https://shop.example/u?id=1">Shop now</a></p>',
    };
    assert.ok(relevance(foreign, hints).score < MIN_RELEVANCE);
  });

  it("göndərən yaddan çıxmış subdomendir, amma keçid sayta gedirsə məktub bizimdir", () => {
    const via = {
      from: "Mailer <bounce@mailgun.org>",
      subject: "Confirm your account",
      body: '<a href="https://nexora.example/confirm?token=zzz">Confirm</a>',
      bodyContentType: "html",
    };
    assert.ok(relevance(via, hints).score >= MIN_RELEVANCE);
  });

  it("mövzuda saytın adı kifayət edir", () => {
    const subject = { from: "x@y.example", subject: "Nexora hesabınız", body: "salam", bodyContentType: "text" };
    assert.ok(relevance(subject, hints).score >= MIN_RELEVANCE);
  });
});

describe("keçidlər", () => {
  it("yalnız ana səhifə keçidi olan xoş gəldin məktubu izləməni bitirmir", () => {
    const message = { ...ACTIVATION, subject: "Welcome to Nexora", body: '<a href="https://nexora.example/">Home</a>' };
    assert.equal(extractFromMessage(message, hints), null);
  });
  it("entity-ləri açır, son punktuasiyanı kəsir, etibarsız ünvanı atır", () => {
    assert.equal(cleanUrl("https://nexora.example/c?token=a&amp;b=1."), "https://nexora.example/c?token=a&b=1");
    assert.equal(cleanUrl("ftp://nexora.example/"), "");
    assert.equal(cleanUrl("https://nexora .com/"), "");
  });

  it("href və çılpaq ünvanların ikisini də yığır, təkrarı atır", () => {
    const message = html('<a href="https://nexora.example/a">A</a> https://nexora.example/a və https://nexora.example/b');
    assert.deepEqual(harvestLinks(message).map((l) => l.url), ["https://nexora.example/a", "https://nexora.example/b"]);
  });

  it("aktivasiya keçidini reklam və unsubscribe-dan üstün tutur", () => {
    const link = bestLink(ACTIVATION, hints);
    assert.equal(link.url, "https://nexora.example/confirm?token=a91fQ2&uid=7731");
    assert.ok(link.score >= 40);
  });

  it("saytın öz unsubscribe keçidi aktivasiya sayılmır", () => {
    const message = html('<a href="https://nexora.example/unsubscribe"> çıx </a><a href="https://facebook.com/x">fb</a>');
    const link = bestLink(message, hints);
    assert.equal(link, null);
  });

  it("izləyici host (click.*) aktivasiya keçidi sayılmır", () => {
    const message = html('<a href="https://click.mailer.example/t?u=https://nexora.example/c">getir</a>');
    assert.equal(bestLink(message, hints), null);
  });
});

describe("aktivasiya kodu", () => {
  it("kod yalnız məktubun mövzusundadırsa da tapılır", () => {
    assert.equal(findCode({ subject: "Your verification code: 839271", body: "Use the code above to sign up." })?.value, "839271");
  });

  it("mövzu və gövdədə təkrarlanan kod bir uzun kod kimi birləşmir", () => {
    assert.equal(findCode({ subject: "Your verification code: 4839", body: "4839 is your verification code." })?.value, "4839");
  });
  it("adi aktivasiya məktubundan 6 rəqəmli kodu tapır", () => {
    assert.equal(findCode(ACTIVATION)?.value, "483920");
  });

  it("URL-in içindəki təsadüfi sətir kod sayılmır", () => {
    const message = { subject: "Nexora", bodyContentType: "text", body: "Keçid: https://nexora.example/c?token=998877665544" };
    assert.equal(findCode(message), null);
  });

  it("il kimi görünən dəyər endirilir", () => {
    const year = { subject: "Nexora", bodyContentType: "text", body: "© 2026 Nexora" };
    const real = { subject: "Nexora", bodyContentType: "text", body: "Kod: 202611" };
    assert.equal(findCode(year), null);
    assert.equal(findCode(real)?.value, "202611");
  });

  it("açar söz yaxınlığı və HTML vurğusu xalı artırır", () => {
    const plain = { subject: "x", bodyContentType: "text", body: "sifariş 554433 çatdırıldı, kod 918273 sizin üçündür" };
    assert.equal(findCode(plain)?.value, "918273");
  });

  it("hərf+rəqəm qarışığı da tapılır (rəqəmli seçim yoxdursa)", () => {
    const mixed = { subject: "Nexora", bodyContentType: "text", body: "Verification code: X9K2M4" };
    assert.equal(findCode(mixed)?.value, "X9K2M4");
  });

  it("kod sözündən sonra nöqtəli-bloklu yazılış da oxunur", () => {
    const spaced = { subject: "Nexora", bodyContentType: "text", body: "Kodunuz: 123 456" };
    assert.equal(findCode(spaced)?.value, "123456");
  });
});

describe("normalizeMessages", () => {
  it("zərf formasını da, çılpaq massivi də oxuyur", () => {
    const bare = normalizeMessages([ACTIVATION]);
    const wrapped = normalizeMessages({ data: [ACTIVATION], totalReceived: 1728892 });
    assert.equal(bare.length, 1);
    assert.deepEqual(wrapped[0].id, bare[0].id);
  });

  it("təkrar id-ni atır, təzəni öndə saxlayır, çatışmayan sahəni boşaldır", () => {
    const older = { ...ACTIVATION, id: "m0", date: "2026-09-11T09:00:00.000Z" };
    const list = normalizeMessages({ data: [older, ACTIVATION, ACTIVATION, { id: 7 }] });
    assert.deepEqual(list.map((m) => m.id), ["m1", "m0", "7"]);
    assert.equal(list[2].subject, "");
    assert.equal(list[2].bodyContentType, "text");
  });

  it("id yoxdursa mövzu+tarix əvəz edir (dedupikasiya işləsin deyə)", () => {
    const list = normalizeMessages([{ subject: "A", date: "d1" }, { subject: "A", date: "d1" }]);
    assert.equal(list.length, 1);
  });

  it("zərf pozulubsa boş massiv qaytarır, xəta atmır", () => {
    assert.deepEqual(normalizeMessages(null), []);
    assert.deepEqual(normalizeMessages({ data: "sətir" }), []);
    assert.deepEqual(normalizeMessages({ totalReceived: 5 }), []);
  });
});

describe("extractFromMessage / pickFromMessages", () => {
  it("eyni saytın yenidən göndərilmiş kodu köhnə, daha çox nişanlı məktubdan üstündür", () => {
    const older = { ...ACTIVATION, date: "2026-09-17T10:00:00Z" };
    const newer = { id: "resent", date: "2026-09-17T10:01:00Z", from: "no-reply@nexora.example",
      subject: "Verification code", body: "Your verification code: 938271" };
    assert.equal(pickFromMessages([older, newer], hints)?.code, "938271");
  });
  it("uyğun məktubdan həm kodu, həm keçidi verir", () => {
    const found = extractFromMessage(ACTIVATION, hints);
    assert.equal(found.code, "483920");
    assert.equal(found.link, "https://nexora.example/confirm?token=a91fQ2&uid=7731");
    assert.match(found.subject, /confirm your email/i);
    assert.ok(found.reasons.length > 0);
    assert.equal(typeof found.at, "number");
  });

  it("uyğun olmayan məktub üçün null qaytarır", () => {
    assert.equal(extractFromMessage({ from: "a@b.example", subject: "salam", body: "", bodyContentType: "text" }, hints), null);
  });

  it("saytın məktubudur, amma nə kod nə keçid yoxdursa null", () => {
    const bare = { from: "no-reply@nexora.example", subject: "Nexora", body: "təşəkkürlər", bodyContentType: "text" };
    assert.equal(extractFromMessage(bare, hints), null);
  });

  it("siyahıdan yalnız bizim sayta aid olanı seçir", () => {
    const noise = {
      id: "n1",
      date: "2026-09-11T11:00:00.000Z",   // daha TƏZƏDİR — yenə də seçilməməlidir
      from: "Shop <news@shop.example>",
      subject: "Big sale, code 112233",
      body: '<a href="https://shop.example/sale">Buy</a>',
      bodyContentType: "html",
    };
    const found = pickFromMessages([noise, ACTIVATION], hints);
    assert.equal(found.code, "483920");
  });

  it("heç bir məktub uyğun gəlmirsə null", () => {
    assert.equal(pickFromMessages([], hints), null);
    assert.equal(pickFromMessages([{ from: "x@y.example", subject: "reklam", body: "", bodyContentType: "text" }], hints), null);
  });

  it("kod yoxdursa yalnız keçidi verir (link-only aktivasiya)", () => {
    const linkOnly = {
      id: "l1",
      from: "Nexora <no-reply@nexora.example>",
      subject: "Activate your Nexora account",
      body: '<p>Click here to activate: <a href="https://nexora.example/a?t=zz9">Activate</a></p>',
      bodyContentType: "html",
    };
    const found = extractFromMessage(linkOnly, hints);
    assert.equal(found.code, null);
    assert.equal(found.link, "https://nexora.example/a?t=zz9");
  });

  it("keçid yoxdursa yalnız kodu verir (kod-only aktivasiya)", () => {
    const codeOnly = {
      id: "c1",
      from: "Nexora <no-reply@nexora.example>",
      subject: "Nexora verification code",
      body: "Your code is 778899. Do not share it.",
      bodyContentType: "text",
    };
    const found = extractFromMessage(codeOnly, hints);
    assert.equal(found.code, "778899");
    assert.equal(found.link, null);
  });
});
