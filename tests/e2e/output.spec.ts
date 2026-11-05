import { chooseUnsaved, closeDiscardingChanges, fileAction, controls, exportImage, openOutput } from './ui'
import { _electron as electron, expect, test, type Page } from '@playwright/test'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { PNG } from 'pngjs'

async function recordEncodedSnapshots(page: Page): Promise<void> {
  await page.evaluate(() => {
    const NativeWorker = window.Worker
    window.Worker = class extends NativeWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options)
        this.addEventListener('message', (event) => {
          const data: unknown = event.data
          if (typeof data !== 'object' || data === null || !('kind' in data) || data.kind !== 'ready' || !('output' in data)) return
          const output = data.output
          if (typeof output !== 'object' || output === null || !('bytes' in output) || !(output.bytes instanceof Uint8Array)) return
          let binary = ''
          for (const byte of output.bytes) binary += String.fromCharCode(byte)
          document.documentElement.dataset.encodedSnapshot = btoa(binary)
        })
      }
    }
  })
}

async function decodedFile(page: Page, bytes: Buffer, mime: string) {
  return page.evaluate(async ({ encoded, mime }) => {
    const data = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0))
    const bitmap = await createImageBitmap(new Blob([data], { type: mime }))
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
    const context = canvas.getContext('2d')!
    context.drawImage(bitmap, 0, 0)
    bitmap.close()
    return { width: canvas.width, height: canvas.height, pixels: Array.from(context.getImageData(0, 0, canvas.width, canvas.height).data) }
  }, { encoded: bytes.toString('base64'), mime })
}

