/**
 * Read-only Excel view (Univer) with the mapping overlay and two-way linkage.
 * Overlay colours are highlight layers, never cell styles, so the client's workbook is never modified.
 */
import { useEffect, useRef } from 'react'
import { createUniver, LocaleType, mergeLocales, type FUniver, type IDisposable } from '@univerjs/presets'
import { UniverSheetsCorePreset } from '@univerjs/preset-sheets-core'
import UniverPresetSheetsCoreEnUS from '@univerjs/preset-sheets-core/locales/en-US'
import '@univerjs/preset-sheets-core/lib/index.css'
import type { MappingView } from '@shared/editor'
import { cellKey, MAX_BLOCK_CELLS, MAX_RANGE_CELLS, rangeA1, rangeOf, type CellRef, type WorkbookModel } from '@shared/workbook'
import { registerTestHook } from '@/lib/test-hooks'
import { useEditor } from '@/stores/editor'
import { toUniverWorkbook } from './univer-data'

/** Overlay palette (docs/08-ui-ux.md "Mapping colours"). */
const STYLE = {
  approved: { fill: 'rgba(22,163,74,0.16)', stroke: 'rgba(22,163,74,0.75)' },
  suggested: { fill: 'rgba(217,119,6,0.18)', stroke: 'rgba(217,119,6,0.85)' },
  rejected: { fill: 'rgba(220,38,38,0.08)', stroke: 'rgba(220,38,38,0.6)' },
  linked: { fill: 'rgba(37,99,235,0.10)', stroke: 'rgba(37,99,235,1)' },
  /** a suggested table block: an outline only, so the cells' own colours show through */
  block: { fill: 'rgba(217,119,6,0)', stroke: 'rgba(217,119,6,0.95)' },
} as const

const overlayStyle = (s: { fill: string; stroke: string }, strokeWidth = 1, strokeDash?: number) => ({
  ...s,
  strokeWidth,
  ...(strokeDash ? { strokeDash } : {}),
  widgets: {},
  widgetSize: 0,
})

/** ~3 s of 100 ms tries: the grid is created after React's commit and a sheet renders a few frames after activation */
const REVEAL_RETRIES = 30

/** Shows a cell (activates its sheet, selects and scrolls to it). False while the grid can't do it yet. */
function revealCell(univerAPI: FUniver | null, cell: CellRef): boolean {
  const wb = univerAPI?.getActiveWorkbook()
  const ws = wb?.getSheetByName(cell.sheet)
  const at = rangeOf(cell.ref)
  if (!wb || !ws || !at) return false
  try {
    ws.activate()
    ws.getRange(cell.ref).activate()
    ws.scrollToCell(Math.max(0, at.r1 - 3), Math.max(0, at.c1 - 2))
    return true
  } catch {
    return false // render unit not registered yet
  }
}

