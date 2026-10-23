import { _electron as electron, expect, test } from '@playwright/test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { PNG } from 'pngjs'

test('ordered texture and real JPEG damage export the current pixels', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'deep-fryer-effects-'))
  const original = new PNG({ width: 96, height: 64 })
  for (let y = 0; y < original.height; y += 1) for (let x = 0; x < original.width; x += 1) {
    const offset = (y * original.width + x) * 4
    original.data.set([x * 2, y * 3, (x * 7 + y * 11) % 256, x < 12 ? 0 : 255], offset)
  }
  const bytes = PNG.sync.write(original)
  const source = join(folder, 'texture.png')
  await writeFile(source, bytes)
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
    await app.evaluate(({ dialog }, selected) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selected] }) }, source)
    await page.getByRole('button', { name: 'Open image' }).click()
    await expect(page.getByRole('button', { name: 'Export PNG' })).toBeEnabled()

    await page.getByLabel('Add effect').selectOption('noise')
    await page.getByRole('spinbutton', { name: 'Noise value' }).fill('70')
    await expect(page.getByRole('button', { name: 'Export PNG' })).toBeEnabled()
    await page.getByRole('spinbutton', { name: 'Noise pattern' }).fill('42')
    await page.getByRole('spinbutton', { name: 'Noise pattern' }).blur()
    await expect(page.getByRole('button', { name: 'Export PNG' })).toBeEnabled()
    const noiseOnly = await page.getByLabel('Edited full resolution image canvas').evaluate((element) => Array.from((element as HTMLCanvasElement).getContext('2d')!.getImageData(0, 0, 96, 64).data))
    await page.getByRole('button', { name: 'Duplicate Noise' }).click()
    await expect(page.locator('[data-effect-kind="noise"]')).toHaveCount(2)
    await page.locator('[data-effect-kind="noise"]').last().getByRole('spinbutton', { name: 'Noise mix value' }).fill('0')
    await expect(page.getByRole('button', { name: 'Export PNG' })).toBeEnabled()
    const zeroMixDuplicate = await page.getByLabel('Edited full resolution image canvas').evaluate((element) => Array.from((element as HTMLCanvasElement).getContext('2d')!.getImageData(0, 0, 96, 64).data))
    expect(zeroMixDuplicate).toEqual(noiseOnly)
    await page.locator('[data-effect-kind="noise"]').last().getByRole('button', { name: 'Remove Noise' }).click()

    await page.getByLabel('Add effect').selectOption('jpeg')
    await page.getByRole('spinbutton', { name: 'JPEG quality value' }).fill('20')
    await page.getByRole('spinbutton', { name: 'JPEG passes value' }).fill('1')
    await expect(page.getByRole('button', { name: 'Export PNG' })).toBeEnabled()
    const afterJpeg = await page.getByLabel('Edited full resolution image canvas').evaluate((element) => Array.from((element as HTMLCanvasElement).getContext('2d')!.getImageData(0, 0, 96, 64).data))
    expect(afterJpeg[3]).toBe(255)
    expect(afterJpeg.slice(0, 3)).not.toEqual([0, 0, 0])
    expect(afterJpeg).not.toEqual(noiseOnly)
    await page.setViewportSize({ width: 1244, height: 950 })
    await page.evaluate(() => {
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
      document.querySelector('.sidebar')?.scrollTo(0, 10000)
    })
    await mkdir('.artifacts', { recursive: true })
    await page.screenshot({ path: '.artifacts/ordered-effects.png' })
    const firstOutput = join(folder, 'after-jpeg.png')
    await app.evaluate(({ dialog }, selected) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: selected }) }, firstOutput)
    await page.getByRole('button', { name: 'Export PNG' }).click()
    await expect(page.getByRole('status')).toContainText('Saved after-jpeg.png')
    expect(Array.from(PNG.sync.read(await readFile(firstOutput)).data)).toEqual(afterJpeg)

    await page.getByRole('button', { name: 'Move JPEG damage up' }).click()
    await expect(page.getByRole('button', { name: 'Export PNG' })).toBeEnabled()
    const beforeNoise = await page.getByLabel('Edited full resolution image canvas').evaluate((element) => Array.from((element as HTMLCanvasElement).getContext('2d')!.getImageData(0, 0, 96, 64).data))
    expect(beforeNoise).not.toEqual(afterJpeg)
    await page.getByRole('checkbox', { name: /Enable Noise/ }).uncheck()
    await expect(page.getByRole('button', { name: 'Export PNG' })).toBeEnabled()
    const jpegOnly = await page.getByLabel('Edited full resolution image canvas').evaluate((element) => Array.from((element as HTMLCanvasElement).getContext('2d')!.getImageData(0, 0, 96, 64).data))
    expect(jpegOnly).not.toEqual(beforeNoise)
    const directCodec = await page.evaluate(async () => {
      const originalCanvas = document.querySelector<HTMLCanvasElement>('canvas[aria-label="Original full resolution image canvas"]')!
      const input = originalCanvas.getContext('2d')!.getImageData(0, 0, 96, 64)
      const layer = new OffscreenCanvas(96, 64)
      layer.getContext('2d')!.putImageData(input, 0, 0)
      const composite = new OffscreenCanvas(96, 64)
      const context = composite.getContext('2d', { willReadFrequently: true })!
      context.fillStyle = '#ffffff'
      context.fillRect(0, 0, 96, 64)
      context.drawImage(layer, 0, 0)
      const compressed = await composite.convertToBlob({ type: 'image/jpeg', quality: 0.2 })
      const bitmap = await createImageBitmap(compressed)
      context.drawImage(bitmap, 0, 0)
      bitmap.close()
      return Array.from(context.getImageData(0, 0, 96, 64).data)
    })
    expect(jpegOnly).toEqual(directCodec)
    await page.getByRole('spinbutton', { name: 'JPEG damage mix value' }).fill('50')
    await expect(page.getByRole('button', { name: 'Export PNG' })).toBeEnabled()
    const mixedPixel = await page.getByLabel('Edited full resolution image canvas').evaluate((element) => Array.from((element as HTMLCanvasElement).getContext('2d')!.getImageData(0, 0, 1, 1).data))
    expect(mixedPixel[3]).toBe(128)
    for (let channel = 0; channel < 3; channel += 1) expect(Math.abs(mixedPixel[channel]! - directCodec[channel]!)).toBeLessThanOrEqual(1)
    expect(await readFile(source)).toEqual(bytes)
    expect(errors).toEqual([])
  } finally {
    await app.close()
    await rm(folder, { recursive: true, force: true })
  }
})

