import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { closeDiscardingChanges, ready, section, traceElectron } from './ui'
import { openImageWithShortcut } from './open-image-shortcut'
import { prepareMissingCaptionFont } from './save-font-fault'

async function launch() {
  const folder = await mkdtemp(join(tmpdir(), 'deep-fryer-installed-boundary-'))
  const executable = process.env.DEEP_FRYER_EXECUTABLE ?? process.env.ELECTRON_EXECUTABLE_PATH
  const app = await electron.launch({ ...(executable ? { executablePath: executable } : {}),
    args: [...(process.env.DEEP_FRYER_EXECUTABLE ? [] : [resolve('.')]), `--user-data-dir=${join(folder, 'profile')}`],
    env: { ...process.env, ELECTRON_RENDERER_URL: '' } })
  const launcher = app.process()
  const pids = await app.evaluate(({ app }) => [...new Set([process.pid, ...app.getAppMetrics().map(({ pid }) => pid)])])
  await writeFile(test.info().outputPath('runtime.json'), JSON.stringify({ folder, pid: launcher.pid, pids }))
  await traceElectron(app)
  return { app, folder, launcher, pids }
}

async function cleanup({ app, folder, launcher, pids }: Awaited<ReturnType<typeof launch>>, passed: boolean) {
  await closeDiscardingChanges(app)
  await expect.poll(() => launcher.exitCode !== null || launcher.signalCode !== null).toBe(true)
  await expect.poll(() => pids.filter(pid => {
    try { process.kill(pid, 0); return true } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ESRCH') return false
      throw error
    }
  }), { message: 'Owned Electron processes must exit before profile removal' }).toEqual([])
  const profileRemoved = passed
  if (profileRemoved) await rm(folder, { recursive: true, force: true })
  await writeFile(test.info().outputPath('teardown.json'), JSON.stringify({ folder, pid: launcher.pid, pids,
    exitCode: launcher.exitCode, signal: launcher.signalCode, profileRemoved }))
}

async function releaseRecovery(app: ElectronApplication) {
  await app.evaluate(() => { Reflect.get(globalThis, '__releaseRecovery')?.() })
}

