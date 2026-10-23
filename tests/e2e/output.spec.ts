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
    await page.getByRole('button', { name: 'Open image' }).click()
    await page.getByRole('spinbutton', { name: 'Brightness value' }).fill('15')
    await expect(page.getByRole('button', { name: 'Export PNG' })).toBeEnabled()
    await page.getByLabel('Add effect').selectOption('noise')
    await page.getByRole('spinbutton', { name: 'Noise value', exact: true }).fill('35')
    await page.getByRole('spinbutton', { name: 'Noise pattern' }).fill('42')
    await page.getByRole('spinbutton', { name: 'Noise pattern' }).blur()
    await expect(page.getByRole('button', { name: 'Export PNG' })).toBeEnabled()
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
    await page.getByRole('spinbutton', { name: 'Brightness value' }).fill('25')
    await expect(page.locator('.output-inspection-state')).toContainText('Out of date.')
    await expect(page.getByRole('button', { name: 'Export WebP' })).toBeEnabled()
    await page.getByRole('spinbutton', { name: 'Output width' }).fill('0')
    await expect(page.getByRole('button', { name: 'Inspect final output', exact: true })).toBeDisabled()
    expect(await readFile(source)).toEqual(originalBytes)
    expect(errors).toEqual([])
  } finally {
    await app.close()
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
    await page.getByRole('button', { name: 'Open image' }).click()
    const destination = join(folder, 'frozen.png')
    await app.evaluate(({ dialog }, selected) => {
      dialog.showSaveDialog = async () => {
        await new Promise((resolve) => setTimeout(resolve, 2500))
        return { canceled: false, filePath: selected }
      }
    }, destination)
    await page.getByRole('button', { name: 'Export PNG' }).click()
    await expect(page.locator('html')).toHaveAttribute('data-encoded-snapshot', /.+/)
    const frozen = await page.locator('html').getAttribute('data-encoded-snapshot')
    await page.getByRole('spinbutton', { name: 'Brightness value' }).fill('50')
    await page.getByRole('spinbutton', { name: 'Output width' }).fill('4')
    await expect(page.locator('.output-inspection-state')).toContainText('Out of date.')
    await expect(page.getByRole('status')).toContainText('Saved frozen.png')
    const saved = await readFile(destination)
    expect(createHash('sha256').update(saved).digest('hex')).toEqual(createHash('sha256').update(Buffer.from(frozen!, 'base64')).digest('hex'))
    expect(PNG.sync.read(saved).width).toBe(8)
    expect(Array.from(PNG.sync.read(saved).data.subarray(0, 4))).toEqual([50, 60, 70, 255])
    await app.evaluate(({ dialog }) => { dialog.showSaveDialog = async () => ({ canceled: true, filePath: '' }) })
    await page.getByRole('button', { name: 'Export PNG' }).click()
    await expect(page.getByRole('status')).toContainText('Export canceled. No file was saved.')
    expect(await readFile(source)).toEqual(original)
  } finally {
    await app.close()
    await rm(folder, { recursive: true, force: true })
  }
})
