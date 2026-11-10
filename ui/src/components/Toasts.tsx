import { CircleAlert, CircleCheck, Info, X } from 'lucide-react'
import { cn } from '@/lib/cn'
import { useToasts } from '@/stores/toast'

const ICON = { info: Info, success: CircleCheck, error: CircleAlert }

export function Toasts() {
  const { toasts, dismiss } = useToasts()
  return (
    <div className="pointer-events-none fixed right-4 bottom-10 z-[60] flex w-96 flex-col gap-2" aria-live="polite">
      {toasts.map((t) => {
        const Icon = ICON[t.kind]
        return (
          <div
            key={t.id}
            role={t.kind === 'error' ? 'alert' : 'status'}
            className="pointer-events-auto flex items-start gap-2 rounded border border-border bg-panel p-3 text-xs shadow-lg"
          >
            <Icon size={15} className={cn('mt-px shrink-0', t.kind === 'error' ? 'text-err' : t.kind === 'success' ? 'text-ok' : 'text-accent')} />
            <span className="flex-1 leading-relaxed select-text">{t.message}</span>
            <button className="text-muted hover:text-fg" aria-label="Dismiss" onClick={() => dismiss(t.id)}>
              <X size={13} />
            </button>
          </div>
        )
      })}
    </div>
  )
}