test('aspect ratio defaults to the oriented source, unlocks explicitly, resets on replacement, and saves inspected dimensions', async () => {
  test.setTimeout(90_000)
  const folder = await mkdtemp(join(tmpdir(), 'deep-fryer-aspect-ratio-'))
  const source = join(folder, 'landscape.png')
  const image = new PNG({ width: 96, height: 64 })
  for (let y = 0; y < image.height; y += 1) for (let x = 0; x < image.width; x += 1) {
    image.data.set([x * 2, y * 3, (x * 7 + y * 11) % 256, 255], (y * image.width + x) * 4)
  }
  const original = PNG.sync.write(image)
  await writeFile(source, original)
  const executable = process.env.DEEP_FRYER_EXECUTABLE ?? process.env.ELECTRON_EXECUTABLE_PATH
  const app = await electron.launch({
    ...(executable ? { executablePath: executable } : {}),
    args: [...(process.env.DEEP_FRYER_EXECUTABLE ? [] : [resolve('.')]), `--user-data-dir=${join(folder, 'profile')}`],
    env: { ...process.env, ELECTRON_RENDERER_URL: '' }
  })
  try {
    const page = await app.firstWindow()
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await recordEncodedSnapshots(page)
    await app.evaluate(({ dialog }, selected) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selected] }) }, source)
    await fileAction(page, 'Open image')
    await expect(page.getByRole('button', { name: 'Export', exact: true })).toBeEnabled()
    await openOutput(page)
    const width = page.getByRole('spinbutton', { name: 'Output width' })
    const height = page.getByRole('spinbutton', { name: 'Output height' })
    const lock = page.getByRole('checkbox', { name: 'Lock aspect ratio' })
    const inspect = page.getByRole('button', { name: 'Inspect final output', exact: true })
    const save = page.getByRole('button', { name: 'Save image…' })
    const proofs: Array<{ name: string; width: number; height: number; sha256: string }> = []
    await mkdir('.artifacts/export-aspect-ratio', { recursive: true })

    async function inspectAndSave(name: string, expected: [number, number]): Promise<void> {
      const destination = join(folder, `${name}.png`)
      await app.evaluate(({ dialog }, selected) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: selected }) }, destination)
      await inspect.click()
      await expect(page.locator('.output-inspection-state')).toContainText('Current output.')
      const canvas = page.getByLabel('Decoded final output at 100 percent')
      await expect.poll(() => canvas.evaluate((element) => {
        if (!(element instanceof HTMLCanvasElement)) throw new Error('Inspection canvas missing.')
        return [element.width, element.height]
      })).toEqual(expected)
      await expect(page.getByRole('dialog', { name: 'Final output inspection' })).toContainText(`${expected[0]} × ${expected[1]} px`)
      const inspected = await canvas.evaluate((element) => {
        if (!(element instanceof HTMLCanvasElement)) throw new Error('Inspection canvas missing.')
        return Array.from(element.getContext('2d')!.getImageData(0, 0, element.width, element.height).data)
      })
      const encoded = await page.locator('html').getAttribute('data-encoded-snapshot')
      if (!encoded) throw new Error('Encoded inspection missing.')
      await page.getByRole('button', { name: 'Save inspected snapshot' }).click()
      await expect(page.getByRole('status')).toContainText(`Saved ${name}.png`)
      const saved = await readFile(destination)
      expect(saved).toEqual(Buffer.from(encoded, 'base64'))
      const decoded = PNG.sync.read(saved)
      expect([decoded.width, decoded.height]).toEqual(expected)
      expect(Array.from(decoded.data)).toEqual(inspected)
      await writeFile(join('.artifacts/export-aspect-ratio', `${name}.png`), saved)
      proofs.push({ name, width: decoded.width, height: decoded.height, sha256: createHash('sha256').update(saved).digest('hex') })
      await page.screenshot({ path: `.artifacts/export-aspect-ratio/${name}-inspection.png` })
      await page.getByRole('button', { name: 'Close inspection' }).click()
    }

    await expect(lock).toBeChecked()
    await expect(width).toHaveValue('96')
    await expect(height).toHaveValue('64')
    await expect(page.getByLabel('Export file name')).toHaveValue('landscape-fried')
    await inspect.click()
    await expect(page.locator('.output-inspection-state')).toContainText('Current output.')
    const untouchedSnapshot = await page.locator('html').getAttribute('data-encoded-snapshot')
    await page.getByRole('button', { name: 'Close inspection' }).click()
    await lock.uncheck()
    await expect(page.locator('.output-inspection-state')).toContainText('Current output.')
    await lock.check()
    await expect(width).toHaveValue('96')
    await expect(height).toHaveValue('64')
    await expect(page.locator('.output-inspection-state')).toContainText('Current output.')
    await expect(page.getByRole('button', { name: 'Save inspected snapshot', includeHidden: true })).toBeEnabled()
    await inspectAndSave('untouched-relocked', [96, 64])
    expect(await page.locator('html').getAttribute('data-encoded-snapshot')).toBe(untouchedSnapshot)
    await width.fill('49')
    await expect(height).toHaveValue('33')
    await inspectAndSave('locked-width', [49, 33])
    await height.fill('25')
    await expect(width).toHaveValue('38')
    await expect(page.locator('.output-inspection-state')).toContainText('Out of date.')
    await expect(page.getByRole('button', { name: 'Save inspected snapshot', includeHidden: true })).toBeDisabled()
    await inspectAndSave('locked-height', [38, 25])
    await height.fill('32')
    await expect(width).toHaveValue('48')

    await lock.focus()
    await page.keyboard.press('Space')
    await expect(lock).not.toBeChecked()
    await width.fill('40')
    await expect(height).toHaveValue('32')
    await height.fill('17')
    await expect(width).toHaveValue('40')
    await inspectAndSave('unlocked-stretch', [40, 17])
    await page.screenshot({ path: '.artifacts/export-aspect-ratio/unlocked-settings.png' })
    await lock.check()
    await expect(height).toHaveValue('27')
    await expect(page.locator('.output-inspection-state')).toContainText('Out of date.')

    for (const value of ['', '0', '-1', '1.5', '16385', '6001']) {
      await width.fill(value)
      await expect(inspect).toBeDisabled()
      await expect(save).toBeDisabled()
      await expect(page.locator('.control-error')).toBeVisible()
    }
    await width.fill('6000')
    await expect(height).toHaveValue('4000')
    await expect(inspect).toBeEnabled()
    await expect(save).toBeEnabled()
    await lock.uncheck()
    await width.fill('16385')
    await height.fill('1')
    await expect(inspect).toBeDisabled()
    await width.fill('16384')
    await expect(inspect).toBeEnabled()
    await height.fill('0')
    await expect(save).toBeDisabled()
    await height.fill('1')
    await page.getByRole('button', { name: 'Close export', exact: true }).click()

    const jpeg = Buffer.from(await app.evaluate(({ nativeImage }, encoded) => nativeImage.createFromBuffer(Buffer.from(encoded, 'base64')).toJPEG(92).toString('base64'), original.toString('base64')), 'base64')
    const exif = Buffer.from('ffe1002245786966000049492a0008000000010012010300010000000600000000000000', 'hex')
    const orientedBytes = Buffer.concat([jpeg.subarray(0, 2), exif, jpeg.subarray(2)])
    const replacement = join(folder, 'portrait.jpg')
    await writeFile(replacement, orientedBytes)
    await app.evaluate(({ dialog }, selected) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selected] }) }, replacement)
    await chooseUnsaved(app, 'discard')
    await fileAction(page, 'Open image')
    await expect(page.getByRole('button', { name: 'Export', exact: true })).toBeEnabled()
    await openOutput(page)
    await expect(lock).toBeChecked()
    await expect(width).toHaveValue('64')
    await expect(height).toHaveValue('96')
    await expect(page.getByLabel('Export file name')).toHaveValue('portrait-fried')
    await expect(page.locator('.output-inspection-state')).toContainText('Out of date.')
    await width.fill('20')
    await expect(height).toHaveValue('30')
    await inspectAndSave('oriented-replacement', [20, 30])
    await height.fill('45')
    await expect(width).toHaveValue('30')
    await width.fill('12000')
    await expect(height).toHaveValue('18000')
    await expect(inspect).toBeDisabled()
    await expect(save).toBeDisabled()
    expect(await readFile(source)).toEqual(original)
    expect(await readFile(replacement)).toEqual(orientedBytes)
    expect(errors).toEqual([])
    await writeFile('.artifacts/export-aspect-ratio/proof.json', JSON.stringify({ proofs, errors, originalPreserved: true, replacementPreserved: true }, null, 2))
  } finally {
    await closeDiscardingChanges(app)
    await rm(folder, { recursive: true, force: true })
  }
})

