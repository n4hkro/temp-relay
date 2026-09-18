// Relay saytında qeydiyyat addımlarının icrası.
//
// Niyə lazımdır: kodu tapıb clipboard-a yazmaq işi yarımçıq qoyurdu — istifadəçi yenə
// formanı açıb metodu seçir, ünvanı yazır, "Send code" basır, sonra kodu yerləşdirir, parol
// düşünür və "Create account" basır. Bu addımların hamısı mexanikidir, ona görə extension
// onları özü yerinə yetirir.
//
// Bölgü: HANSI element və HANSI ardıcıllıq saytın məlumatıdır (relay deskriptorundaki
// `signup` addımları), NECƏ icra olunacağı isə bütün saytlar üçün eynidir və buradadır.
// Addımlar iki fazaya bölünür:
//   afterAddress — ünvan alınan kimi: metodu seç, ünvanı yaz, kodu istə
//   afterCode    — aktivasiya kodu tapılan kimi: kodu və parolu yaz, hesabı yarat
//
// Səhifəyə köçürülən funksiya `providers/.../page.js` ilə eyni məhdudiyyətlərə tabedir
// (import yoxdur, modul dəyişəni yoxdur, chrome.* yoxdur), çünki mənbəyi `toString` ilə
// serializasiya olunur. Fərq: bu funksiya sayt məlumatı DEYİL, ona görə core-dadır.

import { isLiveSession, type Session } from "../shared/state";

// Faza adları: deskriptor da, contract.ts da bu siyahını işlədir
export const SignupPhase = Object.freeze({ afterAddress: "afterAddress", afterCode: "afterCode" });
// Addımın `value` sahəsində icazəli dəyər adları — worker onları konkret sətirlə doldurur
export const SLOTS = Object.freeze(["address", "username", "code", "password"]);

// Elementin görünməsini gözləmə limiti (səhifə açılan kimi mövcud olmalıdır)
export const FIND_TIMEOUT_MS = 8000;
// `enabled: true` və `waitValue` addımları: saytın öz hazırlığını gözləyir.
// Cloudflare Turnstile token-i ~9 saniyəyə gəlir; contract.ts limiti 25 saniyədir.
export const ENABLED_TIMEOUT_MS = 22000;
// MV3 worker-i ~30 s boşluqdan sonra sönür; gözləmə müddətində nəbz göndərilir
// (eyni üsul: background/inbox.ts → pulse)
const KEEPALIVE_MS = 15000;

// Deskriptorda yazılan xam addım (contract.ts → validateSignup qaydalarına tabedir)
export interface DeclaredStep {
  click?: string;
  fill?: string;
  waitValue?: string;
  value?: string;
  text?: string;
  enabled?: boolean;
  timeoutMs?: number;
}

// İcraya hazır addım (resolveSteps nəticəsi) — səhifəyə köçürülən formadır
export interface SignupStep {
  action: "wait" | "fill" | "click";
  selector: string;
  text: string | null;
  value: string | null;
  enabled: boolean;
  timeoutMs: number;
}

export interface SignupStepResult {
  done: boolean;
  at?: number;
  reason?: string;
}

// Qeydiyyat addımı axtarışı üçün relay-in lazım olan hissəsi: funksiyalar yalnız
// `signup`-u oxuyur (`relay?.signup`), ona görə natamam obyekt də qəbul olunur —
// real deskriptorlar da, testlərdəki qismən formalar da bu tipə uyğundur.
export interface SignupStepSource {
  signup?: unknown;
}

export const signupSteps = (
  relay: SignupStepSource | null | undefined,
  phase: string,
): DeclaredStep[] => {
  // Faza adı sətirdir (SignupPhase dəyərləri), deskriptorun signup forması isə yalnız
  // məlum fazaları tanıyır — indeksləmə tip səviyyəsində sərbəst mappinq ilə aparılır.
  const steps: unknown = (relay?.signup as Record<string, unknown> | undefined)?.[phase];
  return Array.isArray(steps) ? (steps as DeclaredStep[]) : [];
};

export const supportsSignup = (
  relay: SignupStepSource | null | undefined,
  phase: string,
): boolean => signupSteps(relay, phase).length > 0;

