import { _electron as electron, expect, test } from '@playwright/test'
import { access, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { chooseUnsaved, closeDiscardingChanges } from './ui'

function launch(profile: string) {
  const executable = process.env.DEEP_FRYER_EXECUTABLE ?? process.env.ELECTRON_EXECUTABLE_PATH
  return electron.launch({
    ...(executable ? { executablePath: executable } : {}),
    args: [...(process.env.DEEP_FRYER_EXECUTABLE ? [] : [resolve('.')]), `--user-data-dir=${profile}`],
    env: { ...process.env, ELECTRON_RENDERER_URL: '' }
  })
}

test('demo is opt-in and the editor remains usable at 900 by 620', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'deep-fryer-demo-'))
  const app = await launch(folder)
  try {
    const page = await app.firstWindow()
    const nativeSize = await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0]
      if (!window) throw new Error('Editor window is missing')
      window.setSize(900, 620)
      return { minimum: window.getMinimumSize(), outer: window.getSize() }
    })
    expect(nativeSize).toEqual({ minimum: [900, 620], outer: [900, 620] })
    await expect(page.getByRole('button', { name: 'Choose an image' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Export', exact: true })).toBeDisabled()
    await page.getByRole('button', { name: 'Try demo' }).click()
    await expect(page.getByRole('button', { name: 'Export', exact: true })).toBeEnabled()
    await expect(page.locator('.filename')).toContainText('toast-cat.png')
    await expect(page.locator('.look-grid')).toHaveAttribute('aria-busy', 'false')
    for (const scheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: scheme })
      await expect(page.getByRole('button', { name: 'Help', exact: true })).toBeVisible()
      await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeVisible()
      await expect(page.getByRole('button', { name: 'Crispy color', exact: true })).toBeVisible()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight)).toBe(true)
    }
    await page.screenshot({ path: '.artifacts/demo-gallery-900.png' })
    const look = page.getByRole('button', { name: 'Crispy color', exact: true, includeHidden: true })
    await look.click()
    await expect(page.locator('.look-gallery')).not.toHaveAttribute('open', '')
    await expect(page.locator('.look-gallery summary')).toBeFocused()
    await expect(look).toHaveAttribute('aria-pressed', 'true')
    const effect = await page.locator('.effect-heading').first().boundingBox()
    if (!effect) throw new Error('First effect heading is missing')
    expect(effect.y).toBeGreaterThanOrEqual(0)
    expect(effect.y + effect.height).toBeLessThanOrEqual(await page.evaluate(() => innerHeight))
    await page.getByRole('slider', { name: 'Fry level' }).fill('50')
    await expect(look).toHaveAttribute('aria-pressed', 'false')
    await page.locator('.look-gallery summary').click()
    await expect(look).toBeVisible()
    await expect(page.getByRole('slider', { name: 'Fry level' })).toBeVisible()
  } finally {
    await closeDiscardingChanges(app)
    await rm(folder, { recursive: true, force: true })
  }
})


test('an interrupted demo offers recovery before another demo can load', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'deep-fryer-demo-recovery-'))
  let app = await launch(folder)
  try {
    let page = await app.firstWindow()
    await page.getByRole('button', { name: 'Try demo' }).click()
    await expect(page.getByRole('button', { name: 'Export', exact: true })).toBeEnabled()
    await expect.poll(() => access(join(folder, 'recovery', 'latest.deepfryer')).then(() => true, () => false)).toBe(true)
    await app.evaluate(({ app }) => app.exit(19)).catch(() => {})
    app = await launch(folder)
    page = await app.firstWindow()
    const recovery = page.getByRole('alertdialog', { name: 'Restore interrupted work?' })
    await expect(recovery).toBeVisible()
    await expect(recovery).toContainText('toast-cat.png')
    await recovery.getByRole('button', { name: 'Restore work' }).click()
    await expect(page.locator('.filename')).toContainText('toast-cat.png')
    await expect(page.getByRole('button', { name: 'Export', exact: true })).toBeEnabled()
  } finally {
    await closeDiscardingChanges(app)
    await rm(folder, { recursive: true, force: true })
  }
})

test('thumbnail failure is visible while editing remains available', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'deep-fryer-look-error-'))
  const app = await launch(folder)
  try {
    const page = await app.firstWindow()
    await expect(page.getByRole('button', { name: 'Try demo' })).toBeEnabled()
    await page.evaluate(() => {
      window.Worker = new Proxy(window.Worker, { construct() { throw new Error('Thumbnail worker unavailable') } })
    })
    await page.getByRole('button', { name: 'Try demo' }).click()
    await expect(page.getByRole('status')).toContainText('Thumbnail worker unavailable')
    await expect(page.getByRole('button', { name: 'Crispy color', exact: true })).toBeEnabled()
    await expect(page.locator('.look-grid')).toHaveAttribute('aria-busy', 'false')
  } finally {
    await closeDiscardingChanges(app)
    await rm(folder, { recursive: true, force: true })
  }
})


test('replacing the source cancels outstanding look rendering', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'deep-fryer-look-cancel-'))
  const app = await launch(folder)
  try {
    const page = await app.firstWindow()
    await expect(page.getByRole('button', { name: 'Try demo' })).toBeEnabled()
    await page.evaluate(() => {
      Reflect.set(window, 'terminatedLookWorkers', 0)
      window.Worker = new Proxy(window.Worker, {
        construct(target, args) {
          const worker: unknown = Reflect.construct(target, args)
          if (!(worker instanceof target)) throw new Error('Expected a native Worker')
          const terminate = worker.terminate.bind(worker)
          worker.postMessage = () => {}
          worker.terminate = () => { Reflect.set(window, 'terminatedLookWorkers', Number(Reflect.get(window, 'terminatedLookWorkers')) + 1); terminate() }
          return worker
        }
      })
    })
    await page.getByRole('button', { name: 'Try demo' }).click()
    await expect(page.locator('.look-grid')).toHaveAttribute('aria-busy', 'true')
    await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }) }, resolve('tests/fixtures/v1/original.png'))
    await chooseUnsaved(app, 'discard')
    await page.locator('.file-menu summary').click()
    await page.getByRole('button', { name: 'Open image' }).click()
    await expect(page.locator('.filename')).toContainText('original.png')
    await expect.poll(() => page.evaluate(() => Number(Reflect.get(window, 'terminatedLookWorkers')))).toBeGreaterThan(0)
  } finally {
    await closeDiscardingChanges(app)
    await rm(folder, { recursive: true, force: true })
  }
})
