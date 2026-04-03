// ─── content.ts — ISOLATED world bridge between page and background ───────────
//
// Runs in Chrome's ISOLATED world: it has access to the extension APIs
// (browser.runtime, browser.tabs) but does NOT share a JS context with the
// page. It cannot read or write window.ethereum directly.
//
// Two responsibilities:
//   1. Page → background:  intercept UM_PAGE_REQUEST from inpage.content.ts
//      (MAIN world) and forward it to the background service worker.
//   2. Background → page:  relay UM_ETH_RESULT (pushed by background after
//      approval) and UM_EMIT_EVENT (accountsChanged / chainChanged) back to
//      inpage.content.ts via window.postMessage / CustomEvent.
//
// Why fire-and-forget for sendMessage?
//   In MV3 service workers, returning a long-lived Promise from onMessage to
//   keep a sendMessage channel open is unreliable — Chrome can silently drop
//   the connection while the user is interacting with the approval popup.
//   Instead the background always pushes results via browser.tabs.sendMessage,
//   which this script receives through its own onMessage listener.

import { EIP1193_ERRORS } from '@/types/messages';
import type { ContentToBackground, EthResultMessage, PageRequest } from '@/types/messages';

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_start', // must be ready before inpage.content.ts posts any messages

  main() {
    // ── Page → background ──────────────────────────────────────────────────────
    // window.postMessage from inpage.content.ts (MAIN world) arrives here.
    // We forward it to the background and do NOT await a response — the result
    // comes back asynchronously via the onMessage listener below.
    window.addEventListener('message', (e) => {
      if (e.source !== window) return; // ignore cross-frame messages
      const msg = e.data as PageRequest;
      if (msg?.type !== 'UM_PAGE_REQUEST') return;

      const payload: ContentToBackground = {
        type: 'UM_ETH_REQUEST',
        requestId: msg.requestId, // preserves the requestId so responses can be matched
        method: msg.method,
        params: msg.params,
        origin: window.location.origin, // added here because inpage world shouldn't be trusted for origin
        tabId: -1, // placeholder — background reads the real tabId from sender.tab.id
      };

      // Fire-and-forget. The .catch() only triggers if the background is
      // completely unreachable (e.g. extension was reloaded), in which case we
      // immediately surface an INTERNAL error to the dApp.
      browser.runtime.sendMessage(payload).catch(() => {
        window.postMessage({
          type: 'UM_PAGE_RESPONSE',
          requestId: msg.requestId,
          error: EIP1193_ERRORS.INTERNAL,
        }, '*');
      });
    });

    // ── Background → page ──────────────────────────────────────────────────────
    // Receives both UM_ETH_RESULT (method responses) and UM_EMIT_EVENT
    // (provider events like accountsChanged) pushed by the background.
    browser.runtime.onMessage.addListener((msg) => {
      if (msg?.type === 'UM_ETH_RESULT') {
        // Forward the result to inpage.content.ts via window.postMessage.
        // Explicitly list result and error fields instead of spreading to
        // avoid accidentally leaking extra properties.
        const result = msg as EthResultMessage;
        window.postMessage({
          type: 'UM_PAGE_RESPONSE',
          requestId: result.requestId,
          result: result.result,
          error: result.error,
        }, '*');
      }

      if (msg?.type === 'UM_EMIT_EVENT') {
        // Translate background push events into CustomEvents on window.
        // inpage.content.ts listens for 'um_accountsChanged' / 'um_chainChanged'
        // and re-emits them on the EIP-1193 provider's event emitter.
        window.dispatchEvent(new CustomEvent(`um_${msg.event}`, { detail: msg.data }));
      }
    });
  },
});
