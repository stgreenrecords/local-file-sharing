import { join } from 'node:path'
import { BrowserWindow, app, shell } from 'electron'
import { Channel } from '@shared/ipc'
import { startDaemon, stopDaemon, daemonStatus } from './daemon'
import { bridgeEvents, registerIpc } from './ipc'
import { store } from './store'

let mainWindow: BrowserWindow | null = null
let detachEvents: (() => void) | null = null

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 900,
    minHeight: 620,
    show: false,
    backgroundColor: '#10141a',
    // The design draws its own title bar and traffic lights.
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    ...(process.platform === 'win32'
      ? {
          titleBarOverlay: { color: '#0a0e14', symbolColor: '#bdc8d1', height: 36 }
        }
      : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false
    }
  })

  window.on('ready-to-show', () => window.show())

  // External links open in the user's browser, never in an app window.
  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  const devServerUrl = process.env['ELECTRON_RENDERER_URL']
  if (devServerUrl !== undefined) void window.loadURL(devServerUrl)
  else void window.loadFile(join(__dirname, '../renderer/index.html'))

  detachEvents?.()
  detachEvents = bridgeEvents(window)

  // Push an initial status once the renderer can receive it.
  window.webContents.once('did-finish-load', () => {
    window.webContents.send(Channel.EVENT_STATUS, daemonStatus())
  })

  window.on('closed', () => {
    detachEvents?.()
    detachEvents = null
    mainWindow = null
  })

  return window
}

// A second instance would fight over the mDNS name and the port; focus the
// existing window instead. `OMNI_DATA_DIR` deliberately opts out for dev.
const isDevSecondInstance = process.env['OMNI_DATA_DIR'] !== undefined
if (!isDevSecondInstance && !app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow === null) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })

  void app.whenReady().then(async () => {
    // Touch the store first so identity exists before anything advertises it.
    store()
    registerIpc()
    try {
      await startDaemon()
    } catch (err) {
      console.error('[main] daemon failed to start:', (err as Error).message)
    }
    mainWindow = createWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('before-quit', () => {
    // Send mDNS goodbyes so peers drop us immediately rather than timing out.
    void stopDaemon()
  })
}
