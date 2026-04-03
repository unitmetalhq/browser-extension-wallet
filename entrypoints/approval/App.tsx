// ─── approval/App.tsx — user-facing approval popup ────────────────────────────
//
// This page runs as a standalone browser popup window (400×600), opened by
// background.ts for any method that requires explicit user consent.
//
// Lifecycle:
//   1. background.ts writes the pending request to chrome.storage.local and
//      opens this window with ?requestId=<id> in the URL.
//   2. On mount, App reads the requestId from the URL, fetches the matching
//      PendingRequest from storage, and loads the active wallet.
//   3. The user sees a method-specific screen (connect / sign / send) and
//      either clicks Approve (signs/sends then posts UM_APPROVAL_RESULT) or
//      Reject (posts UM_APPROVAL_REJECT). Either way the window closes.
//   4. background.ts receives the result and pushes it to the originating tab.
//
// Signing is done entirely inside this popup using the user's password to
// decrypt the BIP-39 mnemonic from the ox keystore, derive the account with
// viem, and produce the signature or broadcast the transaction. The plaintext
// mnemonic and derived key are only held in memory for the duration of the
// signing operation.

import { useEffect, useState } from 'react';
import { Keystore, Bytes } from 'ox';
import { mnemonicToAccount } from 'viem/accounts';
import { createWalletClient, http, formatEther, type Hex } from 'viem';
import { mainnet } from 'viem/chains';
import { browser } from 'wxt/browser';
import { Lock, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { cn, truncateAddress } from '@/lib/utils';
import type { PendingRequest, ApprovalResultMessage, ApprovalRejectMessage } from '@/types/messages';
import type { UmKeystore } from '@/types/wallet';
import type { WalletSettings } from '@/types/setting';

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Extract the requestId from the URL query string.
// background.ts embeds it as ?requestId=<uuid> so the popup can verify it is
// reading the correct entry from storage (guards against stale data).
function getRequestId(): string | null {
  return new URLSearchParams(window.location.search).get('requestId');
}

// Read all wallets from localStorage (where jotai atomWithStorage persists them).
// The approval popup is a separate window from the extension popup, so it cannot
// use React/Jotai context — it reads storage directly.
function getWallets(): UmKeystore[] {
  try {
    return JSON.parse(localStorage.getItem('wallets') || '[]');
  } catch {
    return [];
  }
}

// Read the user's custom RPC URL from wallet settings (also localStorage).
// Falls back to the environment variable, then to Cloudflare's public endpoint.
function getRpcUrl(): string {
  try {
    const stored = localStorage.getItem('wallet-settings');
    if (stored) {
      const settings = JSON.parse(stored) as WalletSettings;
      if (settings.rpc?.chainId === mainnet.id && settings.rpc.url) {
        return settings.rpc.url;
      }
    }
  } catch {}
  return import.meta.env.VITE_MAINNET_RPC_URL as string || 'https://cloudflare-eth.com';
}

// Determine the active wallet, checking multiple sources in priority order:
//   1. browser.storage.local 'activeAddress' — written by manage-wallet.tsx
//      when the user explicitly selects a wallet from the dropdown.
//   2. localStorage 'activeWallet' — written by atomWithStorage (activeWalletAtom)
//      which persists the full wallet object across popup closes.
//   3. First wallet in the list — last-resort fallback.
async function getActiveWallet(): Promise<UmKeystore | null> {
  const wallets = getWallets();
  if (wallets.length === 0) return null;

  // Priority 1: explicitly selected address in browser.storage.local
  try {
    const data = await browser.storage.local.get('activeAddress');
    const activeAddress = data.activeAddress as string | undefined;
    if (activeAddress) {
      return wallets.find((w) => w.address === activeAddress) ?? wallets[0];
    }
  } catch {}

  // Priority 2: atomWithStorage-persisted activeWallet in localStorage
  try {
    const stored = localStorage.getItem('activeWallet');
    if (stored) {
      const activeWallet = JSON.parse(stored) as UmKeystore | null;
      if (activeWallet?.address) {
        return wallets.find((w) => w.address === activeWallet.address) ?? wallets[0];
      }
    }
  } catch {}

  // Priority 3: first wallet
  return wallets[0];
}

// Decrypt the ox keystore using the user's password and derive a viem account.
// ox uses PBKDF2 to derive the decryption key from the password, then AES to
// decrypt the mnemonic. The resulting account object can sign messages/txs.
async function decryptWallet(wallet: UmKeystore, password: string) {
  const key = Keystore.toKey(wallet, { password });
  const mnemonicHex = Keystore.decrypt(wallet, key);
  const mnemonic = Bytes.toString(Bytes.fromHex(mnemonicHex as Hex));
  return mnemonicToAccount(mnemonic);
}

// ─── Method-specific display components ──────────────────────────────────────
// Each component renders the relevant details for one RPC method so the user
// can make an informed decision before approving.

// eth_requestAccounts — no signing needed, just shows which address will be shared.
function ConnectScreen({ request, wallet }: { request: PendingRequest; wallet: UmKeystore }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        This site is requesting access to your wallet address.
      </p>
      <div className="border border-border p-3 flex flex-col gap-1">
        <p className="text-xs text-muted-foreground">Wallet</p>
        <p className="font-medium">{wallet.name}</p>
        <p className="text-sm text-muted-foreground font-mono">{truncateAddress(wallet.address)}</p>
      </div>
    </div>
  );
}

