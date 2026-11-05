import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { PNG } from 'pngjs'
import { chooseUnsaved, closeDiscardingChanges, controls, exportImage, fileAction, ready, interruptForRecovery } from './ui'
import { parseProject } from '../../src/main/document-files'

async function launch(profile: string): Promise<ElectronApplication> {
  const executable = process.env.DEEP_FRYER_EXECUTABLE ?? process.env.ELECTRON_EXECUTABLE_PATH
  return electron.launch({
    ...(executable ? { executablePath: executable } : {}),
    args: [...(process.env.DEEP_FRYER_EXECUTABLE ? [] : [resolve('.')]), `--user-data-dir=${profile}`],
    env: { ...process.env, ELECTRON_RENDERER_URL: '' }
  })
}

async function choose(app: ElectronApplication, response: number): Promise<void> {
  await chooseUnsaved(app, response === 0 ? 'save' : response === 1 ? 'discard' : 'cancel')
}

async function saveTo(app: ElectronApplication, path: string | null): Promise<void> {
  await app.evaluate(({ dialog }, path) => { dialog.showSaveDialog = async () => ({ canceled: path === null, filePath: path ?? '' }) }, path)
}

async function nativeClose(app: ElectronApplication, quit = false): Promise<void> {
  await app.evaluate(({ app, BrowserWindow }, quit) => { if (quit) app.quit(); else BrowserWindow.getAllWindows()[0]?.close() }, quit).catch(() => {})
}

async function open(app: ElectronApplication, page: Page, path: string): Promise<void> {
  await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }) }, path)
  await fileAction(page, 'Open image')
  await ready(page)
}

async function setup() {
  const folder = await mkdtemp(join(tmpdir(), 'deep-fryer-unsaved-'))
  const source = join(folder, 'original.png')
  const replacement = join(folder, 'replacement.png')
  const png = new PNG({ width: 48, height: 32 })
  png.data.fill(128)
  for (let i = 3; i < png.data.length; i += 4) png.data[i] = 255
  await writeFile(source, PNG.sync.write(png))
  png.data.fill(255)
  await writeFile(replacement, PNG.sync.write(png))
  const app = await launch(join(folder, 'profile'))
  const page = await app.firstWindow()
  await open(app, page, source)
  const brightness = (await controls(page)).getByRole('spinbutton', { name: 'Brightness value' })
  await brightness.fill('25')
  await brightness.blur()
  await ready(page)
  return { folder, source, replacement, app, page }
}

async function pixels(page: Page): Promise<string> {
  return page.getByLabel('Edited full resolution image canvas').evaluate((canvas) => {
    if (!(canvas instanceof HTMLCanvasElement)) throw new Error('Missing canvas')
    return canvas.toDataURL()
  })
}

async function cleanup(app: ElectronApplication, folder: string): Promise<void> {
  await closeDiscardingChanges(app)
  await rm(folder, { recursive: true, force: true })
}

test('cancel a valid replacement preserves unsaved pixels and undo history', async () => {
  const { folder, replacement, app, page } = await setup()
  try {
    const before = await pixels(page)
    await choose(app, 2)
    await open(app, page, replacement)
    await expect(page.locator('.filename')).toHaveText('original.png')
    expect(await pixels(page)).toBe(before)
    await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeEnabled()
  } finally { await cleanup(app, folder) }
})

test('cancel a native close keeps the editor and its checkpoint alive', async () => {
  const { folder, app, page } = await setup()
  try {
    const checkpoint = join(folder, 'profile', 'recovery', 'latest.deepfryer')
    await expect.poll(async () => readFile(checkpoint, 'utf8').then((text) => JSON.parse(text).edit.preset.effects[0].value).catch(() => null)).toBe(25)
    await choose(app, 2)
    await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0]?.close() }).catch(() => {})
    await page.waitForTimeout(300).catch(() => {})
    expect(page.isClosed(), 'Cancel must keep the unsaved editor open').toBe(false)
    expect(JSON.parse(await readFile(checkpoint, 'utf8')).edit.preset.effects[0].value).toBe(25)
  } finally { await cleanup(app, folder) }
})

