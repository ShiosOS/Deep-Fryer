import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { chooseUnsaved, closeDiscardingChanges, fileAction, interruptForRecovery, openOutput, ready } from './ui'
import { PNG } from 'pngjs'

async function launch(folder: string): Promise<ElectronApplication> {
  const executable = process.env.DEEP_FRYER_EXECUTABLE ?? process.env.ELECTRON_EXECUTABLE_PATH
  return electron.launch({ ...(executable ? { executablePath: executable } : {}), args: [...(process.env.DEEP_FRYER_EXECUTABLE ? [] : [resolve('.')]), `--user-data-dir=${folder}`], env: { ...process.env, ELECTRON_RENDERER_URL: '' } })
}
async function demo(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Try demo', exact: true }).click()
  await ready(page)
}
async function captions(page: Page): Promise<void> {
  if (await page.locator('.caption-controls').getAttribute('open') === null) await page.locator('.caption-controls > summary').click()
}
async function pixels(page: Page): Promise<string> {
  return page.getByLabel('Edited full resolution image canvas').evaluate(async canvas => {
    if (!(canvas instanceof HTMLCanvasElement)) throw new Error('Canvas missing')
    const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data
    return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', pixels)), byte => byte.toString(16).padStart(2, '0')).join('')
  })
}
async function saveProject(app: ElectronApplication, page: Page, path: string): Promise<void> {
  await app.evaluate(({ dialog }, path) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: path }) }, path)
  await fileAction(page, 'Save project as…')
  await expect(page.getByRole('status')).toContainText('Saved')
}

test('caption typing, native text undo, clear, document undo/redo and minimum window keep the look and relative fry baseline', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'deep-fryer-captions-'))
  const app = await launch(folder)
  try {
    const page = await app.firstWindow()
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await demo(page)
    await page.getByRole('button', { name: 'Crispy color', exact: true }).click()
    await ready(page)
    await captions(page)
    const top = page.getByRole('textbox', { name: 'Top caption', exact: true })
    const bottom = page.getByRole('textbox', { name: 'Bottom caption', exact: true })
    await page.getByRole('button', { name: 'Original', exact: true }).click()
    await top.pressSequentially('WHEN THE TOAST')
    await bottom.fill('IS A LITTLE TOO CRISPY')
    await bottom.blur()
    await ready(page)
    await expect(page.getByRole('button', { name: 'Edited', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('.look-gallery')).toContainText('Crispy color')
    await expect(page.getByRole('slider', { name: 'Fry level', exact: true })).toHaveValue('100')
    await page.getByRole('button', { name: 'Undo', exact: true }).click()
    await expect(bottom).toHaveValue('')
    await ready(page)
    await expect(page.locator('.look-gallery')).toContainText('Crispy color')
    await page.getByRole('button', { name: 'Redo', exact: true }).click()
    await ready(page)
    const baseline = await pixels(page)
    const level = page.getByRole('slider', { name: 'Fry level', exact: true })
    await level.fill('60')
    await level.dispatchEvent('change')
    await ready(page)
    await top.fill('Café TOAST')
    await top.blur()
    await ready(page)
    await expect(level).toHaveValue('60')
    await page.getByRole('button', { name: 'Undo', exact: true }).click()
    await ready(page)
    await expect(level).toHaveValue('60')
    await level.fill('100')
    await level.dispatchEvent('change')
    await ready(page)
    expect(await pixels(page)).toEqual(baseline)
    await top.click()
    await top.press('End')
    await top.pressSequentially('!')
    await top.press('Control+z')
    await expect(top).toHaveValue('WHEN THE TOAST')
    await top.blur()
    await ready(page)
    await page.locator('.caption-controls').getByRole('button', { name: 'Clear', exact: true }).click()
    await ready(page)
    await expect(top).toHaveValue('')
    await expect(bottom).toHaveValue('')
    await page.getByRole('button', { name: 'Undo', exact: true }).click()
    await ready(page)
    expect(await pixels(page)).toEqual(baseline)
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(900, 620))
    await mkdir('.artifacts/captions', { recursive: true })
    await page.locator('.sidebar').evaluate(element => { element.scrollTop = 0 })
    await page.screenshot({ path: '.artifacts/captions/minimum-window.png' })
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.getSize())).toEqual([900, 620])
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await expect(top).toBeInViewport()
    await expect(bottom).toBeInViewport()
    await page.getByRole('button', { name: 'Help', exact: true }).click()
    await page.getByRole('tab', { name: 'Licenses', exact: true }).click()
    await expect(page.locator('.font-license')).toHaveText(await readFile('src/renderer/src/assets/fonts/OFL.txt', 'utf8'))
    expect(errors).toEqual([])
  } finally { await closeDiscardingChanges(app); await rm(folder, { recursive: true, force: true }) }
})

