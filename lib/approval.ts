// ─── Shared helpers for approval popups ──────────────────────────────────────
// Used by connect/, sign/, and approval/ entrypoints. Each runs as a standalone
// popup window with no access to the React/Jotai context of the main extension
// popup, so all state is read directly from localStorage / browser.storage.local.

import { mainnet } from 'viem/chains';
import { decryptWalletToAccount } from '@/lib/um-wallet';
import { browser } from 'wxt/browser';
import type { UmKeystore } from '@/types/wallet';
import type { WalletSettings } from '@/types/setting';

// Extract the requestId from the popup URL query string.
// background.ts embeds it as ?requestId=<uuid>.
export function getRequestId(): string | null {
  return new URLSearchParams(window.location.search).get('requestId');
}

// Read all wallets from localStorage (where Jotai atomWithStorage persists them).
export function getWallets(): UmKeystore[] {
  try {
    return JSON.parse(localStorage.getItem('wallets') || '[]');
  } catch {
    return [];
  }
}

// Read the user's custom RPC URL from wallet settings (localStorage).
// Falls back to the build-time env var, then Cloudflare's public endpoint.
export function getRpcUrl(): string {
  try {
    const stored = localStorage.getItem('wallet-settings');
    if (stored) {
      const settings = JSON.parse(stored) as WalletSettings;
      if (settings.rpc?.chainId === mainnet.id && settings.rpc.url) {
        return settings.rpc.url;
      }
    }
  } catch {}
  return (import.meta.env.VITE_MAINNET_RPC_URL as string) || 'https://cloudflare-eth.com';
}

// Determine the active wallet, checking sources in priority order:
//   1. browser.storage.local 'activeAddress' — set by manage-wallet dropdown
//   2. localStorage 'activeWallet' — persisted by activeWalletAtom
//   3. First wallet in the list
export async function getActiveWallet(): Promise<UmKeystore | null> {
  const wallets = getWallets();
  if (wallets.length === 0) return null;

  try {
    const data = await browser.storage.local.get('activeAddress');
    const activeAddress = data.activeAddress as string | undefined;
    if (activeAddress) {
      return wallets.find((w) => w.address === activeAddress) ?? wallets[0];
    }
  } catch {}

  try {
    const stored = localStorage.getItem('activeWallet');
    if (stored) {
      const activeWallet = JSON.parse(stored) as UmKeystore | null;
      if (activeWallet?.address) {
        return wallets.find((w) => w.address === activeWallet.address) ?? wallets[0];
      }
    }
  } catch {}

  return wallets[0];
}

// Decrypt the ox keystore with the user's password and return a viem account.
// The plaintext mnemonic is only held in memory for the duration of signing.
export async function decryptWallet(wallet: UmKeystore, password: string) {
  return decryptWalletToAccount(wallet, password);
}

// Normalise a raw crypto error into a user-friendly message.
export function friendlyError(err: unknown): string {
  const message = err instanceof Error ? err.message : 'Unknown error';
  if (
    message.toLowerCase().includes('decrypt') ||
    message.toLowerCase().includes('password') ||
    message.toLowerCase().includes('key')
  ) {
    return 'Wrong password. Please try again.';
  }
  return message;
}
