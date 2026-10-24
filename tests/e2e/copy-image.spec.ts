import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { PNG } from 'pngjs'
import { encodePreset } from '../../src/main/document-files'
import type { Preset } from '../../src/shared/preset'
import { controls, exportImage, fileAction, openOutput, ready } from './ui'

delete process.env.ELECTRON_RUN_AS_NODE

function fixture(): Buffer {
  const image = new PNG({ width: 96, height: 64 })
  for (let y = 0; y < image.height; y += 1) for (let x = 0; x < image.width; x += 1) {
    image.data.set([x * 2, y * 3, (x * 17 + y * 11) % 256, x < 16 ? 0 : x < 48 ? 128 : 255], (y * image.width + x) * 4)
  }
  return PNG.sync.write(image)
}

async function launch(folder: string): Promise<ElectronApplication> {
  const executable = process.env.DEEP_FRYER_EXECUTABLE ?? process.env.ELECTRON_EXECUTABLE_PATH
  return electron.launch({ ...(executable ? { executablePath: executable } : {}),
    args: [...(process.env.DEEP_FRYER_EXECUTABLE ? [] : [resolve('.')]), `--user-data-dir=${join(folder, 'profile')}`],
    env: { ...process.env, ELECTRON_RENDERER_URL: '' } })
}

async function interceptClipboard(app: ElectronApplication, mode: 'success' | 'delay' | 'fail' = 'success'): Promise<void> {
  await app.evaluate(({ clipboard }, mode) => {
    const types: string[] = []
    const captured = { writes: 0, encoded: '', mime: '', types, release: () => {} }
    Reflect.set(globalThis, '__copyCapture', captured)
    clipboard.write = async (items) => {
      captured.writes += 1
      if (items.length !== 1 || !items[0]) throw new Error('Expected one clipboard item.')
      captured.types = [...items[0].types]
      const blob = await items[0].getType('image/png')
      if (!(blob instanceof Blob)) throw new Error('Expected a PNG Blob.')
      captured.mime = blob.type
      captured.encoded = Buffer.from(await blob.arrayBuffer()).toString('base64')
      if (mode === 'delay') await new Promise<void>((resolve) => { captured.release = resolve })
      if (mode === 'fail') throw new Error('Clipboard test rejection. Try again.')
    }
  }, mode)
}

async function capture(app: ElectronApplication) {
  return app.evaluate(() => {
    const state = Reflect.get(globalThis, '__copyCapture')
    return { writes: Number(state.writes), encoded: String(state.encoded), mime: String(state.mime), types: Array.from<string>(state.types) }
  })
}

async function releaseWrite(app: ElectronApplication): Promise<void> {
  await app.evaluate(() => { Reflect.get(globalThis, '__copyCapture').release() })
}

async function open(app: ElectronApplication, page: Page, source: string): Promise<void> {
  await app.evaluate(({ dialog }, source) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [source] }) }, source)
  await fileAction(page, 'Open image')
  await ready(page)
}

async function savePng(app: ElectronApplication, page: Page, destination: string): Promise<Buffer> {
  const size = await page.getByLabel('Original full resolution image canvas').evaluate((element) => {
    if (!(element instanceof HTMLCanvasElement)) throw new Error('Original canvas missing.')
    return { width: element.width, height: element.height }
  })
  await openOutput(page)
  await page.getByLabel('Output format').selectOption('png')
  await page.getByLabel('Output width', { exact: true }).fill(String(size.width))
  await page.getByLabel('Output height', { exact: true }).fill(String(size.height))
  await app.evaluate(({ dialog }, destination) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: destination }) }, destination)
  await exportImage(page)
  await expect(page.getByRole('status')).toContainText(`Saved ${destination.split(/[\\/]/).pop()}.`)
  return readFile(destination)
}

async function state(page: Page) {
  return page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('canvas[aria-label="Edited full resolution image canvas"]')
    const context = canvas?.getContext('2d')
    if (!canvas || !context) throw new Error('Edited canvas missing.')
    return {
      inputs: Array.from(document.querySelectorAll<HTMLInputElement | HTMLSelectElement>('.sidebar input, .sidebar select'), (element) => [element.getAttribute('aria-label'), element.value]),
      undo: document.querySelector<HTMLButtonElement>('[aria-label="Undo"]')?.disabled,
      redo: document.querySelector<HTMLButtonElement>('[aria-label="Redo"]')?.disabled,
      pixels: Array.from(context.getImageData(0, 0, canvas.width, canvas.height).data)
    }
  })
}

