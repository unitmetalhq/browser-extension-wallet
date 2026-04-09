// ─── sign/App.tsx — message & typed-data signing approval popup ───────────────
//
// Opened by background.ts for personal_sign and eth_signTypedData_v4.
// Decrypts the wallet with the user's password and produces a signature.

import { useEffect, useState } from 'react';
import { Bytes } from 'ox';
import { browser } from 'wxt/browser';
import { Globe, LockOpen, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { getRequestId, getActiveWallet, decryptWallet, friendlyError } from '@/lib/approval';
import { getSessionPassword } from '@/lib/password-session';
import type { PendingRequest, ApprovalResultMessage, ApprovalRejectMessage } from '@/types/messages';
import type { UmKeystore } from '@/types/wallet';
import type { Hex } from 'viem';

// ─── Method-specific display ──────────────────────────────────────────────────

function SignMessageScreen({ request }: { request: PendingRequest }) {
  const rawMsg = request.params[0] as string;
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
      <div className="border border-border p-3 max-h-[200px] overflow-y-auto">
        <p className="text-sm break-all whitespace-pre-wrap">{displayMsg}</p>
      </div>
    </div>
  );
}

function SignTypedDataScreen({ request }: { request: PendingRequest }) {
  let typedData: Record<string, unknown> = {};
  try {
    typedData = JSON.parse(request.params[1] as string);
  } catch {}

  const domain = typedData.domain as Record<string, unknown> | undefined;

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        This site is requesting you to sign typed data.
      </p>
      {!!domain?.name && (
        <div className="border border-border p-3 flex flex-col gap-1">
          <p className="text-xs text-muted-foreground">Domain</p>
          <p className="text-sm font-medium">{domain.name as string}</p>
          {!!domain.version && (
            <p className="text-xs text-muted-foreground">v{domain.version as string}</p>
          )}
        </div>
      )}
      {!!typedData.primaryType && (
        <div className="border border-border p-3 flex flex-col gap-1">
          <p className="text-xs text-muted-foreground">Type</p>
          <p className="text-sm font-mono">{typedData.primaryType as string}</p>
        </div>
      )}
      <div className="border border-border p-3 max-h-[160px] overflow-y-auto">
        <p className="text-xs text-muted-foreground mb-1">Message</p>
        <pre className="text-xs break-all whitespace-pre-wrap">
          {JSON.stringify(typedData.message, null, 2)}
        </pre>
      </div>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const METHOD_LABELS: Record<string, string> = {
  personal_sign: 'Sign Message',
  eth_signTypedData_v4: 'Sign Typed Data',
};

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

  async function handleSign() {
    if (!request || !wallet) return;
    setError('');
    setLoading(true);

    try {
      const account = await decryptWallet(wallet, password);
      let result: unknown;

      if (request.method === 'personal_sign') {
        const rawMsg = request.params[0] as string;
        if (rawMsg.startsWith('0x')) {
          result = await account.signMessage({ message: { raw: rawMsg as Hex } });
        } else {
          result = await account.signMessage({ message: rawMsg });
        }
      } else if (request.method === 'eth_signTypedData_v4') {
        const typedData = JSON.parse(request.params[1] as string);
        const { domain, types, primaryType, message } = typedData;
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { EIP712Domain: _, ...strippedTypes } = types ?? {};
        result = await account.signTypedData({ domain, types: strippedTypes, primaryType, message });
      }

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

  const hostname = (() => { try { return new URL(request.origin).hostname; } catch { return request.origin; } })();

  return (
    <div className="flex flex-col w-[400px] h-screen">
      {/* Title */}
      <div className="px-4 pt-3 pb-2">
        <h1 className="text-sm font-bold">{METHOD_LABELS[request.method] ?? request.method}</h1>
      </div>
      <Separator />

      {/* App identity */}
      <div className="flex flex-row items-center gap-2 px-4 py-3 border-b border-border">
        <Globe className="w-4 h-4 text-muted-foreground shrink-0" />
        <p className="text-sm font-medium truncate">{hostname}</p>
      </div>

      <Separator />

      <div className="flex-1 overflow-y-auto px-4 py-4">
        {request.method === 'personal_sign' && <SignMessageScreen request={request} />}
        {request.method === 'eth_signTypedData_v4' && <SignTypedDataScreen request={request} />}
      </div>

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
              onKeyDown={(e) => { if (e.key === 'Enter' && password) handleSign(); }}
              autoFocus
            />
          </div>
        )}

        {error && <p className="text-xs text-destructive">{error}</p>}

        <div className="grid grid-cols-2 gap-2">
          <Button variant="outline" className="rounded-none hover:cursor-pointer" onClick={handleReject} disabled={loading}>
            Deny
          </Button>
          <Button className="rounded-none hover:cursor-pointer" onClick={handleSign} disabled={loading || !password}>
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Sign'}
          </Button>
        </div>
      </div>
    </div>
  );
}
