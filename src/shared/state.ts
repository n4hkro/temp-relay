// Vəziyyət qatı. Service worker ~30 s boş qalanda söndürülür, ona görə worker-in öz
// yaddaşında saxlanan heç nə uzun iş axını üçün etibarlı deyil: bütün vəziyyət
// chrome.storage-dadır və hər addımda oradan oxunur.
//
//   session (storage.session) — aktiv sessiya: seçilmiş provider-lər, tab/pəncərə id-ləri.
//                               Brauzer bağlananda silinir; bu qəsdəndir (sessiya bitir).
//   status  (storage.session) — popup-da göstərilən son hadisə: { level, text, time }.
//   inbox   (storage.session) — poçt izləməsinin vəziyyəti: tapılan kod/keçid, mərhələ, nəbz.
//                               Worker sönsə də popup bunu göstərir (shared/inbox.ts forması).
//   choice  (storage.local)   — popup-dakı son seçim; qalıcıdır, yenidən seçməyə ehtiyac qalmır.
//
// Popup və worker eyni köməkçiləri işlədir: açarlar və status forması bir yerdə təyin olunur.

// shared → shared istinadı (dövrsüz: proxy.js state-i tanımır) — köhnə idxal qeydlərinin
// süzgəci oxu qatında işləməlidir ki, həm popup, həm worker eyni təmiz siyahını görsün.
import { pruneImported } from "./proxy";
import type { ProxyEntry } from "./proxy";
import type { Choice } from "./options";
import type { InboxState } from "./inbox";
import type { Identity } from "./identity";

export const StorageArea = Object.freeze({ session: "session", local: "local" } as const);
export type StorageAreaName = (typeof StorageArea)[keyof typeof StorageArea];

export const StorageKey = Object.freeze({
  session: "session",
  status: "status",
  choice: "choice",
  inbox: "inbox",
  theme: "theme",
  pendingWipe: "pendingWipe",
  proxies: "proxies",
  activeProxy: "activeProxy",
  shield: "shield",
} as const);
export type StorageKeyName = (typeof StorageKey)[keyof typeof StorageKey];

// Statusun səviyyəsi — popup rəngi buna görə seçir (mətni "Xəta" ilə başlamır)
export const StatusLevel = Object.freeze({ info: "info", warn: "warn", error: "error" } as const);
export type StatusLevelValue = (typeof StatusLevel)[keyof typeof StatusLevel];

export interface Status {
  level: StatusLevelValue;
  text: string;
  time: number;
}

// Aktiv sessiya (storage.session → "session"). Bütün sahələr istəyə bağlıdır: sessiya
// mərhələ-mərhələ doldurulur (ünvan, parol, şəxs profili sonra yaranır).
export interface Session {
  id?: string;
  tempId?: string;
  relayId?: string;
  relaySite?: string;
  tempTabId?: number | null;
  relayTabId?: number;
  windowId?: number;
  options?: Record<string, unknown>;
  address?: string | null;
  username?: string;
  password?: string;
  identity?: Identity;
  started?: number;
  [key: string]: unknown;
}

// Host icazəsi gözləyən yarımçıq silmə (storage.session → "pendingWipe")
export interface PendingWipe {
  tabId: number;
  domain: string;
  at: number;
}

export type Theme = "light" | "dark";

export interface StoredProxies {
  list: ProxyEntry[];
  updated: number;
}

const store = (name: StorageAreaName): chrome.storage.StorageArea => {
  const areas: Record<StorageAreaName, chrome.storage.StorageArea> = {
    session: chrome.storage.session,
    local: chrome.storage.local,
  };
  return areas[name];
};

const read = async <T>(areaName: StorageAreaName, key: string): Promise<T | null> =>
  ((await store(areaName).get(key)) as Record<string, T>)[key] ?? null;
const write = async (areaName: StorageAreaName, key: string, value: unknown): Promise<void> => {
  await store(areaName).set({ [key]: value });
};

// --- sessiya ---------------------------------------------------------------------------
export const readSession = (): Promise<Session | null> =>
  read<Session>(StorageArea.session, StorageKey.session);
