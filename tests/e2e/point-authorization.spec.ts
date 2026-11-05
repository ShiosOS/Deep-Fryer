import { expect, test, type ElectronApplication, type Locator, type Page, type TestInfo } from '@playwright/test'
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { parseProject } from '../../src/main/document-files'
import { RecoveryEvidence } from './recovery-evidence'
import { controls, interruptForRecovery, ready, section } from './ui'

async function withEditor(info: TestInfo, run: (app: ElectronApplication, page: Page, folder: string) => Promise<void>) {
  const folder = await mkdtemp(join(tmpdir(), 'deep-fryer-point-guard-'))
  const evidence = await RecoveryEvidence.create(info, folder)
  let app: ElectronApplication | undefined
  let failed = false
  try {
    app = await evidence.launchObserved()
    const page = await app.firstWindow()
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    const doctor = await app.evaluate(({ app, BrowserWindow }) => ({
      packaged: app.isPackaged, executable: process.execPath, version: app.getVersion(),
      profile: app.getPath('userData'), url: BrowserWindow.getAllWindows()[0]?.webContents.getURL()
    }))
    expect(doctor.packaged).toBe(!!process.env.DEEP_FRYER_EXECUTABLE)
    expect(doctor.profile).toBe(join(folder, 'profile'))
    expect(doctor.url).toMatch(/^file:/)
    await writeFile(info.outputPath('doctor.json'), JSON.stringify(doctor, null, 2))
    const source = resolve('src/renderer/src/assets/demo/toast-cat.png')
    const original = await readFile(source)
    await page.getByRole('button', { name: 'Try demo', exact: true }).click()
    await ready(page)
    await controls(page)
    await page.getByRole('combobox', { name: 'Add effect' }).selectOption('bulge')
    await ready(page)
    await run(app, page, folder)
    expect(await readFile(source)).toEqual(original)
    expect(errors).toEqual([])
    failed = info.errors.length > 0
    if (failed) await evidence.capture(app, new Error('Point authorization assertions failed'))
  } catch (error) {
    failed = true
    await evidence.capture(app, error)
    throw error
  } finally {
    if (failed && app) await interruptForRecovery(app)
    await evidence.close(failed)
    if (!failed) {
      const actual = await realpath(folder)
      expect(dirname(actual).toLowerCase()).toBe((await realpath(tmpdir())).toLowerCase())
      expect(basename(actual)).toMatch(/^deep-fryer-point-guard-/)
      await rm(actual, { recursive: true })
    }
  }
}

async function checkpoint(folder: string) {
  const path = join(folder, 'profile/recovery/latest.deepfryer')
  await expect.poll(() => readFile(path).then(() => true, (error: unknown) => {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false
    throw error
  })).toBe(true)
  return { path, bytes: await readFile(path) }
}

async function drag(page: Page, handle: Locator) {
  const bounds = await handle.boundingBox()
  if (!bounds) throw new Error('Point bounds missing')
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
  await page.mouse.down()
  await page.mouse.move(bounds.x + bounds.width / 2 + 45, bounds.y + bounds.height / 2 + 12, { steps: 5 })
  await page.mouse.up()
}

async function place(page: Page) {
  const stage = page.getByRole('region', { name: 'Image preview' })
  const bounds = await stage.boundingBox()
  if (!bounds) throw new Error('Preview bounds missing')
  await stage.click({ position: { x: bounds.width * 0.4, y: bounds.height * 0.4 } })
}