test('caption-only dirty state, canceled save and native close, IME completion and failed-layout recovery retain words', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'deep-fryer-caption-recovery-'))
  let app = await launch(folder)
  try {
    let page = await app.firstWindow()
    await demo(page)
    await saveProject(app, page, join(folder, 'clean.deepfryer'))
    await expect(page.getByLabel('Unsaved project')).toHaveCount(0)
    await captions(page)
    const top = page.getByRole('textbox', { name: 'Top caption', exact: true })
    await top.fill('caption only')
    await top.blur()
    await ready(page)
    await expect(page.getByLabel('Unsaved project')).toBeVisible()
    await page.getByRole('button', { name: 'Undo', exact: true }).click()
    await ready(page)
    await expect(page.getByLabel('Unsaved project')).toHaveCount(0)
    await page.getByRole('button', { name: 'Redo', exact: true }).click()
    await ready(page)
    await app.evaluate(({ dialog }) => { dialog.showSaveDialog = async () => ({ canceled: true, filePath: '' }) })
    await fileAction(page, 'Save project as…')
    await expect(page.getByLabel('Unsaved project')).toBeVisible()
    await chooseUnsaved(app, 'cancel')
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.close())
    await expect(top).toHaveValue('caption only')
    await top.focus()
    const session = await app.context().newCDPSession(page)
    await top.press('Control+a')
    await session.send('Input.imeSetComposition', { text: 'café', selectionStart: 4, selectionEnd: 4 })
    await session.send('Input.insertText', { text: 'café' })
    await top.blur()
    await ready(page)
    await expect(top).toHaveValue('café')
    const failing = 'Saved\ntext\nwith\nfour lines 🙂'
    await top.fill(failing)
    await top.blur()
    await expect(page.locator('.caption-controls [role=alert]')).toContainText('Anton does not include')
    await expect(page.getByRole('button', { name: 'Export', exact: true })).toBeDisabled()
    await saveProject(app, page, join(folder, 'kept.deepfryer'))
    expect(JSON.parse(await readFile(join(folder, 'kept.deepfryer'), 'utf8')).edit.composition.captions.top).toBe(failing)
    await expect.poll(async () => readFile(join(folder, 'recovery/latest.deepfryer'), 'utf8').then(text => JSON.parse(text).edit.composition.captions?.top).catch(() => null)).toBe(failing)
    await interruptForRecovery(app)
    app = await launch(folder)
    page = await app.firstWindow()
    await page.getByRole('button', { name: 'Restore work', exact: true }).click()
    await expect(page.getByRole('textbox', { name: 'Top caption', exact: true })).toHaveValue(failing)
    await expect(page.getByRole('button', { name: 'Export', exact: true })).toBeDisabled()
    await expect(page.getByLabel('Unsaved project')).toBeVisible()
  } finally { await closeDiscardingChanges(app); await rm(folder, { recursive: true, force: true }) }
})