test('keyboard import waits for the public open control while recovery is pending', async () => {
  const owned = await launch()
  const { app } = owned
  let passed = false
  try {
    const page = await app.firstWindow()
    await app.evaluate(({ ipcMain, dialog }, source) => {
      const handlers = Reflect.get(ipcMain, '_invokeHandlers')
      if (!(handlers instanceof Map)) throw new Error('IPC handler map unavailable')
      const original = handlers.get('recovery:offer')
      ipcMain.removeHandler('recovery:offer')
      ipcMain.handle('recovery:offer', async (...args) => {
        await new Promise<void>(resolve => { Reflect.set(globalThis, '__releaseRecovery', resolve) })
        return original(...args)
      })
      Reflect.set(globalThis, '__openCalls', 0)
      dialog.showOpenDialog = async () => {
        Reflect.set(globalThis, '__openCalls', Reflect.get(globalThis, '__openCalls') + 1)
        return { canceled: false, filePaths: [source] }
      }
    }, resolve('tests/fixtures/v1/original.png'))
    await page.reload()
    await expect(page.getByRole('heading', { name: 'Open your first image.' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Export', exact: true })).toBeDisabled()
    await expect(page.getByRole('button', { name: 'Choose an image', exact: true })).toBeDisabled()
    await expect.poll(() => app.evaluate(() => typeof Reflect.get(globalThis, '__releaseRecovery'))).toBe('function')
    const press = page.keyboard.press.bind(page.keyboard)
    let pressedBeforeRelease = false
    let released = false
    page.keyboard.press = (...args) => {
      if (!released) pressedBeforeRelease = true
      return press(...args)
    }
    const opening = openImageWithShortcut(page)
    // Finish an eager shortcut while recovery is held, so a dropped key cannot race the release.
    if (pressedBeforeRelease) await opening
    const beforeRelease = await app.evaluate(() => Reflect.get(globalThis, '__openCalls'))
    released = true
    await releaseRecovery(app)
    await opening
    await writeFile(test.info().outputPath('keyboard-boundary.json'), JSON.stringify({ pressedBeforeRelease, beforeRelease }))
    await expect(page.locator('.filename')).toHaveText('original.png')
    expect(pressedBeforeRelease).toBe(false)
    expect(beforeRelease).toBe(0)
    expect(await app.evaluate(() => Reflect.get(globalThis, '__openCalls'))).toBe(1)
    await ready(page)
    passed = true
  } finally {
    await releaseRecovery(app)
    await cleanup(owned, passed)
  }
})

test('missing-font setup survives an unavailable initial driver worker inventory', async () => {
  const owned = await launch()
  const { app } = owned
  let passed = false
  try {
    const page = await app.firstWindow()
    await page.getByRole('button', { name: 'Try demo', exact: true }).click()
    await ready(page)
    await expect(page.locator('.look-grid')).toHaveAttribute('aria-busy', 'false')
    const cdp = await page.context().newCDPSession(page)
    const targets = (await cdp.send('Target.getTargets')).targetInfos.filter(target => target.type === 'worker')
    expect(targets.some(target => target.url.includes('effects-worker'))).toBe(true)
    await cdp.detach()
    const workers = page.workers.bind(page)
    const observedWorkers = workers().map(worker => worker.url())
    // Inject the CI-observed inventory at the driver boundary, without terminating a renderer worker.
    page.workers = () => []
    await writeFile(test.info().outputPath('worker-boundary.json'), JSON.stringify({ targets, observedWorkers, injectedInventory: [] }))
    try { await prepareMissingCaptionFont(page) } finally { page.workers = workers }
    await page.getByRole('button', { name: 'Try demo', exact: true }).click()
    await ready(page)
    await section(page, 'Captions')
    const top = page.getByRole('textbox', { name: 'Top caption', exact: true })
    await top.fill('Keep these words')
    await top.blur()
    await expect(page.locator('.caption-controls [role=alert]')).toContainText('bundled Anton font could not load')
    await expect(top).toHaveValue('Keep these words')
    passed = true
  } finally { await cleanup(owned, passed) }
})

test('missing-font setup ignores a late worker event from the document being replaced', async () => {
  const owned = await launch()
  const { app } = owned
  let passed = false
  try {
    const page = await app.firstWindow()
    await expect(page.getByRole('heading', { name: 'Open your first image.' })).toBeVisible()
    await expect.poll(() => page.workers().length).toBe(1)
    const original = page.workers()[0]
    if (!original) throw new Error('Original document worker unavailable for late-event injection')
    const originalURL = await original.evaluate(() => location.href)
    expect(originalURL).toContain('effects-worker')
    const before = await page.evaluate(() => performance.timeOrigin)
    let closed = false
    original.on('close', () => { closed = true })
    const reload = page.reload.bind(page)
    const emit = Reflect.get(page, 'emit')
    if (typeof emit !== 'function') throw new Error('Driver event delivery unavailable')
    let delivered = false
    page.reload = async (...args) => {
      // Replay delayed driver delivery of the live original worker, then replace its document.
      delivered = true
      emit.call(page, 'worker', original)
      return reload(...args)
    }
    let setupError: unknown = null
    try { await prepareMissingCaptionFont(page) } catch (error) { setupError = error }
    finally { page.reload = reload }
    const after = await page.evaluate(() => performance.timeOrigin)
    await writeFile(test.info().outputPath('worker-generation.json'), JSON.stringify({
      before, after, originalURL, delivered, closed, setupError: setupError === null ? null : String(setupError)
    }))
    expect(delivered).toBe(true)
    expect(after).not.toBe(before)
    expect(closed).toBe(true)
    if (setupError !== null) throw setupError
    await page.getByRole('button', { name: 'Try demo', exact: true }).click()
    await ready(page)
    await expect(page.locator('.look-grid')).toHaveAttribute('aria-busy', 'false')
    await section(page, 'Captions')
    const top = page.getByRole('textbox', { name: 'Top caption', exact: true })
    await top.fill('Keep these words')
    await top.blur()
    await expect(page.locator('.caption-controls [role=alert]')).toContainText('bundled Anton font could not load')
    await expect(top).toHaveValue('Keep these words')
    await page.reload()
    await expect(page.getByRole('heading', { name: 'Open your first image.' })).toBeVisible()
    await expect.poll(() => page.workers().map(worker => worker.url())).toEqual([originalURL])
    await page.getByRole('button', { name: 'Try demo', exact: true }).click()
    await ready(page)
    await section(page, 'Captions')
    await top.fill('Font works after setup is removed')
    await top.blur()
    await ready(page)
    await expect(page.locator('.caption-controls [role=alert]')).toHaveCount(0)
    await expect(top).toHaveValue('Font works after setup is removed')
    passed = true
  } finally { await cleanup(owned, passed) }
})