test('save before replacement writes the old editable snapshot, then imports an unsaved image', async () => {
  const { folder, source, replacement, app, page } = await setup()
  try {
    const project = join(folder, 'before-replacement.deepfryer')
    await saveTo(app, project)
    await choose(app, 0)
    await open(app, page, replacement)
    await expect(page.locator('.filename')).toHaveText('replacement.png')
    await expect(page.getByLabel('Unsaved project', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled()
    const saved = parseProject(await readFile(project, 'utf8'))
    expect(Buffer.from(saved.source.bytes)).toEqual(await readFile(source))
    expect(saved.edit.preset.effects[0]).toMatchObject({ kind: 'brightness', value: 25 })
  } finally { await cleanup(app, folder) }
})

test('discard replacement resets history and imported work remains unsaved', async () => {
  const { folder, replacement, app, page } = await setup()
  try {
    await choose(app, 1)
    await open(app, page, replacement)
    await expect(page.locator('.filename')).toHaveText('replacement.png')
    await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled()
    await expect(page.getByLabel('Unsaved project', { exact: true })).toBeVisible()
  } finally { await cleanup(app, folder) }
})

for (const action of ['replacement', 'close'] as const) {
  for (const outcome of ['cancelled', 'failed'] as const) {
    test(`${outcome} project save cancels ${action} without changing pixels, history or baseline`, async () => {
      const { folder, replacement, app, page } = await setup()
      try {
        const before = await pixels(page)
        const existing = join(folder, 'existing.deepfryer')
        await writeFile(existing, 'keep this file')
        await saveTo(app, outcome === 'cancelled' ? null : existing)
        await choose(app, 0)
        if (action === 'replacement') await open(app, page, replacement)
        else await nativeClose(app, true)
        await expect(page.getByRole('status')).toContainText(outcome === 'cancelled' ? 'Project save canceled' : 'already exists')
        await ready(page)
        expect(await pixels(page)).toBe(before)
        await expect(page.locator('.filename')).toHaveText('original.png')
        await expect(page.getByLabel('Unsaved project', { exact: true })).toBeVisible()
        await page.getByRole('button', { name: 'Undo', exact: true }).click()
        await ready(page)
        await expect(page.getByLabel('Unsaved project', { exact: true })).toBeVisible()
        await page.getByRole('button', { name: 'Redo', exact: true }).click()
        await ready(page)
        expect(await pixels(page)).toBe(before)
        expect(await readFile(existing, 'utf8')).toBe('keep this file')
      } finally { await cleanup(app, folder) }
    })
  }
}

test('only project save cleans the document and undo to its saved values is clean', async () => {
  const { folder, app, page } = await setup()
  try {
    const dirty = page.getByLabel('Unsaved project', { exact: true })
    await expect(dirty).toBeVisible()
    await mkdir('.artifacts/unsaved-work', { recursive: true })
    await page.screenshot({ path: '.artifacts/unsaved-work/dirty-editor.png' })
    await saveTo(app, join(folder, 'export.png'))
    await exportImage(page)
    await expect(page.getByRole('status')).toContainText('Saved export.png')
    await expect(dirty).toBeVisible()
    await app.evaluate(({ clipboard }) => { clipboard.write = async () => {} })
    await page.getByRole('button', { name: 'Copy image', exact: true }).click()
    await expect(page.getByRole('status')).toContainText('Image copied')
    await expect(dirty).toBeVisible()
    await saveTo(app, join(folder, 'look.frypreset'))
    await fileAction(page, 'Save preset as…')
    await expect(page.getByRole('status')).toContainText('Saved look.frypreset')
    await expect(dirty).toBeVisible()
    const project = join(folder, 'saved.deepfryer')
    await saveTo(app, project)
    await fileAction(page, 'Save project as…')
    await expect(dirty).toHaveCount(0)
    const brightness = (await controls(page)).getByRole('spinbutton', { name: 'Brightness value' })
    await brightness.fill('50')
    await brightness.blur()
    await ready(page)
    await expect(dirty).toBeVisible()
    await page.getByRole('button', { name: 'Undo', exact: true }).click()
    await ready(page)
    await expect(dirty).toHaveCount(0)
    await page.getByRole('button', { name: 'Redo', exact: true }).click()
    await ready(page)
    await saveTo(app, null)
    await fileAction(page, 'Save project as…')
    await expect(page.getByRole('status')).toContainText('Project save canceled')
    await expect(dirty).toBeVisible()
    await page.getByRole('button', { name: 'Undo', exact: true }).click()
    await ready(page)
    await expect(dirty).toHaveCount(0)
    await nativeClose(app)
    await expect.poll(() => page.isClosed()).toBe(true)
  } finally { await cleanup(app, folder) }
})

test('project replacement validates first, then cancel preserves and discard opens a clean project', async () => {
  const { folder, app, page } = await setup()
  try {
    const before = await pixels(page)
    const project = resolve('tests/fixtures/v1/baseline.deepfryer')
    await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }) }, project)
    await choose(app, 2)
    await fileAction(page, 'Open project')
    await ready(page)
    expect(await pixels(page)).toBe(before)
    await expect(page.getByLabel('Unsaved project', { exact: true })).toBeVisible()
    await choose(app, 1)
    await fileAction(page, 'Open project')
    await ready(page)
    await expect(page.getByLabel('Unsaved project', { exact: true })).toHaveCount(0)
    await nativeClose(app)
    await expect.poll(() => page.isClosed()).toBe(true)
  } finally { await cleanup(app, folder) }
})

