import { expect, test, type ElectronApplication, type Page, type TestInfo } from '@playwright/test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { RecoveryEvidence } from './recovery-evidence'
import { controls, fileAction, interruptForRecovery, projectSaved, ready, section } from './ui'
import { parseProject } from '../../src/main/document-files'

async function checkpointEdit(path: string) {
  const text = await readFile(path, 'utf8').catch((error: unknown) => {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null
    throw error
  })
  return text === null ? null : parseProject(text).edit
}

async function withEditor(info: TestInfo, run: (app: ElectronApplication, page: Page, folder: string, evidence: RecoveryEvidence) => Promise<void>): Promise<void> {
  const folder = await mkdtemp(join(tmpdir(), 'deep-fryer-sections-'))
  const evidence = await RecoveryEvidence.create(info, folder)
  let app: ElectronApplication | undefined
  let failed = false
  try {
    app = await evidence.launchObserved()
    const page = await app.firstWindow()
    const doctor = await app.evaluate(({ app, BrowserWindow }) => ({
      packaged: app.isPackaged, executable: process.execPath, version: app.getVersion(),
      profile: app.getPath('userData'), url: BrowserWindow.getAllWindows()[0]?.webContents.getURL()
    }))
    expect(doctor.packaged).toBe(!!process.env.DEEP_FRYER_EXECUTABLE)
    expect(doctor.url).toMatch(/^file:/)
    await info.attach('doctor', { body: JSON.stringify(doctor), contentType: 'application/json' })
    await run(app, page, folder, evidence)
    failed = info.errors.length > 0
  } catch (error) {
    failed = true
    await evidence.capture(app, error)
    throw error
  } finally {
    if (failed && app) await interruptForRecovery(app)
    await evidence.close(failed)
    if (!failed) await rm(folder, { recursive: true, force: true })
  }
}

test('primary effect heading and adjustment occupy the usable inspector at actual window bounds', async ({}, info) => {
  await withEditor(info, async (app, page) => {
    const source = resolve('src/renderer/src/assets/demo/toast-cat.png')
    const original = await readFile(source)
    await app.evaluate(({ dialog }, source) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [source] }) }, source)
    await page.getByRole('button', { name: 'Choose an image', exact: true }).click()
    await ready(page)
    await page.getByRole('button', { name: 'Crispy color', exact: true }).click()
    await ready(page)
    await section(page, 'Effects')
    if (await page.locator('.effect-card').first().getAttribute('open') === null) await page.locator('.effect-heading').first().click()
    for (const size of [[900, 620], [1120, 760]]) {
      const [width = 900, height = 620] = size
      const bounds = await app.evaluate(({ BrowserWindow }, { width, height }) => {
        const window = BrowserWindow.getAllWindows()[0]
        if (!window) throw new Error('Editor window missing')
        window.setSize(width, height)
        return { minimum: window.getMinimumSize(), outer: window.getSize(), content: window.getContentSize() }
      }, { width, height })
      expect(bounds.minimum).toEqual([900, 620])
      expect(bounds.outer).toEqual(size)
      await expect.poll(() => page.evaluate(() => [innerWidth, innerHeight])).toEqual(bounds.content)
      for (const theme of ['Light', 'Dark']) {
        await page.getByRole('button', { name: 'Settings', exact: true }).click()
        await page.getByRole('button', { name: theme, exact: true }).click()
        await page.getByRole('button', { name: 'Done', exact: true }).click()
        await expect(page.locator('html')).toHaveAttribute('data-appearance', theme.toLowerCase())
        await page.locator('#inspector-effects').evaluate(element => { element.scrollTop = 0 })
        const geometry = await page.evaluate(() => {
          const bounds = (selector: string) => {
            const box = document.querySelector(selector)?.getBoundingClientRect()
            if (!box) throw new Error(`Missing ${selector}`)
            return { top: box.top, bottom: box.bottom, height: box.height }
          }
          return { sidebar: bounds('.sidebar'), heading: bounds('.effect-heading'),
            adjustment: bounds('.effect-card input[type=range]'), canvas: bounds('.preview-stage'),
            overflow: document.documentElement.scrollWidth > innerWidth || document.documentElement.scrollHeight > innerHeight }
        })
        const name = `${width}x${height}-${theme.toLowerCase()}`
        await page.screenshot({ path: info.outputPath(`${name}.png`) })
        await writeFile(info.outputPath(`${name}.json`), JSON.stringify({ bounds, geometry }, null, 2))
        expect.soft(geometry.heading.top).toBeGreaterThanOrEqual(geometry.sidebar.top)
        expect.soft(geometry.heading.bottom - geometry.sidebar.top).toBeLessThan(geometry.sidebar.height * 0.4)
        expect.soft(geometry.adjustment.bottom).toBeLessThan(geometry.sidebar.bottom - 20)
        expect(geometry.adjustment.height).toBeGreaterThan(0)
        expect(geometry.canvas.height).toBeGreaterThan(300)
        expect(geometry.overflow).toBe(false)
        await expect(page.getByRole('button', { name: 'Export', exact: true })).toBeInViewport()
        await expect(page.locator('.notice')).toBeInViewport()
        await expect(page.locator('.canvas-caption')).toBeInViewport()
      }
    }
    expect(await readFile(source)).toEqual(original)
  })
})

