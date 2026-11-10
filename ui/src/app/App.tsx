import { useEffect } from 'react'
import { useSidecar } from '@/stores/sidecar'
import { useUi } from '@/stores/ui'
import { ActivityBar } from './ActivityBar'
import { StatusBar } from './StatusBar'
import { Workbench } from './Workbench'

export function App() {
  const init = useSidecar((s) => s.init)

  useEffect(() => init(), [init])

  useEffect(() => {
    return window.xap?.menu.onCommand((cmd) => {
      const ui = useUi.getState()
      if (cmd === 'view:toggle-sidebar') ui.toggleSidebar()
      else if (cmd === 'view:toggle-bottom') ui.toggleBottom()
      else if (cmd === 'tools:settings') ui.setActivity('settings')
      else if (cmd === 'filing:validate') ui.setBottomTab('problems')
      // Remaining commands (new/open/save/generate/MCA tool) are wired in Phases 3–6.
    })
  }, [])

  return (
    <div className="flex h-full flex-col bg-bg text-fg">
      <div className="flex min-h-0 flex-1">
        <ActivityBar />
        <Workbench />
      </div>
      <StatusBar />
    </div>
  )
}
