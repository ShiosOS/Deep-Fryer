import { app, BrowserWindow, dialog, ipcMain, Menu, type IpcMainInvokeEvent } from 'electron'
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { readImage } from './image-files'
import { registerImageOutput } from './image-output'
import { registerImageClipboard } from './image-clipboard'
import { registerDocumentActions, validateSource } from './document-actions'
import { RecoveryStore } from './recovery'
import { AppearanceStore } from './appearance-store'
import { appearanceSchema, defaultAppearance } from '../shared/appearance'
import { closeReplySchema } from '../shared/documents'

const profile = app.commandLine.getSwitchValue('user-data-dir')
if (profile) { mkdirSync(profile, { recursive: true }); app.setPath('userData', profile) }
const ownsProfile = app.requestSingleInstanceLock()
const recovery = new RecoveryStore(join(app.getPath('userData'), 'recovery'), validateSource)
const appearance = new AppearanceStore(app.getPath('userData'))
let quitting = false
let closeState: { kind: 'idle' } | { kind: 'requested'; request: string } | { kind: 'closing' } = { kind: 'idle' }
let rendererReady = false
let rendererGone = false

let window: BrowserWindow | null = null
let fileActionActive = false

function finishClose(preserveRecovery: boolean): void {
  if (closeState.kind === 'closing') return
  closeState = { kind: 'closing' }
  void Promise.all([recovery.close(preserveRecovery), appearance.drain()]).finally(() => {
    quitting = true
    app.quit()
  })
}

function requestClose(): void {
  if (!window || rendererGone) { finishClose(true); return }
  if (closeState.kind !== 'idle') return
  closeState = { kind: 'requested', request: crypto.randomUUID() }
  if (rendererReady) window.webContents.send('document:close-request', closeState.request)
}

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
  rendererReady = false
  rendererGone = false
  editor.on('close', (event) => {
    if (quitting) return
    event.preventDefault()
    requestClose()
  })
  editor.on('closed', () => { window = null })
  editor.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  editor.webContents.on('will-navigate', (event) => event.preventDefault())
  editor.webContents.on('will-attach-webview', (event) => event.preventDefault())
  editor.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  editor.webContents.session.setPermissionCheckHandler(() => false)
  editor.webContents.on('render-process-gone', () => {
    rendererGone = true
    if (closeState.kind === 'requested') finishClose(true)
  })
  function authenticate(event: IpcMainInvokeEvent): void {
    if (event.sender !== editor.webContents || event.senderFrame !== editor.webContents.mainFrame ||
      event.senderFrame.url !== rendererUrl) {
      throw new Error('This request did not come from the editor.')
    }
  }
  function checkSender(event: IpcMainInvokeEvent): void {
    authenticate(event)
    if (fileActionActive) throw new Error('Finish the current file action first.')
  }
  for (const channel of ['document:close-ready', 'document:close-reply']) ipcMain.removeHandler(channel)
  ipcMain.handle('document:close-ready', (event) => {
    authenticate(event)
    rendererReady = true
    if (closeState.kind === 'requested') editor.webContents.send('document:close-request', closeState.request)
  })
  ipcMain.handle('document:close-reply', (event, input: unknown) => {
    authenticate(event)
    const reply = closeReplySchema.parse(input)
    if (closeState.kind !== 'requested' || reply.request !== closeState.request) return
    if (reply.decision === 'cancel') closeState = { kind: 'idle' }
    else finishClose(reply.decision === 'preserve-recovery')
  })
  function setFileAction(active: boolean): void { fileActionActive = active }
  registerDocumentActions(editor, checkSender, recovery, setFileAction)
  for (const channel of ['appearance:load', 'appearance:save', 'appearance:reset']) ipcMain.removeHandler(channel)
  ipcMain.handle('appearance:load', (event) => { checkSender(event); return appearance.load() })
  ipcMain.handle('appearance:save', (event, input: unknown) => { checkSender(event); return appearance.save(appearanceSchema.parse(input)) })
  ipcMain.handle('appearance:reset', (event) => { checkSender(event); return appearance.save(defaultAppearance(), true) })
  ipcMain.removeHandler('image:open')
  registerImageOutput(editor, checkSender, setFileAction)
  registerImageClipboard(checkSender, setFileAction)
  ipcMain.handle('image:open', async (event) => {
    checkSender(event)
    setFileAction(true)
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
      setFileAction(false)
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
    requestClose()
  })
} else { app.quit() }