test('invalid image or project never prompts or changes the current document', async () => {
  const { folder, source, app, page } = await setup()
  try {
    const before = await pixels(page)
    const damagedImage = join(folder, 'damaged.png')
    const damagedProject = join(folder, 'damaged.deepfryer')
    await writeFile(damagedImage, (await readFile(source)).subarray(0, 33))
    await writeFile(damagedProject, '{"version":999}')
    await app.evaluate(({ dialog }) => {
      Reflect.set(globalThis, '__unexpectedPrompts', 0)
      dialog.showMessageBox = async () => {
        Reflect.set(globalThis, '__unexpectedPrompts', Number(Reflect.get(globalThis, '__unexpectedPrompts')) + 1)
        return { response: 2, checkboxChecked: false }
      }
    })
    for (const [path, action] of [[damagedImage, 'Open image'], [damagedProject, 'Open project']] as const) {
      await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }) }, path)
      await fileAction(page, action)
      await expect(page.locator('.notice.error')).toBeVisible()
      await ready(page)
      expect(await pixels(page)).toBe(before)
      await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeEnabled()
    }
    expect(await app.evaluate(() => Reflect.get(globalThis, '__unexpectedPrompts'))).toBe(0)
  } finally { await cleanup(app, folder) }
})

test('paste and real file drop use the same cancel guard without changing the personal clipboard', async () => {
  const { folder, replacement, app, page } = await setup()
  try {
    const before = await pixels(page)
    await app.evaluate(({ clipboard, ClipboardItem }, bytes) => {
      clipboard.read = async () => [new ClipboardItem({ 'image/png': new Blob([Buffer.from(bytes, 'base64')], { type: 'image/png' }) })]
    }, (await readFile(replacement)).toString('base64'))
    await choose(app, 2)
    await fileAction(page, 'Paste image')
    await ready(page)
    expect(await pixels(page)).toBe(before)
    await page.evaluate(() => {
      const input = document.createElement('input')
      input.id = 'drop-fixture'
      input.type = 'file'
      input.hidden = true
      document.body.append(input)
    })
    await page.locator('#drop-fixture').setInputFiles(replacement)
    await choose(app, 2)
    await page.locator('.editor').evaluate((editor) => {
      const input = document.getElementById('drop-fixture')
      if (!(input instanceof HTMLInputElement) || !input.files?.[0]) throw new Error('Missing drop fixture')
      const transfer = new DataTransfer()
      transfer.items.add(input.files[0])
      editor.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }))
    })
    await ready(page)
    await expect(page.locator('.filename')).toHaveText('original.png')
    expect(await pixels(page)).toBe(before)
    await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeEnabled()
  } finally { await cleanup(app, folder) }
})

