import { _electron as electron, expect, test, type Locator, type Page } from '@playwright/test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { PNG } from 'pngjs'

async function tabTo(page: Page, control: Locator): Promise<void> {
  for (let count = 0; count < 180; count += 1) {
    if (await control.evaluate((element) => element === document.activeElement)) return
    await page.keyboard.press('Tab')
  }
  throw new Error('The requested control is not reachable through the keyboard tab order.')
}

test('keyboard completes import, effect and point edits, undo, variation selection and inspected export', async () => {
  test.setTimeout(90_000)
  const folder = await mkdtemp(join(tmpdir(), 'deep-fryer-keyboard-'))
  const source = join(folder, 'grid.png')
  const output = join(folder, 'keyboard.png')
  const image = new PNG({ width: 80, height: 60 })
  for (let y = 0; y < image.height; y += 1) for (let x = 0; x < image.width; x += 1) image.data.set([x * 3, y * 4, x % 10 < 2 || y % 10 < 2 ? 255 : 40, 255], (y * image.width + x) * 4)
  const bytes = PNG.sync.write(image)
  await writeFile(source, bytes)
  const executable = process.env.DEEP_FRYER_EXECUTABLE ?? process.env.ELECTRON_EXECUTABLE_PATH
  const app = await electron.launch({ ...(executable ? { executablePath: executable } : {}),
    args: [...(process.env.DEEP_FRYER_EXECUTABLE ? [] : [resolve('.')]), `--user-data-dir=${join(folder, 'profile')}`],
    env: { ...process.env, ELECTRON_RENDERER_URL: '' } })
  try {
    const page = await app.firstWindow()
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await app.evaluate(({ dialog }, selected) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selected] }) }, source)
    await expect(page.getByRole('button', { name: 'Open image' })).toBeEnabled()
    await page.keyboard.press('Control+o')
    const exportButton = page.getByRole('button', { name: 'Export PNG' })
    await expect(exportButton).toBeEnabled()
    const add = page.getByRole('combobox', { name: 'Add effect' })
    await tabTo(page, add)
    await page.keyboard.press('Space')
    await page.keyboard.press('End')
    await page.keyboard.press('Enter')
    await expect(page.locator('[data-effect-kind="bulge"]')).toHaveCount(1)
    for (const [name, value] of [['Bulge x value', '35'], ['Bulge y value', '65'], ['Bulge radius value', '40'], ['Bulge strength value', '-60']] as const) {
      await tabTo(page, page.getByRole('spinbutton', { name, exact: true }))
      await page.keyboard.press('Control+a')
      await page.keyboard.type(value)
      await page.keyboard.press('Tab')
    }
    await expect(exportButton).toBeEnabled()
    const undo = page.getByRole('button', { name: 'Undo', exact: true })
    const redo = page.getByRole('button', { name: 'Redo', exact: true })
    await tabTo(page, undo)
    await page.keyboard.press('Enter')
    await expect(page.getByRole('spinbutton', { name: 'Bulge strength value' })).toHaveValue('50')
    await tabTo(page, redo)
    await page.keyboard.press('Enter')
    await expect(exportButton).toBeEnabled()
    await expect(page.getByRole('spinbutton', { name: 'Bulge strength value' })).toHaveValue('-60')
    const compare = page.getByRole('button', { name: 'Compare five levels' })
    await tabTo(page, compare)
    await page.keyboard.press('Enter')
    const variations = page.getByRole('dialog', { name: 'Choose a fry level' })
    await expect(variations.getByRole('radio')).toHaveCount(5)
    await page.keyboard.press('Escape')
    await expect(variations).not.toBeVisible()
    await expect(compare).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(variations.getByRole('radio')).toHaveCount(5)
    await tabTo(page, variations.getByRole('radio', { name: /60% fry/ }))
    await page.keyboard.press('ArrowLeft')
    await expect(variations.getByRole('radio', { name: /40% fry/ })).toBeChecked()
    await tabTo(page, variations.getByRole('button', { name: 'Apply selected level' }))
    await page.keyboard.press('Enter')
    await expect(exportButton).toBeEnabled()
    await expect(page.getByRole('spinbutton', { name: 'Bulge strength value' })).toHaveValue('-24')
    for (const [name, value] of [['Output width', '40'], ['Output height', '30']] as const) {
      await tabTo(page, page.getByRole('spinbutton', { name, exact: true }))
      await page.keyboard.press('Control+a')
      await page.keyboard.type(value)
      await page.keyboard.press('Tab')
    }
    await tabTo(page, page.getByRole('button', { name: 'Inspect final output' }))
    await page.keyboard.press('Enter')
    const inspection = page.getByRole('dialog', { name: 'Final output inspection' })
    await expect(inspection.locator('.output-inspection-state')).toContainText('Current output')
    const inspected = await inspection.getByLabel('Decoded final output at 100 percent').evaluate((element) => {
      if (!(element instanceof HTMLCanvasElement)) throw new Error('Output inspection canvas missing')
      return Array.from(element.getContext('2d')!.getImageData(0, 0, element.width, element.height).data)
    })
    await app.evaluate(({ dialog }, selected) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: selected }) }, output)
    await tabTo(page, inspection.getByRole('button', { name: 'Save inspected snapshot' }))
    await page.keyboard.press('Enter')
    await expect(page.locator('.notice')).toContainText('Saved keyboard.png')
    await tabTo(page, inspection.getByRole('button', { name: 'Close inspection' }))
    await page.keyboard.press('Enter')
    const saved = PNG.sync.read(await readFile(output))
    expect([saved.width, saved.height]).toEqual([40, 30])
    expect(Array.from(saved.data)).toEqual(inspected)
    expect(saved.data).not.toEqual(image.data)
    expect(await readFile(source)).toEqual(bytes)
    expect(errors).toEqual([])
  } finally { await app.close(); await rm(folder, { recursive: true, force: true }) }
})
