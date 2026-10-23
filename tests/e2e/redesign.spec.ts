import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileAction, openOutput, ready } from './ui'
import type { BaseWindow, SaveDialogOptions } from 'electron'

async function launch(profile: string): Promise<ElectronApplication> {
  const executable = process.env.DEEP_FRYER_EXECUTABLE ?? process.env.ELECTRON_EXECUTABLE_PATH
  return electron.launch({ ...(executable ? { executablePath: executable } : {}), args: [...(process.env.DEEP_FRYER_EXECUTABLE ? [] : [resolve('.')]), `--user-data-dir=${profile}`], env: { ...process.env, ELECTRON_RENDERER_URL: '' } })
}
function recordErrors(page: Page, errors: string[]): void {
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
}
async function source(app: ElectronApplication, page: Page): Promise<void> {
  await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }) }, resolve('tests/fixtures/v1/original.png'))
  await fileAction(page, 'Open image')
  await ready(page)
}

test('appearance persists six independent custom colors, System and pink selection across restart without changing history or recovery', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'deep-fryer-theme-'))
  const profile = join(folder, 'profile')
  let app = await launch(profile)
  const errors: string[] = []
  try {
    let page = await app.firstWindow()
    recordErrors(page, errors)
    await source(app, page)
    const checkpoint = join(profile, 'recovery/latest.deepfryer')
    await expect.poll(() => readFile(checkpoint, 'utf8').catch(() => '')).not.toBe('')
    const savedEdit = await readFile(checkpoint)
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    const palettes = { Light: ['#102030', '#fafafa', '#ffffff'], Dark: ['#ffeedd', '#101020', '#151015'] }
    for (const [mode, colors] of Object.entries(palettes)) {
      await page.getByRole('button', { name: mode, exact: true }).click()
      await expect(page.getByRole('button', { name: 'Done', exact: true })).toBeEnabled()
      await page.getByRole('button', { name: 'Custom colors', exact: true }).click()
      for (const [index, label] of ['Accent color', 'Canvas color', 'Panels color'].entries()) {
        await page.getByLabel(label, { exact: true }).fill(colors[index]!)
        await expect(page.getByRole('button', { name: 'Done', exact: true })).toBeEnabled()
      }
    }
    await page.getByRole('button', { name: 'Pastel pink', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Done', exact: true })).toBeEnabled()
    await page.getByRole('button', { name: 'System', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Done', exact: true })).toBeEnabled()
    await page.emulateMedia({ colorScheme: 'light' })
    await expect(page.locator('html')).toHaveAttribute('data-appearance', 'light')
    await page.emulateMedia({ colorScheme: 'dark' })
    await expect(page.locator('html')).toHaveAttribute('data-appearance', 'dark')
    const persisted = JSON.parse(await readFile(join(profile, 'appearance.json'), 'utf8'))
    expect(persisted.settings.mode).toBe('system')
    expect(persisted.settings.palettes).toEqual({ light: { selected: 'custom', custom: { accent: '#102030', canvas: '#fafafa', panel: '#ffffff' } }, dark: { selected: 'pink', custom: { accent: '#ffeedd', canvas: '#101020', panel: '#151015' } } })
    await page.keyboard.press('Escape')
    await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeFocused()
    await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled()
    expect(await readFile(checkpoint)).toEqual(savedEdit)
    await app.close()
    app = await launch(profile)
    page = await app.firstWindow()
    recordErrors(page, errors)
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await expect(page.getByRole('button', { name: 'System', exact: true })).toHaveAttribute('aria-pressed', 'true')
    for (const [mode, colors] of Object.entries(palettes)) {
      await page.getByRole('button', { name: mode, exact: true }).click()
      await expect(page.getByRole('button', { name: 'Done', exact: true })).toBeEnabled()
      await page.getByRole('button', { name: 'Custom colors', exact: true }).click()
      for (const [index, label] of ['Accent color', 'Canvas color', 'Panels color'].entries()) await expect(page.getByLabel(label, { exact: true })).toHaveValue(colors[index]!)
    }
    await mkdir('.artifacts/implementation', { recursive: true })
    await page.screenshot({ path: '.artifacts/implementation/settings-custom.png' })
    expect(errors).toEqual([])
  } finally { await app.close(); await rm(folder, { recursive: true, force: true }) }
})

test('Help tabs, engine-rendered media, reduced motion, focus return and minimum window are usable', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'deep-fryer-help-'))
  const app = await launch(folder)
  try {
    const page = await app.firstWindow()
    const errors: string[] = []
    recordErrors(page, errors)
    await page.setViewportSize({ width: 900, height: 620 })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.getByRole('button', { name: 'Help', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Help', exact: true })
    await expect(dialog.getByRole('tab')).toHaveCount(5)
    await expect(dialog.getByRole('img').first()).toBeVisible()
    await dialog.getByRole('tab', { name: 'Quick start' }).focus()
    await page.keyboard.press('ArrowRight')
    await expect(dialog.getByRole('tab', { name: 'Effects', exact: true })).toBeFocused()
    await expect(dialog.getByRole('button', { name: 'Play animation' })).toBeVisible()
    await expect(dialog.locator('.demo-gif')).toHaveAttribute('src', /contrast-poster.*png/)
    for (const effect of ['brightness', 'contrast', 'saturation', 'levels', 'sharpen', 'noise', 'jpeg', 'bulge']) {
      await dialog.getByLabel('Choose an effect').selectOption(effect)
      for (const image of await dialog.locator('img').all()) await expect.poll(() => image.evaluate((element) => element instanceof HTMLImageElement && element.complete && element.naturalWidth > 0)).toBe(true)
      await dialog.getByText('Technical detail', { exact: true }).click()
      await expect(dialog.locator('.tech-detail[open]')).toBeVisible()
      await dialog.getByText('Technical detail', { exact: true }).click()
    }
    await dialog.getByLabel('Choose an effect').selectOption('contrast')
    await dialog.getByRole('button', { name: 'Play animation' }).click()
    await expect(dialog.locator('.demo-gif')).toHaveAttribute('src', /\.gif$/)
    await dialog.getByRole('button', { name: 'Pause animation' }).click()
    await page.screenshot({ path: '.artifacts/implementation/help-effects.png' })
    for (const topic of ['Layering', 'Points', 'Saving & export']) {
      await dialog.getByRole('tab', { name: topic, exact: true }).click()
      await expect(dialog.getByRole('tabpanel')).not.toBeEmpty()
    }
    await page.screenshot({ path: '.artifacts/implementation/help-saving.png' })
    await page.keyboard.press('Escape')
    await expect(dialog).not.toBeVisible()
    await expect(page.getByRole('button', { name: 'Help', exact: true })).toBeFocused()
    const bounds = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: innerWidth, inspector: document.querySelector('.sidebar')?.getBoundingClientRect().width, header: document.querySelector('.app-header')?.getBoundingClientRect().height }))
    expect(bounds).toEqual({ scroll: 900, width: 900, inspector: 272, header: 62 })
    expect(await page.locator('.export-bar, .preset-strip, .brand').count()).toBe(0)
    expect(errors).toEqual([])
  } finally { await app.close(); await rm(folder, { recursive: true, force: true }) }
})