test('caption to look to effects keeps keyboard focus, complete edits and presentation-only navigation across save and recovery', async ({}, info) => {
  test.setTimeout(90_000)
  await withEditor(info, async (app, page, folder, evidence) => {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(900, 620))
    const source = resolve('src/renderer/src/assets/demo/toast-cat.png')
    const original = await readFile(source)
    await page.getByRole('button', { name: 'Try demo', exact: true }).click()
    await ready(page)
    const navigation = page.getByRole('navigation', { name: 'Editor sections' })
    const look = navigation.getByRole('button', { name: 'Look', exact: true })
    const effects = navigation.getByRole('button', { name: 'Effects', exact: true })
    const captions = navigation.getByRole('button', { name: 'Captions', exact: true })
    await expect(look).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByRole('button', { name: 'Crispy color', exact: true })).toBeVisible()
    await look.focus()
    await page.keyboard.press('Tab')
    await expect(effects).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(captions).toBeFocused()
    await page.keyboard.press('Space')
    await expect(captions).toBeFocused()
    await expect(captions).toHaveAttribute('aria-pressed', 'true')
    await page.keyboard.press('Tab')
    const top = page.getByRole('textbox', { name: 'Top caption', exact: true })
    await expect(top).toBeFocused()
    await top.pressSequentially('TOAST')
    await top.press('Shift+Tab')
    await expect(captions).toBeFocused()
    await page.keyboard.press('Shift+Tab')
    await page.keyboard.press('Shift+Tab')
    await expect(look).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(look).toBeFocused()
    await expect(top).toBeHidden()
    await ready(page)
    await page.getByRole('button', { name: 'Undo', exact: true }).click()
    await ready(page)
    await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled()
    await section(page, 'Captions')
    await expect(top).toHaveValue('')
    await page.getByRole('button', { name: 'Redo', exact: true }).click()
    await ready(page)
    await expect(top).toHaveValue('TOAST')
    await section(page, 'Look')
    await page.getByRole('button', { name: 'Crispy color', exact: true }).click()
    await ready(page)
    await expect(look).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('.look-gallery > summary')).toBeFocused()
    await page.locator('.random-locks > summary').click()
    await page.getByRole('checkbox', { name: 'Lock Saturation 3', exact: true }).check()
    await page.locator('.preset-menu > summary').click()
    await section(page, 'Effects')
    await expect(page.locator('.preset-menu')).not.toHaveAttribute('open', '')
    await page.getByRole('combobox', { name: 'Add effect' }).selectOption('bulge')
    await ready(page)
    expect(await page.locator('.effect-card').evaluateAll(cards => cards.map(card => card.getAttribute('data-effect-kind')))).toEqual(['brightness', 'contrast', 'saturation', 'levels', 'sharpen', 'noise', 'jpeg', 'bulge'])
    await page.getByRole('spinbutton', { name: 'Bulge strength value', exact: true }).fill('-40')
    await section(page, 'Look')
    await expect(page.getByRole('checkbox', { name: 'Lock Saturation 3', exact: true })).toBeChecked()
    const handle = page.getByRole('button', { name: 'Distortion point 1, pinch', exact: true })
    await handle.focus()
    await handle.press('Enter')
    await expect(handle).toBeFocused()
    await expect(effects).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByRole('button', { name: 'Select distortion point 1', exact: true })).toBeInViewport()
    await expect(page.getByRole('spinbutton', { name: 'Bulge strength value', exact: true })).toHaveValue('-40')
    await ready(page)
    const destination = join(folder, 'complete.deepfryer')
    await app.evaluate(({ dialog }, destination) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: destination }) }, destination)
    await fileAction(page, 'Save project as…')
    await projectSaved(page)
    const saved = parseProject(await readFile(destination, 'utf8'))
    expect(saved.edit.composition.captions?.top).toBe('TOAST')
    expect(saved.edit.preset.effects.at(-1)).toMatchObject({ kind: 'bulge', strength: -40 })
    expect(Buffer.from(saved.source.bytes)).toEqual(original)
    const checkpoint = join(folder, 'profile/recovery/latest.deepfryer')
    await expect.poll(() => checkpointEdit(checkpoint)).toEqual(saved.edit)
    const recoveryBytes = await readFile(checkpoint)
    const savedBytes = await readFile(destination)
    await section(page, 'Captions')
    await expect(top).toHaveValue('TOAST')
    await section(page, 'Look')
    await section(page, 'Effects')
    await expect(page.getByLabel('Unsaved project')).toHaveCount(0)
    await page.waitForTimeout(1100)
    expect(await readFile(checkpoint)).toEqual(recoveryBytes)
    expect(await readFile(destination)).toEqual(savedBytes)
    await interruptForRecovery(app)
    const recovered = await evidence.launchObserved()
    const restored = await recovered.firstWindow()
    await restored.getByRole('button', { name: 'Restore work', exact: true }).click()
    await ready(restored)
    await section(restored, 'Captions')
    await expect(restored.getByRole('textbox', { name: 'Top caption', exact: true })).toHaveValue('TOAST')
    await controls(restored)
    await expect(restored.getByRole('spinbutton', { name: 'Bulge strength value', exact: true })).toHaveValue('-40')
    await expect.poll(() => checkpointEdit(checkpoint)).toEqual(saved.edit)
    expect(await readFile(source)).toEqual(original)
  })
})

