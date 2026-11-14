/**
 * Expand / collapse of the Form's statement tree (webXBRL's + / − per head and Ctrl+E). Pure helpers over the rows'
 * depths, plus the hook that keeps the state per statement.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FormView } from '@shared/editor'

type TreeRow = { depth: number }

/** Rows that have rows below them in the tree (a head with + / −). */
export function parentRows(rows: TreeRow[]): number[] {
  return rows.flatMap((r, i) => (rows[i + 1] && rows[i + 1]!.depth > r.depth ? [i] : []))
}

/** Per row: hidden because a head above it is collapsed. */
export function hiddenRows(rows: TreeRow[], collapsed: ReadonlySet<number>): boolean[] {
  const out: boolean[] = []
  let hideBelow: number | null = null // depth of the collapsed head being skipped
  rows.forEach((r, i) => {
    if (hideBelow !== null && r.depth <= hideBelow) hideBelow = null
    out.push(hideBelow !== null)
    if (hideBelow === null && collapsed.has(i)) hideBelow = r.depth
  })
  return out
}

/** The heads that enclose a row (nearest first is not guaranteed; order doesn't matter). */
export function ancestorRows(rows: TreeRow[], index: number): number[] {
  const out: number[] = []
  let depth = rows[index]?.depth ?? 0
  for (let i = index - 1; i >= 0 && depth > 0; i--) {
    if (rows[i]!.depth < depth) {
      out.push(i)
      depth = rows[i]!.depth
    }
  }
  return out
}

/**
 * The tree state of one statement: collapsed heads and closed table grids, reset when the statement changes.
 * `reveal` opens whatever hides a row or table, then runs `then` once that is rendered (to scroll to it).
 */
export function useFormTree(form: FormView | null) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<number>>(new Set())
  const [closedTables, setClosedTables] = useState<ReadonlySet<string>>(new Set())
  const pending = useRef<(() => void) | null>(null)
  const rows = useMemo(() => form?.rows ?? [], [form])
  const parents = useMemo(() => parentRows(rows), [rows])
  const hidden = useMemo(() => hiddenRows(rows, collapsed), [rows, collapsed])

  useEffect(() => {
    setCollapsed(new Set())
    setClosedTables(new Set())
  }, [form?.elrUri])

  useEffect(() => {
    const then = pending.current
    pending.current = null
    then?.()
  }, [collapsed, closedTables])

  const toggleRow = useCallback((i: number) => setCollapsed((s) => toggled(s, i)), [])
  const toggleTable = useCallback((id: string) => setClosedTables((s) => toggled(s, id)), [])

  /** Ctrl+E: everything open when anything is closed, else every head and table closed. */
  const toggleAll = useCallback(() => {
    if (collapsed.size || closedTables.size) {
      setCollapsed(new Set())
      setClosedTables(new Set())
    } else {
      setCollapsed(new Set(parents))
      setClosedTables(new Set(form?.tables.map((t) => t.tableId) ?? []))
    }
  }, [collapsed, closedTables, parents, form])

  const reveal = useCallback(
    (target: { row?: number; tableId?: string }, then: () => void) => {
      const heads = target.row != null ? ancestorRows(rows, target.row).filter((i) => collapsed.has(i)) : []
      const table = target.tableId && closedTables.has(target.tableId) ? target.tableId : null
      if (!heads.length && !table) return then()
      pending.current = then
      if (heads.length) setCollapsed((s) => new Set([...s].filter((i) => !heads.includes(i))))
      if (table) setClosedTables((s) => new Set([...s].filter((id) => id !== table)))
    },
    [rows, collapsed, closedTables],
  )

  return { parents: useMemo(() => new Set(parents), [parents]), collapsed, hidden, closedTables, toggleRow, toggleTable, toggleAll, reveal }
}

function toggled<T>(s: ReadonlySet<T>, v: T): ReadonlySet<T> {
  const next = new Set(s)
  if (!next.delete(v)) next.add(v)
  return next
}
