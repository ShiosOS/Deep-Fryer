import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { parseProject } from '../../src/main/document-files'
import { editStateSchema } from '../../src/shared/edit'
import { chooseUnsaved, closeDiscardingChanges, fileAction, fileOperationComplete, finishElectronTrace, ready, traceElectron, PROJECT_FILE_OPERATION_MS } from './ui'

async function holdSave(app: ElectronApplication, channel: string): Promise<void> {
  await app.evaluate(({ ipcMain }, channel) => {
    const handlers = Reflect.get(ipcMain, '_invokeHandlers')
    if (!(handlers instanceof Map)) throw new Error('Electron IPC handler map unavailable')
    const original = handlers.get(channel)
    if (typeof original !== 'function') throw new Error('Project save handler missing')
    const state = { entered: false, result: '', document: null, release: () => {} }
    Reflect.set(globalThis, '__heldProjectSave', state)
    ipcMain.removeHandler(channel)
    ipcMain.handle(channel, async (...args) => {
      state.entered = true
      state.document = args[1].document
      const released = new Promise<void>(resolve => { state.release = resolve })
      const result = await original(...args)
      state.result = result.kind
      await released
      return result
    })
  }, channel)
}

test('canceled, failed, uncertain and rejected saves clear progress before direct retry, replacement or close', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'deep-fryer-save-outcomes-'))
  const executable = process.env.DEEP_FRYER_EXECUTABLE ?? process.env.ELECTRON_EXECUTABLE_PATH
  const app = await electron.launch({ ...(executable ? { executablePath: executable } : {}),
    args: [...(process.env.DEEP_FRYER_EXECUTABLE ? [] : [resolve('.')]), `--user-data-dir=${join(folder, 'profile')}`],
    env: { ...process.env, ELECTRON_RENDERER_URL: '' } })
  await traceElectron(app)
  try {
    const page = await app.firstWindow()
    await page.getByRole('button', { name: 'Try demo', exact: true }).click()
    await ready(page)
    const originalName = await page.locator('.filename').textContent()
    for (const trigger of ['direct', 'replacement', 'close']) {
      for (const outcome of ['cancelled', 'failed', 'uncertain', 'rejected']) {
        await app.evaluate(({ ipcMain, dialog }, { outcome, replacement }) => {
          ipcMain.removeHandler('document:save-project-as')
          ipcMain.handle('document:save-project-as', async () => {
            await new Promise<void>(resolve => { Reflect.set(globalThis, '__releaseOutcome', resolve) })
            if (outcome === 'rejected') throw new Error('Injected rejected project save')
            return outcome === 'cancelled' ? { kind: 'cancelled' } : { kind: outcome, message: `Injected ${outcome} project save` }
          })
          dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [replacement] })
        }, { outcome, replacement: resolve('tests/fixtures/v1/original.png') })
        if (trigger === 'direct') await fileAction(page, 'Save project as…')
        else {
          await chooseUnsaved(app, 'save')
          if (trigger === 'replacement') await fileAction(page, 'Open image')
          else await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0]?.close() })
        }
        await pending(page, false)
        await app.evaluate(() => {
          const release = Reflect.get(globalThis, '__releaseOutcome')
          if (typeof release !== 'function') throw new Error('Save result was not held')
          Reflect.deleteProperty(globalThis, '__releaseOutcome')
          release()
        })
        await fileOperationComplete(page)
        await expect(page.locator('.notice')).toContainText(outcome === 'cancelled' ? 'Project save canceled' : `Injected ${outcome} project save`)
        await expect(page.locator('.notice')).not.toContainText('Saving project')
        await expect(page.locator('.notice')).not.toContainText('Saved')
        await expect(page.getByLabel('Unsaved project', { exact: true })).toBeVisible()
        await expect(page.locator('.filename')).toHaveText(originalName ?? '')
        await ready(page)
      }
    }
  } finally {
    await closeDiscardingChanges(app)
    await rm(folder, { recursive: true, force: true })
  }
})

async function releaseSave(app: ElectronApplication): Promise<void> {
  await app.evaluate(() => { Reflect.get(globalThis, '__heldProjectSave')?.release() })
}

