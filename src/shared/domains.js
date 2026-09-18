// PSL həm ICANN, həm şəxsi hostinq domenlərini əhatə edir; wildcard və istisnalar daxildir.
import { PUBLIC_SUFFIX_RULES } from "./public-suffix-rules.js";

const rules = new Set(PUBLIC_SUFFIX_RULES);
export const isLocalHost = (host) => String(host).startsWith("[")
  || /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || !String(host).includes(".");

export function registrableDomain(host) {
  let clean = String(host ?? "").toLowerCase().replace(/^\.+|\.+$/g, "");
  if (!clean || isLocalHost(clean)) return clean;
  try { clean = new URL(`https://${clean}`).hostname; } catch { return clean; }
  const labels = clean.split(".");
  let suffixSize = 1;
  for (let i = 0; i < labels.length; i++) {
    const suffix = labels.slice(i).join(".");
    if (rules.has(`!${suffix}`)) return labels.slice(i).join(".");
    if (rules.has(suffix)) suffixSize = Math.max(suffixSize, labels.length - i);
    if (i > 0 && rules.has(`*.${suffix}`)) suffixSize = Math.max(suffixSize, labels.length - i + 1);
  }
  return labels.slice(-Math.min(labels.length, suffixSize + 1)).join(".");
}
