import { useEffect, useState } from "react";
import { browser } from "wxt/browser";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Lock, LockOpen, Loader2 } from "lucide-react";
import { decryptWalletToAccount } from "@/lib/um-wallet";
import { getSessionPassword, setSessionPassword, clearSessionPassword } from "@/lib/password-session";
import type { UmKeystore } from "@/types/wallet";

export default function ManageSessionPassword({ activeWallet }: { activeWallet: UmKeystore | null }) {
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [unlockOpen, setUnlockOpen] = useState(false);
  const [lockOpen, setLockOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    getSessionPassword().then((pw) => setIsUnlocked(pw !== null));

    function onSessionChanged(changes: Record<string, { newValue?: unknown }>) {
      if ("sessionPassword" in changes) {
        setIsUnlocked(changes.sessionPassword.newValue !== undefined);
      }
    }
    browser.storage.session.onChanged.addListener(onSessionChanged);
    return () => browser.storage.session.onChanged.removeListener(onSessionChanged);
  }, []);

  async function handleUnlock() {
    if (!activeWallet || !password) return;
    setError("");
    setLoading(true);
    try {
      await decryptWalletToAccount(activeWallet, password);
      await setSessionPassword(password);
      setIsUnlocked(true);
      setUnlockOpen(false);
      setPassword("");
    } catch {
      setError("Wrong password. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function handleLock() {
    await clearSessionPassword();
    setIsUnlocked(false);
    setLockOpen(false);
  }

  if (isUnlocked) {
    return (
      <Dialog open={lockOpen} onOpenChange={setLockOpen}>
        <DialogTrigger
          render={
            <Button
              type="button"
              className="rounded-none hover:cursor-pointer text-green-600 bg-green-500/10"
              title="Session unlocked"
              disabled={!activeWallet}
            />
          }
        >
          <LockOpen />
          Session unlocked
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Wallet Session Active</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">
            Your password is held in session memory. You will not be asked for it on signing requests until the browser restarts or you lock the session manually.
          </p>
          <Button
            variant="outline"
            className="rounded-none hover:cursor-pointer"
            onClick={handleLock}
          >
            <Lock />
            Lock session
          </Button>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={unlockOpen} onOpenChange={(o) => { setUnlockOpen(o); setPassword(""); setError(""); }}>
      <DialogTrigger
        render={
          <Button
            type="button"
            className="rounded-none hover:cursor-pointer"
            disabled={!activeWallet}
            title="Unlock wallet session"
          />
        }
      >
        <Lock />
        Unlock session
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Unlock Wallet Session</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">
          Enter your password once to skip re-entering it on every signing request. Your seed phrase stays encrypted — only the password is held in session memory until the browser restarts.
        </p>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="session-password">Password</Label>
          <Input
            id="session-password"
            type="password"
            placeholder="Enter your wallet password"
            value={password}
            onChange={(e) => { setPassword(e.target.value); setError(""); }}
            onKeyDown={(e) => { if (e.key === "Enter" && password) handleUnlock(); }}
            autoFocus
          />
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="outline"
            className="rounded-none hover:cursor-pointer"
            onClick={() => setUnlockOpen(false)}
          >
            Cancel
          </Button>
          <Button
            className="rounded-none hover:cursor-pointer"
            onClick={handleUnlock}
            disabled={loading || !password}
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Unlock"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
