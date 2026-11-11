import { useTables } from '@/stores/tables'
import { AlsoReportDialog } from './AlsoReportDialog'
import { TableMapDialog } from './TableMapDialog'

/** Mounts the open table-tagging dialog, if any ("Map as table" or "Also report as"). */
export function TableDialogs() {
  const { dialog, close } = useTables()
  if (!dialog) return null
  if (dialog.kind === 'map') return <TableMapDialog key={dialog.range.ref} range={dialog.range} onClose={close} />
  return <AlsoReportDialog key={dialog.mappingId} mappingId={dialog.mappingId} concept={dialog.concept} onClose={close} />
}
