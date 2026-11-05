import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { chmod, copyFile, mkdtemp, readFile, readdir, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { PNG } from 'pngjs'
import { CURRENT_PROJECT_VERSION, encodeProject, parseProject } from '../../src/main/document-files'
import { newPreset } from '../../src/shared/preset'
import { newEdit } from '../../src/shared/edit'
import { projectTargetIdSchema } from '../../src/shared/documents'
import { randomUUID } from 'node:crypto'
import { section, PROJECT_FILE_OPERATION_MS, projectSaved, traceElectron, finishElectronTrace, fileOperationComplete, chooseUnsaved, controls, fileAction, ready } from './ui'
import { aclFixture } from '../windows-acl-fixture'
import type { FileHandle } from 'node:fs/promises'

const ownedApplications = new WeakMap<ElectronApplication, { launcher: ReturnType<ElectronApplication['process']>; pids: number[] }>()

async function setup() {
  const folder = await mkdtemp(join(tmpdir(), 'deep-fryer-ordinary-save-'))
  const source = join(folder, 'source.png')
  const a = join(folder, 'a.deepfryer')
  const b = join(folder, 'b.deepfryer')
  const png = new PNG({ width: 48, height: 32 })
  png.data.fill(180)
  const bytes = PNG.sync.write(png)
  await writeFile(source, bytes)
  await writeFile(a, encodeProject({ source: { name: 'source.png', mime: 'image/png', bytes: new Uint8Array(bytes) }, edit: newEdit({ ...newPreset(), seed: 123456 }) }))
  await writeFile(b, encodeProject({ source: { name: 'candidate.png', mime: 'image/png', bytes: new Uint8Array(bytes) }, edit: newEdit({ ...newPreset(), seed: 234567 }) }))
  const executable = process.env.DEEP_FRYER_EXECUTABLE ?? process.env.ELECTRON_EXECUTABLE_PATH
  const app = await electron.launch({ ...(executable ? { executablePath: executable } : {}),
    args: [...(process.env.DEEP_FRYER_EXECUTABLE ? [] : [resolve('.')]), `--user-data-dir=${join(folder, 'profile')}`],
    env: { ...process.env, ELECTRON_RENDERER_URL: '' } })
  await traceElectron(app)
  const launcher = app.process()
  const page = await app.firstWindow()
  const runtime = await app.evaluate(({ app }) => ({ mainPid: process.pid, executable: process.execPath, ownedPids: app.getAppMetrics().map(({ pid }) => pid) }))
  ownedApplications.set(app, { launcher, pids: runtime.ownedPids })
  await writeFile(test.info().outputPath('runtime.json'), JSON.stringify({ folder, pid: launcher.pid, ...runtime }))
  await expect(page.locator('.open-button')).toBeEnabled()
  return { folder, source, a, b, bytes, app, page }
}

async function selectOpen(app: ElectronApplication, path: string): Promise<void> {
  await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }) }, path)
}

async function openProject(app: ElectronApplication, page: Page, path: string): Promise<void> {
  await selectOpen(app, path)
  await fileAction(page, 'Open project')
  await fileOperationComplete(page)
  await ready(page)
}

async function selectSave(app: ElectronApplication, path: string | null): Promise<void> {
  await app.evaluate(({ dialog }, path) => { dialog.showSaveDialog = async () => ({ canceled: path === null, filePath: path ?? '' }) }, path)
}

async function forbidChooser(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ dialog }) => { dialog.showSaveDialog = async () => { throw new Error('Unexpected save chooser for an authorized project') } })
}

async function edit(page: Page, value: string): Promise<void> {
  const input = (await controls(page)).getByRole('spinbutton', { name: 'Brightness value' })
  await input.fill(value)
  await input.blur()
  await ready(page)
  await expect(page.getByLabel('Unsaved project', { exact: true })).toBeVisible()
}

async function save(page: Page): Promise<void> {
  await page.keyboard.press('Control+s')
  await projectSaved(page)
  await ready(page)
  await expect(page.getByRole('dialog', { name: 'Save project as', exact: true })).toHaveCount(0)
}

async function caption(page: Page, top: string): Promise<void> {
  await section(page, 'Captions')
  await page.getByRole('textbox', { name: 'Top caption', exact: true }).fill(top)
  await page.getByRole('textbox', { name: 'Bottom caption', exact: true }).fill('BOTTOM')
  await page.getByRole('textbox', { name: 'Bottom caption', exact: true }).blur()
}

