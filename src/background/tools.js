// Alət əmrləri: izləyici qalxanı və proxy. Sessiya axınından TAM MÜSTƏQİLDİR, ona görə
// orchestrator-un növbəsinə qoyulmur — istifadəçi düyməyə basıb cavab gözləyir.
//
// Niyə ayrı router: background.js yalnız wiring-dir, orchestrator isə poçt/relay axınıdır.
// Alətlərin öz kiçik cədvəli var; yeni alət əlavə etmək bir sətirdir.

import { MessageType } from "../shared/messages.js";
import { describePage } from "./forms.js";
import { addProxies, connectProxy, disconnectProxy, removeProxy } from "./proxy.js";
import { setShield } from "./trackers.js";

const HANDLERS = Object.freeze({
  [MessageType.SET_SHIELD]: (message) => setShield(message.on),
  [MessageType.PROXY_ADD]: (message) => addProxies(message.text),
  [MessageType.PROXY_REMOVE]: (message) => removeProxy(message.keys),
  [MessageType.PROXY_CONNECT]: (message) => connectProxy(message.key),
  [MessageType.PROXY_DISCONNECT]: () => disconnectProxy(),
  // Diaqnostika: səhifəni təsvir edir, heç nə dəyişdirmir (sessiyadan asılı deyil)
  [MessageType.DESCRIBE_PAGE]: (message) => describePage(message.tabId),
});

export const isToolCommand = (message) => Object.hasOwn(HANDLERS, String(message?.type ?? ""));

export const handleToolCommand = (message) => HANDLERS[message.type](message);