test('button and shortcut copy full edited PNG pixels with alpha and orientation independently of Original and export drafts', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'deep-fryer-copy-pixels-'))
  const app = await launch(folder)
  try {
    const page = await app.firstWindow()
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await interceptClipboard(app)
    const original = fixture()
    const jpeg = Buffer.from(await app.evaluate(({ nativeImage }, encoded) => nativeImage.createFromBuffer(Buffer.from(encoded, 'base64')).toJPEG(92).toString('base64'), original.toString('base64')), 'base64')
    const exif = Buffer.from('ffe1002245786966000049492a0008000000010012010300010000000600000000000000', 'hex')
    const preset: Preset = { seed: 42, effects: [
      { id: 'noise', enabled: true, mix: 100, kind: 'noise', value: 35 },
      { id: 'jpeg', enabled: true, mix: 80, kind: 'jpeg', quality: 31, passes: 2, background: '#2468ac' },
      { id: 'bulge', enabled: true, mix: 75, kind: 'bulge', x: 0.4, y: 0.6, radius: 0.45, strength: -70 }
    ] }
    const presetPath = join(folder, 'rich.frypreset')
    await writeFile(presetPath, encodePreset(preset))
    await mkdir('.artifacts/copy-image', { recursive: true })
    const proofs: Array<{ source: string; width: number; height: number; rgbaSha256: string; differentPixels: number }> = []
    for (const [index, input] of [original, Buffer.concat([jpeg.subarray(0, 2), exif, jpeg.subarray(2)])].entries()) {
      const source = join(folder, index === 0 ? 'alpha.png' : 'oriented.jpg')
      await writeFile(source, input)
      await open(app, page, source)
      await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }) }, presetPath)
      await fileAction(page, 'Load preset')
      await ready(page)
      const exported = await savePng(app, page, join(folder, `equivalent-${index}.png`))
      const expected = PNG.sync.read(exported)
      expect([expected.width, expected.height]).toEqual(index === 0 ? [96, 64] : [64, 96])
      if (index === 0) expect(Array.from(expected.data).some((value, offset) => offset % 4 === 3 && value > 0 && value < 255)).toBe(true)
      await openOutput(page)
      await page.getByLabel('Output format').selectOption('webp')
      await page.getByLabel('Output width', { exact: true }).fill('24')
      await page.getByLabel('Output height', { exact: true }).fill('16')
      await page.getByLabel('Output quality').fill('23')
      await page.getByLabel('Export file name').fill('independent-draft')
      await page.getByRole('button', { name: 'Inspect final output', exact: true }).click()
      await expect(page.locator('.output-inspection-state')).toContainText('Current output.')
      const inspection = await page.getByLabel('Decoded final output at 100 percent').evaluate((element) => {
        if (!(element instanceof HTMLCanvasElement)) throw new Error('Inspection canvas missing.')
        return element.toDataURL()
      })
      await page.getByRole('button', { name: 'Close inspection' }).click()
      await page.getByLabel('Output quality').fill('24')
      await expect(page.locator('.output-inspection-state')).toContainText('Out of date.')
      await page.getByRole('button', { name: 'Close export', exact: true }).click()
      await page.getByRole('button', { name: 'Original', exact: true }).click()
      const before = await state(page)
      if (index === 0) await page.getByRole('button', { name: 'Copy image', exact: true }).click()
      else { await page.getByLabel('Image preview', { exact: true }).focus(); await page.keyboard.press('Control+Shift+c') }
      await expect(page.getByRole('button', { name: 'Copy image', exact: true })).toHaveText('Image copied')
      const copied = await capture(app)
      expect(copied.writes).toBe(index + 1)
      expect(copied.mime).toBe('image/png')
      expect(copied.types).toEqual(['image/png'])
      const decoded = PNG.sync.read(Buffer.from(copied.encoded, 'base64'))
      expect([decoded.width, decoded.height]).toEqual([expected.width, expected.height])
      expect(decoded.data).toEqual(expected.data)
      const label = index === 0 ? 'alpha' : 'orientation'
      await writeFile(`.artifacts/copy-image/copied-${label}.png`, Buffer.from(copied.encoded, 'base64'))
      await writeFile(`.artifacts/copy-image/exported-${label}.png`, exported)
      proofs.push({ source: label, width: decoded.width, height: decoded.height, rgbaSha256: createHash('sha256').update(decoded.data).digest('hex'), differentPixels: 0 })
      expect(await state(page)).toEqual(before)
      expect(createHash('sha256').update(await readFile(source)).digest('hex')).toBe(createHash('sha256').update(input).digest('hex'))
      await expect(page.getByRole('button', { name: 'Original', exact: true })).toHaveAttribute('aria-pressed', 'true')
      await openOutput(page)
      await expect(page.getByLabel('Output format')).toHaveValue('webp')
      await expect(page.getByLabel('Output width', { exact: true })).toHaveValue('24')
      await expect(page.getByLabel('Output height', { exact: true })).toHaveValue('16')
      await expect(page.getByLabel('Output quality')).toHaveValue('24')
      await expect(page.getByLabel('Export file name')).toHaveValue('independent-draft')
      await expect(page.locator('.output-inspection-state')).toContainText('Out of date.')
      expect(await page.getByLabel('Decoded final output at 100 percent').evaluate((element) => {
        if (!(element instanceof HTMLCanvasElement)) throw new Error('Inspection canvas missing.')
        return element.toDataURL()
      })).toBe(inspection)
      await page.getByRole('button', { name: 'Close export', exact: true }).click()
      if (index === 0) {
        await page.setViewportSize({ width: 900, height: 620 })
        await page.locator('.sidebar').evaluate((element) => { element.scrollTop = 0 })
        await page.screenshot({ path: '.artifacts/copy-image/header-900.png' })
        expect(await page.locator('.header-actions').evaluate((element) => element.getBoundingClientRect().right <= window.innerWidth)).toBe(true)
      }
    }
    await writeFile('.artifacts/copy-image/pixel-proof.json', JSON.stringify({ preset, proofs }, null, 2) + '\n')
    expect(errors).toEqual([])
  } finally { await app.close(); await rm(folder, { recursive: true, force: true }) }
})

