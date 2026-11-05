import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { createHash } from 'node:crypto'
import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { parseProject } from '../../src/main/document-files'
import { editStateSchema } from '../../src/shared/edit'
import { saveUpgradeFile } from '../fixtures/upgrade-ui'
import { closeDiscardingChanges, controls, fileAction, projectSaved, ready, traceElectron, PROJECT_FILE_OPERATION_MS } from './ui'

async function setup() {
  const folder = await mkdtemp(join(tmpdir(), 'deep-fryer-upgrade-save-'))
  const previous = join(folder, 'previous.deepfryer')
  await copyFile(resolve('tests/fixtures/v1-rich/baseline.deepfryer'), previous)
  const executable = process.env.DEEP_FRYER_EXECUTABLE ?? process.env.ELECTRON_EXECUTABLE_PATH
  const app = await electron.launch({ ...(executable ? { executablePath: executable } : {}),
    args: [...(process.env.DEEP_FRYER_EXECUTABLE ? [] : [resolve('.')]), `--user-data-dir=${join(folder, 'profile')}`],
    env: { ...process.env, ELECTRON_RENDERER_URL: '' } })
  const launcher = app.process()
  const runtime = await app.evaluate(({ app }) => ({ packaged: app.isPackaged, executable: process.execPath,
    version: app.getVersion(), profile: app.getPath('userData'),
    pids: [...new Set([process.pid, ...app.getAppMetrics().map(({ pid }) => pid)])] }))
  await writeFile(test.info().outputPath('runtime.json'), JSON.stringify({ folder, pid: launcher.pid, ...runtime }))
  const page = await app.firstWindow()
  await traceElectron(app)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  return { folder, previous, app, page, launcher, runtime, errors }
}

