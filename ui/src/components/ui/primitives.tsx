/** Small, reusable form/layout primitives (shadcn-style, tokens from styles.css). */
import { useEffect, useRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/cn'

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'

export function Button({
  variant = 'secondary',
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return (
    <button
      type="button"
      {...props}
      className={cn(
        'inline-flex h-8 items-center justify-center gap-1.5 rounded px-3 text-xs font-medium transition-colors',
        'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent disabled:pointer-events-none disabled:opacity-50',
        variant === 'primary' && 'bg-accent text-accent-fg hover:brightness-110',
        variant === 'secondary' && 'border border-border bg-panel text-fg hover:bg-panel-2',
        variant === 'ghost' && 'text-muted hover:bg-panel-2 hover:text-fg',
        variant === 'danger' && 'border border-err/40 text-err hover:bg-err/10',
        className,
      )}
    />
  )
}

const control =
  'h-8 w-full rounded border border-border bg-panel px-2 text-[13px] text-fg outline-none placeholder:text-muted focus:border-accent disabled:opacity-60 select-text'

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cn(control, className)} />
}

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...props} className={cn(control, 'pr-6', className)}>
      {children}
    </select>
  )
}

export function Field(props: { label: string; hint?: string; error?: string | null; children: ReactNode; className?: string }) {
  return (
    <label className={cn('flex flex-col gap-1', props.className)}>
      <span className="text-[11px] font-medium text-muted">{props.label}</span>
      {props.children}
      {props.error ? (
        <span className="text-[11px] text-err">{props.error}</span>
      ) : props.hint ? (
        <span className="text-[11px] text-muted">{props.hint}</span>
      ) : null}
    </label>
  )
}

export function Checkbox(props: { checked: boolean; onChange(v: boolean): void; label: string; disabled?: boolean }) {
  return (
    <label className="flex items-center gap-2 text-[13px]">
      <input
        type="checkbox"
        className="h-3.5 w-3.5 accent-[var(--accent)]"
        checked={props.checked}
        disabled={props.disabled}
        onChange={(e) => props.onChange(e.target.checked)}
      />
      {props.label}
    </label>
  )
}

/** Accessible modal dialog: Esc closes, focus moves into the dialog, backdrop click closes. */
export function Dialog(props: { open: boolean; title: string; onClose(): void; children: ReactNode; footer?: ReactNode; width?: number }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!props.open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && props.onClose()
    window.addEventListener('keydown', onKey)
    // focus the first field of the body (not the header's close button)
    ref.current?.querySelector<HTMLElement>('[data-dialog-body] :is(input, select, textarea, button):not([disabled])')?.focus()
    return () => window.removeEventListener('keydown', onKey)
  }, [props.open, props.onClose])
  if (!props.open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onMouseDown={props.onClose}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={props.title}
        style={{ width: props.width ?? 560 }}
        className="max-h-[90vh] max-w-[95vw] overflow-hidden rounded-md border border-border bg-panel shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="flex h-10 items-center justify-between border-b border-border px-4">
          <h2 className="text-sm font-semibold">{props.title}</h2>
          <button className="text-muted hover:text-fg" aria-label="Close" onClick={props.onClose}>
            <X size={16} />
          </button>
        </header>
        <div data-dialog-body className="max-h-[calc(90vh-6rem)] overflow-auto p-4">
          {props.children}
        </div>
        {props.footer && <footer className="flex justify-end gap-2 border-t border-border px-4 py-3">{props.footer}</footer>}
      </div>
    </div>
  )
}

export function Section(props: { title: string; children: ReactNode; className?: string }) {
  return (
    <section className={cn('flex flex-col gap-3', props.className)}>
      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted">{props.title}</h3>
      {props.children}
    </section>
  )
}
