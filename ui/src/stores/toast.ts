import { create } from 'zustand'

export interface Toast {
  id: number
  kind: 'info' | 'success' | 'error'
  message: string
}

interface ToastState {
  toasts: Toast[]
  push(kind: Toast['kind'], message: string): void
  dismiss(id: number): void
}

let seq = 0

export const useToasts = create<ToastState>((set, get) => ({
  toasts: [],
  push: (kind, message) => {
    const id = ++seq
    set((s) => ({ toasts: [...s.toasts.slice(-3), { id, kind, message }] }))
    setTimeout(() => get().dismiss(id), kind === 'error' ? 8000 : 3500)
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}))

/** Imperative helpers usable outside React. */
export const toast = {
  info: (m: string) => useToasts.getState().push('info', m),
  success: (m: string) => useToasts.getState().push('success', m),
  error: (m: string) => useToasts.getState().push('error', m),
}
