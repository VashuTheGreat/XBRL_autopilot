import { create } from 'zustand'
import type { AppInfo, SidecarLogLine, SidecarStatus } from '@shared/ipc'

interface SidecarState {
  status: SidecarStatus
  logs: SidecarLogLine[]
  app: AppInfo | null
  init(): () => void
}

const MAX_LOGS = 2000

export const useSidecar = create<SidecarState>((set) => ({
  status: { state: 'starting' },
  logs: [],
  app: null,
  init: () => {
    const xap = window.xap
    if (!xap) return () => {}
    void xap.app.info().then((app) => set({ app }))
    void xap.sidecar.status().then((status) => set({ status }))
    void xap.sidecar.logs().then((logs) => set({ logs }))
    const offStatus = xap.sidecar.onStatus((status) => set({ status }))
    const offLog = xap.sidecar.onLog((line) =>
      set((s) => ({ logs: s.logs.length >= MAX_LOGS ? [...s.logs.slice(-MAX_LOGS + 1), line] : [...s.logs, line] })),
    )
    return () => {
      offStatus()
      offLog()
    }
  },
}))