test('PNG, JPEG and WebP save the inspected bytes at explicit output size and detect stale inspections', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'deep-fryer-output-'))
  const original = new PNG({ width: 96, height: 64 })
  for (let y = 0; y < 64; y += 1) for (let x = 0; x < 96; x += 1) {
    original.data.set([x * 2, y * 3, (x * 7 + y * 11) % 256, x < 64 ? 0 : 255], (y * 96 + x) * 4)
  }
  const originalBytes = PNG.sync.write(original)
  const source = join(folder, 'source.png')
  await writeFile(source, originalBytes)
  const executable = process.env.DEEP_FRYER_EXECUTABLE ?? process.env.ELECTRON_EXECUTABLE_PATH
  const app = await electron.launch({
    ...(executable ? { executablePath: executable } : {}),
    args: [...(process.env.DEEP_FRYER_EXECUTABLE ? [] : [resolve('.')]), `--user-data-dir=${join(folder, 'profile')}`],
    env: { ...process.env, ELECTRON_RENDERER_URL: '' }
  })
  try {
    const page = await app.firstWindow()
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await recordEncodedSnapshots(page)
    await app.evaluate(({ dialog }, selected) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selected] }) }, source)
    await fileAction(page, 'Open image')
    await (await controls(page)).getByRole('spinbutton', { name: 'Brightness value' }).fill('15')
    await expect(page.getByRole('button', { name: 'Export', exact: true })).toBeEnabled()
    await page.getByLabel('Add effect').selectOption('noise')
    await (await controls(page)).getByRole('spinbutton', { name: 'Noise value', exact: true }).fill('35')
    await (await controls(page)).getByRole('spinbutton', { name: 'Noise pattern' }).fill('42')
    await (await controls(page)).getByRole('spinbutton', { name: 'Noise pattern' }).blur()
    await expect(page.getByRole('button', { name: 'Export', exact: true })).toBeEnabled()
    await openOutput(page)
    await page.getByRole('spinbutton', { name: 'Output width' }).fill('48')
    await page.getByRole('spinbutton', { name: 'Output height' }).fill('32')
    const resizedPreview = await page.evaluate(() => {
      function resized(label: string): number[] {
        const input = document.querySelector<HTMLCanvasElement>(`canvas[aria-label="${label}"]`)!
        const output = new OffscreenCanvas(48, 32)
        const context = output.getContext('2d')!
        context.imageSmoothingQuality = 'high'
        context.drawImage(input, 0, 0, 48, 32)
        return Array.from(context.getImageData(0, 0, 48, 32).data)
      }
      return { original: resized('Original full resolution image canvas'), edited: resized('Edited full resolution image canvas') }
    })

    for (const format of [
      { kind: 'png', extension: 'png', mime: 'image/png', label: 'PNG' },
      { kind: 'jpeg', extension: 'jpg', mime: 'image/jpeg', label: 'JPEG' },
      { kind: 'webp', extension: 'webp', mime: 'image/webp', label: 'WebP' }
    ]) {
      await page.getByLabel('Output format').selectOption(format.kind)
      if (format.kind !== 'png') await page.getByRole('spinbutton', { name: 'Output quality' }).fill('43')
      if (format.kind === 'jpeg') await page.getByLabel('JPEG output background').fill('#2468ac')
      const destination = join(folder, `output.${format.extension}`)
      await app.evaluate(({ dialog }, selected) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: selected }) }, destination)
      await page.getByRole('button', { name: 'Inspect final output', exact: true }).click()
      await expect(page.locator('.output-inspection-state')).toContainText('Current output.')
      const inspection = page.getByLabel('Decoded final output at 100 percent')
      const inspected = await inspection.evaluate((element) => {
        if (!(element instanceof HTMLCanvasElement)) throw new Error('Inspection is not a canvas.')
        const bounds = element.getBoundingClientRect()
        return { width: element.width, height: element.height, cssWidth: bounds.width, cssHeight: bounds.height, pixels: Array.from(element.getContext('2d')!.getImageData(0, 0, element.width, element.height).data) }
      })
      expect([inspected.width, inspected.height, inspected.cssWidth, inspected.cssHeight]).toEqual([48, 32, 48, 32])
      const encoded = await page.locator('html').getAttribute('data-encoded-snapshot')
      expect(encoded).not.toBeNull()
      await page.getByRole('button', { name: 'Save inspected snapshot' }).click()
      await expect(page.getByRole('status')).toContainText(`Saved output.${format.extension}`)
      const saved = await readFile(destination)
      expect(saved).toEqual(Buffer.from(encoded!, 'base64'))
      const decoded = await decodedFile(page, saved, format.mime)
      expect(decoded.width).toBe(48)
      expect(decoded.height).toBe(32)
      expect(decoded.pixels).toEqual(inspected.pixels)
      if (format.kind === 'jpeg') {
        expect(decoded.pixels[3]).toBe(255)
        for (const [channel, expected] of [36, 104, 172].entries()) expect(Math.abs(decoded.pixels[channel]! - expected)).toBeLessThanOrEqual(3)
      } else expect(decoded.pixels[3]).toBe(0)
      if (format.kind === 'png') {
        expect(Array.from(PNG.sync.read(saved).data)).toEqual(inspected.pixels)
        expect(inspected.pixels).not.toEqual(resizedPreview.original)
        expect(inspected.pixels).not.toEqual(resizedPreview.edited)
      }
      if (format.kind === 'webp') {
        await mkdir('.artifacts', { recursive: true })
        await page.screenshot({ path: '.artifacts/final-output-inspection.png' })
      }
      await page.getByRole('button', { name: 'Close inspection' }).click()
    }

    await page.getByRole('spinbutton', { name: 'Output quality' }).fill('44')
    await expect(page.locator('.output-inspection-state')).toContainText('Out of date.')
    await expect(page.getByRole('button', { name: 'Save inspected snapshot', includeHidden: true })).toBeDisabled()
    await page.getByRole('button', { name: 'Close export', exact: true }).click()
    await (await controls(page)).getByRole('spinbutton', { name: 'Brightness value' }).fill('25')
    await expect(page.locator('.output-inspection-state')).toContainText('Out of date.')
    await expect(page.getByRole('button', { name: 'Export', exact: true })).toBeEnabled()
    await openOutput(page)
    await page.getByRole('spinbutton', { name: 'Output width' }).fill('0')
    await expect(page.getByRole('button', { name: 'Inspect final output', exact: true })).toBeDisabled()
    expect(await readFile(source)).toEqual(originalBytes)
    expect(errors).toEqual([])
  } finally {
    await closeDiscardingChanges(app)
    await rm(folder, { recursive: true, force: true })
  }
})

