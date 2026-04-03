import unitmetalSymbol from "@/assets/unitmetal-symbol.svg"
import { ThemeToggle } from "@/components/theme-toggle"
import { Maximize2, PanelRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { browser } from "wxt/browser"

function openInTab() {
  browser.tabs.create({ url: browser.runtime.getURL('/tab.html') });
}

async function openSidePanel() {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (tab.id) {
    await (browser.sidePanel as any).open({ tabId: tab.id });
  }
}

export default function ExtensionHeader() {
  return (
    <div className="flex flex-row items-center justify-between w-full px-3 py-2 border-b border-border">
      <img
        src={unitmetalSymbol}
        alt="UnitMetal"
        width={24}
        height={24}
        className="dark:invert"
      />
      <div className="flex flex-row items-center gap-2">
        <Button variant="outline" size="icon" onClick={openSidePanel} title="Open side panel">
          <PanelRight className="h-[1.2rem] w-[1.2rem]" />
        </Button>
        <Button variant="outline" size="icon" onClick={openInTab} title="Open in tab">
          <Maximize2 className="h-[1.2rem] w-[1.2rem]" />
        </Button>
        <ThemeToggle />
      </div>
    </div>
  )
}