// Hər hansı addım verilən dəyəri tələb edirsə sessiya üçün o dəyər hazırlanmalıdır
export const usesSlot = (relay: SignupStepSource | null | undefined, slot: string): boolean =>
  Object.values(SignupPhase).some((phase) => signupSteps(relay, phase).some((step) => step?.value === slot));

export const usesPassword = (relay: SignupStepSource | null | undefined): boolean =>
  usesSlot(relay, "password");

// SƏHİFƏDƏ icra olunur. Nəticə həmişə obyektdir — throw etmir (page.js ilə eyni qayda).
// `export` yalnız test üçündür (tests/signup.test.ts saxta DOM ilə çağırır).
export const runInPage = async (steps: SignupStep[]): Promise<SignupStepResult> => {
  const seen = (el: Element | null | undefined): boolean =>
    !!(el && ((el as HTMLElement).offsetParent || (el as HTMLElement).offsetWidth || (el as HTMLElement).offsetHeight));

  // Selektor + (istəyə bağlı) mətn: bəzi düymələrin sabit atributu olmur, yalnız yazısı var
  const matching = (step: SignupStep): Element[] => {
    let found: Element[] = [];
    try {
      found = [...document.querySelectorAll(step.selector)];
    } catch {
      return [];                       // pozulmuş selektor: addım "tapılmadı" kimi bitir
    }
    if (!step.text) return found;
    const needle = step.text.toLowerCase();
    const text = (el: Element): string => ((el.textContent ?? "") as string).trim().toLowerCase();
    const exact = found.filter((el) => text(el) === needle);
    return exact.length ? exact : found.filter((el) => text(el).includes(needle));
  };

  // Addım üçün hazır element.
  //   wait  — element mövcud olmalı və `value`-su boş olmamalıdır. GÖRÜNMƏK tələb olunmur:
  //           Turnstile token-i `type="hidden"` input-dadır.
  //   click/fill — element görünən olmalı, `enabled` istənilibsə aktiv də olmalı.
  const ready = (step: SignupStep): Element | null => {
    const found = matching(step);
    if (step.action === "wait") {
      return found.find((el) => typeof (el as HTMLInputElement).value === "string"
        && (el as HTMLInputElement).value.trim() !== "") ?? null;
    }
    const candidates = found.filter(seen);
    if (!candidates.length) return null;
    if (!step.enabled) return candidates[0];
    return candidates.find((el) =>
      !(el as HTMLInputElement).disabled && el.getAttribute("aria-disabled") !== "true") ?? null;
  };

  // Arxa plandaki tabda setTimeout boğulur, MutationObserver isə yox — gözləmə ona bağlanır.
  // Aralıq yoxlama `disabled` kimi PROPERTY dəyişiklikləri üçün ehtiyatdır (atribut dəyişməsə
  // observer işə düşmür).
  const waitFor = (step: SignupStep): Promise<Element | null> => new Promise((resolve) => {
    const immediate = ready(step);
    if (immediate) { resolve(immediate); return; }
    let settled = false;
    const finish = (value: Element | null): void => {
      if (settled) return;
      settled = true;
      observer.disconnect();
      clearInterval(ticker);
      clearTimeout(timer);
      resolve(value);
    };
    const check = (): void => { const el = ready(step); if (el) finish(el); };
    const observer = new MutationObserver(check);
    observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
    const ticker = setInterval(check, 400);
    const timer = setTimeout(() => finish(null), step.timeoutMs);
  });

  for (let index = 0; index < steps.length; index++) {
    const step = steps[index];
    const el = await waitFor(step);
    if (!el) {
      const what = step.text ? `${step.selector} ("${step.text}")` : step.selector;
      const why = step.action === "wait"
        ? "dəyər gözlənildi, gəlmədi: "
        : step.enabled ? "aktiv element gözlənildi: " : "element tapılmadı: ";
      return { done: false, at: index, reason: why + what };
    }

    if (step.action === "wait") continue;   // şərt ödəndi, başqa iş yoxdur

    if (step.action === "fill") {
      // React/Vue idarə edən xanada `el.value = x` state-ə ÇATMIR: dəyər prototipdəki native
      // setter ilə yazılır və hadisələr özümüz göndəririk — framework onu istifadəçi
      // yazısı kimi qəbul edir.
      const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value")?.set as
        | ((this: unknown, value: string) => void)
        | undefined;
      try {
        (el as HTMLElement).focus?.();
        if (setter) setter.call(el, step.value as string);
        else (el as HTMLInputElement).value = step.value as string;
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      } catch (e) {
        return { done: false, at: index, reason: "dəyər yazılmadı: " + ((e as { message?: unknown })?.message ?? e) };
      }
      // maxlength dəyəri kəsə bilər, framework isə onu geri qaytara bilər
      if ((el as HTMLInputElement).value !== step.value) {
        return { done: false, at: index, reason: "xana dəyəri saxlamadı (maxlength?): " + step.selector };
      }
      (el as HTMLElement).scrollIntoView?.({ block: "center" });
    } else {
      try {
        (el as HTMLElement).click();
      } catch (e) {
        return { done: false, at: index, reason: "klik alınmadı: " + ((e as { message?: unknown })?.message ?? e) };
      }
    }
  }
  return { done: true, at: steps.length };
};