async function pending(page: Page, missingFont: boolean): Promise<void> {
  await expect(page.locator('.notice')).toHaveText('Saving project…')
  await expect(page.getByLabel('Unsaved project', { exact: true })).toBeVisible()
  await expect(page.locator('.notice')).not.toContainText('Saved')
  await page.getByRole('button', { name: 'File', exact: true }).click()
  for (const name of ['Open image', 'Paste image', 'Open project', 'Save project', 'Save project as…']) {
    await expect(page.getByRole('button', { name, exact: name !== 'Open image' })).toBeDisabled()
  }
  await page.getByRole('button', { name: 'File', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Export', exact: true })).toBeDisabled()
  if (missingFont) await expect(page.locator('.caption-controls [role=alert]')).toContainText('bundled Anton font could not load')
}

for (const missingFont of [false, true]) {
  test(`project save progress holds real acknowledgement and exact disk snapshot: ${missingFont ? 'missing font' : 'plain'}`, async () => {
    const folder = await mkdtemp(join(tmpdir(), 'deep-fryer-save-progress-'))
    const executable = process.env.DEEP_FRYER_EXECUTABLE ?? process.env.ELECTRON_EXECUTABLE_PATH
    const app = await electron.launch({ ...(executable ? { executablePath: executable } : {}),
      args: [...(process.env.DEEP_FRYER_EXECUTABLE ? [] : [resolve('.')]), `--user-data-dir=${join(folder, 'profile')}`],
      env: { ...process.env, ELECTRON_RENDERER_URL: '' } })
    const page = await app.firstWindow()
    await traceElectron(app)
    const runtime = await app.evaluate(({ app }) => ({ packaged: app.isPackaged, executable: process.execPath,
      pids: [...new Set([process.pid, ...app.getAppMetrics().map(({ pid }) => pid)])] }))
    await writeFile(test.info().outputPath('runtime.json'), JSON.stringify({ folder, ...runtime }))
    try {
      await page.getByRole('button', { name: 'Try demo', exact: true }).click()
      await ready(page)
      if (missingFont) {
        await expect(page.locator('.look-grid')).toHaveAttribute('aria-busy', 'false')
        const worker = page.workers().find(worker => worker.url().includes('effects-worker'))
        if (!worker) throw new Error('Rendering worker missing')
        await worker.evaluate(() => {
          const original = globalThis.fetch
          globalThis.fetch = async (input, options) => String(input).endsWith('.ttf')
            ? new Response('Missing test font', { status: 404 }) : original(input, options)
        })
        await page.locator('.caption-controls > summary').click()
        const top = page.getByRole('textbox', { name: 'Top caption', exact: true })
        await top.fill('Keep these words')
        await top.blur()
        await expect(page.locator('.caption-controls [role=alert]')).toContainText('bundled Anton font could not load')
      }
      const path = join(folder, 'progress.deepfryer')
      await app.evaluate(({ dialog }, path) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: path }) }, path)
      for (const channel of ['document:save-project-as', 'document:save-project']) {
        const artifactName = channel.replaceAll(':', '-')
        if (channel === 'document:save-project') {
          if (!await page.locator('.caption-controls').getAttribute('open').then(value => value !== null)) await page.locator('.caption-controls > summary').click()
          const top = page.getByRole('textbox', { name: 'Top caption', exact: true })
          await top.fill('Second exact edit')
          await top.blur()
          if (missingFont) await expect(page.locator('.caption-controls [role=alert]')).toBeVisible()
          else await ready(page)
        }
        await holdSave(app, channel)
        if (channel.endsWith('-as')) await fileAction(page, 'Save project as…')
        else await fileAction(page, 'Save project')
        await expect.poll(() => app.evaluate(() => Reflect.get(globalThis, '__heldProjectSave').entered)).toBe(true)
        await pending(page, missingFont)
        await expect.poll(() => app.evaluate(() => Reflect.get(globalThis, '__heldProjectSave').result), { timeout: PROJECT_FILE_OPERATION_MS }).toBe('saved')
        await pending(page, missingFont)
        const submitted = await app.evaluate(() => {
          const document = Reflect.get(globalThis, '__heldProjectSave').document
          return { sourceSha256: process.getBuiltinModule('node:crypto').createHash('sha256').update(document.source.bytes).digest('hex'), edit: document.edit }
        })
        const saved = parseProject(await readFile(path, 'utf8'))
        expect(createHash('sha256').update(saved.source.bytes).digest('hex')).toBe(submitted.sourceSha256)
        expect(saved.edit).toEqual(editStateSchema.parse(submitted.edit))
        await writeFile(test.info().outputPath(`${artifactName}-fidelity.json`), JSON.stringify({ sourceSha256: submitted.sourceSha256, edit: saved.edit }))
        await page.screenshot({ path: test.info().outputPath(`${artifactName}-pending.png`) })
        await releaseSave(app)
        await expect(page.locator('.notice')).toContainText('Saved progress.deepfryer')
        await expect(page.getByLabel('Unsaved project', { exact: true })).toHaveCount(0)
        await expect(page.locator('.open-button')).toBeEnabled()
        if (missingFont) await expect(page.getByRole('button', { name: 'Export', exact: true })).toBeDisabled()
        else await ready(page)
      }
    } finally {
      await releaseSave(app)
      await finishElectronTrace(app)
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        await chooseUnsaved(app, 'discard')
        await Promise.race([app.close(), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`Close timed out; retained ${folder}`)), 10_000) })])
        await expect.poll(() => runtime.pids.filter(pid => {
          try { process.kill(pid, 0); return true } catch (error) {
            if (error instanceof Error && 'code' in error && error.code === 'ESRCH') return false
            throw error
          }
        })).toEqual([])
        await rm(folder, { recursive: true, force: true })
        await writeFile(test.info().outputPath('teardown.json'), JSON.stringify({ profileRemoved: true, pids: runtime.pids }))
      } finally { clearTimeout(timer) }
    }
  })
}
