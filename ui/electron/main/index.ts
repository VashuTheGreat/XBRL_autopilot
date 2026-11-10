/**
 * Composition root: the only place that knows the concrete implementations.
 * It creates the adapters (database, secret store, autosave dir, authority file), injects them
 * into the services, and wires services ↔ window ↔ IPC.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { app, BrowserWindow, Menu, shell } from 'electron'
import { IPC } from '@shared/ipc'
import { AppDatabase } from './infra/app-database'
import { DirAutosaveStore } from './infra/dir-autosave-store'
import { FileAuthorityProvider } from './infra/file-authority-provider'
import { SafeStorageSecretStore } from './infra/safe-storage-secret-store'
import { registerIpc } from './ipc/register'
import { buildMenu } from './menu'
import { ProjectController } from './project/project-controller'
import { AutosaveScheduler } from './services/autosave-scheduler'
import { ProjectService } from './services/project-service'
import { SettingsService } from './services/settings-service'
import { SidecarManager } from './sidecar'
import { findProjectArg, parseDotEnv, windowTitle } from './util/launch'

const isDev = !app.isPackaged
// In dev, app.getAppPath() is <repo>/ui; the Python sidecar, engine and .env live at the repo root.
const repoRoot = resolve(app.getAppPath(), '..')
app.setName('XBRL Autopilot')
// XAP_USER_DATA (dev only) isolates automated test runs from the developer's real app data.
app.setPath('userData', (isDev && process.env.XAP_USER_DATA) || join(app.getPath('appData'), 'XBRL Autopilot'))

let mainWindow: BrowserWindow | null = null
const getWindow = () => mainWindow

// ---------------------------------------------------------------- adapters + services
const userData = app.getPath('userData')
const db = new AppDatabase(join(userData, 'app.db'))
const devEnv = isDev && existsSync(join(repoRoot, '.env')) ? parseDotEnv(readFileSync(join(repoRoot, '.env'), 'utf8')) : {}
const settings = new SettingsService(db, new SafeStorageSecretStore(join(userData, 'secrets.bin')), devEnv.GROQ_API_KEY || null)
const projects = new ProjectService({
  authority: new FileAuthorityProvider(
    isDev ? join(repoRoot, 'engine', 'authority', 'ci-2016.authority.json') : join(process.resourcesPath, 'authority', 'ci-2016.authority.json'),
  ),
  recents: db,
  autosave: new DirAutosaveStore(join(userData, 'autosave')),
  appVersion: app.getVersion(),
})
const projectController = new ProjectController(projects, getWindow)
const autosave = new AutosaveScheduler(projects, () => settings.get().autosaveSeconds)
const sidecar = new SidecarManager({
  isPackaged: app.isPackaged,
  repoRoot,
  resourcesPath: process.resourcesPath,
  // Settings win over the dev .env (pydantic-settings gives env vars priority over .env).
  extraEnv: async () => ({ GROQ_API_KEY: (await settings.groqKey()) ?? undefined, GROQ_MODEL: settings.get().groqModel }),
})

// ---------------------------------------------------------------- window
function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    title: windowTitle(projects.summary()),
    backgroundColor: '#0b0d10',
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
  mainWindow.on('blur', () => void autosave.tick())
  // Keep our title: the page <title> must not override it.
  mainWindow.on('page-title-updated', (e) => e.preventDefault())

  let closingConfirmed = false
  mainWindow.on('close', (e) => {
    if (closingConfirmed || !projects.isDirty()) return
    e.preventDefault()
    void projectController.confirmUnsaved().then(async (proceed) => {
      if (!proceed) return
      await projects.close() // discards the recovery copy after an explicit Save / Don't save
      closingConfirmed = true
      mainWindow?.close()
    })
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (e, url) => {
    const devUrl = process.env.ELECTRON_RENDERER_URL
    if (!(devUrl && url.startsWith(devUrl))) e.preventDefault()
  })

  if (isDev && process.env.ELECTRON_RENDERER_URL) void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
}

function wireEvents(): void {
  projects.on('changed', (s) => {
    mainWindow?.setTitle(windowTitle(s))
    mainWindow?.setDocumentEdited(Boolean(s?.dirty))
    mainWindow?.webContents.send(IPC.projectChanged, s)
  })
  settings.on('changed', (s) => mainWindow?.webContents.send(IPC.settingsChanged, s))
  settings.on('ai-config-changed', () => void sidecar.restart())
  settings.on('changed', () => autosave.start()) // re-arm with a possibly new interval
  sidecar.on('status', (s) => mainWindow?.webContents.send(IPC.sidecarStatusChanged, s))
  sidecar.on('log', (l) => {
    if (isDev) console.log(`[sidecar:${l.stream}] ${l.text}`)
    mainWindow?.webContents.send(IPC.sidecarLog, l)
  })
}

/** Opens a project passed on the command line (double-click on a .axbrl file). */
async function openFromArgs(argv: readonly string[]): Promise<void> {
  const file = findProjectArg(argv)
  if (!file) return
  const result = await projectController.open(file).catch((err: unknown) => err)
  if (result instanceof Error) console.error('[open]', result)
}

// ---------------------------------------------------------------- app lifecycle
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', (_e, argv) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
    void openFromArgs(argv)
  })

  app.whenReady().then(() => {
    app.setAppUserModelId('in.xbrlautopilot.desktop')
    Menu.setApplicationMenu(buildMenu(getWindow, isDev))
    registerIpc({
      appInfo: () => ({ name: 'XBRL Autopilot', version: app.getVersion(), platform: process.platform, isDev }),
      sidecar,
      projects,
      projectController,
      settings,
      getWindow,
    })
    wireEvents()
    createWindow()
    autosave.start()
    void sidecar.start()
    mainWindow?.webContents.once('did-finish-load', () => void openFromArgs(process.argv))

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
    autosave.stop()
    void sidecar.stop().finally(() => {
      db.close()
      app.quit()
    })
  })
}
