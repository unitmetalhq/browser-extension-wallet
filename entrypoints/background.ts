// ─── background.ts — service worker: request router and approval orchestrator ──
//
// Central hub for all dApp-initiated requests. Receives every UM_ETH_REQUEST
// from content.ts, either auto-resolves it (chainId, accounts, etc.) or opens
// a 400×600 approval popup for methods that require explicit user consent.
//
// Push model (vs. the naive sendMessage/response model):
//   Returning a long-lived Promise from onMessage is unreliable in MV3 service
//   workers — Chrome can silently close the message channel while the user is
//   interacting with the popup (often 10–30 seconds). Instead, we store the
//   tabId and requestId, resolve the request independently (either immediately
//   or after approval), then PUSH the result to the content script via
//   browser.tabs.sendMessage. This makes the flow robust regardless of how long
//   the user takes to approve or reject.
//
// Methods handled:
//   Auto-resolved  →  eth_chainId, net_version, eth_accounts, wallet_switchEthereumChain
//   Needs approval →  eth_requestAccounts, personal_sign, eth_signTypedData_v4, eth_sendTransaction

import { EIP1193_ERRORS } from '@/types/messages';
import type {
  ContentToBackground,
  PendingRequest,
  ApprovalResultMessage,
  ApprovalRejectMessage,
  EthResultMessage,
} from '@/types/messages';

// ─── RPC proxy ────────────────────────────────────────────────────────────────
// The background cannot read localStorage (where Jotai stores wallet-settings),
// so the custom RPC URL is mirrored to browser.storage.local under 'rpcUrl'
// whenever the user saves settings. Falls back to the build-time env var then
// cloudflare-eth.com.

const BUILD_TIME_RPC = import.meta.env.VITE_MAINNET_RPC_URL as string | undefined;

async function getRpcUrl(): Promise<string> {
  const data = await browser.storage.local.get('rpcUrl');
  return (data.rpcUrl as string | undefined)
    ?? BUILD_TIME_RPC
    ?? 'https://cloudflare-eth.com';
}

async function forwardToRpc(
  tabId: number,
  requestId: string,
  method: string,
  params: unknown[],
) {
  try {
    const rpcUrl = await getRpcUrl();
    const res = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    });
    const json = await res.json() as {
      result?: unknown;
      error?: { code: number; message: string };
    };
    if (json.error) {
      pushError(tabId, requestId, {
        code: json.error.code ?? -32603,
        message: json.error.message ?? 'RPC error',
      });
    } else {
      pushResult(tabId, requestId, json.result ?? null);
    }
  } catch {
    pushError(tabId, requestId, { code: -32603, message: 'RPC request failed' });
  }
}

// ─── In-memory pending requests ───────────────────────────────────────────────
// Keyed by requestId. Entries live here from the moment a popup is opened until
// the user approves or rejects (or the service worker is restarted — in which
// case the popup will find no matching entry and can be closed by the user).

type PendingEntry = {
  tabId: number;   // the tab that initiated the request — result will be pushed here
  method: string;  // needed to know what to persist after approval (e.g. connectedOrigins)
  origin: string;  // the dApp origin — used for connectedOrigins storage
};

const pendingRequests = new Map<string, PendingEntry>();

// ─── Methods that require the approval popup ──────────────────────────────────

const APPROVAL_METHODS = new Set([
  'eth_requestAccounts',    // connect wallet — opens connect.html
  'personal_sign',          // sign arbitrary message — opens sign.html
  'eth_signTypedData_v4',   // sign structured data — opens sign.html
  'eth_sendTransaction',    // broadcast a transaction — opens approve.html
]);

// Map each approval method to its dedicated popup page.
function popupPageForMethod(method: string): 'approve.html' | 'connect.html' | 'sign.html' {
  if (method === 'eth_requestAccounts') return 'connect.html';
  if (method === 'personal_sign' || method === 'eth_signTypedData_v4') return 'sign.html';
  return 'approve.html';
}

// ─── Storage helpers ──────────────────────────────────────────────────────────
// connectedOrigins: { [origin: string]: string[] }
// Persists which wallet addresses have been authorised for each dApp origin so
// that eth_accounts can return the connected address without a popup.

async function getConnectedAccounts(origin: string): Promise<string[]> {
  const data = await browser.storage.local.get('connectedOrigins');
  const connectedOrigins = (data.connectedOrigins ?? {}) as Record<string, string[]>;
  return connectedOrigins[origin] ?? [];
}

async function setConnectedAccount(origin: string, address: string) {
  const data = await browser.storage.local.get('connectedOrigins');
  const connectedOrigins = (data.connectedOrigins ?? {}) as Record<string, string[]>;
  connectedOrigins[origin] = [address];
  await browser.storage.local.set({ connectedOrigins });
}

// ─── Push helpers ─────────────────────────────────────────────────────────────
// All results are delivered to content.ts via tabs.sendMessage rather than as
// a sendMessage response. This decouples result delivery from the original
// request lifetime and avoids MV3 service-worker channel timeout issues.

function pushResult(tabId: number, requestId: string, result: unknown) {
  const msg: EthResultMessage = { type: 'UM_ETH_RESULT', requestId, result };
  browser.tabs.sendMessage(tabId, msg).catch(() => {
    // Tab may have been closed before the result arrived — silently ignore.
  });
}

function pushError(tabId: number, requestId: string, error: { code: number; message: string }) {
  const msg: EthResultMessage = { type: 'UM_ETH_RESULT', requestId, error };
  browser.tabs.sendMessage(tabId, msg).catch(() => {});
}

// ─── Main request handler ─────────────────────────────────────────────────────

