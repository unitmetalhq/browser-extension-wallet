# Unitmetal Browser Extension Wallet

A non-custodial Ethereum browser extension wallet built with [WXT](https://wxt.dev), React 19, and viem. Supports Chrome and Firefox via Manifest V3.

## Commands

```bash
bun run dev           # Chrome dev mode with HMR
bun run dev:firefox   # Firefox dev mode
bun run build         # Production build for Chrome
bun run build:firefox # Production build for Firefox
bun run zip           # Build + zip for Chrome Web Store
bun run compile       # TypeScript type-check only (no emit)
bun run postinstall   # Regenerate WXT types (run after adding entrypoints)
```

No test runner is configured. Use `bun run compile` to catch type errors.

---

## Architecture

### Stack

| Layer | Library |
|---|---|
| Extension framework | WXT 0.20 (Vite-based, MV3) |
| UI | React 19, TailwindCSS v4, shadcn/ui (Base UI) |
| Ethereum | viem 2, wagmi 3, ox 0.12 |
| State | Jotai 2 (atomWithStorage → localStorage) |
| Async data | TanStack Query 5 |
| Database | Dexie 4 (IndexedDB, activity log) |
| Crypto | ox Keystore (PBKDF2+AES-GCM) |

### Entrypoints

| Path | Role |
|---|---|
| `entrypoints/popup/` | 400×600 toolbar popup — 4 tabs: Wallets, Send, Backup, Settings |
| `entrypoints/sidepanel/` | Same UI in the Chrome side panel (persistent across navigation) |
| `entrypoints/tab/` | Full-page tab variant with responsive layout |
| `entrypoints/connect/` | dApp connection approval popup (eth_requestAccounts) |
| `entrypoints/sign/` | Message and typed-data signing popup (personal_sign, eth_signTypedData_v4) |
| `entrypoints/approve/` | Transaction approval popup (eth_sendTransaction) |
| `entrypoints/background.ts` | MV3 service worker — routes dApp requests, manages approval popups |
| `entrypoints/content.ts` | ISOLATED-world bridge — relays messages between page and background |
| `entrypoints/inpage.content.ts` | MAIN-world — injects `window.ethereum` (EIP-1193) and announces via EIP-6963 |

### EIP-1193 Message Flow

All dApp interactions follow a push model (not request/response) to work around MV3 service-worker channel timeouts. Returning a long-lived Promise from `onMessage` is unreliable in MV3 — Chrome can silently close the message channel while the user is interacting with the approval popup. Instead, results are pushed back asynchronously via `browser.tabs.sendMessage`.

```
dApp page
  → window.postMessage(UM_PAGE_REQUEST)
inpage.content.ts  [MAIN world]
  → browser.runtime.sendMessage(UM_ETH_REQUEST)   ← fire-and-forget
content.ts  [ISOLATED world]
  → background.ts  [service worker]
      auto-resolves:  eth_chainId, net_version, eth_accounts, wallet_switchEthereumChain
      needs approval: eth_requestAccounts  → connect.html
                      personal_sign        → sign.html
                      eth_signTypedData_v4 → sign.html
                      eth_sendTransaction  → approve.html
        → opens popup, stores PendingRequest in browser.storage.local
        → on approval: browser.tabs.sendMessage(UM_ETH_RESULT)   ← push result
content.ts
  → window.postMessage(UM_PAGE_RESPONSE)
inpage.content.ts
  → resolves / rejects the original Promise
```

Unknown methods (e.g. `eth_call`, `eth_estimateGas`, `eth_blockNumber`) are forwarded as a JSON-RPC proxy to the configured RPC endpoint rather than returning `UNSUPPORTED`.

All message types are defined in `types/messages.ts`.

### Wallet Storage

Wallets are stored as `UmKeystore` objects (`types/wallet.tsx`) — the `ox` library's `Keystore.Keystore` type extended with `name`, `address`, and `meta.type: 'secret-phrase'`. The mnemonic is encrypted with PBKDF2+AES-GCM; plaintext key material is only held in memory during signing.

Active wallet selection uses two sources (priority order):
1. `browser.storage.local` key `activeAddress` — set when the user picks from the dropdown
2. `localStorage` key `activeWallet` — persisted by `activeWalletAtom`

### State Management

All atoms use `atomWithStorage` for persistence across popup opens:

| Atom | localStorage key | Description |
|---|---|---|
| `walletsAtom` | `wallets` | Array of all `UmKeystore` objects |
| `activeWalletAtom` | `activeWallet` | Currently selected wallet |
| `settingsAtom` | `wallet-settings` | `{ rpc, offlineMode, pretendToBeMetamask }` |
| `customTokensAtom` | `custom-tokens` | User-added ERC-20 tokens |
| `customNftsAtom` | `custom-nfts` | User-added ERC-721 collections |

`inpage.content.ts` and the approval popups read `localStorage` directly — they run outside the React/Jotai tree.

### Session Password

When the user unlocks a session, their wallet password is stored in `browser.storage.session` — cleared on browser restart, never written to disk, inaccessible from content scripts or web pages. This allows signing requests to proceed without re-entering the password on each interaction. The session is also cleared whenever the active wallet is changed.

The session state is managed by `components/manage-session-password.tsx` and the helper functions in `lib/password-session.ts`.

### Provider Tree

`providers.tsx` wraps all UI entrypoints:

```
WagmiProvider  (mainnet only, RPC from settings or VITE_MAINNET_RPC_URL)
  QueryClientProvider
    JotaiProvider
      ThemeProvider
        OfflineModeSync  ← pauses TanStack Query when offlineMode is true
```

### EIP-6963 & pretendToBeMetamask

`inpage.content.ts` announces the wallet via both `window.ethereum` (EIP-1193) and the `eip6963:announceProvider` event. When `pretendToBeMetamask` is enabled in settings, the EIP-6963 announcement uses MetaMask's `rdns: 'io.metamask'` and sets `isMetaMask: true`.

### Environment Variables

| Variable | Purpose |
|---|---|
| `VITE_MAINNET_RPC_URL` | Default Ethereum mainnet RPC URL; falls back to `https://cloudflare-eth.com` |

---

## Security Assessment

### Keystore Design

**Strengths**

- Mnemonic encrypted at rest with PBKDF2+AES via `ox` Keystore — a standard, well-audited scheme.
- `decryptWalletToAccount` does not cache anything — each call derives the key fresh, decrypts, signs, and discards.
- Encrypted keystores never touch the network.

**Weaknesses**

- `localStorage` is readable by any extension page and the JS console. The encrypted keystore ciphertext is exposed to any script running in the extension origin. Security depends entirely on password strength. This is the same model MetaMask uses.
- No brute-force protection. There is no rate-limiting, attempt counter, or lockout on decryption. An attacker with a copy of `localStorage` can try passwords offline at full CPU/GPU speed. The PBKDF2 iteration count in `ox` is the only throttle — verify that `ox` uses 262,144+ iterations (EIP-55 recommendation). Older defaults of 8,192 are significantly weaker.
- `address` is stored in plaintext in the keystore and in `browser.storage.local` as `activeAddress`. Wallet enumeration requires no password.

### Session Password Design

**Strengths**

- `browser.storage.session` is not accessible from content scripts or web pages — only extension pages and the service worker.
- Storing the **password** (not the decrypted mnemonic) is the correct trade-off. A compromised session leaks only the password; the attacker still needs the keystore ciphertext from `localStorage` to derive the private key. Two independent components must be compromised simultaneously.
- Session is cleared on wallet switch.

**Weaknesses**

- Password stored in plaintext within session storage. Within the extension origin, any extension page can call `browser.storage.session.get('sessionPassword')`. A supply-chain attack on a dependency could exploit this.
- No session idle timeout. The session lives until browser restart or manual lock. A user who unlocks and walks away has an indefinitely open session.
- No step-up authentication for high-value actions. Once unlocked, `eth_sendTransaction` goes through without re-confirming the user's identity, regardless of transaction value.
- Password lives as a plain JS string in React component state (V8 heap) until GC. There is no `SecureString` equivalent in JavaScript — this is a known, accepted limitation shared by all browser-based wallets.

### Message Flow Security

**Strengths**

- `pendingRequest_*` entries are written by the service worker, read once by the popup, and immediately deleted. No stale request data lingers.
- The dApp origin is sourced from `sender` (Chrome-provided), not from the content script message body — it cannot be spoofed.
- `sender.tab.id` from Chrome's `sender` object is used as the authoritative tab ID, not a self-reported value.

**Weaknesses**

- `pendingRequest_*` entries briefly exist in `browser.storage.local` between when the service worker writes them and when the popup reads and removes them. All extension pages can read `browser.storage.local` during this window.
- `UM_APPROVAL_RESULT` and `UM_APPROVAL_REJECT` messages are accepted from any sender without validating the source. A malicious extension page cannot forge a real signature (signing happens in the popup), but it could forge a rejection to DoS a pending request.

### Summary

| Area | Status | Priority |
|---|---|---|
| Mnemonic encryption (PBKDF2+AES) | Solid | — |
| Plaintext mnemonic lifetime | Good (milliseconds) | — |
| Session storage API choice | Good | — |
| Two-factor compromise requirement | Good | — |
| PBKDF2 iteration count | Verify `ox` default | High |
| No brute-force rate limiting | Missing | High |
| No session idle timeout | Missing | Medium |
| No step-up auth for large transactions | Missing | Medium |
| Password in React state (V8 heap) | Unavoidable / accepted | Low |
| `pendingRequest_*` brief read window | Narrow race | Low |
| Approval message sender not validated | DoS risk only | Low |
