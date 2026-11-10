import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IPC, type MenuCommand, type SidecarLogLine, type SidecarStatus, type XapApi } from '@shared/ipc'

function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_e: IpcRendererEvent, payload: T) => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api: XapApi = {
  app: {
    info: () => ipcRenderer.invoke(IPC.appInfo),
  },
  sidecar: {
    status: () => ipcRenderer.invoke(IPC.sidecarStatus),
    logs: () => ipcRenderer.invoke(IPC.sidecarLogs),
    restart: () => ipcRenderer.invoke(IPC.sidecarRestart),
    request: (method, path, body) => ipcRenderer.invoke(IPC.sidecarRequest, method, path, body),
    onStatus: (cb) => subscribe<SidecarStatus>(IPC.sidecarStatusChanged, cb),
    onLog: (cb) => subscribe<SidecarLogLine>(IPC.sidecarLog, cb),
  },
  menu: {
    onCommand: (cb) => subscribe<MenuCommand>(IPC.menuCommand, cb),
  },
}

contextBridge.exposeInMainWorld('xap', api)