test('project, preset and export names are independent and canceling names or native choosers keeps the edit and source', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'deep-fryer-names-'))
  const app = await launch(join(folder, 'profile'))
  try {
    const page = await app.firstWindow()
    const errors: string[] = []
    recordErrors(page, errors)
    await source(app, page)
    await app.evaluate(({ dialog }, destination) => {
      Reflect.set(globalThis, 'saveSuggestions', [])
      dialog.showSaveDialog = async (windowOrOptions: BaseWindow | SaveDialogOptions, supplied?: SaveDialogOptions) => {
        const options = supplied ?? windowOrOptions
        if (!('defaultPath' in options)) throw new Error('Missing save suggestion')
        Reflect.get(globalThis, 'saveSuggestions').push(options.defaultPath)
        return { canceled: false, filePath: `${destination}/${options.defaultPath}` }
      }
    }, folder)
    for (const [kind, name] of [['project', 'Weekend edit'], ['preset', 'Extra crispy']] as const) {
      await page.getByRole('button', { name: kind === 'project' ? 'File' : 'Preset actions', exact: true }).click()
      await page.getByRole('button', { name: `Save ${kind} as…`, exact: true }).click()
      await page.getByRole('textbox', { name: kind === 'project' ? 'Project name' : 'Preset name' }).fill(name)
      await page.getByRole('button', { name: 'Save as…', exact: true }).click()
      await expect(page.locator('.notice')).toContainText(`Saved ${name}`)
    }
    await openOutput(page)
    await page.getByRole('textbox', { name: 'Export file name' }).fill('Share this')
    await page.getByRole('button', { name: 'Inspect final output', exact: true }).click()
    await expect(page.locator('.output-inspection-state')).toContainText('Current output.')
    await page.getByRole('button', { name: 'Close inspection' }).click()
    await page.getByRole('textbox', { name: 'Export file name' }).fill('Share renamed')
    await expect(page.locator('.output-inspection-state')).toContainText('Current output.')
    await page.getByRole('button', { name: 'Save image…' }).click()
    await expect(page.locator('.notice')).toContainText('Saved Share renamed.png')
    await page.getByRole('button', { name: 'Close export', exact: true }).click()
    expect(await app.evaluate(() => Reflect.get(globalThis, 'saveSuggestions'))).toEqual(['Weekend edit.deepfryer', 'Extra crispy.frypreset', 'Share renamed.png'])
    await expect(page.locator('.filename')).toHaveText('original.png')
    const before = await page.getByLabel('Edited full resolution image canvas').evaluate((canvas) => canvas instanceof HTMLCanvasElement ? canvas.toDataURL() : '')
    await page.getByRole('button', { name: 'File', exact: true }).click()
    await page.getByRole('button', { name: 'Save project as…' }).click()
    await expect(page.getByRole('textbox', { name: 'Project name' })).toHaveValue('Weekend edit')
    await page.keyboard.press('Escape')
    expect(await app.evaluate(() => Reflect.get(globalThis, 'saveSuggestions').length)).toBe(3)
    await app.evaluate(({ dialog }) => { dialog.showSaveDialog = async () => ({ canceled: true, filePath: '' }) })
    await fileAction(page, 'Save preset as…')
    await expect(page.locator('.notice')).toContainText('Preset save canceled')
    expect(await page.getByLabel('Edited full resolution image canvas').evaluate((canvas) => canvas instanceof HTMLCanvasElement ? canvas.toDataURL() : '')).toBe(before)
    expect(await readFile(join(folder, 'Weekend edit.deepfryer'), 'utf8')).not.toContain('appearance')
    expect(errors).toEqual([])
  } finally { await app.close(); await rm(folder, { recursive: true, force: true }) }
})

test('unreadable settings show defaults and remain intact until Reset saved settings', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'deep-fryer-corrupt-settings-'))
  const file = join(profile, 'appearance.json')
  const bytes = '{"version":999,"future":"keep"}'
  await writeFile(file, bytes)
  const app = await launch(profile)
  try {
    const page = await app.firstWindow()
    await page.getByRole('button', { name: /Settings/ }).click()
    await expect(page.getByRole('alert')).toContainText('Defaults are active')
    expect(await readFile(file, 'utf8')).toBe(bytes)
    await page.getByRole('button', { name: 'Reset saved settings', exact: true }).click()
    await expect(page.getByRole('alert')).toHaveCount(0)
    expect(JSON.parse(await readFile(file, 'utf8')).version).toBe(1)
  } finally { await app.close(); await rm(profile, { recursive: true, force: true }) }
})
