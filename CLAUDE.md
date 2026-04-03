# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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

## Architecture

**Framework:** [WXT](https://wxt.dev) — a Vite-based browser extension framework. Entry points live in `entrypoints/` and are automatically picked up by WXT. The `@` alias maps to the project root.

**UI stack:** React 19, TailwindCSS v4 (via `@tailwindcss/vite`), shadcn/ui components in `components/ui/`, Jotai for state, TanStack Query for async data.

### Entrypoints

| Path | Role |
|------|------|
| `entrypoints/popup/` | 400×600 browser toolbar popup — 4 tabs: Wallets, Send, Balances, Settings |
| `entrypoints/sidepanel/` | Same UI in the Chrome side panel |
| `entrypoints/tab/` | Full-page tab variant (responsive layout) |
| `entrypoints/approval/` | Standalone 400×600 popup opened by background.ts for dApp request approval |
| `entrypoints/background.ts` | MV3 service worker — routes dApp requests, manages approval popups |
| `entrypoints/content.ts` | ISOLATED-world bridge — relays messages between page and background |
| `entrypoints/inpage.content.ts` | MAIN-world — injects `window.ethereum` (EIP-1193) and announces via EIP-6963 |

### EIP-1193 Message Flow (4 hops)

All dApp interactions follow a push model (not request/response) to work around MV3 service-worker channel timeouts:

```
dApp page
  → window.postMessage(UM_PAGE_REQUEST)
inpage.content.ts [MAIN world]
  → browser.runtime.sendMessage(UM_ETH_REQUEST)  [fire-and-forget]
content.ts [ISOLATED world]
  → background.ts [service worker]
      auto-resolves: eth_chainId, net_version, eth_accounts, wallet_switchEthereumChain
      needs approval: eth_requestAccounts, personal_sign, eth_signTypedData_v4, eth_sendTransaction
        → opens approval.html popup, stores PendingRequest in browser.storage.local
        → on approval: browser.tabs.sendMessage(UM_ETH_RESULT)  [push back]
content.ts
  → window.postMessage(UM_PAGE_RESPONSE)
inpage.content.ts
  → resolves/rejects the original Promise
```

Message types are all defined in `types/messages.ts`.

### Wallet Storage

Wallets are stored as `UmKeystore` objects (`types/wallet.tsx`) — the `ox` library's `Keystore.Keystore` type extended with `name`, `address`, and `meta.type: 'secret-phrase'`. The mnemonic is encrypted with PBKDF2+AES; plaintext key material is only held in memory during signing in `entrypoints/approval/App.tsx`.

Active wallet selection uses two sources (priority order):
1. `browser.storage.local` key `activeAddress` — set when user picks from dropdown
2. `localStorage` key `activeWallet` — persisted by `activeWalletAtom`

### State Management (Jotai atoms)

All atoms use `atomWithStorage` for persistence across popup opens:

| Atom | localStorage key | Description |
|------|-----------------|-------------|
| `walletsAtom` | `wallets` | Array of all `UmKeystore` objects |
| `activeWalletAtom` | `activeWallet` | Currently selected wallet |
| `settingsAtom` | `wallet-settings` | `{ rpc, offlineMode, pretendToBeMetamask }` |

`inpage.content.ts` and `approval/App.tsx` read `localStorage` directly (they run outside the React tree and cannot use Jotai context).

### Provider Tree

`providers.tsx` wraps all UI entrypoints:
```
WagmiProvider (mainnet only, RPC from settings or VITE_MAINNET_RPC_URL)
  QueryClientProvider
    JotaiProvider
      ThemeProvider
        OfflineModeSync  ← pauses TanStack Query when offlineMode is true
```

### EIP-6963 & pretendToBeMetamask

`inpage.content.ts` announces the wallet via both `window.ethereum` (EIP-1193) and the `eip6963:announceProvider` event. When `pretendToBeMetamask` is enabled in settings, the EIP-6963 announcement uses MetaMask's `rdns: 'io.metamask'` and sets `isMetaMask: true`.

### Environment Variables

- `VITE_MAINNET_RPC_URL` — default Ethereum mainnet RPC URL; falls back to `https://cloudflare-eth.com` in the approval popup
