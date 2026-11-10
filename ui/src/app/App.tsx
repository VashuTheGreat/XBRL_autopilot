import { useEffect } from 'react'
import type { MenuCommand } from '@shared/ipc'
import { Toasts } from '@/components/Toasts'
import { NewFilingDialog } from '@/features/new-filing/NewFilingDialog'
import { useProject } from '@/stores/project'
import { useSettings } from '@/stores/settings'
import { useSidecar } from '@/stores/sidecar'
import { toast } from '@/stores/toast'
import { useUi } from '@/stores/ui'
import { ActivityBar } from './ActivityBar'
import { StatusBar } from './StatusBar'
import { Workbench } from './Workbench'

/** Menu command → use case. One place, so the menu, toolbar buttons and shortcuts stay consistent. */
function runCommand(cmd: MenuCommand): void {
  const ui = useUi.getState()
  const project = useProject.getState()
  switch (cmd) {
    case 'file:new':
      return project.openNewFiling()
    case 'file:open':
      return void project.open()
    case 'file:save':
      return void (project.summary ? project.save() : undefined)
    case 'file:save-as':
      return void (project.summary ? project.saveAs() : undefined)
    case 'view:toggle-sidebar':
      return ui.toggleSidebar()
    case 'view:toggle-bottom':
      return ui.toggleBottom()
    case 'tools:settings':
      return ui.setActivity('settings')
    case 'filing:validate':
      return ui.setBottomTab('problems')
    default:
      // view:quick-switch, filing:generate-xml, tools:open-mca-validator arrive with Phases 4–6
      return toast.info('Coming in a later phase of the build.')
  }
}

export function App() {
  const initSidecar = useSidecar((s) => s.init)
  const initProject = useProject((s) => s.init)
  const initSettings = useSettings((s) => s.init)

  useEffect(() => initSidecar(), [initSidecar])
  useEffect(() => initProject(), [initProject])
  useEffect(() => initSettings(), [initSettings])
  useEffect(() => window.xap?.menu.onCommand(runCommand), [])

  return (
    <div className="flex h-full flex-col bg-bg text-fg">
      <div className="flex min-h-0 flex-1">
        <ActivityBar />
        <Workbench />
      </div>
      <StatusBar />
      <NewFilingDialog />
      <Toasts />
    </div>
  )
}