test('close saves editable values while full rendering is still pending', async () => {
  const { folder, app, page } = await setup()
  try {
    await controls(page)
    await page.evaluate(() => {
      const send = Worker.prototype.postMessage
      Worker.prototype.postMessage = function (...args) {
        if (args[0]?.kind === 'render') return
        return Reflect.apply(send, this, args)
      }
    })
    await page.getByRole('spinbutton', { name: 'Brightness value' }).fill('67')
    await expect(page.getByRole('button', { name: 'Export', exact: true })).toBeDisabled()
    const project = join(folder, 'pending.deepfryer')
    await saveTo(app, project)
    await choose(app, 0)
    await nativeClose(app)
    await expect.poll(() => page.isClosed()).toBe(true)
    expect(parseProject(await readFile(project, 'utf8')).edit.preset.effects[0]).toMatchObject({ kind: 'brightness', value: 67 })
  } finally { await cleanup(app, folder) }
})

test('repeated native closes and app.quit share one prompt and Cancel permits a later close', async () => {
  const { folder, app, page } = await setup()
  try {
    await app.evaluate(({ dialog }) => {
      Reflect.set(globalThis, '__promptCount', 0)
      dialog.showMessageBox = () => {
        Reflect.set(globalThis, '__promptCount', Number(Reflect.get(globalThis, '__promptCount')) + 1)
        return new Promise((resolve) => { Reflect.set(globalThis, '__answerPrompt', () => resolve({ response: 2, checkboxChecked: false })) })
      }
    })
    await nativeClose(app)
    await expect.poll(() => app.evaluate(() => Reflect.get(globalThis, '__promptCount'))).toBe(1)
    await page.evaluate(() => window.documentBridge.replyToClose({ request: crypto.randomUUID(), decision: 'close' }))
    expect(page.isClosed()).toBe(false)
    await nativeClose(app, true)
    await nativeClose(app)
    expect(await app.evaluate(() => Reflect.get(globalThis, '__promptCount'))).toBe(1)
    await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled()
    await app.evaluate(() => {
      const answer = Reflect.get(globalThis, '__answerPrompt')
      if (typeof answer !== 'function') throw new Error('Prompt was not requested')
      answer()
    })
    await ready(page)
    await choose(app, 1)
    await nativeClose(app, true)
    await expect.poll(() => page.isClosed()).toBe(true)
    await expect.poll(() => readFile(join(folder, 'profile/recovery/latest.deepfryer')).then(() => true).catch(() => false)).toBe(false)
  } finally { await cleanup(app, folder) }
})

for (const pending of [false, true]) {
  test(`closing with ${pending ? 'pending lookup' : 'unresolved recovery offer'} preserves recovery`, async () => {
    const fixture = await setup()
    let { app, page } = fixture
    const { folder } = fixture
    try {
      const checkpoint = join(folder, 'profile/recovery/latest.deepfryer')
      await expect.poll(() => readFile(checkpoint).then(() => true).catch(() => false)).toBe(true)
      const before = await readFile(checkpoint)
      await interruptForRecovery(app)
      app = await launch(join(folder, 'profile'))
      page = await app.firstWindow()
      await expect(page.getByRole('alertdialog')).toBeVisible()
      if (pending) {
        await app.evaluate(({ ipcMain }) => {
          ipcMain.removeHandler('recovery:offer')
          ipcMain.handle('recovery:offer', () => new Promise(() => {}))
        })
        await page.reload()
        await expect(page.locator('.open-button')).toBeDisabled()
      }
      await nativeClose(app, true)
      await expect.poll(() => page.isClosed()).toBe(true)
      expect(await readFile(checkpoint)).toEqual(before)
      app = await launch(join(folder, 'profile'))
      page = await app.firstWindow()
      await expect(page.getByRole('alertdialog')).toContainText('original.png')
      await page.getByRole('button', { name: 'Restore work' }).click()
      await ready(page)
      await expect(page.getByLabel('Unsaved project', { exact: true })).toBeVisible()
    } finally { await cleanup(app, folder) }
  })
}

