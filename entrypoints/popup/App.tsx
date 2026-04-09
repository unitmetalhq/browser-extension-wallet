import { useState } from 'react';
import ExtensionHeader from '@/components/extension-header';
import ManageWallet from '@/components/manage-wallet';
import BackupWallet from '@/components/backup-wallet';
import SendTokens from '@/components/send-tokens';
import Balances from '@/components/balances';
import WalletSettings from '@/components/wallet-settings';
import ManageAddressBook from '@/components/manage-address-book';
import OutgoingActivity from '@/components/outgoing-activity';
import IncomingActivity from '@/components/incoming-activity';
import { Wallet, BookUser, ArrowUpRight, TableProperties, Save, Settings } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

type Tab = 'wallets' | 'address-book' | 'send' | 'activity' | 'backup' | 'settings';

const TABS: { id: Tab; icon: LucideIcon }[] = [
  { id: 'wallets', icon: Wallet },
  { id: 'address-book', icon: BookUser },
  { id: 'send', icon: ArrowUpRight },
  { id: 'activity', icon: TableProperties },
  { id: 'backup', icon: Save },
  { id: 'settings', icon: Settings },
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
            <Balances />
          </div>
        )}
        {activeTab === 'address-book' && (
          <div className="p-3">
            <ManageAddressBook />
          </div>
        )}
        {activeTab === 'send' && (
          <div className="p-3">
            <SendTokens />
          </div>
        )}
        {activeTab === 'activity' && (
          <div className="flex flex-col gap-4 p-3">
            <OutgoingActivity />
            <IncomingActivity />
          </div>
        )}
        {activeTab === 'backup' && (
          <div className="p-3">
            <BackupWallet />
          </div>
        )}
        {activeTab === 'settings' && (
          <div className="p-3">
            <WalletSettings />
          </div>
        )}
      </div>

      <div className="absolute bottom-0 left-0 right-0 border-t-2 border-primary bg-background grid grid-cols-6 h-[44px]">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center justify-center hover:cursor-pointer transition-colors ${
                activeTab === tab.id
                  ? 'bg-primary text-secondary'
                  : 'text-muted-foreground hover:text-foreground'
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

export default App;