// personal_sign (EIP-191) — shows the human-readable message content.
// Hex-encoded messages (0x-prefixed) are decoded to UTF-8 for display.
function SignMessageScreen({ request }: { request: PendingRequest }) {
  const rawMsg = request.params[0] as string;
  // personal_sign params: [message, address]. Message may be a hex-encoded
  // string (e.g. '0x48656c6c6f') — decode it for human-readable display.
  let displayMsg = rawMsg;
  try {
    if (rawMsg.startsWith('0x')) {
      displayMsg = Bytes.toString(Bytes.fromHex(rawMsg as Hex));
    }
  } catch {}

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        This site is requesting you to sign the following message.
      </p>
      <div className="border border-border p-3 max-h-[160px] overflow-y-auto">
        <p className="text-sm break-all whitespace-pre-wrap">{displayMsg}</p>
      </div>
    </div>
  );
}

// eth_signTypedData_v4 (EIP-712) — shows domain, type, and message fields.
// params[1] is a JSON-encoded typed-data object with domain/types/message keys.
function SignTypedDataScreen({ request }: { request: PendingRequest }) {
  let typedData: Record<string, unknown> = {};
  try {
    typedData = JSON.parse(request.params[1] as string);
  } catch {}

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        This site is requesting you to sign typed data.
      </p>
      {!!typedData.domain && (
        <div className="border border-border p-3 flex flex-col gap-1">
          <p className="text-xs text-muted-foreground">Domain</p>
          <p className="text-sm">{(typedData.domain as Record<string, unknown>).name as string}</p>
        </div>
      )}
      {!!typedData.primaryType && (
        <div className="border border-border p-3 flex flex-col gap-1">
          <p className="text-xs text-muted-foreground">Type</p>
          <p className="text-sm">{typedData.primaryType as string}</p>
        </div>
      )}
      <div className="border border-border p-3 max-h-[120px] overflow-y-auto">
        <p className="text-xs text-muted-foreground mb-1">Message</p>
        <pre className="text-xs break-all whitespace-pre-wrap">
          {JSON.stringify(typedData.message, null, 2)}
        </pre>
      </div>
    </div>
  );
}