test('a close queued during preset load guards the newly applied settings', async () => {
  const { folder, app, page } = await setup()
  try {
    const initialProject = join(folder, 'initial.deepfryer')
    await saveTo(app, initialProject)
    await fileAction(page, 'Save project as…')
    await expect(page.getByLabel('Unsaved project', { exact: true })).toHaveCount(0)
    const presetPath = join(folder, 'loaded.frypreset')
    const initial = JSON.parse(await readFile(initialProject, 'utf8'))
    initial.edit.preset.effects[0].value = 72
    await writeFile(presetPath, JSON.stringify({ format: 'deep-fryer-preset', version: 2, preset: initial.edit.preset }))
    await app.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = () => new Promise((resolve) => {
        Reflect.set(globalThis, '__releasePreset', () => resolve({ canceled: false, filePaths: [path] }))
      })
    }, presetPath)
    await fileAction(page, 'Load preset')
    await expect.poll(() => app.evaluate(() => typeof Reflect.get(globalThis, '__releasePreset'))).toBe('function')
    const savedOnClose = join(folder, 'loaded-at-close.deepfryer')
    await saveTo(app, savedOnClose)
    await choose(app, 0)
    await nativeClose(app)
    expect(page.isClosed()).toBe(false)
    await app.evaluate(() => {
      const release = Reflect.get(globalThis, '__releasePreset')
      if (typeof release !== 'function') throw new Error('Preset dialog is not pending')
      release()
    })
    await expect.poll(() => page.isClosed()).toBe(true)
    expect(parseProject(await readFile(savedOnClose, 'utf8')).edit.preset.effects[0]).toMatchObject({ kind: 'brightness', value: 72 })
  } finally { await cleanup(app, folder) }
})

test('renderer termination preserves recovery when the remaining native window closes', async () => {
  const { folder, app, page } = await setup()
  try {
    const checkpoint = join(folder, 'profile/recovery/latest.deepfryer')
    await expect.poll(() => readFile(checkpoint).then(() => true).catch(() => false)).toBe(true)
    const before = await readFile(checkpoint)
    await app.evaluate(async ({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0]
      if (!window) throw new Error('Missing window')
      await new Promise<void>((resolve) => {
        window.webContents.once('render-process-gone', () => resolve())
        window.webContents.forcefullyCrashRenderer()
      })
    })
    await nativeClose(app, true)
    await expect.poll(() => page.isClosed()).toBe(true)
    expect(await readFile(checkpoint)).toEqual(before)
  } finally { await cleanup(app, folder) }
})

test('failed recovery lookup preserves old copies but still guards new unsaved work', async () => {
  const { folder, replacement, app, page } = await setup()
  try {
    const checkpoint = join(folder, 'profile/recovery/latest.deepfryer')
    await expect.poll(() => readFile(checkpoint).then(() => true).catch(() => false)).toBe(true)
    const before = await readFile(checkpoint)
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('recovery:offer')
      ipcMain.handle('recovery:offer', () => { throw new Error('Injected lookup failure') })
    })
    await page.reload()
    await expect(page.locator('.open-button')).toBeEnabled()
    await open(app, page, replacement)
    await choose(app, 2)
    await nativeClose(app)
    await ready(page)
    expect(page.isClosed()).toBe(false)
    await expect(page.locator('.filename')).toHaveText('replacement.png')
    await choose(app, 1)
    await nativeClose(app)
    await expect.poll(() => page.isClosed()).toBe(true)
    expect(await readFile(checkpoint)).toEqual(before)
  } finally { await cleanup(app, folder) }
})