test('copy waits for acknowledgement, ignores duplicates and guarded shortcuts, preserves recovery, and retries failures', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'deep-fryer-copy-lifetime-'))
  const source = join(folder, 'source.png')
  await writeFile(source, fixture())
  const app = await launch(folder)
  try {
    const page = await app.firstWindow()
    await interceptClipboard(app)
    const button = page.getByRole('button', { name: 'Copy image', exact: true })
    await expect(button).toBeDisabled()
    await page.keyboard.press('Control+Shift+c')
    await open(app, page, source)
    await controls(page)
    await page.getByRole('button', { name: 'Help', exact: true }).click()
    await page.keyboard.press('Control+Shift+c')
    await page.keyboard.press('Escape')
    await page.getByLabel('Brightness value', { exact: true }).focus()
    await page.keyboard.press('Control+Shift+c')
    await page.getByLabel('Add effect').focus()
    await page.keyboard.press('Control+Shift+c')
    await page.evaluate(() => { const input = document.createElement('div'); input.id = 'editable-copy-guard'; input.contentEditable = 'true'; input.textContent = 'Editable'; document.body.append(input); input.focus() })
    await page.keyboard.press('Control+Shift+c')
    await page.locator('#editable-copy-guard').evaluate((element) => element.remove())
    await page.getByLabel('Image preview', { exact: true }).focus()
    await page.keyboard.press('Control+Alt+Shift+c')
    expect((await capture(app)).writes).toBe(0)
    await interceptClipboard(app, 'delay')
    await page.getByLabel('Brightness value', { exact: true }).fill('25')
    await ready(page)
    const before = await state(page)
    await button.click()
    await expect.poll(async () => (await capture(app)).encoded.length).toBeGreaterThan(0)
    const frozen = await capture(app)
    await expect(button).toBeDisabled()
    await expect(button).toHaveText('Copy image')
    await expect(page.getByRole('status')).not.toContainText('Image copied')
    await expect(page.getByLabel('Brightness value', { exact: true })).toBeDisabled()
    await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled()
    await page.keyboard.press('Control+Shift+c')
    await page.keyboard.press('Meta+Shift+c')
    await page.keyboard.press('Control+z')
    await page.keyboard.press('Control+o')
    const blocked = await page.evaluate(async () => {
      try { await window.imageBridge.openImage(); return '' } catch (error) { return String(error) }
    })
    expect(blocked).toContain('Finish the current file action first')
    const documentBlocked = await page.evaluate(async () => {
      try { await window.documentBridge.openProject(); return '' } catch (error) { return String(error) }
    })
    expect(documentBlocked).toContain('Finish the current file action first')
    await page.getByRole('button', { name: 'Original', exact: true }).click()
    await page.getByRole('button', { name: '100%', exact: true }).click()
    await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 1100)))
    expect((await capture(app)).writes).toBe(1)
    await expect(page.getByRole('status')).not.toContainText('Image copied')
    const latest = join(folder, 'profile', 'recovery', 'latest.deepfryer')
    expect(await readFile(latest, 'utf8').catch(() => '')).not.toContain('"value":25')
    await mkdir('.artifacts/copy-image', { recursive: true })
    await page.screenshot({ path: '.artifacts/copy-image/waiting-for-acknowledgement.png' })
    await releaseWrite(app)
    await expect(button).toHaveText('Image copied')
    await expect(button).toBeEnabled()
    await expect(page.locator('.app-header [aria-live="polite"]')).toHaveText('Image copied.')
    expect(await state(page)).toEqual(before)
    expect((await capture(app)).encoded).toBe(frozen.encoded)
    await expect.poll(async () => readFile(latest, 'utf8').catch(() => '')).toContain('"value":25')
    const recovery = await readFile(latest)
    const generations = await readdir(join(folder, 'profile', 'recovery'))
    await mkdir('.artifacts/copy-image', { recursive: true })
    await page.screenshot({ path: '.artifacts/copy-image/copied-acknowledgement.png' })
    await interceptClipboard(app, 'fail')
    await button.click()
    await expect(page.getByRole('status')).toContainText('Clipboard test rejection')
    await expect(button).toBeEnabled()
    await expect(button).toHaveText('Copy image')
    await interceptClipboard(app)
    await page.getByLabel('Image preview', { exact: true }).focus()
    await page.keyboard.press('Meta+Shift+c')
    await expect(button).toHaveText('Image copied')
    expect((await capture(app)).writes).toBe(1)
    expect(await state(page)).toEqual(before)
    expect(await readFile(latest)).toEqual(recovery)
    expect(await readdir(join(folder, 'profile', 'recovery'))).toEqual(generations)
    await expect(button).toHaveText('Copy image')
    await page.getByLabel('Image preview', { exact: true }).focus()
    await page.keyboard.press('Control+z')
    await expect((await controls(page)).getByLabel('Brightness value', { exact: true })).toHaveValue('0')
    await page.getByLabel('Image preview', { exact: true }).focus()
    await page.keyboard.press('Control+Shift+z')
    await expect((await controls(page)).getByLabel('Brightness value', { exact: true })).toHaveValue('25')
  } finally { await app.close(); await rm(folder, { recursive: true, force: true }) }
})

