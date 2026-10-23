import { _electron as electron, expect, test } from '@playwright/test'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { PNG } from 'pngjs'

test('place, drag, edit, undo, redo, and export a bulge in Electron', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'deep-fryer-bulge-'))
  const source = join(folder, 'grid.png')
  const output = join(folder, 'bulged.png')
  const image = new PNG({ width: 120, height: 120 })
  for (let y = 0; y < 120; y += 1) for (let x = 0; x < 120; x += 1) image.data.set([x * 2, y * 2, (x % 20 < 2 || y % 20 < 2) ? 255 : 40, 255], (y * 120 + x) * 4)
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
    page.on('pageerror', error => errors.push(error.message))
    await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }) }, source)
    await page.getByRole('button', { name: 'Open image' }).click()
    await expect(page.getByRole('button', { name: 'Export PNG' })).toBeEnabled()
    const brightness = page.getByRole('spinbutton', { name: 'Brightness value' })
    await brightness.click()
    await page.keyboard.press('Control+a')
    await page.keyboard.type('25')
    await brightness.blur()
    await expect(page.getByRole('button', { name: 'Export PNG' })).toBeEnabled()
    await page.getByRole('button', { name: 'Undo', exact: true }).click()
    await expect(brightness).toHaveValue('0')
    await expect(page.getByRole('button', { name: 'Export PNG' })).toBeEnabled()
    for (let step = 0; step < 4; step += 1) await page.getByRole('button', { name: 'Zoom in' }).click()
    await page.getByRole('button', { name: 'Place point' }).click()
    const stage = page.getByRole('region', { name: 'Image preview' })
    const bounds = await stage.boundingBox()
    if (!bounds) throw new Error('Preview bounds are unavailable')
    await stage.click({ position: { x: bounds.width / 2, y: bounds.height / 2 } })
    const point = page.getByRole('button', { name: /Distortion point 1/ })
    await expect(point).toBeVisible()
    await expect(page.getByRole('button', { name: 'Undo' })).toBeEnabled()
    const before = await point.boundingBox()
    if (!before) throw new Error('Point bounds are unavailable')
    await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2)
    await page.mouse.down()
    await page.mouse.move(before.x + before.width / 2 + 28, before.y + before.height / 2 + 12, { steps: 5 })
    await page.mouse.up()
    const after = await point.boundingBox()
    if (!after) throw new Error('Dragged point bounds are unavailable')
    expect(after.x).toBeGreaterThan(before.x + 15)
    await page.keyboard.press('Control+z')
    const undone = await point.boundingBox()
    expect(Math.abs(undone!.x - before.x)).toBeLessThan(2)
    await page.keyboard.press('Control+Shift+z')
    const redone = await point.boundingBox()
    expect(Math.abs(redone!.x - after.x)).toBeLessThan(2)
    await page.getByRole('spinbutton', { name: 'Bulge strength value' }).fill('-75')
    await page.getByRole('spinbutton', { name: 'Bulge strength value' }).blur()
    await expect(point).toHaveAttribute('aria-label', /pinch/)
    await expect(page.getByRole('button', { name: 'Export PNG' })).toBeEnabled()
    await app.evaluate(({ dialog }, path) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: path }) }, output)
    await mkdir('.artifacts', { recursive: true })
    await page.screenshot({ path: '.artifacts/bulge-history-electron.png' })
    await page.getByRole('button', { name: 'Export PNG' }).click()
    await expect(page.getByRole('status')).toContainText('Saved bulged.png')
    const exported = PNG.sync.read(await readFile(output))
    expect(exported.width).toBe(120)
    expect(exported.height).toBe(120)
    expect(exported.data).not.toEqual(image.data)
    expect(createHash('sha256').update(await readFile(source)).digest('hex')).toBe(createHash('sha256').update(original).digest('hex'))
    expect(errors).toEqual([])
  } finally {
    await app.close()
    await rm(folder, { recursive: true, force: true })
  }
})
