import { app, BrowserWindow, dialog, ipcMain, Menu, type IpcMainInvokeEvent } from 'electron'
import { basename, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { exportPngInput, type ExportResult } from '../shared/image'
import { readImage, writePngExclusive } from './image-files'

let window: BrowserWindow | null = null
let operation: 'idle' | 'opening' | 'exporting' = 'idle'

function createWindow(): void {
  const rendererPath = join(__dirname, '../renderer/index.html')
  const rendererUrl = new URL((!app.isPackaged && process.env.ELECTRON_RENDERER_URL) || pathToFileURL(rendererPath).href).href
  const editor = new BrowserWindow({
    title: 'Deep Fryer',
    width: 1260,
    height: 840,
    minWidth: 900,
    minHeight: 620,
    backgroundColor: '#121315',
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
  function checkSender(event: IpcMainInvokeEvent): void {
    if (event.sender !== editor.webContents || event.senderFrame !== editor.webContents.mainFrame ||
      event.senderFrame.url !== rendererUrl) {
      throw new Error('This request did not come from the editor.')
    }
    if (operation !== 'idle') throw new Error('Finish the current file action first.')
  }
  ipcMain.removeHandler('image:open')
  ipcMain.removeHandler('image:export-png')
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
  ipcMain.handle('image:export-png', async (event, bytes: unknown, suggestedName: unknown): Promise<ExportResult> => {
    checkSender(event)
    const input = exportPngInput.parse({ bytes, suggestedName })
    operation = 'exporting'
    try {
      const safeName = basename(input.suggestedName).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
      const result = await dialog.showSaveDialog(editor, {
        title: 'Export PNG as a new file',
        defaultPath: safeName,
        properties: ['dontAddToRecent'],
        filters: [{ name: 'PNG image', extensions: ['png'] }]
      })
      if (result.canceled || result.filePath === undefined) return { kind: 'cancelled' }
      const path = /\.png$/i.test(result.filePath) ? result.filePath : `${result.filePath}.png`
      await writePngExclusive(path, input.bytes)
      return { kind: 'saved', name: basename(path) }
    } finally {
      operation = 'idle'
    }
  })
  void editor.loadURL(rendererUrl)
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null)
  createWindow()
  app.on('activate', () => { if (window === null) createWindow() })
})
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