for (const draft of ['synthetic overlength caption', 'emulated caption composition', 'invalid numeric in Effects'] as const) {
  test(`${draft} refuses point drag, placement, arrows and delete without changing accepted work`, async ({}, info) => {
    await withEditor(info, async (app, page, folder) => {
      // Arm placement before the draft so the canvas itself must authorize insertion.
      await page.getByRole('button', { name: 'Place point', exact: true }).click()
      const numeric = draft === 'invalid numeric in Effects'
      if (!numeric) await section(page, 'Captions')
      const field = numeric ? page.getByRole('spinbutton', { name: 'Brightness value', exact: true })
        : page.getByRole('textbox', { name: 'Top caption', exact: true })
      await field.focus()
      if (numeric) {
        await field.fill('10')
        await field.fill('20')
        await ready(page)
      }
      const saved = await checkpoint(folder)
      await expect.poll(async () => parseProject((await readFile(saved.path)).toString()).edit.preset.effects[0])
        .toMatchObject({ kind: 'brightness', value: numeric ? 20 : 0 })
      saved.bytes = await readFile(saved.path)
      await expect.poll(async () => parseProject((await readFile(saved.path)).toString()).edit.preset.effects.filter(effect => effect.kind === 'bulge').length).toBe(1)
      saved.bytes = await readFile(saved.path)
      const accepted = parseProject(saved.bytes.toString())
      const pixels = await page.getByLabel('Edited full resolution image canvas').evaluate(canvas => {
        if (!(canvas instanceof HTMLCanvasElement)) throw new Error('Edited canvas missing')
        return canvas.toDataURL()
      })
      const history = { undo: await page.getByRole('button', { name: 'Undo', exact: true }).isEnabled(),
        redo: await page.getByRole('button', { name: 'Redo', exact: true }).isEnabled() }
      const session = await app.context().newCDPSession(page)
      if (numeric) await field.fill('999')
      else if (draft === 'emulated caption composition') {
        await session.send('Input.imeSetComposition', { text: 'café', selectionStart: 4, selectionEnd: 4 })
      } else {
        // Deliberately bypass maxlength to exercise the document boundary, not native typing/IME.
        await field.evaluate(element => {
          if (!(element instanceof HTMLTextAreaElement)) throw new Error('Caption field missing')
          element.value = 'x'.repeat(513)
          element.dispatchEvent(new InputEvent('input', { bubbles: true }))
        })
      }
      const raw = await field.inputValue()
      const count = await page.locator('.effect-card').count()
      const handle = page.getByRole('button', { name: /Distortion point 1/ })
      const x = page.getByRole('spinbutton', { name: 'Bulge x value', exact: true, includeHidden: true })
      const y = page.getByRole('spinbutton', { name: 'Bulge y value', exact: true, includeHidden: true })
      const coordinates = [await x.inputValue(), await y.inputValue()]
      await page.evaluate(() => {
        for (const name of ['gotpointercapture', 'blur', 'compositionend']) document.addEventListener(name, event => {
          const target = event.target
          if (target instanceof HTMLElement && (target.matches('.bulge-handle, .preview-stage, textarea, input'))) {
            document.documentElement.dataset[name] = String(Number(document.documentElement.dataset[name] ?? 0) + 1)
          }
        }, true)
      })
      for (const action of ['drag', 'placement', 'ArrowRight', 'Delete']) {
        if (action === 'drag') await drag(page, handle)
        else if (action === 'placement') await place(page)
        // Route keys to the point while the refusing field remains focused. This emulates
        // event delivery; the valid journey below uses normal focused keyboard input.
        else await handle.dispatchEvent('keydown', { key: action, bubbles: true, cancelable: true })
        await expect.soft(x, action).toHaveValue(coordinates[0] ?? '')
        await expect.soft(y, action).toHaveValue(coordinates[1] ?? '')
        await expect.soft(page.locator('.effect-card'), action).toHaveCount(count)
        await expect.soft(field, action).toHaveValue(raw)
        await expect.soft(field, action).toBeFocused()
        await expect.soft(field, action).toBeVisible()
        await expect.soft(page.getByRole('navigation', { name: 'Editor sections' }).getByRole('button', { name: numeric ? 'Effects' : 'Captions', exact: true }), action).toHaveAttribute('aria-pressed', 'true')
        await expect.soft(page.locator('.section-error'), action).toContainText(numeric ? 'valid Brightness' : draft === 'emulated caption composition' ? 'Finish composing' : '512')
        if (info.errors.length) return
      }
      const events = await page.evaluate(() => ['gotpointercapture', 'blur', 'compositionend'].map(name => Number(document.documentElement.dataset[name] ?? 0)))
      expect.soft(events).toEqual([0, 0, 0])
      await page.waitForTimeout(1100)
      expect.soft(await readFile(saved.path)).toEqual(saved.bytes)
      expect.soft(await page.getByLabel('Edited full resolution image canvas').evaluate(canvas => canvas instanceof HTMLCanvasElement ? canvas.toDataURL() : '')).toBe(pixels)
      expect.soft({ undo: await page.getByRole('button', { name: 'Undo', exact: true }).isEnabled(),
        redo: await page.getByRole('button', { name: 'Redo', exact: true }).isEnabled() }).toEqual(history)
      await writeFile(info.outputPath('refusal.json'), JSON.stringify({ draft, raw, coordinates, count, events, history, acceptedEdit: accepted.edit }, null, 2))
      if (info.errors.length) return
      if (draft === 'emulated caption composition') await session.send('Input.insertText', { text: 'café' })
      else await field.fill(numeric ? '25' : '')
      await section(page, 'Look')
      await ready(page)
      const undo = page.getByRole('button', { name: 'Undo', exact: true })
      const redo = page.getByRole('button', { name: 'Redo', exact: true })
      if (numeric || draft === 'emulated caption composition') {
        await undo.click()
        await ready(page)
        await expect(field).toHaveValue(numeric ? '0' : '')
      }
      await undo.click()
      await ready(page)
      await expect(page.locator('.bulge-handle')).toHaveCount(0)
      await expect(undo).toBeDisabled()
      await redo.click()
      await ready(page)
      await expect(x).toHaveValue(coordinates[0] ?? '')
      if (numeric || draft === 'emulated caption composition') {
        await redo.click()
        await ready(page)
        await expect(field).toHaveValue(numeric ? '25' : 'café')
      }
      await expect(redo).toBeDisabled()
    })
  })
}

