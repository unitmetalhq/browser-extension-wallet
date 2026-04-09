// ─── approve/App.tsx — transaction approval popup ─────────────────────────────
//
// Opened by background.ts for eth_sendTransaction only.
// Decrypts the wallet with the user's password and broadcasts the transaction.

import { useEffect, useState } from 'react';
import { createWalletClient, http, formatEther, type Hex } from 'viem';
import { mainnet } from 'viem/chains';
import { browser } from 'wxt/browser';
import { Globe, Lock, LockOpen, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { getRequestId, getActiveWallet, decryptWallet, getRpcUrl, friendlyError } from '@/lib/approval';
import { getSessionPassword } from '@/lib/password-session';
import type { PendingRequest, ApprovalResultMessage, ApprovalRejectMessage } from '@/types/messages';
import type { UmKeystore } from '@/types/wallet';

function parseOrigin(origin: string) {
  try {
    return new URL(origin).hostname;
  } catch {
    return origin;
  }
}

export default function App() {
  const [request, setRequest] = useState<PendingRequest | null>(null);
  const [wallet, setWallet] = useState<UmKeystore | null>(null);
  const [password, setPassword] = useState('');
  const [sessionActive, setSessionActive] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const requestId = getRequestId();

  useEffect(() => {
    if (!requestId) return;
    const storageKey = `pendingRequest_${requestId}`;
    browser.storage.local.get(storageKey).then((data) => {
      const pending = data[storageKey] as PendingRequest | undefined;
      if (pending) {
        setRequest(pending);
        browser.storage.local.remove(storageKey);
      }
    });
    getActiveWallet().then(setWallet);
    getSessionPassword().then((pw) => {
      if (pw) { setSessionActive(true); setPassword(pw); }
    });
  }, [requestId]);

  async function handleApprove() {
    if (!request || !wallet) return;
    setError('');
    setLoading(true);

    try {
      const account = await decryptWallet(wallet, password);
      const tx = request.params[0] as Record<string, string>;
      const client = createWalletClient({
        account,
        chain: mainnet,
        transport: http(getRpcUrl()),
      });
      const result = await client.sendTransaction({
        to: tx.to as Hex,
        value: tx.value ? BigInt(tx.value) : 0n,
        data: tx.data as Hex | undefined,
        gas: tx.gas ? BigInt(tx.gas) : undefined,
        maxFeePerGas: tx.maxFeePerGas ? BigInt(tx.maxFeePerGas) : undefined,
        maxPriorityFeePerGas: tx.maxPriorityFeePerGas ? BigInt(tx.maxPriorityFeePerGas) : undefined,
        nonce: tx.nonce ? parseInt(tx.nonce, 16) : undefined,
      });

      const msg: ApprovalResultMessage = {
        type: 'UM_APPROVAL_RESULT',
        requestId: request.requestId,
        result,
      };
      await browser.runtime.sendMessage(msg);
      window.close();
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setLoading(false);
    }
  }

  async function handleReject() {
    if (!request) { window.close(); return; }
    const msg: ApprovalRejectMessage = {
      type: 'UM_APPROVAL_REJECT',
      requestId: request.requestId,
    };
    await browser.runtime.sendMessage(msg);
    window.close();
  }

  if (!request || !wallet) {
    return (
      <div className="flex flex-col w-[400px] h-screen items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const tx = request.params[0] as Record<string, string>;
  const valueEth = tx.value ? formatEther(BigInt(tx.value)) : '0';
  const hostname = parseOrigin(request.origin);

  return (
    <div className="flex flex-col w-[400px] h-screen">
      {/* Title */}
      <div className="px-4 pt-3 pb-2">
        <h1 className="text-sm font-bold">Approve Request</h1>
      </div>
      <Separator />

      {/* App identity */}
      <div className="flex flex-row items-center gap-2 px-4 py-3 border-b border-border">
        <Globe className="w-4 h-4 text-muted-foreground shrink-0" />
        <p className="text-sm font-medium truncate">{hostname}</p>
      </div>

      {/* Transaction details */}
      <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-2">
        <p className="text-xs text-muted-foreground">Transaction details</p>

        <div className="border border-border flex flex-col">
          {tx.to && (
            <>
              <div className="px-3 py-2 flex flex-col gap-0.5">
                <p className="text-xs text-muted-foreground">To</p>
                <p className="text-xs font-mono break-all">{tx.to}</p>
              </div>
              <Separator />
            </>
          )}

          <div className="px-3 py-2 flex flex-col gap-0.5">
            <p className="text-xs text-muted-foreground">Value</p>
            <p className="text-sm font-medium">{valueEth} ETH</p>
          </div>

          {tx.gas && (
            <>
              <Separator />
              <div className="px-3 py-2 flex flex-col gap-0.5">
                <p className="text-xs text-muted-foreground">Gas limit</p>
                <p className="text-sm">{parseInt(tx.gas, 16).toLocaleString()}</p>
              </div>
            </>
          )}

          {tx.data && tx.data !== '0x' && (
            <>
              <Separator />
              <div className="px-3 py-2 flex flex-col gap-0.5">
                <p className="text-xs text-muted-foreground">Data</p>
                <p className="text-xs font-mono break-all">{tx.data.slice(0, 66)}{tx.data.length > 66 ? '…' : ''}</p>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex flex-col gap-2 px-4 py-3 border-t border-border">
        {sessionActive ? (
          <p className="text-xs text-green-500 flex items-center gap-1.5">
            <LockOpen className="w-3.5 h-3.5" /> Session unlocked — no password needed
          </p>
        ) : (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="password">Wallet password</Label>
            <Input
              id="password"
              type="password"
              placeholder="Enter your password"
              value={password}
              onChange={(e) => { setPassword(e.target.value); setError(''); }}
              onKeyDown={(e) => { if (e.key === 'Enter' && password) handleApprove(); }}
              autoFocus
            />
          </div>
        )}

        {error && <p className="text-xs text-destructive">{error}</p>}

        <div className="grid grid-cols-2 gap-2">
          <Button variant="outline" className="rounded-none hover:cursor-pointer" onClick={handleReject} disabled={loading}>
            Deny
          </Button>
          <Button className="rounded-none hover:cursor-pointer" onClick={handleApprove} disabled={loading || !password}>
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Approve'}
          </Button>
        </div>
      </div>
    </div>
  );
}