test('unfinished composition and invalid numeric drafts refuse navigation without losing raw text or splitting undo', async ({}, info) => {
  await withEditor(info, async (app, page, folder) => {
    await page.getByRole('button', { name: 'Try demo', exact: true }).click()
    await ready(page)
    await section(page, 'Captions')
    const top = page.getByRole('textbox', { name: 'Top caption', exact: true })
    const look = page.getByRole('navigation', { name: 'Editor sections' }).getByRole('button', { name: 'Look', exact: true })
    await top.focus()
    const session = await app.context().newCDPSession(page)
    await session.send('Input.imeSetComposition', { text: 'café', selectionStart: 4, selectionEnd: 4 })
    await look.click()
    await expect(top).toBeVisible()
    await expect(top).toBeFocused()
    await expect(top).toHaveValue('café')
    await expect(page.locator('.section-error')).toContainText('Finish composing')
    await session.send('Input.insertText', { text: 'café' })
    await section(page, 'Look')
    await ready(page)
    await page.getByRole('button', { name: 'Undo', exact: true }).click()
    await ready(page)
    await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled()
    await section(page, 'Captions')
    await expect(top).toHaveValue('')
    await top.evaluate(element => {
      if (!(element instanceof HTMLTextAreaElement)) throw new Error('Caption field missing')
      element.value = 'x'.repeat(513)
      element.dispatchEvent(new InputEvent('input', { bubbles: true }))
    })
    await look.click()
    await expect(top).toHaveValue('x'.repeat(513))
    await expect(top).toBeFocused()
    await expect(page.locator('.section-error')).toContainText('512')
    await top.fill('')
    await controls(page)
    const brightness = page.getByRole('spinbutton', { name: 'Brightness value', exact: true })
    await brightness.fill('10')
    await brightness.fill('20')
    await ready(page)
    await brightness.fill('999')
    await look.click()
    await expect(brightness).toHaveValue('999')
    await expect(brightness).toBeFocused()
    await expect(page.locator('.section-error')).toContainText('valid Brightness value')
    await expect(page.getByRole('navigation').getByRole('button', { name: 'Effects', exact: true })).toHaveAttribute('aria-pressed', 'true')
    const checkpoint = join(folder, 'profile/recovery/latest.deepfryer')
    await expect.poll(async () => (await checkpointEdit(checkpoint))?.preset.effects[0]).toMatchObject({ kind: 'brightness', value: 20 })
    await brightness.fill('25')
    await section(page, 'Look')
    await ready(page)
    await page.getByRole('button', { name: 'Undo', exact: true }).click()
    await controls(page)
    await expect(brightness).toHaveValue('0')
    await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled()
    for (const draft of ['', '4294967296']) {
      const seed = page.getByRole('spinbutton', { name: 'Noise pattern', exact: true })
      await seed.fill(draft)
      await look.click()
      await expect(seed).toHaveValue(draft)
      await expect(seed).toBeFocused()
      await expect(page.locator('.section-error')).toContainText('valid Noise pattern')
      await page.getByRole('button', { name: 'Reset color', exact: true }).click()
      await expect(seed).toHaveValue(draft)
    }
    await page.getByRole('spinbutton', { name: 'Noise pattern', exact: true }).fill('42')
    await page.getByRole('combobox', { name: 'Add effect' }).selectOption('bulge')
    const coordinate = page.getByRole('spinbutton', { name: 'Bulge x value', exact: true })
    await coordinate.fill('101')
    await look.click()
    await expect(coordinate).toHaveValue('101')
    await expect(coordinate).toBeFocused()
    await coordinate.fill('35')
    await section(page, 'Look')
    await ready(page)
  })
})