test('authorized points keep one undo per drag, keyboard edits and placement, and exact source bytes', async ({}, info) => {
  await withEditor(info, async (_app, page, folder) => {
    const handle = page.getByRole('button', { name: /Distortion point 1/ })
    const x = page.getByRole('spinbutton', { name: 'Bulge x value', exact: true, includeHidden: true })
    const y = page.getByRole('spinbutton', { name: 'Bulge y value', exact: true, includeHidden: true })
    const undo = page.getByRole('button', { name: 'Undo', exact: true })
    const redo = page.getByRole('button', { name: 'Redo', exact: true })
    await section(page, 'Captions')
    await page.getByRole('textbox', { name: 'Top caption', exact: true }).fill('KEPT')
    await drag(page, handle)
    await ready(page)
    await expect(handle).toBeFocused()
    await expect(page.getByRole('navigation').getByRole('button', { name: 'Effects', exact: true })).toHaveAttribute('aria-pressed', 'true')
    const moved = [await x.inputValue(), await y.inputValue()]
    expect(moved).not.toEqual(['50', '50'])
    await undo.click()
    await ready(page)
    await expect(x).toHaveValue('50')
    await expect(y).toHaveValue('50')
    await expect(page.getByRole('textbox', { name: 'Top caption', exact: true, includeHidden: true })).toHaveValue('KEPT')
    await redo.click()
    await ready(page)
    await expect(x).toHaveValue(moved[0] ?? '')
    await expect(y).toHaveValue(moved[1] ?? '')
    await handle.press('ArrowRight')
    await ready(page)
    await expect(x).toHaveValue(String(Number(moved[0]) + 1))
    await undo.click()
    await ready(page)
    await expect(x).toHaveValue(moved[0] ?? '')
    await handle.press('Delete')
    await ready(page)
    await expect(page.locator('.bulge-handle')).toHaveCount(0)
    await undo.click()
    await ready(page)
    await expect(handle).toBeVisible()
    await page.getByRole('button', { name: 'Place point', exact: true }).click()
    await place(page)
    await ready(page)
    await expect(page.locator('.bulge-handle')).toHaveCount(2)
    await undo.click()
    await ready(page)
    await expect(page.locator('.bulge-handle')).toHaveCount(1)
    await redo.click()
    await ready(page)
    await expect(page.locator('.bulge-handle')).toHaveCount(2)
    const saved = await checkpoint(folder)
    await expect.poll(async () => parseProject((await readFile(saved.path)).toString()).edit.preset.effects.filter(effect => effect.kind === 'bulge').length).toBe(2)
    expect(Buffer.from(parseProject((await readFile(saved.path)).toString()).source.bytes)).toEqual(await readFile(resolve('src/renderer/src/assets/demo/toast-cat.png')))
  })
})
