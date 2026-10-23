import { fileAction, controls, exportImage } from './ui'
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'
import { createHash } from 'node:crypto'
import { link, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { PNG } from 'pngjs'

function makeImage(): PNG {
  const image = new PNG({ width: 800, height: 560 })
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const offset = (y * image.width + x) * 4
      const sun = (x - 570) ** 2 + (y - 170) ** 2 < 78 ** 2
      const nearMountain = y > 490 - 135 * Math.sin(x / 190)
      const farMountain = y > 330 - 90 * Math.cos(x / 170)
      const color = nearMountain ? [31, 57, 72] : farMountain ? [72, 100, 115] : sun ? [255, 221, 148] : [230 - y / 5, 156 - y / 9, 127 + y / 12]
      image.data[offset] = Math.round(color[0] ?? 0)
      image.data[offset + 1] = Math.round(color[1] ?? 0)
      image.data[offset + 2] = Math.round(color[2] ?? 0)
      image.data[offset + 3] = 255
    }
  }
  return image
}

async function selectOpen(app: ElectronApplication, path: string | null): Promise<void> {
  await app.evaluate(({ dialog }, selectedPath) => {
    dialog.showOpenDialog = async () => ({ canceled: selectedPath === null, filePaths: selectedPath === null ? [] : [selectedPath] })
  }, path)
}

async function selectSave(app: ElectronApplication, path: string | null): Promise<void> {
  await app.evaluate(({ dialog }, selectedPath) => {
    dialog.showSaveDialog = async () => ({ canceled: selectedPath === null, filePath: selectedPath ?? '' })
  }, path)
}

