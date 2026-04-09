import { useAtomValue } from 'jotai';
import { desktopTabAtom } from '@/atoms/desktopTabAtom';
import TabHeader from '@/components/tab-header';
import ManageWallet from '@/components/manage-wallet';
import SendTokens from '@/components/send-tokens';
import Balances from '@/components/balances';
import BackupWallet from '@/components/backup-wallet';
import WalletSettings from '@/components/wallet-settings';
import ManageAddressBook from '@/components/manage-address-book';
import OutgoingActivity from '@/components/outgoing-activity';
import IncomingActivity from '@/components/incoming-activity';

export default function App() {
  const desktopTab = useAtomValue(desktopTabAtom);

  return (
    <div className="flex flex-col min-h-screen">
      <TabHeader />
      <main className="flex-1 p-6">
        {desktopTab === 'home' && (
          <div className="grid lg:grid-cols-3 gap-4 w-full">
            <div className="flex flex-col gap-4">
              <ManageWallet />
            </div>
            <SendTokens />
            <div className="flex flex-col gap-4">
              <Balances />
            </div>
          </div>
        )}
        {desktopTab === 'backup' && (
          <div className="w-[760px] mx-auto">
            <BackupWallet />
          </div>
        )}
        {desktopTab === 'address-book' && (
          <div className="w-[760px] mx-auto">
            <ManageAddressBook />
          </div>
        )}
        {desktopTab === 'activity' && (
          <div className="grid lg:grid-cols-2 gap-4 w-full">
            <OutgoingActivity />
            <IncomingActivity />
          </div>
        )}
        {desktopTab === 'settings' && (
          <div className="w-[760px] mx-auto">
            <WalletSettings />
          </div>
        )}
      </main>
    </div>
  );
}
