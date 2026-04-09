// ─── Session password helpers ─────────────────────────────────────────────────
// Stores the wallet password in browser.storage.session — cleared on browser
// restart, never written to disk, shared across all extension pages.
//
// The seed phrase stays encrypted at all times. The password is only used
// momentarily during signing (PBKDF2 derive → AES decrypt → sign → discard).

import { browser } from "wxt/browser";

const SESSION_KEY = "sessionPassword";

export async function getSessionPassword(): Promise<string | null> {
  const data = await browser.storage.session.get(SESSION_KEY);
  return (data[SESSION_KEY] as string | undefined) ?? null;
}

export async function setSessionPassword(password: string): Promise<void> {
  await browser.storage.session.set({ [SESSION_KEY]: password });
}

export async function clearSessionPassword(): Promise<void> {
  await browser.storage.session.remove(SESSION_KEY);
}

export async function isSessionUnlocked(): Promise<boolean> {
  const pw = await getSessionPassword();
  return pw !== null;
}
