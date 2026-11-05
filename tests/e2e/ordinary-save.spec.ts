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
import { chooseUnsaved, closeDiscardingChanges, controls, fileAction, ready } from './ui'

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
  const page = await app.firstWindow()
  await writeFile(test.info().outputPath('runtime.json'), JSON.stringify({ folder, pid: app.process().pid, executable: await app.evaluate(() => process.execPath) }))
  await expect(page.locator('.open-button')).toBeEnabled()
  return { folder, source, a, b, bytes, app, page }
}

async function selectOpen(app: ElectronApplication, path: string): Promise<void> {
  await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }) }, path)
}

async function openProject(app: ElectronApplication, page: Page, path: string): Promise<void> {
  await selectOpen(app, path)
  await fileAction(page, 'Open project')
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
  await expect(page.getByLabel('Unsaved project', { exact: true })).toHaveCount(0)
  await ready(page)
  await expect(page.getByRole('dialog', { name: 'Save project as', exact: true })).toHaveCount(0)
}

async function cleanup(app: ElectronApplication, folder: string): Promise<void> {
  const child = app.process()
  await closeDiscardingChanges(app)
  await expect.poll(() => child.exitCode).not.toBeNull()
  await rm(folder, { recursive: true, force: true })
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
      await expect(page.getByRole('status')).toContainText(destination ? 'already exists' : 'Project save canceled')
      expect(await readFile(b)).toEqual(originalB)
      await expect(page.getByLabel('Unsaved project', { exact: true })).toHaveCount(0)
    }
    const copy = join(folder, 'copy.deepfryer')
    await selectSave(app, copy)
    await fileAction(page, 'Save project as…')
    await expect(page.getByRole('status')).toContainText('Saved copy.deepfryer')
    await forbidChooser(app)
    await edit(page, '50')
    await save(page)
    expect(await readFile(a)).toEqual(aSaved)
    expect(parseProject(await readFile(copy, 'utf8')).edit.preset.effects[0]).toMatchObject({ value: 50 })
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
      await expect(page.getByRole('status')).toContainText('Saved separate.deepfryer')
      expect(parseProject(await readFile(copy, 'utf8')).edit.preset.effects[0]).toMatchObject({ value: 25 })
      if (change === 'missing') expect(await readFile(a).then(() => true).catch(() => false)).toBe(false)
      else expect(await readFile(a, 'utf8')).toBe(change === 'same-size' ? before.replace('123456', '987654') : before)
      expect((await readdir(folder)).some((name) => name.endsWith('.tmp'))).toBe(false)
    } finally { await chmod(a, 0o666).catch(() => {}); await cleanup(app, folder) }
  })
}

test('v1 Ctrl+S creates a current-version copy and never writes the legacy project', async () => {
  const { folder, app, page } = await setup()
  try {
    const legacy = join(folder, 'legacy.deepfryer')
    await copyFile('tests/fixtures/v1/baseline.deepfryer', legacy)
    const original = await readFile(legacy)
    await openProject(app, page, legacy)
    await edit(page, '25')
    const copy = join(folder, 'upgraded.deepfryer')
    await selectSave(app, copy)
    await page.keyboard.press('Control+s')
    await expect(page.getByRole('dialog', { name: 'Save project as', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Save as…', exact: true }).click()
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
  const child = app.process()
  try {
    await openProject(app, page, a)
    await forbidChooser(app)
    await edit(page, '25')
    await fileAction(page, 'Save project')
    await expect(page.getByLabel('Unsaved project', { exact: true })).toHaveCount(0)
    expect(parseProject(await readFile(a, 'utf8')).edit.preset.effects[0]).toMatchObject({ value: 25 })
    await edit(page, '50')
    await chooseUnsaved(app, 'cancel')
    await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0]?.close() })
    await ready(page)
    await expect(page.getByLabel('Unsaved project', { exact: true })).toBeVisible()
    await chooseUnsaved(app, 'save')
    await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0]?.close() }).catch(() => {})
    await expect.poll(() => child.exitCode).not.toBeNull()
    expect(parseProject(await readFile(a, 'utf8')).edit.preset.effects[0]).toMatchObject({ value: 50 })
  } finally {
    if (child.exitCode === null) await closeDiscardingChanges(app)
    await expect.poll(() => child.exitCode).not.toBeNull()
    await rm(folder, { recursive: true, force: true })
  }
})

test('close queued while candidate B is selected saves A before adopting B and closes cleanly', async () => {
  const { folder, a, b, app, page } = await setup()
  const child = app.process()
  try {
    await openProject(app, page, a)
    await forbidChooser(app)
    await edit(page, '25')
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
    await expect.poll(() => child.exitCode).not.toBeNull()
    expect(parseProject(await readFile(a, 'utf8')).edit.preset.effects[0]).toMatchObject({ value: 25 })
    expect(await readFile(b)).toEqual(bBefore)
  } finally {
    if (child.exitCode === null) await closeDiscardingChanges(app)
    await expect.poll(() => child.exitCode).not.toBeNull()
    await rm(folder, { recursive: true, force: true })
  }
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
