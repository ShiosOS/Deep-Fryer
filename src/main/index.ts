import { app, BrowserWindow, dialog, ipcMain, Menu, type IpcMainInvokeEvent } from 'electron'
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { readImage } from './image-files'
import { registerImageOutput } from './image-output'
import { registerDocumentActions, validateSource } from './document-actions'
import { RecoveryStore } from './recovery'
import { AppearanceStore } from './appearance-store'
import { appearanceSchema, defaultAppearance } from '../shared/appearance'

const profile = app.commandLine.getSwitchValue('user-data-dir')
if (profile) { mkdirSync(profile, { recursive: true }); app.setPath('userData', profile) }
const ownsProfile = app.requestSingleInstanceLock()
const recovery = new RecoveryStore(join(app.getPath('userData'), 'recovery'), validateSource)
const appearance = new AppearanceStore(app.getPath('userData'))
let quitting = false
let preserveRecovery = false

let window: BrowserWindow | null = null
let operation: 'idle' | 'opening' | 'exporting' = 'idle'

function createWindow(): void {
  const rendererPath = join(__dirname, '../renderer/index.html')
  const rendererUrl = new URL((!app.isPackaged && process.env.ELECTRON_RENDERER_URL) || pathToFileURL(rendererPath).href).href
  const editor = new BrowserWindow({
    title: 'Deep Fryer',
    icon: join(__dirname, '../../resources/icon.png'),
    width: 1260,
    height: 840,
    minWidth: 900,
    minHeight: 620,
    backgroundColor: '#28232c',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true
    }
  })
  window = editor
  editor.on('closed', () => { window = null })
  editor.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  editor.webContents.on('will-navigate', (event) => event.preventDefault())
  editor.webContents.on('will-attach-webview', (event) => event.preventDefault())
  editor.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  editor.webContents.session.setPermissionCheckHandler(() => false)
  editor.webContents.on('render-process-gone', () => { preserveRecovery = true })
  function checkSender(event: IpcMainInvokeEvent): void {
    if (event.sender !== editor.webContents || event.senderFrame !== editor.webContents.mainFrame ||
      event.senderFrame.url !== rendererUrl) {
      throw new Error('This request did not come from the editor.')
    }
    if (operation !== 'idle') throw new Error('Finish the current file action first.')
  }
  registerDocumentActions(editor, checkSender, recovery)
  for (const channel of ['appearance:load', 'appearance:save', 'appearance:reset']) ipcMain.removeHandler(channel)
  ipcMain.handle('appearance:load', (event) => { checkSender(event); return appearance.load() })
  ipcMain.handle('appearance:save', (event, input: unknown) => { checkSender(event); return appearance.save(appearanceSchema.parse(input)) })
  ipcMain.handle('appearance:reset', (event) => { checkSender(event); return appearance.save(defaultAppearance(), true) })
  ipcMain.removeHandler('image:open')
  registerImageOutput(editor, checkSender, (active) => { operation = active ? 'exporting' : 'idle' })
  ipcMain.handle('image:open', async (event) => {
    checkSender(event)
    operation = 'opening'
    try {
      const result = await dialog.showOpenDialog(editor, {
        title: 'Open an image',
        properties: ['openFile', 'dontAddToRecent'],
        filters: [{ name: 'PNG and JPEG images', extensions: ['png', 'jpg', 'jpeg'] }]
      })
      const path = result.filePaths[0]
      if (result.canceled || path === undefined) return null
      return await readImage(path)
    } finally {
      operation = 'idle'
    }
  })
  void editor.loadURL(rendererUrl)
}

if (ownsProfile) {
  app.on('second-instance', () => {
    if (window?.isMinimized()) window.restore()
    window?.focus()
  })
  app.whenReady().then(() => {
    app.setAppUserModelId('com.deepfryer.desktop')
    Menu.setApplicationMenu(null)
    createWindow()
    app.on('activate', () => { if (window === null) createWindow() })
  })
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
  app.on('before-quit', (event) => {
    if (quitting) return
    event.preventDefault()
    quitting = true
    void Promise.all([preserveRecovery ? Promise.resolve() : recovery.close(), appearance.drain()]).finally(() => app.quit())
  })
} else { app.quit() }