async function cleanup(app: ElectronApplication, folder: string): Promise<void> {
  await finishElectronTrace(app)
  const owned = ownedApplications.get(app)
  if (!owned) throw new Error(`Electron launch ownership is missing; retained ${folder}`)
  const child = owned.launcher
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([(async () => {
      if (app.windows().length) await chooseUnsaved(app, 'discard')
      await app.close()
    })(), new Promise<never>((_, reject) => {
      timeout = setTimeout(() => reject(new Error(`Electron close timed out; retained ${folder}`)), 10_000)
    })])
    await expect.poll(() => child.exitCode !== null || child.signalCode !== null).toBe(true)
    const ownedPids = owned.pids
    await expect.poll(() => ownedPids.filter(pid => {
      try { process.kill(pid, 0); return true } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ESRCH') return false
        throw error
      }
    })).toEqual([])
    await rm(folder, { recursive: true, force: true })
    await writeFile(test.info().outputPath('teardown.json'), JSON.stringify({ pid: child.pid, ownedPids, exitCode: child.exitCode, signal: child.signalCode, profileRemoved: true }))
  } finally { clearTimeout(timeout) }
}

test('first Ctrl+S chooses a project, repeated Ctrl+S saves exact edits and undo returns to the saved baseline', async () => {
  const { folder, source, bytes, app, page } = await setup()
  try {
    await selectOpen(app, source)
    await fileAction(page, 'Open image')
    await ready(page)
    const path = join(folder, 'first.deepfryer')
    await selectSave(app, path)
    await page.keyboard.press('Control+s')
    await expect(page.getByRole('dialog', { name: 'Save project as', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Save as…', exact: true }).click()
    await fileOperationComplete(page)
    await expect(page.getByLabel('Unsaved project', { exact: true })).toHaveCount(0)
    await forbidChooser(app)
    for (const value of ['25', '50']) {
      await edit(page, value)
      await save(page)
      const saved = parseProject(await readFile(path, 'utf8'))
      expect(saved.edit.preset.effects[0]).toMatchObject({ kind: 'brightness', value: Number(value) })
      expect(Buffer.from(saved.source.bytes)).toEqual(bytes)
    }
    await edit(page, '75')
    await page.getByRole('button', { name: 'Undo', exact: true }).click()
    await ready(page)
    await expect(page.getByLabel('Unsaved project', { exact: true })).toHaveCount(0)
    await page.getByRole('button', { name: 'Redo', exact: true }).click()
    await ready(page)
    await expect(page.getByLabel('Unsaved project', { exact: true })).toBeVisible()
    const saved = parseProject(await readFile(path, 'utf8'))
    await chooseUnsaved(app, 'discard')
    await openProject(app, page, path)
    await save(page)
    expect(parseProject(await readFile(path, 'utf8'))).toEqual(saved)
    expect(await readFile(source)).toEqual(bytes)
  } finally { await cleanup(app, folder) }
})

test('native Open authorizes Save and explicit Save As switches the target only after success', async () => {
  const { folder, a, b, app, page } = await setup()
  try {
    await openProject(app, page, a)
    await forbidChooser(app)
    await edit(page, '25')
    await save(page)
    const aSaved = await readFile(a)
    for (const destination of [null, b]) {
      const originalB = await readFile(b)
      await selectSave(app, destination)
      await fileAction(page, 'Save project as…')
      await fileOperationComplete(page)
      await expect(page.getByRole('status')).toContainText(destination ? 'already exists' : 'Project save canceled')
      expect(await readFile(b)).toEqual(originalB)
      await expect(page.getByLabel('Unsaved project', { exact: true })).toHaveCount(0)
    }
    const copy = join(folder, 'copy.deepfryer')
    await selectSave(app, copy)
    await fileAction(page, 'Save project as…')
    await fileOperationComplete(page)
    await expect(page.getByRole('status')).toContainText('Saved copy.deepfryer')
    await forbidChooser(app)
    await edit(page, '50')
    await save(page)
    expect(await readFile(a)).toEqual(aSaved)
    expect(parseProject(await readFile(copy, 'utf8')).edit.preset.effects[0]).toMatchObject({ value: 50 })
  } finally { await cleanup(app, folder) }
})

test('caption-only ordinary Save is clean, reopens exact text, and keeps caption undo history', async () => {
  const { folder, a, bytes, app, page } = await setup()
  try {
    await openProject(app, page, a)
    const before = parseProject(await readFile(a, 'utf8'))
    await forbidChooser(app)
    await caption(page, 'CAPTION ONLY')
    await ready(page)
    await expect(page.getByLabel('Unsaved project', { exact: true })).toBeVisible()
    await save(page)
    const saved = parseProject(await readFile(a, 'utf8'))
    expect(saved.edit.composition.captions).toMatchObject({ top: 'CAPTION ONLY', bottom: 'BOTTOM' })
    expect(saved.edit.preset).toEqual(before.edit.preset)
    expect(Buffer.from(saved.source.bytes)).toEqual(bytes)
    await page.getByRole('button', { name: 'Undo', exact: true }).click()
    await ready(page)
    await expect(page.getByLabel('Unsaved project', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Redo', exact: true }).click()
    await ready(page)
    await expect(page.getByLabel('Unsaved project', { exact: true })).toHaveCount(0)
    await openProject(app, page, a)
    await section(page, 'Captions')
    await expect(page.getByRole('textbox', { name: 'Top caption', exact: true })).toHaveValue('CAPTION ONLY')
    await expect(page.getByRole('textbox', { name: 'Bottom caption', exact: true })).toHaveValue('BOTTOM')
    expect(parseProject(await readFile(a, 'utf8'))).toEqual(saved)
    await page.screenshot({ path: test.info().outputPath('caption-ordinary-save.png') })
  } finally { await cleanup(app, folder) }
})

test('a delayed Save As writes the complete caption snapshot and later edits stay unsaved', async () => {
  const { folder, a, bytes, app, page } = await setup()
  try {
    await openProject(app, page, a)
    const original = await readFile(a)
    await caption(page, 'SNAPSHOT')
    await ready(page)
    const copy = join(folder, 'delayed.deepfryer')
    await app.evaluate(({ dialog }, path) => {
      dialog.showSaveDialog = () => new Promise(resolve => {
        Reflect.set(globalThis, '__releaseSave', () => resolve({ canceled: false, filePath: path }))
      })
    }, copy)
    await fileAction(page, 'Save project as…')
    await expect.poll(() => app.evaluate(() => typeof Reflect.get(globalThis, '__releaseSave'))).toBe('function')
    await expect(page.getByRole('textbox', { name: 'Top caption', exact: true })).toBeDisabled()
    await expect(page.getByLabel('Unsaved project', { exact: true })).toBeVisible()
    expect(await readFile(copy).then(() => true).catch(() => false)).toBe(false)
    await app.evaluate(() => {
      const release = Reflect.get(globalThis, '__releaseSave')
      if (typeof release !== 'function') throw new Error('Save chooser was not pending')
      release()
    })
    await fileOperationComplete(page)
    await expect(page.getByRole('status')).toContainText('Saved delayed.deepfryer')
    await expect(page.getByLabel('Unsaved project', { exact: true })).toHaveCount(0)
    const submitted = parseProject(await readFile(copy, 'utf8'))
    expect(submitted.edit.composition.captions).toMatchObject({ top: 'SNAPSHOT', bottom: 'BOTTOM' })
    expect(Buffer.from(submitted.source.bytes)).toEqual(bytes)
    await caption(page, 'LATER EDIT')
    await ready(page)
    await expect(page.getByLabel('Unsaved project', { exact: true })).toBeVisible()
    expect(parseProject(await readFile(copy, 'utf8'))).toEqual(submitted)
    expect(await readFile(a)).toEqual(original)
  } finally { await cleanup(app, folder) }
})

test('unrenderable captions ordinary-save and reopen clean with all words retained', async () => {
  const { folder, a, app, page } = await setup()
  try {
    await openProject(app, page, a)
    await forbidChooser(app)
    const text = 'Keep\nfour\nlines\nand 🙂'
    await caption(page, text)
    await expect(page.locator('.caption-controls [role=alert]')).toContainText('Anton does not include')
    await expect(page.getByRole('button', { name: 'Export', exact: true })).toBeDisabled()
    await fileAction(page, 'Save project')
    await fileOperationComplete(page)
    await expect(page.getByRole('status')).toContainText('Saved a.deepfryer')
    await expect(page.getByLabel('Unsaved project', { exact: true })).toHaveCount(0)
    expect(parseProject(await readFile(a, 'utf8')).edit.composition.captions).toMatchObject({ top: text, bottom: 'BOTTOM' })
    await selectOpen(app, a)
    await fileAction(page, 'Open project')
    await expect(page.getByRole('status')).toContainText('Anton does not include')
    await expect(page.getByRole('textbox', { name: 'Top caption', exact: true })).toHaveValue(text)
    await expect(page.getByRole('textbox', { name: 'Bottom caption', exact: true })).toHaveValue('BOTTOM')
    await expect(page.getByLabel('Unsaved project', { exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Export', exact: true })).toBeDisabled()
    await caption(page, 'REPAIRED TEXT')
    await ready(page)
    await save(page)
    expect(parseProject(await readFile(a, 'utf8')).edit.composition.captions?.top).toBe('REPAIRED TEXT')
  } finally { await cleanup(app, folder) }
})

test('ordinary Save refuses an incomplete IME composition and invalid caption draft without changing disk', async () => {
  const { folder, a, app, page } = await setup()
  try {
    await openProject(app, page, a)
    await forbidChooser(app)
    await caption(page, 'VALID')
    await ready(page)
    await save(page)
    const before = await readFile(a)
    const top = page.getByRole('textbox', { name: 'Top caption', exact: true })
    await top.focus()
    await top.press('Control+a')
    const session = await app.context().newCDPSession(page)
    await session.send('Input.imeSetComposition', { text: 'café', selectionStart: 4, selectionEnd: 4 })
    await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true })))
    await expect(page.getByRole('status')).toContainText('Finish composing the caption')
    expect(await readFile(a)).toEqual(before)
    await expect(top).toHaveValue('café')
    await session.send('Input.insertText', { text: 'café' })
    await top.blur()
    await ready(page)
    await save(page)
    const valid = await readFile(a)
    await top.evaluate(element => {
      if (!(element instanceof HTMLTextAreaElement)) throw new Error('Caption field missing')
      element.value = 'x'.repeat(513)
      element.dispatchEvent(new InputEvent('input', { bubbles: true }))
    })
    await page.keyboard.press('Control+s')
    await expect(page.locator('.caption-controls [role=alert]')).toContainText('512')
    expect(await readFile(a)).toEqual(valid)
    await expect(top).toHaveValue('x'.repeat(513))
    await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0]?.close() })
    await expect(top).toHaveValue('x'.repeat(513))
    expect(page.isClosed()).toBe(false)
    expect(await readFile(a)).toEqual(valid)
    await top.fill('café')
    await top.blur()
    await ready(page)
    await expect(page.getByLabel('Unsaved project', { exact: true })).toHaveCount(0)
  } finally { await cleanup(app, folder) }
})

for (const outcome of ['save', 'cancel', 'discard', 'invalid', 'publish-failure', 'save-conflict'] as const) {
  test(`candidate B ${outcome} keeps A's save authority until successful replacement`, async () => {
    const { folder, a, b, app, page } = await setup()
    try {
      await openProject(app, page, a)
      const aBefore = await readFile(a)
      const bBefore = await readFile(b)
      await forbidChooser(app)
      await edit(page, '25')
      if (outcome === 'invalid') await writeFile(b, '{broken')
      if (outcome === 'publish-failure') await page.evaluate(() => {
        const create = window.createImageBitmap
        window.createImageBitmap = async () => { window.createImageBitmap = create; throw new Error('Injected candidate preparation failure') }
      })
      if (outcome === 'save-conflict') await writeFile(a, aBefore.toString('utf8').replace('123456', '987654'))
      if (outcome === 'invalid' || outcome === 'publish-failure') {
        await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => { throw new Error('Invalid candidate must not ask to leave A') } })
      } else await chooseUnsaved(app, outcome === 'save-conflict' ? 'save' : outcome)
      await selectOpen(app, b)
      await fileAction(page, 'Open project')
      await fileOperationComplete(page)
      await ready(page)
      if (outcome === 'save' || outcome === 'discard') {
        await expect(page.locator('.filename')).toHaveText('candidate.png')
        expect(await readFile(b)).toEqual(bBefore)
        if (outcome === 'save') expect(parseProject(await readFile(a, 'utf8')).edit.preset.effects[0]).toMatchObject({ value: 25 })
        else expect(await readFile(a)).toEqual(aBefore)
        await edit(page, '50')
        await save(page)
        expect(parseProject(await readFile(b, 'utf8')).edit.preset.effects[0]).toMatchObject({ value: 50 })
      } else {
        await expect(page.locator('.filename')).toHaveText('source.png')
        await expect(page.getByLabel('Unsaved project', { exact: true })).toBeVisible()
        await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeEnabled()
        if (outcome === 'save-conflict') {
          await expect(page.getByRole('status')).toContainText('changed outside')
          expect(await readFile(a, 'utf8')).toBe(aBefore.toString('utf8').replace('123456', '987654'))
          expect(await readFile(b)).toEqual(bBefore)
        } else {
          await save(page)
          expect(parseProject(await readFile(a, 'utf8')).edit.preset.effects[0]).toMatchObject({ value: 25 })
        }
      }
    } finally { await cleanup(app, folder) }
  })
}