test('an empty editor is clean and closes without a prompt', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'deep-fryer-empty-close-'))
  const app = await launch(join(folder, 'profile'))
  try {
    const page = await app.firstWindow()
    await expect(page.getByRole('heading', { name: 'Open your first image.' })).toBeVisible()
    await expect(page.getByLabel('Unsaved project', { exact: true })).toHaveCount(0)
    await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => { throw new Error('Empty editor must not prompt') } })
    await nativeClose(app, true)
    await expect.poll(() => page.isClosed()).toBe(true)
  } finally { await cleanup(app, folder) }
})

test('startup stays busy through appearance and recovery lookup before accepting keyboard open', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'deep-fryer-startup-'))
  const app = await launch(join(folder, 'profile'))
  try {
    const page = await app.firstWindow()
    await expect(page.locator('.editor')).toBeVisible()
    const appearance = await page.evaluate(() => window.appearanceBridge.load())
    await app.evaluate(({ ipcMain, dialog }, { appearance, source }) => {
      Reflect.set(globalThis, '__startupOpens', 0)
      ipcMain.removeHandler('appearance:load')
      ipcMain.handle('appearance:load', () => new Promise((resolve) => {
        Reflect.set(globalThis, '__releaseAppearance', () => resolve(appearance))
      }))
      ipcMain.removeHandler('recovery:offer')
      ipcMain.handle('recovery:offer', () => new Promise((resolve) => {
        Reflect.set(globalThis, '__releaseRecovery', () => resolve(null))
      }))
      dialog.showOpenDialog = async () => {
        Reflect.set(globalThis, '__startupOpens', Number(Reflect.get(globalThis, '__startupOpens')) + 1)
        return { canceled: false, filePaths: [source] }
      }
    }, { appearance, source: resolve('tests/fixtures/v1/original.png') })
    await page.reload()
    await expect(page.locator('.editor')).toBeHidden()
    await expect(page.locator('.open-button')).toBeDisabled()
    await app.evaluate(() => Reflect.get(globalThis, '__releaseAppearance')())
    await expect(page.locator('.editor')).toBeVisible()
    await expect(page.locator('.open-button')).toBeDisabled()
    expect(await app.evaluate(() => Reflect.get(globalThis, '__startupOpens'))).toBe(0)
    await app.evaluate(() => Reflect.get(globalThis, '__releaseRecovery')())
    await expect(page.locator('.open-button')).toBeEnabled()
    await page.keyboard.press('Control+o')
    await ready(page)
    expect(await app.evaluate(() => Reflect.get(globalThis, '__startupOpens'))).toBe(1)
  } finally { await cleanup(app, folder) }
})

