// ─── inpage.content.ts — EIP-1193 provider injected into the page ────────────
//
// Runs in the MAIN JavaScript world (world: 'MAIN') at document_start, meaning
// it shares the same JS context as the dApp. This is the only content script
// that can set window.ethereum because ISOLATED-world scripts cannot write to
// the page's global scope.
//
// Implements two wallet discovery standards:
//
//   EIP-1193  window.ethereum
//     The legacy provider interface. Still required by many dApps and used as
//     the actual transport for all signing/transaction requests regardless of
//     how the wallet was discovered.
//
//   EIP-6963  eip6963:announceProvider
//     The modern multi-wallet discovery protocol. dApps (Uniswap, Aave, etc.)
//     fire eip6963:requestProvider on window; every injected wallet responds
//     with eip6963:announceProvider carrying its name, icon, and provider.
//     This is what populates the wallet picker in modern dApps.

import iconRaw from '@/assets/icon.svg?raw';
import type { PageRequest, PageResponse } from '@/types/messages';

export default defineContentScript({
  matches: ['<all_urls>'],
  world: 'MAIN',           // shares JS context with the dApp — required to set window.ethereum
  runAt: 'document_start', // must run before any dApp code reads window.ethereum

  main() {
    // ── Pending request map ────────────────────────────────────────────────────
    // Tracks in-flight requests by requestId. Each entry holds the method name
    // (needed to update selectedAddress on eth_requestAccounts) plus the
    // resolve/reject of the Promise returned to the dApp.
    const pendingPromises = new Map<string, {
      method: string;
      resolve: (value: unknown) => void;
      reject: (error: unknown) => void;
    }>();

    // Simple event emitter — mirrors the EventEmitter interface dApps expect.
    // Keyed by event name; each value is a Set of handler functions.
    const listeners: Record<string, Set<Function>> = {};

    // ── EIP-1193 provider ──────────────────────────────────────────────────────
    const provider = {
      isUnitMetal: true,   // always present so our own code can identify the provider
      chainId: '0x1',      // Ethereum mainnet (updated by chainChanged events)
      networkVersion: '1', // legacy property still read by some dApps
      selectedAddress: null as string | null, // kept in sync after every connection

      // EIP-1193 request() — the single entry point for all dApp interactions.
      // Creates a unique requestId, stores the Promise callbacks, then hands the
      // request off to content.ts via window.postMessage. The Promise resolves
      // when UM_PAGE_RESPONSE arrives with the matching requestId.
      request({ method, params = [] }: { method: string; params?: unknown[] }): Promise<unknown> {
        return new Promise((resolve, reject) => {
          const requestId = crypto.randomUUID();
          pendingPromises.set(requestId, { method, resolve, reject });
          const msg: PageRequest = { type: 'UM_PAGE_REQUEST', requestId, method, params };
          // postMessage reaches content.ts (ISOLATED world) which forwards it to
          // the background service worker via browser.runtime.sendMessage.
          window.postMessage(msg, '*');
        });
      },

      // Standard EventEmitter interface — dApps subscribe with provider.on().
      on(event: string, handler: Function) {
        if (!listeners[event]) listeners[event] = new Set();
        listeners[event].add(handler);
      },

      removeListener(event: string, handler: Function) {
        listeners[event]?.delete(handler);
      },

      // Internal — called when background pushes events or when we emit inline.
      emit(event: string, ...args: unknown[]) {
        listeners[event]?.forEach((fn) => fn(...args));
      },
    };

    // ── Response listener ──────────────────────────────────────────────────────
    // Receives UM_PAGE_RESPONSE posted by content.ts after the background pushes
    // back the result via browser.tabs.sendMessage → UM_ETH_RESULT.
    window.addEventListener('message', (e) => {
      if (e.source !== window) return; // ignore messages from iframes / other windows
      const msg = e.data as PageResponse;
      if (msg?.type !== 'UM_PAGE_RESPONSE') return;

      const pending = pendingPromises.get(msg.requestId);
      if (!pending) return; // stale or duplicate — ignore
      pendingPromises.delete(msg.requestId);

      if (msg.error) {
        // Wrap as a proper Error object with the EIP-1193 code property so
        // dApps can distinguish USER_REJECTED (4001) from other errors.
        const err = Object.assign(new Error(msg.error.message), { code: msg.error.code });
        pending.reject(err);
      } else {
        // For eth_requestAccounts: update selectedAddress synchronously before
        // resolving. Some dApps read provider.selectedAddress immediately after
        // awaiting the request, before any accountsChanged event arrives.
        if (pending.method === 'eth_requestAccounts' && Array.isArray(msg.result)) {
          provider.selectedAddress = (msg.result[0] as string) ?? null;
          provider.emit('accountsChanged', msg.result);
        }
        pending.resolve(msg.result);
      }
    });

    // ── Event relay ────────────────────────────────────────────────────────────
    // content.ts (ISOLATED world) cannot call provider.emit() directly because
    // it runs in a separate JS context. Instead it dispatches a CustomEvent on
    // window which these listeners pick up and forward to subscribed dApp handlers.

    window.addEventListener('um_accountsChanged', (e: Event) => {
      const detail = (e as CustomEvent).detail as string[];
      provider.selectedAddress = detail?.[0] ?? null;
      provider.emit('accountsChanged', detail);
    });

    window.addEventListener('um_chainChanged', (e: Event) => {
      const detail = (e as CustomEvent).detail as string;
      provider.chainId = detail;
      provider.emit('chainChanged', detail);
    });

    // ── EIP-1193: expose window.ethereum ──────────────────────────────────────
    // Non-writable + non-configurable prevents dApps or other extensions from
    // overwriting window.ethereum after we set it.
    Object.defineProperty(window, 'ethereum', {
      value: provider,
      writable: false,
      configurable: false,
    });

    // Signal to dApps that window.ethereum is ready. Some libraries (e.g. web3-react)
    // wait for this event before reading the provider.
    window.dispatchEvent(new Event('ethereum#initialized'));

    // ── EIP-6963: multi-wallet discovery ──────────────────────────────────────
    // Modern dApps (Uniswap, Aave, etc.) use this protocol instead of scanning
    // window.ethereum. They fire eip6963:requestProvider; each wallet responds
    // with eip6963:announceProvider. The dApp collects all responses and renders
    // a wallet picker — this is what actually populates that list.
    //
    // The icon must be a data URI because extension asset URLs (chrome-extension://...)
    // are not accessible from the page's origin. We import the SVG source with
    // Vite's ?raw suffix and encode it inline.
    const iconDataUri = `data:image/svg+xml,${encodeURIComponent(iconRaw)}`;

    const eip6963Info = {
      uuid: 'df8ef8a1-f947-4dcf-9997-1f903e644a1f',
      name: 'UnitMetal Wallet',
      icon: iconDataUri,
      rdns: 'com.unitmetal.wallet',
    };

    // detail must be frozen per the EIP-6963 spec so dApps cannot mutate it.
    const eip6963Detail = Object.freeze({ info: Object.freeze(eip6963Info), provider });

    function announceProvider() {
      window.dispatchEvent(
        new CustomEvent('eip6963:announceProvider', { detail: eip6963Detail })
      );
    }

    // Announce immediately for dApps that are already listening.
    announceProvider();

    // Re-announce whenever a dApp (or dApp framework) fires requestProvider.
    // This handles the case where the dApp's wallet-discovery code runs after
    // our content script — it fires requestProvider to catch late announcements.
    window.addEventListener('eip6963:requestProvider', announceProvider);
  },
});
