import { useState } from 'react';
import ExtensionHeader from '@/components/extension-header';
import ManageWallet from '@/components/manage-wallet';
import BackupWallet from '@/components/backup-wallet';
import SendTokens from '@/components/send-tokens';
import Balances from '@/components/balances';
import WalletSettings from '@/components/wallet-settings';

type Tab = 'wallets' | 'send' | 'balances' | 'settings';

const TABS: { id: Tab; label: string }[] = [
  { id: 'wallets', label: 'Wallets' },
  { id: 'send', label: 'Send' },
  { id: 'balances', label: 'Balances' },
  { id: 'settings', label: 'Settings' },
];

function App() {
  const [activeTab, setActiveTab] = useState<Tab>('wallets');

  return (
    <div className="flex flex-col w-[400px] h-[600px]">
      <ExtensionHeader />

      <div className="flex-1 overflow-y-auto pb-[44px]">
        {activeTab === 'wallets' && (
          <div className="flex flex-col gap-4 p-3">
            <ManageWallet />
            <BackupWallet />
          </div>
        )}
        {activeTab === 'send' && (
          <div className="p-3">
            <SendTokens />
          </div>
        )}
        {activeTab === 'balances' && (
          <div className="p-3">
            <Balances />
          </div>
        )}
        {activeTab === 'settings' && (
          <div className="p-3">
            <WalletSettings />
          </div>
        )}
      </div>

      <div className="absolute bottom-0 left-0 right-0 border-t-2 border-primary bg-background grid grid-cols-4 h-[44px]">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`text-sm font-medium hover:cursor-pointer transition-colors ${
              activeTab === tab.id
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export default App;