for (const operation of ['copy', 'export'] as const) {
  test(`close cancels held ${operation} preparation, then Cancel keeps editable work and permits retry`, async () => {
    const { folder, app, page } = await setup()
    try {
      const before = await pixels(page)
      await app.evaluate(({ clipboard, dialog }) => {
        Reflect.set(globalThis, '__nativeWrites', 0)
        Reflect.set(globalThis, '__closePrompts', 0)
        clipboard.write = async () => { Reflect.set(globalThis, '__nativeWrites', Number(Reflect.get(globalThis, '__nativeWrites')) + 1) }
        dialog.showSaveDialog = async () => {
          Reflect.set(globalThis, '__nativeWrites', Number(Reflect.get(globalThis, '__nativeWrites')) + 1)
          return { canceled: true, filePath: '' }
        }
        dialog.showMessageBox = async () => {
          Reflect.set(globalThis, '__closePrompts', Number(Reflect.get(globalThis, '__closePrompts')) + 1)
          return { response: 2, checkboxChecked: false }
        }
      })
      await page.evaluate(() => {
        const NativeWorker = window.Worker
        window.Worker = class extends NativeWorker {
          constructor(url: string | URL, options?: WorkerOptions) {
            super(url, options)
            if (!String(url).includes('output-worker')) return
            window.Worker = NativeWorker
            this.addEventListener('message', (event) => {
              event.stopImmediatePropagation()
              document.documentElement.dataset.heldPreparation = 'true'
            })
          }
          terminate(): void { document.documentElement.dataset.stoppedPreparation = 'true'; super.terminate() }
        }
      })
      if (operation === 'copy') await page.getByRole('button', { name: 'Copy image', exact: true }).click()
      else {
        await page.getByRole('button', { name: 'Export', exact: true }).click()
        await page.getByRole('button', { name: 'Save image…' }).click()
      }
      await expect(page.locator('html')).toHaveAttribute('data-held-preparation', 'true')
      await nativeClose(app)
      await expect.poll(() => app.evaluate(() => Reflect.get(globalThis, '__closePrompts'))).toBe(1)
      await expect(page.locator('html')).toHaveAttribute('data-stopped-preparation', 'true')
      expect(await app.evaluate(() => Reflect.get(globalThis, '__nativeWrites'))).toBe(0)
      expect(await pixels(page)).toBe(before)
      if (operation === 'export') await page.getByRole('button', { name: 'Close export', exact: true }).click()
      await ready(page)
      await page.getByRole('button', { name: 'Copy image', exact: true }).click()
      await expect(page.getByRole('status')).toContainText('Image copied')
      expect(await app.evaluate(() => Reflect.get(globalThis, '__nativeWrites'))).toBe(1)
    } finally {
      await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0]?.destroy() }).catch(() => {})
      await app.close().catch(() => {})
      await rm(folder, { recursive: true, force: true })
    }
  })

  test(`close waits for an admitted native ${operation} write before prompting`, async () => {
    const { folder, app, page } = await setup()
    try {
      await app.evaluate(({ clipboard, dialog }) => {
        Reflect.set(globalThis, '__admittedWrite', false)
        Reflect.set(globalThis, '__writeSettled', false)
        Reflect.set(globalThis, '__closePrompts', 0)
        const hold = () => new Promise<void>((resolve) => {
          Reflect.set(globalThis, '__admittedWrite', true)
          Reflect.set(globalThis, '__releaseWrite', () => { Reflect.set(globalThis, '__writeSettled', true); resolve() })
        })
        clipboard.write = hold
        dialog.showSaveDialog = async () => { await hold(); return { canceled: true, filePath: '' } }
        dialog.showMessageBox = async () => {
          if (!Reflect.get(globalThis, '__writeSettled')) throw new Error('Close prompted before the native write settled')
          Reflect.set(globalThis, '__closePrompts', Number(Reflect.get(globalThis, '__closePrompts')) + 1)
          return { response: 2, checkboxChecked: false }
        }
      })
      if (operation === 'copy') await page.getByRole('button', { name: 'Copy image', exact: true }).click()
      else {
        await page.getByRole('button', { name: 'Export', exact: true }).click()
        await page.getByRole('button', { name: 'Save image…' }).click()
      }
      await expect.poll(() => app.evaluate(() => Reflect.get(globalThis, '__admittedWrite'))).toBe(true)
      await nativeClose(app)
      await page.keyboard.press('Control+o')
      expect(await app.evaluate(() => Reflect.get(globalThis, '__closePrompts'))).toBe(0)
      expect(page.isClosed()).toBe(false)
      await app.evaluate(() => {
        const release = Reflect.get(globalThis, '__releaseWrite')
        if (typeof release !== 'function') throw new Error('No native write was admitted')
        release()
      })
      await expect.poll(() => app.evaluate(() => Reflect.get(globalThis, '__closePrompts'))).toBe(1)
      if (operation === 'export') await page.getByRole('button', { name: 'Close export', exact: true }).click()
      await ready(page)
      await expect(page.getByLabel('Unsaved project', { exact: true })).toBeVisible()
    } finally { await cleanup(app, folder) }
  })
}
