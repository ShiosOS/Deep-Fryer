import { fileAction, controls, exportImage } from './ui'
import { _electron as electron, expect, test } from '@playwright/test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { PNG } from 'pngjs'

function image(width: number, height: number): Buffer {
  const png = new PNG({ width, height })
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4
      png.data.set(x < width / 2 ? [70, 110, 150, 255] : [180, 120, 60, 255], offset)
    }
  }
  return PNG.sync.write(png)
}

function pixelAt(bytes: Buffer, x: number, y: number): number[] {
  const png = PNG.sync.read(bytes)
  const offset = (Math.floor(y) * png.width + Math.floor(x)) * 4
  return Array.from(png.data.subarray(offset, offset + 4))
}

test('zoom, pan, compare, resize, and export full Edited pixels while Original is visible', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'deep-fryer-inspection-'))
  const largePath = join(folder, 'large.png')
  const smallPath = join(folder, 'small.png')
  const outputPath = join(folder, 'small-edited.png')
  const largeBytes = image(1600, 1200)
  const smallBytes = image(80, 40)
  await writeFile(largePath, largeBytes)
  await writeFile(smallPath, smallBytes)
  const executable = process.env.DEEP_FRYER_EXECUTABLE ?? process.env.ELECTRON_EXECUTABLE_PATH
  const app = await electron.launch({
    ...(executable ? { executablePath: executable } : {}),
    args: [...(process.env.DEEP_FRYER_EXECUTABLE ? [] : [resolve('.')]), `--user-data-dir=${join(folder, 'profile')}`],
    env: { ...process.env, ELECTRON_RENDERER_URL: '' }
  })
  try {
    const page = await app.firstWindow()
    await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0]?.setSize(1024, 768) })
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    const stage = page.getByRole('region', { name: 'Image preview' })
    const plane = page.locator('.image-plane')
    await app.evaluate(({ dialog }, selectedPath) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selectedPath] })
    }, largePath)
    await fileAction(page, 'Open image')
    await expect(page.locator('.filename')).toHaveText('large.png')
    await page.getByRole('button', { name: '100%' }).click()
    await expect(page.locator('.inspection-controls .preview-scale')).toHaveText('100%')
    await page.getByRole('button', { name: 'Zoom in' }).click()
    await expect(page.locator('.inspection-controls .preview-scale')).toHaveText('141%')
    const bounds = await stage.boundingBox()
    if (!bounds) throw new Error('Image pane missing')
    await page.mouse.dblclick(bounds.x + bounds.width / 2 + 80, bounds.y + bounds.height / 2 + 40)
    await expect(page.locator('.inspection-controls .preview-scale')).toHaveText('200%')
    await page.keyboard.down('Shift')
    await page.mouse.dblclick(bounds.x + bounds.width / 2 + 80, bounds.y + bounds.height / 2 + 40)
    await page.keyboard.up('Shift')
    await expect(page.locator('.inspection-controls .preview-scale')).toHaveText('141%')
    await page.mouse.dblclick(bounds.x + bounds.width / 2 + 80, bounds.y + bounds.height / 2 + 40)
    await expect(page.locator('.inspection-controls .preview-scale')).toHaveText('200%')
    const beforePan = await plane.evaluate((element) => getComputedStyle(element).transform)
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
    await page.mouse.down()
    await page.mouse.move(bounds.x + bounds.width / 2 + 40, bounds.y + bounds.height / 2, { steps: 4 })
    await page.mouse.up()
    const afterPan = await plane.evaluate((element) => getComputedStyle(element).transform)
    expect(afterPan).not.toBe(beforePan)
    await stage.focus()
    await page.keyboard.press('ArrowRight')
    expect(await plane.evaluate((element) => getComputedStyle(element).transform)).not.toBe(afterPan)
    await page.keyboard.press('+')
    await expect(page.locator('.inspection-controls .preview-scale')).toHaveText('283%')
    await page.keyboard.press('-')
    await expect(page.locator('.inspection-controls .preview-scale')).toHaveText('200%')

    await (await controls(page)).getByRole('spinbutton', { name: 'Brightness value' }).fill('30')
    await expect(page.getByRole('status')).toContainText('Color changes are ready')
    const editedTransform = await plane.evaluate((element) => getComputedStyle(element).transform)
    await page.keyboard.press('ArrowRight')
    expect(await plane.evaluate((element) => getComputedStyle(element).transform)).toBe(editedTransform)
    await page.getByRole('button', { name: 'Original' }).click()
    await expect(page.getByLabel('Original full resolution image canvas')).toBeVisible()
    expect(await plane.evaluate((element) => getComputedStyle(element).transform)).toBe(editedTransform)
    await mkdir('.artifacts', { recursive: true })
    await page.screenshot({ path: '.artifacts/inspection-large-original.png' })
    const originalPane = await stage.screenshot()
    const originalPng = PNG.sync.read(originalPane)
    const sampleX = originalPng.width / 2 - 100
    const sampleY = originalPng.height / 2
    expect(pixelAt(originalPane, sampleX, sampleY)).toEqual([70, 110, 150, 255])
    await page.getByRole('button', { name: 'Edited' }).click()
    expect(await plane.evaluate((element) => getComputedStyle(element).transform)).toBe(editedTransform)
    await page.screenshot({ path: '.artifacts/inspection-large-edited.png' })
    expect(pixelAt(await stage.screenshot(), sampleX, sampleY)).not.toEqual([70, 110, 150, 255])
    await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0]
      if (!window) throw new Error('The editor window is unavailable')
      const { width, height } = window.getBounds()
      window.setSize(width > 900 ? Math.max(900, width - 120) : 1020, Math.max(620, height - 100))
    })
    await expect.poll(async () => (await stage.boundingBox())?.width).not.toBe(bounds.width)
    await expect(page.locator('.inspection-controls .preview-scale')).toHaveText('200%')
    await stage.focus()
    await page.keyboard.press('0')
    await expect(page.locator('.inspection-controls .preview-scale')).not.toHaveText('200%')

    await app.evaluate(({ dialog }, selectedPath) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selectedPath] })
    }, smallPath)
    await fileAction(page, 'Open image')
    await expect(page.locator('.filename')).toHaveText('small.png')
    await expect(page.locator('.inspection-controls .preview-scale')).toHaveText('100%')
    let displayed = await page.getByLabel('Edited full resolution image canvas').boundingBox()
    expect([displayed?.width, displayed?.height]).toEqual([80, 40])
    await page.getByRole('button', { name: 'Fit', exact: true }).click()
    await stage.focus()
    await page.keyboard.press('1')
    displayed = await page.getByLabel('Edited full resolution image canvas').boundingBox()
    expect([displayed?.width, displayed?.height]).toEqual([80, 40])
    await (await controls(page)).getByRole('spinbutton', { name: 'Brightness value' }).fill('30')
    await expect(page.getByRole('status')).toContainText('Color changes are ready')
    await page.getByRole('button', { name: 'Original' }).click()
    await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0]?.setSize(1260, 840) })
    await expect.poll(async () => (await stage.boundingBox())?.width).toBeGreaterThan(800)
    displayed = await page.getByLabel('Original full resolution image canvas').boundingBox()
    expect([displayed?.width, displayed?.height]).toEqual([80, 40])
    await page.screenshot({ path: '.artifacts/inspection-small-original.png' })
    await app.evaluate(({ dialog }, selectedPath) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: selectedPath })
    }, outputPath)
    await exportImage(page)
    await expect(page.getByRole('status')).toContainText('Saved small-edited.png')
    const exported = PNG.sync.read(await readFile(outputPath))
    expect([exported.width, exported.height]).toEqual([80, 40])
    expect(Array.from(exported.data.subarray(0, 4))).not.toEqual([70, 110, 150, 255])
    expect(await readFile(smallPath)).toEqual(smallBytes)
    expect(await readFile(largePath)).toEqual(largeBytes)
    expect(errors).toEqual([])
  } finally {
    await app.close()
    await rm(folder, { recursive: true, force: true })
  }
})