test('main rejects invalid clipboard bytes and untrusted senders before any write, and preload rejects invalid acknowledgements', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'deep-fryer-copy-boundary-'))
  const app = await launch(folder)
  try {
    const page = await app.firstWindow()
    await expect(page.locator('.open-button')).toBeEnabled()
    await interceptClipboard(app)
    const errors = await app.evaluate(async ({ ipcMain, BrowserWindow, nativeImage }, encoded) => {
      const handlers = Reflect.get(ipcMain, '_invokeHandlers')
      if (!(handlers instanceof Map)) throw new Error('Electron IPC handlers unavailable.')
      const handler = handlers.get('image:copy')
      const editor = BrowserWindow.getAllWindows()[0]
      if (typeof handler !== 'function' || !editor) throw new Error('Copy handler unavailable.')
      const sender = { sender: editor.webContents, senderFrame: editor.webContents.mainFrame }
      const valid = new Uint8Array(Buffer.from(encoded, 'base64'))
      const hugeDimensions = new Uint8Array(valid)
      Buffer.from(hugeDimensions.buffer).writeUInt32BE(16385, 16)
      const errors: string[] = []
      for (const input of [null, { bytes: [] }, { bytes: new Uint8Array() }, { bytes: new Uint8Array(128 * 1024 * 1024 + 1) },
        { bytes: valid, filename: 'extra' }, { bytes: hugeDimensions }, { bytes: valid.subarray(0, 33) },
        { bytes: valid.subarray(0, 8) }, { bytes: new Uint8Array(nativeImage.createFromBuffer(Buffer.from(valid)).toJPEG(80)) }]) {
        try { await handler(sender, input); errors.push('ACCEPTED') } catch (error) { errors.push(String(error)) }
      }
      try { await handler({ sender: editor.webContents, senderFrame: null }, { bytes: valid }); errors.push('ACCEPTED') }
      catch (error) { errors.push(String(error)) }
      return errors
    }, fixture().toString('base64'))
    expect(errors).toHaveLength(10)
    expect(errors.every((error) => error !== 'ACCEPTED')).toBe(true)
    expect(errors[6]).toContain('cannot be decoded')
    expect(errors[9]).toContain('did not come from the editor')
    expect((await capture(app)).writes).toBe(0)
    await app.evaluate(({ dialog }) => {
      dialog.showOpenDialog = async () => new Promise((resolve) => {
        Reflect.set(globalThis, '__releaseDocumentOpen', () => resolve({ canceled: true, filePaths: [] }))
      })
    })
    await page.evaluate(() => { Reflect.set(window, '__pendingPreset', window.documentBridge.openPreset()) })
    await expect.poll(() => app.evaluate(() => typeof Reflect.get(globalThis, '__releaseDocumentOpen'))).toBe('function')
    expect(await page.evaluate(async (encoded) => {
      try { await window.imageBridge.copyImage({ bytes: Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0)) }); return 'ACCEPTED' }
      catch (error) { return String(error) }
    }, fixture().toString('base64'))).toContain('Finish the current file action first')
    await app.evaluate(() => Reflect.get(globalThis, '__releaseDocumentOpen')())
    await page.evaluate(() => Reflect.get(window, '__pendingPreset'))
    expect((await capture(app)).writes).toBe(0)
    const source = join(folder, 'source.png')
    await writeFile(source, fixture())
    await open(app, page, source)
    await app.evaluate(({ ipcMain }) => { ipcMain.removeHandler('image:copy'); ipcMain.handle('image:copy', () => ({ kind: 'saved' })) })
    await page.getByRole('button', { name: 'Copy image', exact: true }).click()
    await expect(page.locator('.notice.error')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Copy image', exact: true })).toHaveText('Copy image')
    expect((await capture(app)).writes).toBe(0)
  } finally { await app.close(); await rm(folder, { recursive: true, force: true }) }
})