for (const change of ['same-size', 'missing', 'readonly'] as const) {
  test(`a ${change} target blocks ordinary Save and close Save, retains undo baseline, and allows a separate copy`, async () => {
    const { folder, a, app, page } = await setup()
    try {
      await openProject(app, page, a)
      const before = await readFile(a, 'utf8')
      await edit(page, '25')
      if (change === 'same-size') await writeFile(a, before.replace('123456', '987654'))
      if (change === 'missing') await unlink(a)
      if (change === 'readonly') await chmod(a, 0o444)
      await forbidChooser(app)
      await page.keyboard.press('Control+s')
      const message = change === 'same-size' ? 'changed outside' : change === 'missing' ? 'moved or deleted' : 'read-only'
      await expect(page.getByRole('status')).toContainText(message)
      await chooseUnsaved(app, 'save')
      await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0]?.close() })
      await ready(page)
      expect(page.isClosed()).toBe(false)
      await expect(page.getByLabel('Unsaved project', { exact: true })).toBeVisible()
      await page.getByRole('button', { name: 'Undo', exact: true }).click()
      await ready(page)
      await expect(page.getByLabel('Unsaved project', { exact: true })).toHaveCount(0)
      await page.getByRole('button', { name: 'Redo', exact: true }).click()
      await ready(page)
      const copy = join(folder, 'separate.deepfryer')
      await selectSave(app, copy)
      await fileAction(page, 'Save project as…')
      await fileOperationComplete(page)
      await expect(page.getByRole('status')).toContainText('Saved separate.deepfryer')
      expect(parseProject(await readFile(copy, 'utf8')).edit.preset.effects[0]).toMatchObject({ value: 25 })
      if (change === 'missing') expect(await readFile(a).then(() => true).catch(() => false)).toBe(false)
      else expect(await readFile(a, 'utf8')).toBe(change === 'same-size' ? before.replace('123456', '987654') : before)
      expect((await readdir(folder)).some((name) => name.endsWith('.tmp'))).toBe(false)
    } finally { await chmod(a, 0o666).catch(() => {}); await cleanup(app, folder) }
  })
}