test('open, cancel, reject replacement, protect originals, and export real canvas pixels with stubbed OS selection', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'deep-fryer-electron-'))
  const original = makeImage()
  const bytes = PNG.sync.write(original)
  const source = join(folder, 'sunset.png')
  const alias = join(folder, 'sunset-alias.png')
  const output = join(folder, 'export.png')
  const malformed = join(folder, 'broken.png')
  const overwide = join(folder, 'huge.png')
  await writeFile(source, bytes)
  await link(source, alias)
  await writeFile(malformed, bytes.subarray(0, 33))
  const hugeBytes = Buffer.from(bytes)
  hugeBytes.writeUInt32BE(20_000, 16)
  await writeFile(overwide, hugeBytes)
  const executable = process.env.DEEP_FRYER_EXECUTABLE ?? process.env.ELECTRON_EXECUTABLE_PATH
  const app = await electron.launch({
    ...(executable ? { executablePath: executable } : {}),
    args: [...(process.env.DEEP_FRYER_EXECUTABLE ? [] : [resolve('.')]), `--user-data-dir=${join(folder, 'profile')}`],
    env: { ...process.env, ELECTRON_RENDERER_URL: '' }
  })
  try {
    const page = await app.firstWindow()
    const rendererErrors: string[] = []
    page.on('pageerror', (error) => rendererErrors.push(error.message))
    await expect(page.getByRole('heading', { name: 'Open your first image.' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Export', exact: true })).toBeDisabled()
    expect(await page.evaluate(() => typeof Reflect.get(window, 'require'))).toBe('undefined')
    expect(await page.evaluate(() => typeof Reflect.get(window, 'process'))).toBe('undefined')
    await selectOpen(app, source)
    await page.keyboard.press('Control+o')
    await expect(page.locator('.filename')).toHaveText('sunset.png')
    await expect(page.getByRole('status')).toContainText('sunset.png is ready')
    await expect(page.getByRole('button', { name: 'Export', exact: true })).toBeEnabled()
    await mkdir('.artifacts', { recursive: true })
    await page.screenshot({ path: '.artifacts/first-slice.png' })

    await selectOpen(app, null)
    await fileAction(page, 'Open image')
    await expect(page.locator('.open-button')).toBeEnabled()
    await expect(page.locator('.filename')).toHaveText('sunset.png')
    for (const invalid of [malformed, overwide]) {
      await selectOpen(app, invalid)
      await fileAction(page, 'Open image')
      await expect(page.locator('.open-button')).toBeEnabled()
      await expect(page.locator('.notice.error')).toBeVisible()
      await expect(page.locator('.filename')).toHaveText('sunset.png')
    }
    await selectSave(app, null)
    await exportImage(page)
    await expect(page.getByRole('button', { name: 'Export', exact: true })).toBeEnabled()
    for (const existing of [source, alias]) {
      await selectSave(app, existing)
      await exportImage(page)
      await expect(page.getByRole('status')).toContainText('already exists')
      expect(await readFile(existing)).toEqual(bytes)
    }
    await selectSave(app, output)
    await page.keyboard.press('Control+Shift+s')
    await page.getByRole('button', { name: 'Save image…' }).click()
    await page.getByRole('button', { name: 'Close export', exact: true }).click()
    await expect(page.getByRole('status')).toContainText('Saved export.png')
    const exported = PNG.sync.read(await readFile(output))
    expect([exported.width, exported.height]).toEqual([original.width, original.height])
    expect(exported.data).toEqual(original.data)
    expect(createHash('sha256').update(await readFile(source)).digest('hex')).toBe(createHash('sha256').update(bytes).digest('hex'))

    const jpegBytes = await app.evaluate(({ nativeImage }, pngBase64) => nativeImage.createFromBuffer(Buffer.from(pngBase64, 'base64')).toJPEG(92).toString('base64'), bytes.toString('base64'))
    const jpeg = Buffer.from(jpegBytes, 'base64')
    const exif = Buffer.from('ffe1002245786966000049492a0008000000010012010300010000000600000000000000', 'hex')
    const orientedPath = join(folder, 'rotated.jpg')
    await writeFile(orientedPath, Buffer.concat([jpeg.subarray(0, 2), exif, jpeg.subarray(2)]))
    await selectOpen(app, orientedPath)
    await fileAction(page, 'Open image')
    await expect(page.locator('.filename')).toHaveText('rotated.jpg')
    await expect(page.locator('.canvas-caption')).toContainText('560 × 800')
    const orientedOutput = join(folder, 'oriented.png')
    await selectSave(app, orientedOutput)
    await exportImage(page)
    await expect(page.getByRole('status')).toContainText('Saved oriented.png')
    const oriented = PNG.sync.read(await readFile(orientedOutput))
    expect([oriented.width, oriented.height]).toEqual([560, 800])
    expect(rendererErrors).toEqual([])
  } finally {
    await app.close()
    await rm(folder, { recursive: true, force: true })
  }
})

test('independent color controls preview and export combined settings while preserving alpha and source', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'deep-fryer-color-'))
  const original = new PNG({ width: 200, height: 100 })
  for (let y = 0; y < original.height; y += 1) {
    for (let x = 0; x < original.width; x += 1) {
      original.data.set(x < 100 ? [200, 100, 50, 255] : [40, 80, 120, 128], (y * original.width + x) * 4)
    }
  }
  const bytes = PNG.sync.write(original)
  const source = join(folder, 'patches.png')
  const invalid = join(folder, 'broken.png')
  const output = join(folder, 'color.png')
  await writeFile(source, bytes)
  await writeFile(invalid, bytes.subarray(0, 20))
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
    await selectOpen(app, source)
    await fileAction(page, 'Open image')
    await expect((await controls(page)).getByRole('spinbutton', { name: 'Brightness value' })).toHaveValue('0')
    await expect((await controls(page)).getByRole('spinbutton', { name: 'Contrast value' })).toHaveValue('1')
    await expect((await controls(page)).getByRole('spinbutton', { name: 'Saturation value' })).toHaveValue('1')
    await expect((await controls(page)).getByRole('spinbutton', { name: 'Color levels value' })).toHaveValue('256')

    await (await controls(page)).getByRole('spinbutton', { name: 'Contrast value' }).fill('1.5')
    await expect(page.getByRole('status')).toContainText('Color changes are ready')
    await (await controls(page)).getByRole('spinbutton', { name: 'Saturation value' }).fill('0')
    await expect(page.getByRole('status')).toContainText('Color changes are ready')
    await expect((await controls(page)).getByRole('spinbutton', { name: 'Contrast value' })).toHaveValue('1.5')
    await expect((await controls(page)).getByRole('spinbutton', { name: 'Brightness value' })).toHaveValue('0')
    await expect((await controls(page)).getByRole('spinbutton', { name: 'Color levels value' })).toHaveValue('256')
    await (await controls(page)).getByRole('spinbutton', { name: 'Color levels value' }).fill('1')
    await expect((await controls(page)).getByRole('spinbutton', { name: 'Color levels value' })).toHaveAttribute('aria-invalid', 'true')
    await expect(page.getByRole('button', { name: 'Export', exact: true })).toBeEnabled()
    await (await controls(page)).getByRole('spinbutton', { name: 'Color levels value' }).fill('256')
    await expect(page.getByRole('status')).toContainText('Color changes are ready')

    const preview = await page.getByLabel('Edited full resolution image canvas').evaluate((canvas) => {
      if (!(canvas instanceof HTMLCanvasElement)) throw new Error('Preview canvas missing')
      const context = canvas.getContext('2d')
      if (!context) throw new Error('Preview context missing')
      return Array.from(context.getImageData(0, 0, 200, 100).data)
    })
    expect(preview.slice(0, 4)).toEqual([112, 112, 112, 255])
    const secondPatch = 199 * 4
    expect(preview[secondPatch]).toBe(preview[secondPatch + 1])
    expect(preview[secondPatch + 1]).toBe(preview[secondPatch + 2])
    expect(preview[secondPatch + 3]).toBe(128)

    await page.setViewportSize({ width: 1244, height: 950 })
    await page.evaluate(() => {
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
      document.querySelector('.sidebar')?.scrollTo(0, 0)
    })
    await mkdir('.artifacts', { recursive: true })
    await page.screenshot({ path: '.artifacts/color-controls.png' })

    await selectOpen(app, invalid)
    await fileAction(page, 'Open image')
    await expect(page.locator('.notice.error')).toBeVisible()
    await expect((await controls(page)).getByRole('spinbutton', { name: 'Contrast value' })).toHaveValue('1.5')
    await expect((await controls(page)).getByRole('spinbutton', { name: 'Saturation value' })).toHaveValue('0')
    for (const failure of ['pixel preparation', 'worker publication']) {
      await page.evaluate((stage) => {
        if (stage === 'pixel preparation') {
          const readPixels = CanvasRenderingContext2D.prototype.getImageData
          CanvasRenderingContext2D.prototype.getImageData = function () {
            CanvasRenderingContext2D.prototype.getImageData = readPixels
            throw new Error('Injected pixel preparation failure')
          }
        } else {
          const postMessage = Worker.prototype.postMessage
          Worker.prototype.postMessage = function () {
            Worker.prototype.postMessage = postMessage
            throw new Error('Injected worker publication failure')
          }
        }
      }, failure)
      await selectOpen(app, source)
      await fileAction(page, 'Open image')
      await expect(page.getByRole('status')).toContainText(`Injected ${failure} failure`)
      await expect((await controls(page)).getByRole('spinbutton', { name: 'Contrast value' })).toHaveValue('1.5')
      await expect((await controls(page)).getByRole('spinbutton', { name: 'Saturation value' })).toHaveValue('0')
      await expect(page.getByRole('button', { name: 'Export', exact: true })).toBeEnabled()
      const retained = await page.getByLabel('Edited full resolution image canvas').evaluate((element) => {
        if (!(element instanceof HTMLCanvasElement)) throw new Error('Preview canvas missing')
        return Array.from(element.getContext('2d')!.getImageData(0, 0, 200, 100).data)
      })
      expect(retained).toEqual(preview)
    }
    await selectSave(app, output)
    await exportImage(page)
    await expect(page.getByRole('status')).toContainText('Saved color.png')
    const exported = PNG.sync.read(await readFile(output))
    expect(Array.from(exported.data)).toEqual(preview)
    expect(createHash('sha256').update(await readFile(source)).digest('hex')).toBe(createHash('sha256').update(bytes).digest('hex'))

    await page.getByRole('button', { name: 'Reset color' }).click()
    await expect(page.getByRole('status')).toContainText('Color changes are ready')
    await expect((await controls(page)).getByRole('spinbutton', { name: 'Contrast value' })).toHaveValue('1')
    await expect((await controls(page)).getByRole('spinbutton', { name: 'Saturation value' })).toHaveValue('1')
    await (await controls(page)).getByRole('spinbutton', { name: 'Brightness value' }).fill('25')
    await expect(page.getByRole('status')).toContainText('Color changes are ready')
    await selectOpen(app, source)
    await fileAction(page, 'Open image')
    await expect((await controls(page)).getByRole('spinbutton', { name: 'Brightness value' })).toHaveValue('0')
    expect(errors).toEqual([])
  } finally {
    await app.close()
    await rm(folder, { recursive: true, force: true })
  }
})