// eth_sendTransaction — shows recipient, ETH value, calldata snippet, and gas limit.
// params[0] is a transaction object with hex-encoded value/gas fields.
function SendTransactionScreen({ request }: { request: PendingRequest }) {
  const tx = request.params[0] as Record<string, string>;
  // value is hex-encoded wei — convert to ETH for display.
  const valueEth = tx.value ? formatEther(BigInt(tx.value)) : '0';

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        This site is requesting to send a transaction on your behalf.
      </p>
      <div className="border border-border p-3 flex flex-col gap-2">
        <div className="flex flex-col gap-0.5">
          <p className="text-xs text-muted-foreground">To</p>
          <p className="text-sm font-mono break-all">{tx.to ?? '—'}</p>
        </div>
        <Separator />
        <div className="flex flex-col gap-0.5">
          <p className="text-xs text-muted-foreground">Value</p>
          <p className="text-sm">{valueEth} ETH</p>
        </div>
        {tx.data && tx.data !== '0x' && (
          <>
            <Separator />
            <div className="flex flex-col gap-0.5">
              <p className="text-xs text-muted-foreground">Data</p>
              {/* Show only the first 32 bytes (function selector + first arg) to avoid overflow */}
              <p className="text-sm font-mono break-all truncate">{tx.data.slice(0, 66)}…</p>
            </div>
          </>
        )}
        {tx.gas && (
          <>
            <Separator />
            <div className="flex flex-col gap-0.5">
              <p className="text-xs text-muted-foreground">Gas limit</p>
              <p className="text-sm">{parseInt(tx.gas, 16).toLocaleString()}</p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Main approval App ────────────────────────────────────────────────────────

export default function App() {
  const [request, setRequest] = useState<PendingRequest | null>(null);
  const [wallet, setWallet] = useState<UmKeystore | null>(null);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // requestId is embedded in the popup URL by background.ts.
  const requestId = getRequestId();

  useEffect(() => {
    if (!requestId) return;

    // Each pending request is stored under its own key so concurrent requests
    // (e.g. eth_chainId fired alongside eth_requestAccounts by wagmi) never
    // overwrite each other. Clean up after reading to avoid stale entries.
    const storageKey = `pendingRequest_${requestId}`;
    browser.storage.local.get(storageKey).then((data) => {
      const pending = data[storageKey] as PendingRequest | undefined;
      if (pending) {
        setRequest(pending);
        browser.storage.local.remove(storageKey);
      }
    });

    getActiveWallet().then(setWallet);
  }, [requestId]);

  // eth_requestAccounts only reveals the address — no key material needed.
  // All other methods require the password to decrypt the mnemonic and sign.
  const needsPassword = request?.method !== 'eth_requestAccounts';

  const METHOD_LABELS: Record<string, string> = {
    eth_requestAccounts: 'Connect Wallet',
    personal_sign: 'Sign Message',
    eth_signTypedData_v4: 'Sign Typed Data',
    eth_sendTransaction: 'Approve Transaction',
  };

  async function handleApprove() {
    if (!request || !wallet) return;
    setError('');
    setLoading(true);

    try {
      let result: unknown;

      if (request.method === 'eth_requestAccounts') {
        // No signing needed — simply return the wallet's public address.
        // background.ts will persist this in connectedOrigins after receiving it.
        result = [wallet.address];
      } else {
        // Decrypt the mnemonic from the keystore using the user's password.
        // If the password is wrong, Keystore.toKey / Keystore.decrypt will throw.
        const account = await decryptWallet(wallet, password);

        switch (request.method) {
          case 'personal_sign': {
            const rawMsg = request.params[0] as string;
            // personal_sign supports both raw strings and 0x-prefixed hex bytes.
            // viem distinguishes these via the `message` shape.
            if (rawMsg.startsWith('0x')) {
              result = await account.signMessage({ message: { raw: rawMsg as Hex } });
            } else {
              result = await account.signMessage({ message: rawMsg });
            }
            break;
          }

          case 'eth_signTypedData_v4': {
            const typedData = JSON.parse(request.params[1] as string);
            const { domain, types, primaryType, message } = typedData;
            // EIP-712: strip EIP712Domain from the types object — viem adds it
            // automatically and passing it explicitly causes a type error.
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const { EIP712Domain: _, ...strippedTypes } = types ?? {};
            result = await account.signTypedData({ domain, types: strippedTypes, primaryType, message });
            break;
          }

          case 'eth_sendTransaction': {
            // Build a viem wallet client with the decrypted account and broadcast
            // the transaction. The RPC URL is read from the user's saved settings.
            const tx = request.params[0] as Record<string, string>;
            const client = createWalletClient({
              account,
              chain: mainnet,
              transport: http(getRpcUrl()),
            });
            result = await client.sendTransaction({
              to: tx.to as Hex,
              value: tx.value ? BigInt(tx.value) : 0n,
              data: tx.data as Hex | undefined,
              gas: tx.gas ? BigInt(tx.gas) : undefined,
              maxFeePerGas: tx.maxFeePerGas ? BigInt(tx.maxFeePerGas) : undefined,
              maxPriorityFeePerGas: tx.maxPriorityFeePerGas ? BigInt(tx.maxPriorityFeePerGas) : undefined,
              nonce: tx.nonce ? parseInt(tx.nonce, 16) : undefined,
            });
            break;
          }
        }
      }

      // Send the result to background.ts, which will push it to the dApp tab.
      const msg: ApprovalResultMessage = {
        type: 'UM_APPROVAL_RESULT',
        requestId: request.requestId,
        result,
      };
      await browser.runtime.sendMessage(msg);
      window.close();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      // Surface a clear message for wrong password — the raw ox/viem error
      // messages reference 'decrypt' or 'key' which aren't user-friendly.
      if (message.toLowerCase().includes('decrypt') || message.toLowerCase().includes('password') || message.toLowerCase().includes('key')) {
        setError('Wrong password. Please try again.');
      } else {
        setError(message);
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleReject() {
    if (!request) { window.close(); return; }
    // Notify background so it can push a USER_REJECTED (4001) error to the dApp.
    const msg: ApprovalRejectMessage = { type: 'UM_APPROVAL_REJECT', requestId: request.requestId };
    await browser.runtime.sendMessage(msg);
    window.close();
  }

  // Show a spinner while the request and wallet are being loaded from storage.
  if (!request || !wallet) {
    return (
      <div className="flex flex-col w-[400px] h-[600px] items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex flex-col w-[400px] h-[600px]">
      {/* Origin badge — shows the dApp's domain so the user knows which site is asking */}
      <div className="flex flex-row items-center gap-2 px-4 py-3 border-b border-border bg-muted">
        <Lock className="w-4 h-4 text-muted-foreground shrink-0" />
        <p className="text-sm text-muted-foreground truncate">{request.origin}</p>
      </div>

      {/* Action title derived from the RPC method */}
      <div className="px-4 pt-4 pb-2">
        <h1 className="text-lg font-bold">{METHOD_LABELS[request.method] ?? request.method}</h1>
      </div>

      <Separator />

      {/* Scrollable request details — rendered by the method-specific component */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {request.method === 'eth_requestAccounts' && (
          <ConnectScreen request={request} wallet={wallet} />
        )}
        {request.method === 'personal_sign' && (
          <SignMessageScreen request={request} />
        )}
        {request.method === 'eth_signTypedData_v4' && (
          <SignTypedDataScreen request={request} />
        )}
        {request.method === 'eth_sendTransaction' && (
          <SendTransactionScreen request={request} />
        )}
      </div>

      {/* Password field (signing methods only) + action buttons */}
      <div className="flex flex-col gap-3 px-4 pb-4 pt-2 border-t border-border">
        {needsPassword && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="password">Wallet password</Label>
            <Input
              id="password"
              type="password"
              placeholder="Enter your password"
              value={password}
              onChange={(e) => { setPassword(e.target.value); setError(''); }}
              onKeyDown={(e) => { if (e.key === 'Enter') handleApprove(); }}
              autoFocus
            />
          </div>
        )}

        {error && (
          <p className="text-sm text-red-400">{error}</p>
        )}

        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="outline"
            onClick={handleReject}
            disabled={loading}
          >
            Reject
          </Button>
          <Button
            onClick={handleApprove}
            disabled={loading || (needsPassword && !password)}
            className={cn(loading && 'opacity-70')}
          >
            {loading ? (
              <span className="flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                {request.method === 'eth_sendTransaction' ? 'Sending…' : 'Signing…'}
              </span>
            ) : (
              request.method === 'eth_requestAccounts' ? 'Connect' : 'Approve'
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