test('maximum supported image finishes the latest full resolution edit', async () => {
  test.setTimeout(120_000)
  const folder = await mkdtemp(join(tmpdir(), 'deep-fryer-max-'))
  const original = new PNG({ width: 6000, height: 4000, colorType: 2 })
  original.data.fill(255)
  const source = join(folder, 'max.png')
  await writeFile(source, PNG.sync.write(original))
  const executable = process.env.DEEP_FRYER_EXECUTABLE ?? process.env.ELECTRON_EXECUTABLE_PATH
  const app = await electron.launch({
    ...(executable ? { executablePath: executable } : {}),
    args: [...(process.env.DEEP_FRYER_EXECUTABLE ? [] : [resolve('.')]), `--user-data-dir=${join(folder, 'profile')}`],
    env: { ...process.env, ELECTRON_RENDERER_URL: '' }
  })
  try {
    const page = await app.firstWindow()
    await app.evaluate(({ dialog }, selected) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selected] }) }, source)
    await page.getByRole('button', { name: 'Open image' }).click()
    await expect(page.getByRole('spinbutton', { name: 'Brightness value' })).toBeVisible()
    await page.getByRole('spinbutton', { name: 'Brightness value' }).fill('-10')
    await expect(page.getByRole('button', { name: 'Export PNG' })).toBeDisabled()
    await expect(page.getByRole('button', { name: 'Export PNG' })).toBeEnabled({ timeout: 90_000 })
    const pixel = await page.getByLabel('Edited full resolution image canvas').evaluate((element) => {
      const canvas = element as HTMLCanvasElement
      return [canvas.width, canvas.height, ...canvas.getContext('2d')!.getImageData(3000, 2000, 1, 1).data]
    })
    expect(pixel).toEqual([6000, 4000, 230, 230, 230, 255])
    await page.getByRole('spinbutton', { name: 'Brightness value' }).fill('-20')
    await expect(page.getByRole('button', { name: 'Export PNG' })).toBeDisabled()
    await page.waitForTimeout(150)
    await page.getByRole('spinbutton', { name: 'Brightness value' }).fill('-30')
    await expect(page.getByRole('spinbutton', { name: 'Brightness value' })).toHaveValue('-30')
    await expect(page.getByRole('button', { name: 'Export PNG' })).toBeEnabled({ timeout: 90_000 })
    const latest = await page.getByLabel('Edited full resolution image canvas').evaluate((element) => Array.from((element as HTMLCanvasElement).getContext('2d')!.getImageData(3000, 2000, 1, 1).data))
    expect(latest).toEqual([178, 178, 178, 255])
    await page.getByRole('spinbutton', { name: 'Brightness value' }).fill('-40')
    await page.getByRole('button', { name: 'Cancel pending changes' }).click()
    await expect(page.getByRole('status')).toContainText('Last confirmed image restored')
    await expect(page.getByRole('spinbutton', { name: 'Brightness value' })).toHaveValue('-30')
    await expect(page.getByRole('button', { name: 'Export PNG' })).toBeEnabled()
    const restored = await page.getByLabel('Edited full resolution image canvas').evaluate((element) => Array.from((element as HTMLCanvasElement).getContext('2d')!.getImageData(3000, 2000, 1, 1).data))
    expect(restored).toEqual(latest)
    await page.getByRole('spinbutton', { name: 'Brightness value' }).fill('-50')
    await expect(page.getByRole('button', { name: 'Export PNG' })).toBeEnabled({ timeout: 90_000 })
    const afterCancel = await page.getByLabel('Edited full resolution image canvas').evaluate((element) => Array.from((element as HTMLCanvasElement).getContext('2d')!.getImageData(3000, 2000, 1, 1).data))
    expect(afterCancel).toEqual([128, 128, 128, 255])
  } finally {
    await app.close()
    await rm(folder, { recursive: true, force: true })
  }
})