for (const version of ['v1', 'v2']) test(`${version} Ctrl+S creates a v3 copy and never writes the legacy project`, async () => {
  const { folder, app, page } = await setup()
  try {
    const legacy = join(folder, 'legacy.deepfryer')
    await copyFile(`tests/fixtures/${version}/baseline.deepfryer`, legacy)
    const original = await readFile(legacy)
    await openProject(app, page, legacy)
    await edit(page, '25')
    const copy = join(folder, 'upgraded.deepfryer')
    await selectSave(app, copy)
    await page.keyboard.press('Control+s')
    await expect(page.getByRole('dialog', { name: 'Save project as', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Save as…', exact: true }).click()
    await fileOperationComplete(page)
    await expect(page.getByLabel('Unsaved project', { exact: true })).toHaveCount(0)
    expect(JSON.parse(await readFile(copy, 'utf8')).version).toBe(CURRENT_PROJECT_VERSION)
    await forbidChooser(app)
    await edit(page, '50')
    await save(page)
    expect(await readFile(legacy)).toEqual(original)
  } finally { await cleanup(app, folder) }
})

test('Save in the File menu updates the authorized project and a native close uses the same target', async () => {
  const { folder, a, app, page } = await setup()
  try {
    await openProject(app, page, a)
    await forbidChooser(app)
    await edit(page, '25')
    await fileAction(page, 'Save project')
    await fileOperationComplete(page)
    await expect(page.getByLabel('Unsaved project', { exact: true })).toHaveCount(0)
    expect(parseProject(await readFile(a, 'utf8')).edit.preset.effects[0]).toMatchObject({ value: 25 })
    await edit(page, '50')
    await chooseUnsaved(app, 'cancel')
    await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0]?.close() })
    await ready(page)
    await expect(page.getByLabel('Unsaved project', { exact: true })).toBeVisible()
    await chooseUnsaved(app, 'save')
    await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0]?.close() }).catch(() => {})
    await expect.poll(() => page.isClosed(), { timeout: PROJECT_FILE_OPERATION_MS }).toBe(true)
    expect(parseProject(await readFile(a, 'utf8')).edit.preset.effects[0]).toMatchObject({ value: 50 })
    await app.close()
  } finally { await cleanup(app, folder) }
})

