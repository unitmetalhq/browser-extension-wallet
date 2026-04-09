import { useState } from "react";
import ManageWallet from "@/components/manage-wallet";
import BackupWallet from "@/components/backup-wallet";
import SendTokens from "@/components/send-tokens";
import Balances from "@/components/balances";
import WalletSettings from "@/components/wallet-settings";
import { Wallet, ArrowUpRight, Save, Settings } from "lucide-react";
import type { LucideIcon } from "lucide-react";

type Tab = "wallets" | "send" | "backup" | "settings";

const TABS: { id: Tab; icon: LucideIcon }[] = [
  { id: "wallets", icon: Wallet },
  { id: "send", icon: ArrowUpRight },
  { id: "backup", icon: Save },
  { id: "settings", icon: Settings },
];

export default function MobileNavbar() {
  const [activeTab, setActiveTab] = useState<Tab>("wallets");

  return (
    <div className="flex flex-col w-full md:hidden">
      <div className="flex-1 pb-16">
        {activeTab === "wallets" && (
          <div className="flex flex-col gap-4">
            <ManageWallet />
            <Balances />
          </div>
        )}
        {activeTab === "send" && <SendTokens />}
        {activeTab === "backup" && <BackupWallet />}
        {activeTab === "settings" && <WalletSettings />}
      </div>

      <div className="fixed bottom-0 left-0 right-0 border-t-2 border-primary bg-background grid grid-cols-4" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 8px)' }}>
        {TABS.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`pt-3 pb-8 flex items-center justify-center hover:cursor-pointer transition-colors ${
                activeTab === tab.id
                  ? "bg-primary text-secondary"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="w-5 h-5" />
            </button>
          );
        })}
      </div>
    </div>
  );
}
