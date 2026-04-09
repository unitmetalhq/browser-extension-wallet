// ─── connect/App.tsx — wallet connection approval popup ───────────────────────
//
// Opened by background.ts for eth_requestAccounts. No key material is needed —
// the user just confirms which address to expose to the dApp.

import { useEffect, useState } from 'react';
import { browser } from 'wxt/browser';
import { Globe, Loader2, Wallet, Check, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { truncateAddress } from '@/lib/utils';
import { getRequestId, getActiveWallet } from '@/lib/approval';
import type { PendingRequest, ApprovalResultMessage, ApprovalRejectMessage } from '@/types/messages';
import type { UmKeystore } from '@/types/wallet';

function parseOrigin(origin: string) {
  try {
    const url = new URL(origin);
    return { hostname: url.hostname, origin };
  } catch {
    return { hostname: origin, origin };
  }
}

export default function App() {
  const [request, setRequest] = useState<PendingRequest | null>(null);
  const [wallet, setWallet] = useState<UmKeystore | null>(null);
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
  }, [requestId]);

  async function handleConnect() {
    if (!request || !wallet) return;
    setLoading(true);
    const msg: ApprovalResultMessage = {
      type: 'UM_APPROVAL_RESULT',
      requestId: request.requestId,
      result: [wallet.address],
    };
    await browser.runtime.sendMessage(msg);
    window.close();
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

  const { hostname } = parseOrigin(request.origin);


  return (
    <div className="flex flex-col w-[400px] h-screen">
      {/* Title */}
      <div className="px-4 pt-3 pb-2">
        <h1 className="text-sm font-bold">Connect Wallet</h1>
      </div>
      <Separator />
      {/* App identity */}
      <div className="flex flex-row items-center gap-2 px-4 py-3 border-b border-border">
        <Globe className="w-4 h-4 text-muted-foreground shrink-0" />
        <p className="text-sm font-medium truncate">{hostname}</p>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-2 flex flex-col gap-2">
        {/* Account */}
        <div className="border border-border p-2 flex flex-col gap-1.5">
          <p className="text-xs text-muted-foreground">Account</p>
          <div className="flex flex-row items-center gap-2">
            <Wallet className="w-4 h-4 text-muted-foreground shrink-0" />
            <div className="flex flex-col">
              <p className="text-sm font-medium">{wallet.name}</p>
              <p className="text-xs text-muted-foreground font-mono">{wallet.address}</p>
            </div>
          </div>
        </div>

        {/* Permissions notice */}
        <div className="border border-border p-3 flex flex-col gap-2">
          <p className="text-xs text-muted-foreground">This app will be able to</p>
          <div className="flex flex-col gap-1.5">
            <div className="flex flex-row items-center gap-2">
              <Check className="w-3.5 h-3.5 text-green-500 shrink-0" />
              <p className="text-xs">View your wallet address</p>
            </div>
            <div className="flex flex-row items-center gap-2">
              <Check className="w-3.5 h-3.5 text-green-500 shrink-0" />
              <p className="text-xs">View your balances and activity</p>
            </div>
            <div className="flex flex-row items-center gap-2">
              <Check className="w-3.5 h-3.5 text-green-500 shrink-0" />
              <p className="text-xs">Request transaction approvals</p>
            </div>
          </div>
          <Separator />
          <p className="text-xs text-muted-foreground">This app will not be able to</p>
          <div className="flex flex-col gap-1.5">
            <div className="flex flex-row items-center gap-2">
              <X className="w-3.5 h-3.5 text-destructive shrink-0" />
              <p className="text-xs">Move funds without your approval</p>
            </div>
            <div className="flex flex-row items-center gap-2">
              <X className="w-3.5 h-3.5 text-destructive shrink-0" />
              <p className="text-xs">Sign transactions without your approval</p>
            </div>
          </div>
        </div>

      </div>

      {/* Actions */}
      <div className="flex flex-col gap-2 px-4 py-3 border-t border-border">
        <div className="grid grid-cols-2 gap-2">
          <Button variant="outline" className="rounded-none hover:cursor-pointer" onClick={handleReject} disabled={loading}>
            Reject
          </Button>
          <Button className="rounded-none hover:cursor-pointer" onClick={handleConnect} disabled={loading}>
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Connect'}
          </Button>
        </div>
      </div>

    </div>
  );
}
