// ─── Message Protocol for the EIP-1193 Bridge ────────────────────────────────
//
// The 4-hop flow for every dApp request:
//
//   dApp page
//     │  window.ethereum.request(...)  →  Promise stored by requestId
//     │  window.postMessage(UM_PAGE_REQUEST)
//     ▼
//   inpage.content.ts  [MAIN world]
//     │  receives UM_PAGE_REQUEST from the page's own window
//     │  browser.runtime.sendMessage(UM_ETH_REQUEST)
//     ▼
//   content.ts  [ISOLATED world]
//     │  forwards to background (fire-and-forget)
//     ▼
//   background.ts  [service worker]
//     │  auto-resolves simple methods immediately
//     │  OR stores request + opens approval popup window
//     │  pushes result back via browser.tabs.sendMessage(UM_ETH_RESULT)
//     ▼
//   content.ts  [ISOLATED world]
//     │  receives UM_ETH_RESULT, posts UM_PAGE_RESPONSE to window
//     ▼
//   inpage.content.ts  [MAIN world]
//     │  receives UM_PAGE_RESPONSE, resolves or rejects the original Promise
//     ▼
//   dApp page  ← gets accounts / signature / tx hash
//
// For approval methods (eth_requestAccounts, personal_sign, etc.):
//   approval/App.tsx  →  browser.runtime.sendMessage(UM_APPROVAL_RESULT / UM_APPROVAL_REJECT)
//   background.ts     →  pushes UM_ETH_RESULT to content.ts (same path as above)

// ─── EIP-1193 standard error codes ───────────────────────────────────────────

export const EIP1193_ERRORS = {
  USER_REJECTED: { code: 4001, message: 'User rejected the request.' },
  UNAUTHORIZED:  { code: 4100, message: 'The requested account has not been authorized by the user.' },
  UNSUPPORTED:   { code: 4200, message: 'The provider does not support the requested method.' },
  DISCONNECTED:  { code: 4900, message: 'The provider is disconnected from all chains.' },
  INTERNAL:      { code: -32603, message: 'Internal JSON-RPC error.' },
} as const;

// ─── Hop 1: page ↔ inpage content script (window.postMessage) ────────────────
// The MAIN-world content script posts these on window so the ISOLATED-world
// bridge can intercept them without touching the page's JS context.

export type PageRequest = {
  type: 'UM_PAGE_REQUEST';
  requestId: string;   // crypto.randomUUID() — ties the response back to its Promise
  method: string;      // e.g. 'eth_requestAccounts', 'personal_sign'
  params: unknown[];
};

export type PageResponse = {
  type: 'UM_PAGE_RESPONSE';
  requestId: string;   // matches the originating PageRequest
  result?: unknown;
  error?: { code: number; message: string };
};

// ─── Hop 2: content script → background (browser.runtime.sendMessage) ─────────
// Sent fire-and-forget — no response is awaited. The result is pushed back
// separately via UM_ETH_RESULT to avoid holding a long-lived MV3 message channel.

export type ContentToBackground = {
  type: 'UM_ETH_REQUEST';
  requestId: string;
  method: string;
  params: unknown[];
  origin: string;  // window.location.origin of the dApp page
  tabId: number;   // always -1 here; background uses sender.tab.id instead
};

// ─── Hop 3 (return): background → content script (browser.tabs.sendMessage) ───
// Background pushes results instead of replying to the original sendMessage.
// This avoids the MV3 service-worker limitation where returning a long-lived
// Promise from onMessage can silently time out before the user approves.

export type EthResultMessage = {
  type: 'UM_ETH_RESULT';
  requestId: string;   // matches the originating ContentToBackground request
  result?: unknown;
  error?: { code: number; message: string };
};

// ─── Approval popup → background ─────────────────────────────────────────────
// Sent after the user clicks Approve or Reject in the approval popup window.

export type ApprovalResultMessage = {
  type: 'UM_APPROVAL_RESULT';
  requestId: string;
  result: unknown;    // accounts array / signature / tx hash depending on method
};

export type ApprovalRejectMessage = {
  type: 'UM_APPROVAL_REJECT';
  requestId: string;
};

// ─── Pending request (stored in chrome.storage.local, key: 'pendingRequest') ──
// Written by background before opening the approval popup so the popup can
// read the request details without needing a live connection to background.

export type PendingRequest = {
  requestId: string;
  method: string;
  params: unknown[];
  origin: string;  // displayed in the approval popup's origin badge
  tabId: number;   // used to push the result back to the correct tab
};

// ─── Connected origins (chrome.storage.local, key: 'connectedOrigins') ────────
// Shape: { [origin: string]: string[] }
// Persists which wallet addresses have been authorised for each dApp origin.