async function cleanup({ app, folder, launcher, runtime }: Awaited<ReturnType<typeof setup>>): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([closeDiscardingChanges(app), new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Close timed out; retained ${folder}`)), 10_000)
    })])
    await expect.poll(() => launcher.exitCode !== null || launcher.signalCode !== null).toBe(true)
    await expect.poll(() => runtime.pids.filter(pid => {
      try { process.kill(pid, 0); return true } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ESRCH') return false
        throw error
      }
    }), { message: 'Owned upgrade Electron processes must exit before profile deletion' }).toEqual([])
    await rm(folder, { recursive: true, force: true })
    await writeFile(test.info().outputPath('teardown.json'), JSON.stringify({
      pids: runtime.pids, exitCode: launcher.exitCode, signal: launcher.signalCode, profileRemoved: true
    }))
  } finally { clearTimeout(timer) }
}

async function openProject(app: ElectronApplication, page: Page, path: string): Promise<void> {
  await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }) }, path)
  await fileAction(page, 'Open project')
  await ready(page)
}

async function pixels(page: Page): Promise<string> {
  const bytes = await page.getByLabel('Edited full resolution image canvas').evaluate(element => {
    if (!(element instanceof HTMLCanvasElement)) throw new Error('Edited canvas missing')
    const context = element.getContext('2d')
    if (!context) throw new Error('Edited context missing')
    return Array.from(context.getImageData(0, 0, element.width, element.height).data)
  })
  return createHash('sha256').update(Buffer.from(bytes)).digest('hex')
}

test('upgrade save waits for the same real acknowledgement beyond five seconds, then preserves exact edit, source and pixels', async () => {
  const state = await setup()
  const { app, page, folder, previous, errors } = state
  const path = join(folder, 'continued-in-candidate.deepfryer')
  try {
    await openProject(app, page, previous)
    const brightness = (await controls(page)).getByRole('spinbutton', { name: 'Brightness value' })
    await brightness.fill('25')
    await brightness.blur()
    await ready(page)
    await page.locator('.caption-controls > summary').click()
    const top = page.getByRole('textbox', { name: 'Top caption', exact: true })
    await top.fill('UPGRADE')
    await top.blur()
    await ready(page)
    const expectedPixels = await pixels(page)
    await expect(page.getByLabel('Unsaved project', { exact: true })).toBeVisible()
    await app.evaluate(({ ipcMain }) => {
      const handlers = Reflect.get(ipcMain, '_invokeHandlers')
      if (!(handlers instanceof Map)) throw new Error('Electron IPC handlers unavailable')
      const original = handlers.get('document:save-project-as')
      if (typeof original !== 'function') throw new Error('Save As handler missing')
      const held = { enteredAt: 0, resultAt: 0, releasedAt: 0, result: '', submitted: null, release: () => {} }
      Reflect.set(globalThis, '__upgradeSave', held)
      ipcMain.removeHandler('document:save-project-as')
      ipcMain.handle('document:save-project-as', async (...args) => {
        held.enteredAt = Date.now()
        held.submitted = args[1].document
        const result = await original(...args)
        held.resultAt = Date.now()
        held.result = result.kind
        await new Promise<void>(resolve => {
          const timer = setTimeout(() => held.release(), 6_500)
          held.release = () => { clearTimeout(timer); held.releasedAt = Date.now(); resolve() }
        })
        return result
      })
    })
    const saving = saveUpgradeFile({ app, page, name: 'Save project as…', path, candidate: true }).then(
      () => ({ error: null, settledAt: Date.now() }),
      async (error: unknown) => {
        const settledAt = Date.now()
        await writeFile(test.info().outputPath('original-assertion-failure.txt'), String(error))
        await writeFile(test.info().outputPath('failed-public-state.json'), JSON.stringify(await page.locator('.editor').evaluate(editor => ({
          notice: editor.querySelector('.notice')?.textContent,
          dirty: !!editor.querySelector('.unsaved-indicator'),
          openDisabled: editor.querySelector('.open-button')?.hasAttribute('disabled')
        }))))
        await page.screenshot({ path: test.info().outputPath('failed-before-release.png') }).catch(() => {})
        return { error, settledAt }
      }
    )
    const outcome = await saving
    // Keep observing this operation after the original assertion fails, before teardown can erase evidence.
    await projectSaved(page, 'Saved continued-in-candidate.deepfryer.')
    const receipt = await app.evaluate(() => {
      const held = Reflect.get(globalThis, '__upgradeSave')
      const { source, edit } = held.submitted
      return { enteredAt: held.enteredAt, resultAt: held.resultAt, releasedAt: held.releasedAt, result: held.result,
        edit, sourceSha256: process.getBuiltinModule('node:crypto').createHash('sha256').update(source.bytes).digest('hex') }
    })
    const bytes = await readFile(path)
    await writeFile(test.info().outputPath('continued-in-candidate.deepfryer'), bytes)
    const saved = parseProject(bytes.toString('utf8'))
    expect(saved.edit).toEqual(editStateSchema.parse(receipt.edit))
    expect(saved.edit.composition.captions?.top).toBe('UPGRADE')
    expect(saved.edit.preset.effects.find(effect => effect.kind === 'brightness')).toMatchObject({ value: 25 })
    expect(createHash('sha256').update(saved.source.bytes).digest('hex')).toBe(receipt.sourceSha256)
    expect(Buffer.from(saved.source.bytes)).toEqual(await readFile(resolve('tests/fixtures/v1-rich/original.png')))
    expect(await readFile(previous)).toEqual(await readFile(resolve('tests/fixtures/v1-rich/baseline.deepfryer')))
    await openProject(app, page, path)
    const reloadedPixels = await pixels(page)
    expect(reloadedPixels).toBe(expectedPixels)
    expect(errors).toEqual([])
    await writeFile(test.info().outputPath('same-operation.json'), JSON.stringify({ ...receipt,
      settledAt: outcome.settledAt, driverError: outcome.error ? String(outcome.error) : null,
      expectedPixels, reloadedPixels, eventualSaved: true, sourceAndEditMatch: true }))
    expect(receipt.releasedAt - receipt.resultAt).toBeGreaterThan(5_000)
    expect(receipt.releasedAt - receipt.enteredAt).toBeLessThan(PROJECT_FILE_OPERATION_MS)
    if (outcome.error) throw outcome.error
    expect(outcome.settledAt).toBeGreaterThanOrEqual(receipt.releasedAt)
  } catch (error) {
    await page.screenshot({ path: test.info().outputPath('before-teardown.png') }).catch(() => {})
    throw error
  } finally {
    await app.evaluate(() => Reflect.get(globalThis, '__upgradeSave')?.release()).catch(() => {})
    await cleanup(state)
  }
})

test('upgrade save rejects an earlier identical Saved notice when the new action never starts', async () => {
  const state = await setup()
  const { app, page, folder, previous } = state
  try {
    await openProject(app, page, previous)
    const path = join(folder, 'continued-in-candidate.deepfryer')
    await saveUpgradeFile({ app, page, name: 'Save project as…', path, candidate: true })
    await page.evaluate(() => {
      document.addEventListener('click', function intercept(event) {
        if (event.target instanceof Element && event.target.closest('button')?.textContent?.trim() === 'Save as…') {
          event.preventDefault()
          event.stopImmediatePropagation()
          document.removeEventListener('click', intercept, true)
        }
      }, true)
    })
    const before = await readFile(path)
    await expect(saveUpgradeFile({ app, page, name: 'Save project as…', path, candidate: true })).rejects.toThrow('This upgrade save must start and complete a new file operation')
    expect(await readFile(path)).toEqual(before)
    await expect(page.locator('.notice')).toHaveText('Saved continued-in-candidate.deepfryer.')
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  } finally { await cleanup(state) }
})

test('upgrade save still fails when the same acknowledgement exceeds the finite operation contract', async () => {
  const state = await setup()
  const { app, page, folder, previous } = state
  try {
    await openProject(app, page, previous)
    await app.evaluate(({ ipcMain }) => {
      const handlers = Reflect.get(ipcMain, '_invokeHandlers')
      if (!(handlers instanceof Map)) throw new Error('Electron IPC handlers unavailable')
      const original = handlers.get('document:save-project-as')
      if (typeof original !== 'function') throw new Error('Save As handler missing')
      const held = { result: '', release: () => {} }
      const released = new Promise<void>(resolve => { held.release = resolve })
      Reflect.set(globalThis, '__pendingUpgradeSave', held)
      ipcMain.removeHandler('document:save-project-as')
      ipcMain.handle('document:save-project-as', async (...args) => {
        const result = await original(...args)
        held.result = result.kind
        await released
        return result
      })
    })
    const path = join(folder, 'continued-in-candidate.deepfryer')
    const error: unknown = await saveUpgradeFile({ app, page, name: 'Save project as…', path, candidate: true }).then(() => null, (error: unknown) => error)
    const pending = await app.evaluate(() => Reflect.get(globalThis, '__pendingUpgradeSave').result)
    await page.screenshot({ path: test.info().outputPath('pending-at-deadline.png') })
    await writeFile(test.info().outputPath('finite-deadline.json'), JSON.stringify({ error: String(error), result: pending, budgetMs: PROJECT_FILE_OPERATION_MS }))
    expect(pending).toBe('saved')
    expect(String(error)).toContain('This upgrade save must start and complete a new file operation')
    expect(String(error)).toContain(`Timeout ${PROJECT_FILE_OPERATION_MS}ms exceeded`)
    await expect(page.locator('.notice')).toHaveText('Saving project…')
    await expect(page.locator('.open-button')).toBeDisabled()
    expect(parseProject(await readFile(path, 'utf8'))).toEqual(parseProject(await readFile(previous, 'utf8')))
    await app.evaluate(() => Reflect.get(globalThis, '__pendingUpgradeSave').release())
    await projectSaved(page, 'Saved continued-in-candidate.deepfryer.')
  } finally {
    await app.evaluate(() => Reflect.get(globalThis, '__pendingUpgradeSave')?.release()).catch(() => {})
    await cleanup(state)
  }
})
