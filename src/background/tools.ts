// Alət əmrləri: izləyici qalxanı və proxy. Sessiya axınından TAM MÜSTƏQİLDİR, ona görə
// orchestrator-un növbəsinə qoyulmur — istifadəçi düyməyə basıb cavab gözləyir.
//
// Niyə ayrı router: background.ts yalnız wiring-dir, orchestrator isə poçt/relay axınıdır.
// Alətlərin öz kiçik cədvəli var; yeni alət əlavə etmək bir sətirdir.

import { MessageType } from "../shared/messages";
import { describePage } from "./forms";
import { addProxies, connectProxy, disconnectProxy, removeProxy } from "./proxy";
import { setShield } from "./trackers";

export interface ToolMessage {
  type?: string;
  on?: unknown;
  text?: string | string[];
  keys?: string | string[];
  key?: string;
  tabId?: number;
}

type ToolHandler = (message: ToolMessage) => unknown;

const HANDLERS: Record<string, ToolHandler> = Object.freeze({
  [MessageType.SET_SHIELD]: (message) => setShield(message.on),
  [MessageType.PROXY_ADD]: (message) => addProxies(message.text as string | string[]),
  [MessageType.PROXY_REMOVE]: (message) => removeProxy(message.keys as string | string[]),
  [MessageType.PROXY_CONNECT]: (message) => connectProxy(message.key as string),
  [MessageType.PROXY_DISCONNECT]: () => disconnectProxy(),
  // Diaqnostika: səhifəni təsvir edir, heç nə dəyişdirmir (sessiyadan asılı deyil)
  [MessageType.DESCRIBE_PAGE]: (message) => describePage(message.tabId as number),
});

export const isToolCommand = (message: unknown): boolean =>
  Object.hasOwn(HANDLERS, String((message as { type?: unknown } | null | undefined)?.type ?? ""));

export const handleToolCommand = (message: ToolMessage): unknown =>
  (HANDLERS[message.type as string] as ToolHandler)(message);