test('pending preview and preparation block copying, worker failures retry, and teardown stops late clipboard submission', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'deep-fryer-copy-worker-'))
  const source = join(folder, 'source.png')
  await writeFile(source, fixture())
  const app = await launch(folder)
  try {
    const page = await app.firstWindow()
    await interceptClipboard(app)
    await open(app, page, source)
    await controls(page)
    await page.evaluate(() => {
      const postMessage = Worker.prototype.postMessage
      Worker.prototype.postMessage = function (message, transfer) {
        const options = Array.isArray(transfer) ? { transfer } : transfer
        if (message.kind === 'render' && message.quality === 'full') {
          Reflect.set(window, '__releasePreview', () => postMessage.call(this, message, options))
          Worker.prototype.postMessage = postMessage
          return
        }
        postMessage.call(this, message, options)
      }
    })
    await page.getByLabel('Brightness value', { exact: true }).fill('20')
    await expect.poll(() => page.evaluate(() => typeof Reflect.get(window, '__releasePreview'))).toBe('function')
    await expect(page.getByRole('button', { name: 'Copy image', exact: true })).toBeDisabled()
    await page.getByLabel('Image preview', { exact: true }).focus()
    await page.keyboard.press('Control+Shift+c')
    expect((await capture(app)).writes).toBe(0)
    await page.evaluate(() => Reflect.get(window, '__releasePreview')())
    await ready(page)
    await page.evaluate(() => {
      const NativeWorker = window.Worker
      window.Worker = class extends NativeWorker {
        constructor(url: string | URL, options?: WorkerOptions) {
          super(url, options)
          if (!String(url).includes('output-worker')) return
          Reflect.set(window, '__copyWorker', this)
          this.addEventListener('message', (event) => {
            event.stopImmediatePropagation()
            document.documentElement.dataset.copyWorker = 'held'
          })
        }
        terminate(): void { document.documentElement.dataset.copyTerminated = 'true'; super.terminate() }
      }
    })
    const button = page.getByRole('button', { name: 'Copy image', exact: true })
    await button.click()
    await expect(page.locator('html')).toHaveAttribute('data-copy-worker', 'held')
    await expect(button).toBeDisabled()
    await page.keyboard.press('Control+Shift+c')
    expect((await capture(app)).writes).toBe(0)
    await page.evaluate(() => { Reflect.get(window, '__copyWorker').dispatchEvent(new ErrorEvent('error', { message: 'Test worker failure' })) })
    await expect(page.getByRole('status')).toContainText('Copy preparation stopped')
    await expect(button).toBeEnabled()
    await expect(page.locator('html')).toHaveAttribute('data-copy-terminated', 'true')
    await page.evaluate(() => { document.documentElement.removeAttribute('data-copy-worker'); document.documentElement.removeAttribute('data-copy-terminated') })
    await button.click()
    await expect(page.locator('html')).toHaveAttribute('data-copy-worker', 'held')
    await page.evaluate(() => {
      const root = document.getElementById('app')
      if (!root) throw new Error('Vue root missing.')
      const app = Reflect.get(root, '__vue_app__')
      if (!app || typeof app.unmount !== 'function') throw new Error('Vue app unavailable for teardown.')
      app.unmount()
    })
    await expect(page.locator('html')).toHaveAttribute('data-copy-terminated', 'true')
    await expect(page.locator('#app')).toBeEmpty()
    expect((await capture(app)).writes).toBe(0)
  } finally { await app.close(); await rm(folder, { recursive: true, force: true }) }
})