test('close queued while candidate B is selected saves A before adopting B and closes cleanly', async () => {
  // Keep the normal budget for setup, edits, assertions and teardown, plus the
  // initial Open and queued Open/Save, each with its existing operation budget.
  test.setTimeout(test.info().timeout + 3 * PROJECT_FILE_OPERATION_MS)
  const { folder, a, b, app, page } = await setup()
  const child = app.process()
  try {
    await openProject(app, page, a)
    await forbidChooser(app)
    await edit(page, '25')
    await caption(page, 'KEEP A')
    await ready(page)
    const candidate = parseProject(await readFile(b, 'utf8'))
    candidate.edit.composition = { captions: { kind: 'top-bottom-v1', font: 'anton-regular-v1', top: 'KEEP B', bottom: 'B BOTTOM', size: 0.1 } }
    await writeFile(b, encodeProject(candidate))
    const bBefore = await readFile(b)
    await app.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = () => new Promise((resolve) => {
        Reflect.set(globalThis, '__releaseCandidate', () => resolve({ canceled: false, filePaths: [path] }))
      })
    }, b)
    await fileAction(page, 'Open project')
    await expect.poll(() => app.evaluate(() => typeof Reflect.get(globalThis, '__releaseCandidate'))).toBe('function')
    await chooseUnsaved(app, 'save')
    await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0]?.close() })
    expect(child.exitCode).toBeNull()
    await app.evaluate(() => {
      const release = Reflect.get(globalThis, '__releaseCandidate')
      if (typeof release !== 'function') throw new Error('Missing candidate chooser')
      release()
    })
    await expect.poll(() => page.isClosed(), { timeout: 2 * PROJECT_FILE_OPERATION_MS }).toBe(true)
    expect(parseProject(await readFile(a, 'utf8')).edit.preset.effects[0]).toMatchObject({ value: 25 })
    expect(parseProject(await readFile(a, 'utf8')).edit.composition.captions).toMatchObject({ top: 'KEEP A', bottom: 'BOTTOM' })
    expect(await readFile(b)).toEqual(bBefore)
  } finally { await cleanup(app, folder) }
})