async function handleEthRequest(msg: ContentToBackground, senderTabId: number) {
  // senderTabId comes from sender.tab.id (provided by Chrome) which is more
  // reliable than any tabId the content script might report about itself.
  const tabId = senderTabId;

  // Auto-resolve methods that don't require user interaction.
  switch (msg.method) {
    case 'eth_chainId':
      // Return mainnet chain ID. If multi-chain support is added, read this
      // from storage and update when the user switches networks.
      pushResult(tabId, msg.requestId, '0x1');
      return;

    case 'net_version':
      // Legacy numeric network ID — same as chainId but decimal string.
      pushResult(tabId, msg.requestId, '1');
      return;

    case 'eth_accounts': {
      // Return currently-connected accounts for this origin ([] if not connected).
      // This method should NEVER open a popup — use eth_requestAccounts for that.
      const accounts = await getConnectedAccounts(msg.origin);
      pushResult(tabId, msg.requestId, accounts);
      return;
    }

    case 'wallet_switchEthereumChain':
      // We only support mainnet for now; treat all switch requests as a no-op.
      pushResult(tabId, msg.requestId, null);
      return;
  }

  // Methods beyond this point require an approval popup.
  if (APPROVAL_METHODS.has(msg.method)) {
    // Store the pending entry so handleApprovalResult can push the result back.
    pendingRequests.set(msg.requestId, {
      tabId,
      method: msg.method,
      origin: msg.origin,
    });

    // Write the full request to storage so the approval popup (a separate window
    // with no live connection to this service worker) can read it on load.
    // Keyed by requestId so concurrent requests (e.g. eth_chainId fired alongside
    // eth_requestAccounts) never overwrite each other's entry.
    const pendingRequest: PendingRequest = {
      requestId: msg.requestId,
      method: msg.method,
      params: msg.params,
      origin: msg.origin,
      tabId,
    };
    await browser.storage.local.set({ [`pendingRequest_${msg.requestId}`]: pendingRequest });

    // Open the approval popup. The requestId in the URL lets the popup verify it
    // is reading the correct pendingRequest from storage (guards against stale data
    // if a previous popup was closed without responding).
    // sign needs more vertical space for typed data; connect and approve use h-screen (auto).
    const popupHeight = msg.method === 'personal_sign' || msg.method === 'eth_signTypedData_v4' ? 600 : 540;
    const popupWidth = 400;

    // Position the popup at the top-right of the current browser window.
    let left: number | undefined;
    let top: number | undefined;
    try {
      const win = await browser.windows.getLastFocused();
      left = (win.left ?? 0) + (win.width ?? 1280) - popupWidth;
      top = win.top ?? 0;
    } catch {}

    browser.windows.create({
      url: browser.runtime.getURL(`/${popupPageForMethod(msg.method)}?requestId=${msg.requestId}`),
      type: 'popup',
      width: popupWidth,
      height: popupHeight,
      left,
      top,
      focused: true,
    });
    return; // result will be pushed later by handleApprovalResult / handleApprovalReject
  }

  // Unknown method — forward to the RPC node (eth_call, eth_estimateGas,
  // eth_getTransactionCount, eth_blockNumber, eth_feeHistory, etc.).
  // All standard JSON-RPC read methods fall through here.
  forwardToRpc(tabId, msg.requestId, msg.method, msg.params);
}

// ─── Approval result handlers ─────────────────────────────────────────────────

async function handleApprovalResult(msg: ApprovalResultMessage) {
  const pending = pendingRequests.get(msg.requestId);
  if (!pending) return; // service worker may have restarted — entry is gone, nothing to do
  pendingRequests.delete(msg.requestId);

  // For wallet connections: persist the address so future eth_accounts calls
  // return it without a popup, then notify the tab of the new account.
  if (pending.method === 'eth_requestAccounts') {
    const accounts = msg.result as string[];
    if (accounts?.[0]) {
      await setConnectedAccount(pending.origin, accounts[0]);
      // Push accountsChanged event to the content script. content.ts will
      // dispatch a CustomEvent that inpage.content.ts translates into a
      // provider.emit('accountsChanged') for any subscribed dApp handlers.
      browser.tabs.sendMessage(pending.tabId, {
        type: 'UM_EMIT_EVENT',
        event: 'accountsChanged',
        data: accounts,
      }).catch(() => {});
    }
  }

  // Push the result (accounts / signature / tx hash) back to the content script.
  pushResult(pending.tabId, msg.requestId, msg.result);
}

function handleApprovalReject(msg: ApprovalRejectMessage) {
  const pending = pendingRequests.get(msg.requestId);
  if (!pending) return;
  pendingRequests.delete(msg.requestId);
  // Push a USER_REJECTED error — dApp will receive a rejected Promise with code 4001.
  pushError(pending.tabId, msg.requestId, EIP1193_ERRORS.USER_REJECTED);
}

// ─── Entry point ──────────────────────────────────────────────────────────────

export default defineBackground(() => {
  browser.runtime.onMessage.addListener((message, sender) => {
    if (message?.type === 'UM_ETH_REQUEST') {
      // sender.tab.id is the authoritative tab ID for the requesting page.
      const tabId = sender.tab?.id ?? -1;
      handleEthRequest(message as ContentToBackground, tabId);
      // No return value — response will be pushed asynchronously via tabs.sendMessage.
      return;
    }

    if (message?.type === 'UM_APPROVAL_RESULT') {
      // Sent by approval/App.tsx after the user clicks Approve and signing succeeds.
      handleApprovalResult(message as ApprovalResultMessage);
      return;
    }

    if (message?.type === 'UM_APPROVAL_REJECT') {
      // Sent by approval/App.tsx when the user clicks Reject.
      handleApprovalReject(message as ApprovalRejectMessage);
      return;
    }
  });
});
