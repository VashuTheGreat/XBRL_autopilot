import { Braces, Eye } from 'lucide-react'
import { lazy, Suspense } from 'react'
import { EmptyState } from '@/components/EmptyState'
import { Tabs } from '@/components/Tabs'
import { useUi } from '@/stores/ui'
import { FormView } from './FormView'

// Monaco is large: load it only when the XML tab is opened.
const XmlView = lazy(() => import('./XmlView').then((m) => ({ default: m.XmlView })))

/** Right editor: XBRL Form (ELR grid), live XML (Monaco) and MCA-like preview. */
export function XbrlPane() {
  const { rightTab, setRightTab } = useUi()
  return (
    <section className="flex h-full flex-col bg-panel" aria-label="XBRL">
      <Tabs
        value={rightTab}
        onChange={setRightTab}
        tabs={[
          { id: 'form', label: 'XBRL Form' },
          { id: 'xml', label: 'XML' },
          { id: 'preview', label: 'Preview' },
        ]}
      />
      <div className="min-h-0 flex-1">
        {rightTab === 'form' && <FormView />}
        {rightTab === 'xml' && (
          <Suspense fallback={<EmptyState icon={Braces} title="Loading XML editor…" />}>
            <XmlView />
          </Suspense>
        )}
        {rightTab === 'preview' && (
          <EmptyState icon={Eye} title="Preview" phase="Phase 6">
            An MCA-like rendering of the filing, exportable to PDF.
          </EmptyState>
        )}
      </div>
    </section>
  )
}
