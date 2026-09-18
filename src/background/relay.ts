// Relay-in işləmə anındaki forması.
//
// Adi relay bütün məlumatını deskriptorda daşıyır. "Bu sayt" relay-i isə (adoptActiveTab)
// aktiv tabın saytını mənimsəyir: url, hostlar və silmə planı yalnız Başlat anında bilinir.
// Qalan qatlar (poçt ipuçları, təmizləmə, status mətnləri) fərq görməməlidir, ona görə
// burada HƏR İKİSİ üçün eyni formada obyekt qurulur:
//
//   { id, name, url, hosts, cleanup, mail?, signup?, adopted }
//
// Beləliklə `mailHints()`, `clearRelayData()` və `supportsSignup()` dəyişmədən işləyir —
// `tabCleanupPlan()` onsuz da relay `cleanup` sahəsi ilə eyni formanı qaytarır.

import { adoptsActiveTab } from "../providers/contract";
import { RELAY } from "../providers/relay/index";
import { tabCleanupPlan } from "../shared/cleanup";
import { ExpectedError } from "../shared/errors";
import type { Session } from "../shared/state";
import type { RelayDescriptor as ContractRelayDescriptor } from "../providers/contract";

// adoptedRelay işləmə anında `adopted: true` əlavə edir — reyestrdəki formada bu sahə yoxdur.
export type RelayDescriptor = ContractRelayDescriptor & { adopted?: boolean };

// Mənimsənilən sayt sessiyada saxlanılır (`relaySite`), çünki worker sönə bilər və tab bu
// arada başqa sayta keçə bilər — istifadəçinin Başlat anında seçdiyi sayt dəyişməməlidir.
export function adoptedRelay(relay: RelayDescriptor, site: string): RelayDescriptor {
  const plan = tabCleanupPlan(site);
  if (!plan) throw new ExpectedError("aktiv tab adi sayt deyil — yalnız http/https saytları");
  // `cleanup` deskriptordaki forma ilə BİREBİR eyni olmalıdır: plandaki əlavə sahələr
  // (host, domain) buraya düşməsin ki, silmə qatı fərq görməsin.
  const { cookieDomains, partitionTopLevelSites, storageOrigins } = plan;
  return Object.freeze({
    id: relay.id,
    // Ad domendir: poçt ipuçları `name`-in tokenlərini də işlədir (shared/extract.ts)
    name: plan.domain,
    url: site,
    hosts: [plan.domain],
    cleanup: { cookieDomains, partitionTopLevelSites, storageOrigins },
    adopted: true,
  });
}

// Sessiyanın relay-i. Adi relay üçün deskriptorun özü, mənimsəyən relay üçün tabdan
// törədilmiş forma qaytarılır.
//
// Reyestrdən SİLİNMİŞ relay: sessiya storage.session-dadır və brauzer bağlananadək yaşayır,
// ona görə provider silindikdən sonra köhnə sessiya qala bilər. Belə halda aydın
// ExpectedError verilir (sarı xəbərdarlıq) — reyestrin "naməlum sayt" xətası qüsur kimi
// görünərdi.
export function resolveRelay(session: Session): RelayDescriptor {
  if (!RELAY.has(session?.relayId as string)) {
    throw new ExpectedError(`relay saytı artıq mövcud deyil ("${session?.relayId ?? "—"}") — Dayandır və yenidən Başlat`);
  }
  const relay = RELAY.get(session.relayId as string);
  if (!adoptsActiveTab(relay)) return relay;
  if (!session.relaySite) throw new ExpectedError(`${relay.name}: sessiyada sayt yazılmayıb, yenidən başladın`);
  return adoptedRelay(relay, session.relaySite);
}

// Mənimsəyən relay-də istifadəçinin öz tabı işlədilir: yeni tab açılmır, tab bağlananda
// sayt məlumatı silinmir və tab yenidən açılmır.
export const isAdopted = (relay: RelayDescriptor | null | undefined): boolean =>
  relay?.adopted === true;