test('a delayed save uses the frozen export and cancellation never reports a completed save', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'deep-fryer-frozen-output-'))
  const source = join(folder, 'source.png')
  const image = new PNG({ width: 8, height: 8 })
  for (let offset = 0; offset < image.data.length; offset += 4) image.data.set([50, 60, 70, 255], offset)
  const original = PNG.sync.write(image)
  await writeFile(source, original)
  const executable = process.env.DEEP_FRYER_EXECUTABLE ?? process.env.ELECTRON_EXECUTABLE_PATH
  const app = await electron.launch({
    ...(executable ? { executablePath: executable } : {}),
    args: [...(process.env.DEEP_FRYER_EXECUTABLE ? [] : [resolve('.')]), `--user-data-dir=${join(folder, 'profile')}`],
    env: { ...process.env, ELECTRON_RENDERER_URL: '' }
  })
  try {
    const page = await app.firstWindow()
    await recordEncodedSnapshots(page)
    await app.evaluate(({ dialog }, selected) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selected] }) }, source)
    await fileAction(page, 'Open image')
    const destination = join(folder, 'frozen.png')
    await app.evaluate(({ dialog }, selected) => {
      dialog.showSaveDialog = async () => {
        await new Promise((resolve) => setTimeout(resolve, 2500))
        return { canceled: false, filePath: selected }
      }
    }, destination)
    await exportImage(page)
    await expect(page.locator('html')).toHaveAttribute('data-encoded-snapshot', /.+/)
    const frozen = await page.locator('html').getAttribute('data-encoded-snapshot')
    await (await controls(page)).getByRole('spinbutton', { name: 'Brightness value' }).fill('50')
    await expect(page.getByRole('button', { name: 'Export', exact: true })).toBeEnabled()
    await openOutput(page)
    await page.getByRole('checkbox', { name: 'Lock aspect ratio' }).uncheck()
    await page.getByRole('spinbutton', { name: 'Output width' }).fill('4')
    await page.getByRole('button', { name: 'Close export', exact: true }).click()
    await expect(page.locator('.output-inspection-state')).toContainText('Out of date.')
    await expect(page.getByRole('status')).toContainText('Saved frozen.png')
    const saved = await readFile(destination)
    expect(createHash('sha256').update(saved).digest('hex')).toEqual(createHash('sha256').update(Buffer.from(frozen!, 'base64')).digest('hex'))
    expect(PNG.sync.read(saved).width).toBe(8)
    expect(Array.from(PNG.sync.read(saved).data.subarray(0, 4))).toEqual([50, 60, 70, 255])
    await app.evaluate(({ dialog }) => { dialog.showSaveDialog = async () => ({ canceled: true, filePath: '' }) })
    await exportImage(page)
    await expect(page.getByRole('status')).toContainText('Export canceled. No file was saved.')
    expect(await readFile(source)).toEqual(original)
  } finally {
    await closeDiscardingChanges(app)
    await rm(folder, { recursive: true, force: true })
  }
})
