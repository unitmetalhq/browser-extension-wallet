import unitmetalSymbol from '@/assets/unitmetal-symbol.svg';
import { ThemeToggle } from '@/components/theme-toggle';
import DesktopNavbar from '@/components/desktop-navbar';

export default function TabHeader() {
  return (
    <div className="flex flex-row items-center justify-between w-full px-6 py-3 border-b border-border">
      <div className="flex flex-row items-center gap-6">
        <img
          src={unitmetalSymbol}
          alt="UnitMetal"
          width={24}
          height={24}
          className="dark:invert"
        />
        <DesktopNavbar />
      </div>
      <ThemeToggle />
    </div>
  );
}
