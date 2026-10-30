import type { Inbound, Outbound } from "./types";

declare global {
  interface Window {
    /** Installed by Kotlin: forwards a message over JBCefJSQuery. */
    __piNativePost?: (message: Outbound) => void;
    /** Installed by the React app: receives messages from Kotlin. */
    __piDeliver?: (message: Inbound) => void;
  }
}

export function post(message: Outbound): void {
  window.__piNativePost?.(message);
}

export function onMessage(listener: (message: Inbound) => void): void {
  window.__piDeliver = listener;
}