test('caption output scales across alpha, portrait and orientation; copied/exported pixels and inspected bytes agree', async () => {
  test.setTimeout(120_000)
  const folder = await mkdtemp(join(tmpdir(), 'deep-fryer-caption-output-'))
  const app = await launch(folder)
  try {
    const page = await app.firstWindow()
    await app.evaluate(({ clipboard }) => {
      clipboard.write = async items => {
        const blob = await items[0]!.getType('image/png')
        Reflect.set(globalThis, 'captionCopy', Buffer.from(await blob.arrayBuffer()).toString('base64'))
      }
    })
    await page.evaluate(() => {
      const OriginalWorker = window.Worker
      window.Worker = class extends OriginalWorker {
        constructor(url: string | URL, options?: WorkerOptions) {
          super(url, options)
          this.addEventListener('message', event => {
            const result = event.data
            if (result.kind !== 'ready' || !(result.output?.bytes instanceof Uint8Array)) return
            document.documentElement.dataset.captionOutput = btoa(Array.from<number>(result.output.bytes).map(byte => String.fromCharCode(byte)).join(''))
          })
        }
      }
    })
    const image = new PNG({ width: 240, height: 160 })
    for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) image.data.set([20, 40, 80, x < 100 ? 0 : 255], (y * image.width + x) * 4)
    const alpha = PNG.sync.write(image)
    const jpeg = Buffer.from(await app.evaluate(({ nativeImage }, data) => nativeImage.createFromBuffer(Buffer.from(data, 'base64')).toJPEG(90).toString('base64'), alpha.toString('base64')), 'base64')
    const exif = Buffer.from('ffe1002245786966000049492a0008000000010012010300010000000600000000000000', 'hex')
    await mkdir('.artifacts/caption-output', { recursive: true })
    for (const [index, bytes] of [alpha, Buffer.concat([jpeg.subarray(0, 2), exif, jpeg.subarray(2)])].entries()) {
      const source = join(folder, index ? 'oriented.jpg' : 'alpha.png')
      await writeFile(source, bytes)
      if (index) await chooseUnsaved(app, 'discard')
      await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }) }, source)
      await fileAction(page, 'Open image')
      await ready(page)
      await captions(page)
      await page.getByRole('textbox', { name: 'Top caption', exact: true }).fill('Top Café')
      await page.getByRole('textbox', { name: 'Bottom caption', exact: true }).fill('Bottom\nline')
      await page.getByRole('textbox', { name: 'Bottom caption', exact: true }).blur()
      await ready(page)
      await page.getByRole('button', { name: 'Copy image', exact: true }).click()
      await expect(page.getByRole('button', { name: 'Copy image', exact: true })).toHaveText('Image copied')
      const copied = PNG.sync.read(Buffer.from(await app.evaluate(() => String(Reflect.get(globalThis, 'captionCopy'))), 'base64'))
      expect([copied.width, copied.height]).toEqual(index ? [160, 240] : [240, 160])
      if (!index) {
        expect(copied.data[(80 * 240 + 50) * 4 + 3]).toBe(0)
        expect(copied.data[(80 * 240 + 120) * 4 + 3]).toBe(255)
        expect([...copied.data].some((value, offset) => offset % 4 === 3 && value > 0 && value < 255)).toBe(true)
      }
      await openOutput(page)
      for (const [variant, width, height] of [['original', copied.width, copied.height], ['scaled', Math.round(copied.width / 2), Math.round(copied.height / 2)], ['unlocked', 180, 280]] as const) {
        if (variant === 'unlocked') await page.getByRole('checkbox', { name: 'Lock aspect ratio' }).uncheck()
        await page.getByLabel('Output width', { exact: true }).fill(String(width))
        if (variant === 'unlocked') await page.getByLabel('Output height', { exact: true }).fill(String(height))
        await page.getByRole('button', { name: 'Inspect final output', exact: true }).click()
        await expect(page.locator('.output-inspection-state')).toContainText('Current output.')
        const inspectedBytes = Buffer.from((await page.locator('html').getAttribute('data-caption-output'))!, 'base64')
        const inspected = PNG.sync.read(inspectedBytes)
        expect([inspected.width, inspected.height]).toEqual([width, height])
        const canvasPixels = await page.getByLabel('Decoded final output at 100 percent').evaluate(element => {
          if (!(element instanceof HTMLCanvasElement)) throw new Error('Missing inspection')
          return Array.from(element.getContext('2d')!.getImageData(0, 0, element.width, element.height).data)
        })
        expect(Buffer.from(canvasPixels)).toEqual(inspected.data)
        if (variant === 'original') expect(inspected.data).toEqual(copied.data)
        const path = join(folder, `${index}-${variant}.png`)
        await app.evaluate(({ dialog }, path) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: path }) }, path)
        await page.getByRole('button', { name: 'Save inspected snapshot', exact: true }).click()
        await expect(page.getByRole('status')).toContainText(`Saved ${index}-${variant}.png`)
        expect(await readFile(path)).toEqual(inspectedBytes)
        await writeFile(`.artifacts/caption-output/${index}-${variant}.png`, inspectedBytes)
        await page.getByRole('button', { name: 'Close inspection', exact: true }).click()
      }
      await page.getByRole('button', { name: 'Close export', exact: true }).click()
      await page.getByRole('textbox', { name: 'Top caption', exact: true }).fill('Changed caption')
      await page.getByRole('textbox', { name: 'Top caption', exact: true }).blur()
      await ready(page)
      await expect(page.locator('.output-inspection-state')).toContainText('Out of date.')
      await expect(page.getByRole('button', { name: 'Save inspected snapshot', includeHidden: true })).toBeDisabled()
      await page.getByRole('button', { name: 'Randomize', exact: true }).click()
      await ready(page)
      await page.locator('.look-gallery > summary').click()
      await page.getByRole('button', { name: 'Crispy color', exact: true }).click()
      await ready(page)
      await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }) }, resolve('tests/fixtures/v2/baseline.frypreset'))
      await fileAction(page, 'Load preset')
      await ready(page)
      await expect(page.getByRole('textbox', { name: 'Top caption', exact: true })).toHaveValue('Changed caption')
      await expect(page.getByRole('textbox', { name: 'Bottom caption', exact: true })).toHaveValue('Bottom\nline')
      expect(await readFile(source)).toEqual(bytes)
    }
  } finally { await closeDiscardingChanges(app); await rm(folder, { recursive: true, force: true }) }
})