test('preload exposes only opaque target and basename and rejects unknown or released save authority', async () => {
  const { folder, a, app, page } = await setup()
  try {
    const before = await readFile(a)
    await selectOpen(app, a)
    const result = await page.evaluate(async (unknownTarget) => {
      const opened = await window.documentBridge.openProject()
      if (!opened?.target) throw new Error('Missing target')
      const targetKeys = Object.keys(opened.target).sort()
      const keys = Object.keys(opened).sort()
      await window.documentBridge.releaseProjectTarget(opened.target.id)
      const released = await window.documentBridge.saveProject({ document: opened.document, target: opened.target.id })
      const unknown = await window.documentBridge.saveProject({ document: opened.document, target: unknownTarget })
      return { targetKeys, keys, name: opened.target.name, released, unknown }
    }, projectTargetIdSchema.parse(randomUUID()))
    expect(result).toEqual({ targetKeys: ['id', 'name'], keys: ['document', 'target'], name: 'a.deepfryer',
      released: { kind: 'conflict', reason: 'stale' }, unknown: { kind: 'conflict', reason: 'stale' } })
    expect(await readFile(a)).toEqual(before)
  } finally { await cleanup(app, folder) }
})

test('Windows protected project keeps its DACL before first temporary write and after Ctrl+S', async () => {
  const { folder, a, source, bytes, app, page } = await setup()
  try {
    await aclFixture(folder, 'broaden-directory')
    const security = await aclFixture(a, 'private')
    await openProject(app, page, a)
    await forbidChooser(app)
    await app.evaluate(async (_, { folder, path, security }) => {
      const fs = process.getBuiltinModule('fs/promises')
      const { join } = process.getBuiltinModule('path')
      const { execFileSync } = process.getBuiltinModule('child_process')
      const probe = await fs.open(path, 'r')
      const prototype = Object.getPrototypeOf(probe)
      const write: FileHandle['writeFile'] = prototype.writeFile
      await probe.close()
      const observations: { size: number; security: string }[] = []
      prototype.writeFile = async function(this: FileHandle, ...args: Parameters<FileHandle['writeFile']>) {
        const stat = await this.stat()
        for (const name of await fs.readdir(folder)) {
          if (!name.startsWith('.deep-fryer-') || !name.endsWith('.tmp')) continue
          const temporary = join(folder, name)
          if ((await fs.stat(temporary)).ino !== stat.ino) continue
          const command = "[Console]::Write([IO.File]::GetAccessControl($env:DF_ACL_PATH, 'Access,Owner,Group').GetSecurityDescriptorSddlForm([Security.AccessControl.AccessControlSections]'Access,Owner,Group'))"
          const actual = execFileSync(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe'),
            ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(command, 'utf16le').toString('base64')],
            { windowsHide: true, timeout: 10000, encoding: 'utf8', env: { ...process.env, DF_ACL_PATH: temporary } }).trim().replace(/D:(P?)(AI|AR)+/g, 'D:$1')
          if (stat.size !== 0 || actual !== security) throw new Error('Temporary content would be written with incorrect Windows permissions')
          observations.push({ size: stat.size, security: actual })
          Reflect.set(globalThis, '__ordinarySaveAclProof', observations)
        }
        return write.apply(this, args)
      }
    }, { folder, path: a, security })
    for (const value of ['25', '50']) { await edit(page, value); await save(page) }
    expect(await aclFixture(a, 'read')).toBe(security)
    expect(await readFile(source)).toEqual(bytes)
    const receipt = await app.evaluate(({ app }) => ({ packaged: app.isPackaged, versions: process.versions,
      executable: process.execPath, observed: Reflect.get(globalThis, '__ordinarySaveAclProof') }))
    expect(receipt.observed).toEqual([{ size: 0, security }, { size: 0, security }])
    await writeFile(test.info().outputPath('acl-security.json'), JSON.stringify({ security, ...receipt }, null, 2))
  } finally { await cleanup(app, folder) }
})