// Bütün yazıçılar worker-dədir. Read-modify-write ilə silməni eyni sırada saxlayırıq:
// paralel patch məlumat itirmir, Dayandır-dan əvvəlki patch sessiyanı diriltmir.
let sessionWrites: Promise<unknown> = Promise.resolve();
function mutateSession<T>(job: () => Promise<T>): Promise<T> {
  const result: Promise<T> = sessionWrites.then(job);
  sessionWrites = result.catch(() => {});
  return result;
}
export const writeSession = (session: Session): Promise<void> => {
  const snapshot = structuredClone(session);
  return mutateSession(() => write(StorageArea.session, StorageKey.session, snapshot));
};
export const clearSession = (): Promise<void> =>
  mutateSession(() => store(StorageArea.session).remove(StorageKey.session));

const sameSession = (
  current: Session | null | undefined,
  session: Session | null | undefined,
): boolean => Boolean(current && session)
  && (current?.id != null || session?.id != null
    ? current?.id === session?.id
    : current?.started === session?.started);

// Sessiya eyniliyi UUID ilə, köhnə qeydlərdə isə "started" ilə tanınır. Uzun axınlarda (səhifənin yüklənməsi,
// cookie silinməsi) bu arada Dayandır basıla və ya yeni Başlat ola bilər; yoxlamasız köhnə
// axın sessiyanı dirildib tab izləməsini davam etdirərdi.

// Sessiya hələ saxlancda və bu axının başladığı sessiyadır?
export async function isLiveSession(session: Session | null | undefined): Promise<boolean> {
  const current = await readSession();
  return sameSession(current, session);
}

// Sessiya sahələrini təzələyir. writeSession-dan fərqi: yalnız eyni sessiya hələ
// aktivdirsə yazır və false qaytarır (çağıranda axın dayandırılmalıdır). Yazılanda həm
// saxlanc, həm də çağıranın canlı session obyekti təzələnir.
export function updateSession(session: Session, patch: Partial<Session>): Promise<boolean> {
  const changes = structuredClone(patch);
  return mutateSession(async () => {
    const current = await readSession();
    if (!sameSession(current, session)) return false;
    await write(StorageArea.session, StorageKey.session, { ...current, ...changes });
    Object.assign(session, changes);
    return true;
  });
}

// --- status ----------------------------------------------------------------------------
export const readStatus = (): Promise<Status | null> =>
  read<Status>(StorageArea.session, StorageKey.status);
export const writeStatus = (level: StatusLevelValue, text: string): Promise<void> =>
  write(StorageArea.session, StorageKey.status, { level, text, time: Date.now() });

// --- poçt qutusu ------------------------------------------------------------------------
// Forması shared/inbox.ts-dədir. Saxlanc sahəsi session-dır: brauzer bağlananda sessiya ilə
// birgə silinir, köhnə kod popup-da qalmır.
export const readInbox = (): Promise<InboxState | null> =>
  read<InboxState>(StorageArea.session, StorageKey.inbox);
export const writeInbox = (
  inbox: InboxState,
  guard: () => boolean | Promise<boolean> = () => true,
): Promise<boolean> => mutateSession(async () => {
  if (!await guard()) return false;
  await write(StorageArea.session, StorageKey.inbox, inbox);
  return true;
});
export const clearInbox = (): Promise<void> =>
  mutateSession(() => store(StorageArea.session).remove(StorageKey.inbox));

// --- son seçim -------------------------------------------------------------------------
export const readChoice = (): Promise<Choice | null> =>
  read<Choice>(StorageArea.local, StorageKey.choice);
export const writeChoice = (choice: Choice): Promise<void> =>
  write(StorageArea.local, StorageKey.choice, choice);

// --- tema ------------------------------------------------------------------------------
// "light" | "dark" | null (null = sistemin seçimi). Qalıcıdır: popup hər açılışda eyni
// görünməlidir. Yalnız popup işlədir, amma açar burada saxlanılır ki, saxlanc açarları
// bir yerdə olsun.
export const readTheme = (): Promise<Theme | null> =>
  read<Theme>(StorageArea.local, StorageKey.theme);