// Deskriptordaki addımları icraya hazır formaya salır: `value` adları konkret sətirlərlə
// dəyişilir (parol və kod worker-də yaranır/tapılır, səhifəyə yalnız hazır dəyər gedir).
export function resolveSteps(
  steps: DeclaredStep[],
  slots?: Record<string, string | null | undefined>,
): { steps?: SignupStep[]; error?: string } {
  const out: SignupStep[] = [];
  for (const step of steps) {
    const isWait = typeof step.waitValue === "string";
    const isFill = typeof step.fill === "string";
    const action: SignupStep["action"] = isWait ? "wait" : isFill ? "fill" : "click";
    const value = isFill ? slots?.[step.value as string] : null;
    if (isFill && (typeof value !== "string" || !value)) {
      return { error: `"${step.value}" dəyəri hazır deyil (addım: ${step.fill})` };
    }
    out.push({
      action,
      selector: (isWait ? step.waitValue : isFill ? step.fill : step.click) as string,
      text: typeof step.text === "string" ? step.text : null,
      value: isFill ? (value as string) : null,
      enabled: step.enabled === true,
      timeoutMs: Number.isInteger(step.timeoutMs)
        ? (step.timeoutMs as number)
        : (isWait || step.enabled === true ? ENABLED_TIMEOUT_MS : FIND_TIMEOUT_MS),
    });
  }
  return { steps: out };
}

// Fazanın addımlarını relay tabında icra edir. Nəticə: { done, at?, reason? } — heç vaxt
// throw etmir, çünki qalan çatdırılma yolları (clipboard, status, bildiriş, popup paneli)
// bundan asılı olmamalıdır.
export async function runSignup(
  session: Session,
  relay: SignupStepSource,
  phase: string,
  slots?: Record<string, string | null | undefined>,
): Promise<SignupStepResult> {
  const declared = signupSteps(relay, phase);
  if (!declared.length) return { done: false, reason: "addım yazılmayıb" };
  if (!session?.relayTabId) return { done: false, reason: "relay tabı yoxdur" };
  // Sessiya bu arada dəyişibsə (Dayandır / yeni Başlat) başqasının tabına toxunmuruq
  if (!await isLiveSession(session)) return { done: false, reason: "sessiya dəyişdi" };

  const { steps, error } = resolveSteps(declared, slots);
  if (error) return { done: false, reason: error };

  // Gözləmə 20 saniyəyə qədər sürə bilər: nəbz worker-i oyaq saxlayır
  const beat = setInterval(() => { chrome.runtime.getPlatformInfo().catch(() => {}); }, KEEPALIVE_MS);
  try {
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId: session.relayTabId },
      func: runInPage,
      args: [steps as SignupStep[]],
      world: "MAIN",              // saytın öz React nümunəsi ilə eyni dünyada olmalıyıq
    });
    const result = injection?.result as SignupStepResult | undefined;
    if (!result || typeof result !== "object") return { done: false, reason: "səhifə cavab qaytarmadı" };
    return result;
  } catch (e) {
    // Tab bağlanıb, başqa sayta gedib və ya skript yeridilə bilməyib — gözlənilən haldır
    return { done: false, reason: ((e as { message?: unknown })?.message ?? String(e)) as string };
  } finally {
    clearInterval(beat);
  }
}
