/** Shared IPC contract between main, preload and renderer. See docs/09-ipc-and-sidecar-api.md. */

export type SidecarStatus =
  | { state: 'starting' }
  | { state: 'ready'; port: number; version: string; aiEnabled: boolean; model: string | null }
  | { state: 'error'; message: string }
  | { state: 'stopped' }

export interface SidecarLogLine {
  ts: number
  stream: 'stdout' | 'stderr' | 'system'
  text: string
}

export interface AppInfo {
  name: string
  version: string
  platform: string
  isDev: boolean
}

export interface SidecarResponse<T = unknown> {
  status: number
  data: T
}

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE'

export type MenuCommand =
  | 'file:new'
  | 'file:open'
  | 'file:save'
  | 'file:save-as'
  | 'filing:validate'
  | 'filing:generate-xml'
  | 'view:toggle-sidebar'
  | 'view:toggle-bottom'
  | 'view:quick-switch'
  | 'tools:open-mca-validator'
  | 'tools:settings'

export const IPC = {
  appInfo: 'app:info',
  sidecarStatus: 'sidecar:status',
  sidecarStatusChanged: 'sidecar:status-changed',
  sidecarLog: 'sidecar:log',
  sidecarLogs: 'sidecar:logs',
  sidecarRequest: 'sidecar:request',
  sidecarRestart: 'sidecar:restart',
  menuCommand: 'menu:command',
} as const

/** The API exposed on window.xap by the preload script. */
export interface XapApi {
  app: { info(): Promise<AppInfo> }
  sidecar: {
    status(): Promise<SidecarStatus>
    logs(): Promise<SidecarLogLine[]>
    restart(): Promise<void>
    request<T = unknown>(method: HttpMethod, path: string, body?: unknown): Promise<SidecarResponse<T>>
    onStatus(cb: (s: SidecarStatus) => void): () => void
    onLog(cb: (l: SidecarLogLine) => void): () => void
  }
  menu: { onCommand(cb: (c: MenuCommand) => void): () => void }
}