export function UniverGrid({ model }: { model: WorkbookModel }) {
  const host = useRef<HTMLDivElement>(null)
  const apiRef = useRef<FUniver | null>(null)
  const overlays = useRef<IDisposable[]>([])
  const mappings = useEditor((s) => s.mappings)
  const blockSuggestions = useEditor((s) => s.blockSuggestions)
  const selection = useEditor((s) => s.selection)
  const reveal = useEditor((s) => s.reveal)

  // ---- create Univer for this workbook
  useEffect(() => {
    const el = host.current
    if (!el) return
    // Univer mounts/unmounts its own React roots. Doing that inside React's commit logs "Attempted to synchronously
    // unmount a root while React was already rendering", so creation and disposal both run after the commit. Deferring
    // creation also means StrictMode's throwaway mount creates nothing: two live Univer instances break event delivery.
    let instance: { dispose(): void } | null = null
    let subs: IDisposable[] = []
    const create = setTimeout(() => {
      const { univer, univerAPI } = createUniver({
        locale: LocaleType.EN_US,
        locales: { [LocaleType.EN_US]: mergeLocales(UniverPresetSheetsCoreEnUS) },
        presets: [
          UniverSheetsCorePreset({
            container: el,
            header: false,
            toolbar: false,
            formulaBar: false,
            contextMenu: false,
            footer: { sheetBar: true, statisticBar: false, menus: false, zoomSlider: true },
          }),
        ],
      })
      instance = univer
      const wb = univerAPI.createWorkbook(toUniverWorkbook(model))
      wb.setEditable(false) // edits flowing back into the filing arrive in a later phase
      apiRef.current = univerAPI
      registerTestHook('univer', univerAPI)

      // Univer 1.4: the selection events (SelectionMoveEnd, not SelectionChanged) start firing only after the grid's
      // first few clicks, while CellPointerUp fires on every click and after a drag. The payloads' `selections` can be
      // empty, so the active range is read from the workbook itself (selectCell ignores repeats).
      const onSelection = () => {
        const wb = univerAPI.getActiveWorkbook()
        const range = wb?.getActiveRange()
        const ws = wb?.getActiveSheet()
        if (!range || !ws) return
        // a drag over several cells selects the range (tagged as their sum)
        let g = { r1: range.getRow(), c1: range.getColumn(), r2: range.getLastRow(), c2: range.getLastColumn() }
        // a block over several rows and columns can be mapped to a table ("Map as table"); the selection is its first cell
        const isBlock = g.c2 > g.c1 && g.r2 > g.r1 && (g.r2 - g.r1 + 1) * (g.c2 - g.c1 + 1) <= MAX_BLOCK_CELLS
        useEditor.getState().setBlockRange(isBlock ? { workbook: model.source, sheet: ws.getSheetName(), ref: rangeA1(g) } : null)
        // only a one-column run of cells can be summed; a block, a whole column or the whole sheet means its first cell
        if (g.c2 !== g.c1 || g.r2 - g.r1 + 1 > MAX_RANGE_CELLS) g = { r1: g.r1, c1: g.c1, r2: g.r1, c2: g.c1 }
        useEditor.getState().selectCell({ workbook: model.source, sheet: ws.getSheetName(), ref: rangeA1(g) })
      }
      subs = [
        univerAPI.addEvent(univerAPI.Event.CellPointerUp, onSelection),
        univerAPI.addEvent(univerAPI.Event.SelectionMoveEnd, onSelection),
        univerAPI.addEvent(univerAPI.Event.SelectionChanged, onSelection),
        univerAPI.addEvent(univerAPI.Event.ActiveSheetChanged, () => drawOverlay()),
      ]
      drawOverlay()
    }, 0)
    return () => {
      clearTimeout(create)
      subs.forEach((d) => d.dispose())
      overlays.current.forEach((d) => d.dispose())
      overlays.current = []
      apiRef.current = null
      const univer = instance
      if (univer) setTimeout(() => univer.dispose(), 0)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model])

  // ---- overlay: tag status colours + the cell linked to the selected fact
  function drawOverlay(): void {
    const univerAPI = apiRef.current
    const ws = univerAPI?.getActiveWorkbook()?.getActiveSheet()
    if (!univerAPI || !ws) return
    overlays.current.forEach((d) => d.dispose())
    overlays.current = []
    const { mappings, selection, blockSuggestions } = useEditor.getState()
    const sheetName = ws.getSheetName()
    const groups = new Map<keyof typeof STYLE, string[]>()
    for (const m of mappings as MappingView[]) {
      if (m.cell.workbook !== model.source || m.cell.sheet !== sheetName) continue
      const list = groups.get(m.status) ?? []
      list.push(m.cell.ref)
      groups.set(m.status, list)
    }
    for (const [status, refs] of groups) {
      overlays.current.push(ws.highlightRanges(refs.map((a1) => ws.getRange(a1)), overlayStyle(STYLE[status])))
    }
    const blocks = blockSuggestions.filter((b) => b.status === 'suggested' && b.cell.workbook === model.source && b.cell.sheet === sheetName)
    for (const b of blocks) overlays.current.push(ws.highlightRanges([ws.getRange(b.cell.ref)], overlayStyle(STYLE.block, 2, 8)))
    const linked = selection.factKey ? useEditor.getState().byFact.get(selection.factKey)?.cell : null
    if (linked && linked.workbook === model.source && linked.sheet === sheetName) {
      overlays.current.push(ws.highlightRanges([ws.getRange(linked.ref)], overlayStyle(STYLE.linked, 2)))
    }
  }

  useEffect(drawOverlay, [mappings, blockSuggestions, selection.factKey])

  // ---- reveal requests from the XBRL side (Form/XML/Inspector)
  // Univer registers a sheet's render unit some frames after the grid (or a newly activated sheet) appears; until then
  // scrollToCell throws. A throw inside an effect unmounts the whole React tree (a white window), so the reveal is
  // retried a few frames later and never throws.
  useEffect(() => {
    if (!reveal || reveal.cell.workbook !== model.source) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const attempt = (left: number) => {
      if (revealCell(apiRef.current, reveal.cell)) return drawOverlay()
      if (left > 0) timer = setTimeout(() => attempt(left - 1), 100)
    }
    attempt(REVEAL_RETRIES)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reveal?.seq])

  return <div ref={host} className="univer-host h-full w-full" data-testid="univer-host" data-cellkey={selection.cell ? cellKey(selection.cell) : ''} />
}
