import { _electron as electron, expect, test } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { controls, fileAction, ready } from './ui'

test('effect controls wait for a replacement image before expanding its cards', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'deep-fryer-disclosure-'))
  const executable = process.env.DEEP_FRYER_EXECUTABLE ?? process.env.ELECTRON_EXECUTABLE_PATH
  const app = await electron.launch({ ...(executable ? { executablePath: executable } : {}),
    args: [...(process.env.DEEP_FRYER_EXECUTABLE ? [] : [resolve('.')]), `--user-data-dir=${folder}`],
    env: { ...process.env, ELECTRON_RENDERER_URL: '' } })
  try {
    const page = await app.firstWindow()
    const source = resolve('tests/fixtures/v1/original.png')
    await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }) }, source)
    await fileAction(page, 'Open image')
    await ready(page)
    await controls(page)
    const oldPanel = await page.locator('.effects-panel').elementHandle()
    await app.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = () => new Promise((resolve) => {
        Reflect.set(globalThis, 'releaseReopen', () => resolve({ canceled: false, filePaths: [path] }))
      })
    }, source)
    await fileAction(page, 'Open image')
    await expect(page.getByRole('button', { name: 'Export', exact: true })).toBeDisabled()
    const expanding = controls(page)
    await Promise.race([expanding, page.waitForTimeout(500)])
    await app.evaluate(() => Reflect.get(globalThis, 'releaseReopen')())
    await expanding
    await ready(page)
    expect(await oldPanel?.evaluate((element) => element.isConnected)).toBe(false)
    await expect(page.locator('.effect-card')).toHaveCount(4)
    for (const card of await page.locator('.effect-card').all()) {
      await expect(card).toHaveAttribute('open', '')
      await expect(card.locator('.more-controls')).toHaveAttribute('open', '')
      await expect(card.locator('.effect-actions')).toBeVisible()
    }
  } finally { await app.close(); await rm(folder, { recursive: true, force: true }) }
})
