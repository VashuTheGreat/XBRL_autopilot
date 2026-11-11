/** Reusable pickers for table tagging (ADR-0013): a taxonomy table, and the members of a row / column / fact. */
import { X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { DimRef, TableInfo, TableStructure } from '@shared/editor'
import { Input, Select } from '@/components/ui/primitives'
import { useTables } from '@/stores/tables'

/** Search the taxonomy's tables by title or statement; `prefer` lists the tables to offer first (e.g. those reporting an element). */
export function TablePicker(props: { value: string | null; onPick(id: string): void; prefer?: (t: TableInfo) => boolean }) {
  const loadCatalog = useTables((s) => s.loadCatalog)
  const catalog = useTables((s) => s.catalog)
  const [q, setQ] = useState('')
  useEffect(() => void loadCatalog(), [loadCatalog])
  const shown = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean)
    const hit = (t: TableInfo) => words.every((w) => `${t.title} ${t.elrCode} ${t.elrTitle}`.toLowerCase().includes(w))
    const all = (catalog ?? []).filter(hit)
    const first = props.prefer ? all.filter(props.prefer) : []
    return [...first, ...all.filter((t) => !first.includes(t))].slice(0, 200)
  }, [catalog, q, props.prefer])
  return (
    <div className="flex flex-col gap-1.5">
      <Input placeholder="Search tables (e.g. property plant, borrowings, share capital)…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search tables" data-testid="table-search" />
      <Select size={6} className="h-auto py-1 text-[12px]" value={props.value ?? ''} onChange={(e) => e.target.value && props.onPick(e.target.value)} aria-label="Table" data-testid="table-picker">
        {shown.map((t) => (
          <option key={t.id} value={t.id} title={t.id}>
            [{t.elrCode}] {t.title}
            {props.prefer?.(t) ? ' ★' : ''}
          </option>
        ))}
      </Select>
    </div>
  )
}

/** The members chosen for a row, a column or a fact: chips, plus a picker grouped by axis (typed axes take a value). */
export function MemberChips(props: { structure: TableStructure; value: DimRef[]; onChange(v: DimRef[]): void; testId?: string }) {
  const { structure, value } = props
  const [typedAxis, setTypedAxis] = useState<string | null>(null)
  const [typedValue, setTypedValue] = useState('')
  const used = new Set(value.map((d) => d.axis))
  const label = (d: DimRef) => {
    const ax = structure.axes.find((a) => a.axis === d.axis)
    return d.member ? (ax?.members.find((m) => m.member === d.member)?.label ?? d.member) : `${ax?.label ?? d.axis}: ${d.typed}`
  }
  const add = (d: DimRef) => props.onChange([...value.filter((x) => x.axis !== d.axis), d])
  return (
    <div className="flex flex-wrap items-center gap-1" data-testid={props.testId}>
      {value.map((d) => (
        <span key={d.axis} className="flex items-center gap-0.5 rounded bg-accent/15 px-1.5 text-[11px] text-accent" title={d.axis}>
          {label(d)}
          <button aria-label="Remove member" onClick={() => props.onChange(value.filter((x) => x.axis !== d.axis))}>
            <X size={10} />
          </button>
        </span>
      ))}
      {typedAxis ? (
        <span className="flex items-center gap-1">
          <Input className="h-6 w-28 text-[11px]" autoFocus placeholder="value" value={typedValue} onChange={(e) => setTypedValue(e.target.value)} />
          <button
            className="text-[11px] text-accent"
            onClick={() => {
              if (typedValue.trim()) add({ axis: typedAxis, typed: typedValue.trim() })
              setTypedAxis(null)
              setTypedValue('')
            }}
          >
            add
          </button>
        </span>
      ) : (
        <select
          className="h-6 max-w-40 rounded border border-border bg-panel px-1 text-[11px] text-muted"
          aria-label="Add a member"
          value=""
          onChange={(e) => {
            const [axis, member] = e.target.value.split('||')
            if (!axis) return
            if (member === '#typed') setTypedAxis(axis)
            else add({ axis, member })
          }}
        >
          <option value="">+ member</option>
          {structure.axes
            .filter((a) => !used.has(a.axis))
            .map((a) => (
              <optgroup key={a.axis} label={a.label}>
                {a.typed ? (
                  <option value={`${a.axis}||#typed`}>Type a value…</option>
                ) : (
                  a.members
                    .filter((m) => m.usable && m.member !== a.default)
                    .map((m) => (
                      <option key={m.member} value={`${a.axis}||${m.member}`}>
                        {' '.repeat(m.depth * 2)}
                        {m.label}
                      </option>
                    ))
                )}
              </optgroup>
            ))}
        </select>
      )}
    </div>
  )
}

/** "concept|role" ⇄ a table row; only the opening / closing roles change the fact. */
export const rowKey = (concept: string, preferredLabel: string | null) => `${concept}|${preferredLabel ?? ''}`
export const roleSuffix = (preferredLabel: string | null) =>
  preferredLabel === 'periodStartLabel' ? ' (opening)' : preferredLabel === 'periodEndLabel' ? ' (closing)' : ''
