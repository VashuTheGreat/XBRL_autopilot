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
import { cellKey, fromA1, toA1, type WorkbookModel } from '@shared/workbook'
import { registerTestHook } from '@/lib/test-hooks'
import { useEditor } from '@/stores/editor'
import { toUniverWorkbook } from './univer-data'

/** Overlay palette (docs/08-ui-ux.md "Mapping colours"). */
const STYLE = {
  approved: { fill: 'rgba(22,163,74,0.16)', stroke: 'rgba(22,163,74,0.75)' },
  suggested: { fill: 'rgba(217,119,6,0.18)', stroke: 'rgba(217,119,6,0.85)' },
  rejected: { fill: 'rgba(220,38,38,0.08)', stroke: 'rgba(220,38,38,0.6)' },
  linked: { fill: 'rgba(37,99,235,0.10)', stroke: 'rgba(37,99,235,1)' },
} as const

const overlayStyle = (s: { fill: string; stroke: string }, strokeWidth = 1) => ({
  ...s,
  strokeWidth,
  widgets: {},
  widgetSize: 0,
})

export function UniverGrid({ model }: { model: WorkbookModel }) {
  const host = useRef<HTMLDivElement>(null)
  const apiRef = useRef<FUniver | null>(null)
  const overlays = useRef<IDisposable[]>([])
  const mappings = useEditor((s) => s.mappings)
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

      // A user click fires SelectionMoveEnd (not SelectionChanged) in Univer 1.4, and the payload's `selections`
      // can be empty, so the active range is read from the workbook itself.
      const onSelection = () => {
        const wb = univerAPI.getActiveWorkbook()
        const range = wb?.getActiveRange()
        const ws = wb?.getActiveSheet()
        if (!range || !ws) return
        useEditor.getState().selectCell({ workbook: model.source, sheet: ws.getSheetName(), ref: toA1(range.getRow(), range.getColumn()) })
      }
      subs = [
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
    const { mappings, selection } = useEditor.getState()
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
    const linked = selection.factKey ? useEditor.getState().byFact.get(selection.factKey)?.cell : null
    if (linked && linked.workbook === model.source && linked.sheet === sheetName) {
      overlays.current.push(ws.highlightRanges([ws.getRange(linked.ref)], overlayStyle(STYLE.linked, 2)))
    }
  }

  useEffect(drawOverlay, [mappings, selection.factKey])

  // ---- reveal requests from the XBRL side (Form/XML/Inspector)
  useEffect(() => {
    const univerAPI = apiRef.current
    if (!reveal || !univerAPI || reveal.cell.workbook !== model.source) return
    const wb = univerAPI.getActiveWorkbook()
    const ws = wb?.getSheetByName(reveal.cell.sheet)
    const at = fromA1(reveal.cell.ref)
    if (!wb || !ws || !at) return
    ws.activate()
    ws.getRange(reveal.cell.ref).activate()
    ws.scrollToCell(Math.max(0, at.r - 3), Math.max(0, at.c - 2))
    drawOverlay()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reveal?.seq])

  return <div ref={host} className="univer-host h-full w-full" data-testid="univer-host" data-cellkey={selection.cell ? cellKey(selection.cell) : ''} />
}