test('unavailable Windows security helper retains the edit and baseline and permits exclusive Save As', async () => {
  const { folder, a, app, page } = await setup()
  let system: string | undefined
  try {
    await openProject(app, page, a)
    await forbidChooser(app)
    await edit(page, '25')
    const before = await readFile(a)
    system = await app.evaluate((_, folder) => { const system = process.env.SystemRoot; process.env.SystemRoot = folder; return system }, folder)
    await page.keyboard.press('Control+s')
    await expect(page.getByRole('status')).toContainText('Save As')
    await expect(page.getByLabel('Unsaved project', { exact: true })).toBeVisible()
    expect(await readFile(a)).toEqual(before)
    expect((await readdir(folder)).filter((name) => name.endsWith('.tmp'))).toEqual([])
    await page.getByRole('button', { name: 'Undo', exact: true }).click()
    await ready(page)
    await expect(page.getByLabel('Unsaved project', { exact: true })).toHaveCount(0)
    await page.getByRole('button', { name: 'Redo', exact: true }).click()
    await ready(page)
    await selectSave(app, join(folder, 'copy.deepfryer'))
    await fileAction(page, 'Save project as…')
    await fileOperationComplete(page)
    await expect(page.getByLabel('Unsaved project', { exact: true })).toHaveCount(0)
    expect(await readFile(a)).toEqual(before)
  } finally {
    if (system) await app.evaluate((_, system) => { process.env.SystemRoot = system }, system)
    await cleanup(app, folder)
  }
})
