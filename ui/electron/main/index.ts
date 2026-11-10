import { app, BrowserWindow, ipcMain, Menu, shell } from 'electron'
import { join, resolve } from 'node:path'
import { IPC, type AppInfo, type HttpMethod } from '@shared/ipc'
import { buildMenu } from './menu'
import { SidecarManager } from './sidecar'

const isDev = !app.isPackaged
// In dev, app.getAppPath() is <repo>/ui; the Python sidecar lives at the repo root.
const repoRoot = resolve(app.getAppPath(), '..')

let mainWindow: BrowserWindow | null = null

const sidecar = new SidecarManager({
  isPackaged: app.isPackaged,
  repoRoot,
  resourcesPath: process.resourcesPath,
})

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    title: 'XBRL Autopilot',
    backgroundColor: '#0b0d10',
    autoHideMenuBar: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
    },
  })

  mainWindow.once('ready-to-show', () => mainWindow?.show())
  mainWindow.on('closed', () => (mainWindow = null))

  // Never open new windows; send safe external links to the OS browser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (e, url) => {
    const devUrl = process.env.ELECTRON_RENDERER_URL
    if (!(devUrl && url.startsWith(devUrl))) e.preventDefault()
  })

  if (isDev && process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function registerIpc(): void {
  ipcMain.handle(IPC.appInfo, (): AppInfo => ({
    name: 'XBRL Autopilot',
    version: app.getVersion(),
    platform: process.platform,
    isDev,
  }))
  ipcMain.handle(IPC.sidecarStatus, () => sidecar.getStatus())
  ipcMain.handle(IPC.sidecarLogs, () => sidecar.getLogs())
  ipcMain.handle(IPC.sidecarRestart, () => sidecar.restart())
  ipcMain.handle(IPC.sidecarRequest, (_e, method: unknown, path: unknown, body: unknown) => {
    const allowed: HttpMethod[] = ['GET', 'POST', 'PUT', 'DELETE']
    if (!allowed.includes(method as HttpMethod) || typeof path !== 'string') {
      throw new Error('Invalid sidecar request')
    }
    return sidecar.request(method as HttpMethod, path, body)
  })

  sidecar.on('status', (s) => mainWindow?.webContents.send(IPC.sidecarStatusChanged, s))
  sidecar.on('log', (l) => {
    if (isDev) console.log(`[sidecar:${l.stream}] ${l.text}`)
    mainWindow?.webContents.send(IPC.sidecarLog, l)
  })
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  app.whenReady().then(() => {
    app.setAppUserModelId('in.xbrlautopilot.desktop')
    Menu.setApplicationMenu(buildMenu(() => mainWindow, isDev))
    registerIpc()
    createWindow()
    void sidecar.start()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  let quitting = false
  app.on('before-quit', (e) => {
    if (quitting) return
    quitting = true
    e.preventDefault()
    void sidecar.stop().finally(() => app.quit())
  })
}