export const writeTheme = (theme: Theme | null): Promise<void> =>
  write(StorageArea.local, StorageKey.theme, theme);

// --- gözləyən tam silmə ------------------------------------------------------------------
// Sayt məlumatı silinəndə host icazəsi yoxdursa partitioned cookie-lər və sessionStorage
// kənarda qalır. Popup icazəni həmin klikdə istəyir, amma icazə pəncərəsi popup-ı bağlayır —
// ona görə "hansı sayt gözləyir" saxlanca yazılır: istifadəçi icazə verən kimi worker
// (chrome.permissions.onAdded) silməni tam şəkildə təkrarlayır.
export const readPendingWipe = (): Promise<PendingWipe | null> =>
  read<PendingWipe>(StorageArea.session, StorageKey.pendingWipe);
export const writePendingWipe = (pending: PendingWipe): Promise<void> =>
  write(StorageArea.session, StorageKey.pendingWipe, pending);
export const clearPendingWipe = (): Promise<void> =>
  store(StorageArea.session).remove(StorageKey.pendingWipe);

type StorageChangeListener = (
  changes: { [key: string]: chrome.storage.StorageChange },
  areaName: string,
) => void;

// storage.session sahəsindəki dəyişiklik (session, status və ya inbox) — popup bunu dinləyir.
// Qaytarılan funksiya dinləyicini geri çıxarır.
export function subscribeToSessionArea(onChange: () => void): () => void {
  const listener: StorageChangeListener = (_changes, changedArea) => {
    if (changedArea === StorageArea.session) onChange();
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}


// --- alətlər: proxy siyahısı və izləyici qalxanı --------------------------------------------
// Hər üçü `storage.local`-dadır: brauzer bağlanandan sonra da qalmalıdır (proxy seçimi hər
// açılışda yenidən qurulmasın). Chrome-un proxy parametri onsuz da qalıcıdır, ona görə
// `activeProxy` onunla eyni ömrü daşıyır.
//
// Oxu KÖHNƏ MƏLUMATI süzür: v1.19.0-a qədər siyahı açıq mənbələrdən idxal olunurdu və
// saxlancda minlərlə yad qeyd qalıb (bax: shared/proxy.ts → pruneImported). Süzgəc həm
// popup-da, həm worker-də işləyir, yəni köhnə qeydlər heç yerdə görünmür; saxlancın özünü
// worker qalxanda `migrateProxies()` təmizləyir. `raw: true` yalnız həmin miqrasiya üçündür.
export async function readProxies({ raw = false }: { raw?: boolean } = {}): Promise<StoredProxies> {
  const stored = (await read<StoredProxies>(StorageArea.local, StorageKey.proxies))
    ?? { list: [], updated: 0 };
  const list = Array.isArray(stored.list) ? stored.list : [];
  return { ...stored, list: raw ? list : pruneImported(list) };
}
export const writeProxies = (list: ProxyEntry[]): Promise<void> =>
  write(StorageArea.local, StorageKey.proxies, { list, updated: Date.now() });

export const readActiveProxy = (): Promise<ProxyEntry | null> =>
  read<ProxyEntry>(StorageArea.local, StorageKey.activeProxy);
export const writeActiveProxy = (proxy: ProxyEntry): Promise<void> =>
  write(StorageArea.local, StorageKey.activeProxy, proxy);
export const clearActiveProxy = (): Promise<void> =>
  store(StorageArea.local).remove(StorageKey.activeProxy);

export const readShield = async (): Promise<boolean> =>
  (await read<boolean>(StorageArea.local, StorageKey.shield)) === true;
export const writeShield = (on: boolean): Promise<void> =>
  write(StorageArea.local, StorageKey.shield, on === true);

// storage.local sahəsindəki alət dəyişiklikləri (proxy siyahısı, aktiv proxy, qalxan) —
// popup bunu dinləyir, çünki idxal worker-də arxada bitir.
export function subscribeToLocalArea(onChange: () => void): () => void {
  const listener: StorageChangeListener = (_changes, changedArea) => {
    if (changedArea === StorageArea.local) onChange();
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}
