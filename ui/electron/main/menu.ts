import { Menu, type BrowserWindow, type MenuItemConstructorOptions } from 'electron'
import { IPC, type MenuCommand } from '@shared/ipc'

/** Application menu. Commands are forwarded to the renderer, which owns the workflow. */
export function buildMenu(getWindow: () => BrowserWindow | null, isDev: boolean): Menu {
  const send = (cmd: MenuCommand) => () => getWindow()?.webContents.send(IPC.menuCommand, cmd)

  const template: MenuItemConstructorOptions[] = [
    {
      label: '&File',
      submenu: [
        { label: 'New Filing…', accelerator: 'CmdOrCtrl+N', click: send('file:new') },
        { label: 'Open…', accelerator: 'CmdOrCtrl+O', click: send('file:open') },
        { type: 'separator' },
        { label: 'Save', accelerator: 'CmdOrCtrl+S', click: send('file:save') },
        { label: 'Save As…', accelerator: 'CmdOrCtrl+Shift+S', click: send('file:save-as') },
        { type: 'separator' },
        { label: 'Settings', accelerator: 'CmdOrCtrl+,', click: send('tools:settings') },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: '&Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: '&View',
      submenu: [
        { label: 'Toggle Side Panel', accelerator: 'CmdOrCtrl+B', click: send('view:toggle-sidebar') },
        { label: 'Toggle Bottom Panel', accelerator: 'CmdOrCtrl+J', click: send('view:toggle-bottom') },
        { label: 'Go to Statement…', accelerator: 'CmdOrCtrl+P', click: send('view:quick-switch') },
        { type: 'separator' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { role: 'resetZoom' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        ...(isDev ? ([{ type: 'separator' }, { role: 'reload' }, { role: 'toggleDevTools' }] as const) : []),
      ],
    },
    {
      label: 'F&iling',
      submenu: [
        { label: 'Validate', accelerator: 'CmdOrCtrl+Shift+V', click: send('filing:validate') },
        { label: 'Generate XML', accelerator: 'CmdOrCtrl+G', click: send('filing:generate-xml') },
      ],
    },
    {
      label: '&Tools',
      submenu: [{ label: 'Validate in MCA Validation Tool…', click: send('tools:open-mca-validator') }],
    },
    { label: '&Help', submenu: [{ role: 'about' }] },
  ]
  return Menu.buildFromTemplate(template)
}