test('missing and delayed worker font keeps savable text and rejects stale caption revisions', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'deep-fryer-caption-font-'))
  const app = await launch(folder)
  try {
    const page = await app.firstWindow()
    await demo(page)
    await expect(page.locator('.look-grid')).toHaveAttribute('aria-busy', 'false')
    const worker = page.workers().find(worker => worker.url().includes('effects-worker'))
    if (!worker) throw new Error('Persistent rendering worker missing')
    await worker.evaluate(() => {
      const state = { mode: 'missing', requests: 0, release: () => {} }
      const originalFetch = globalThis.fetch
      Reflect.set(globalThis, 'captionFont', state)
      globalThis.fetch = async (input, options) => {
        if (String(input).endsWith('.ttf')) {
          state.requests++
          if (state.mode === 'missing') return new Response('Missing test font', { status: 404 })
          if (state.mode === 'delayed') await new Promise<void>(resolve => { state.release = resolve })
        }
        return originalFetch(input, options)
      }
    })
    await captions(page)
    const top = page.getByRole('textbox', { name: 'Top caption', exact: true })
    await top.fill('Keep these words')
    await top.blur()
    await expect(page.locator('.caption-controls [role=alert]')).toContainText('bundled Anton font could not load')
    await saveProject(app, page, join(folder, 'missing-font.deepfryer'))
    expect(JSON.parse(await readFile(join(folder, 'missing-font.deepfryer'), 'utf8')).edit.composition.captions.top).toBe('Keep these words')
    await worker.evaluate(() => { Reflect.get(globalThis, 'captionFont').mode = 'delayed' })
    await page.getByRole('button', { name: 'Retry preview', exact: true }).click()
    await expect.poll(() => worker.evaluate(() => Number(Reflect.get(globalThis, 'captionFont').requests))).toBeGreaterThan(1)
    await top.fill('Latest caption')
    await top.blur()
    await worker.evaluate(() => { const state = Reflect.get(globalThis, 'captionFont'); state.mode = 'ready'; state.release() })
    await ready(page)
    const latest = await pixels(page)
    await expect(top).toHaveValue('Latest caption')
    await page.getByRole('button', { name: 'Undo', exact: true }).click()
    await ready(page)
    expect(await pixels(page)).not.toBe(latest)
    await page.getByRole('button', { name: 'Redo', exact: true }).click()
    await ready(page)
    expect(await pixels(page)).toBe(latest)
  } finally { await closeDiscardingChanges(app); await rm(folder, { recursive: true, force: true }) }
})