test('disposable Windows CI copies through the actual native clipboard and decodes the full PNG', async () => {
  test.skip(process.env.CI !== 'true' || process.platform !== 'win32', 'Native clipboard writes run only on disposable Windows CI to preserve personal clipboard data.')
  const folder = await mkdtemp(join(tmpdir(), 'deep-fryer-native-copy-'))
  const source = join(folder, 'source.png')
  await writeFile(source, fixture())
  const app = await launch(folder)
  try {
    const page = await app.firstWindow()
    await open(app, page, source)
    await (await controls(page)).getByLabel('Brightness value', { exact: true }).fill('15')
    await ready(page)
    const expected = PNG.sync.read(await savePng(app, page, join(folder, 'expected.png')))
    await page.getByRole('button', { name: 'Copy image', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Copy image', exact: true })).toHaveText('Image copied')
    const encoded = await app.evaluate(async ({ clipboard }) => {
      for (const item of await clipboard.read()) if (item.types.includes('image/png')) {
        const blob = await item.getType('image/png')
        return Buffer.from(await blob.arrayBuffer()).toString('base64')
      }
      throw new Error('Native clipboard did not contain PNG.')
    })
    const actual = PNG.sync.read(Buffer.from(encoded, 'base64'))
    expect([actual.width, actual.height]).toEqual([expected.width, expected.height])
    expect(actual.data).toEqual(expected.data)
  } finally {
    await app.evaluate(({ clipboard }) => clipboard.clear()).catch(() => {})
    await app.close()
    await rm(folder, { recursive: true, force: true })
  }
})
