import { expect, test, type ElectronApplication, type Page, type TestInfo } from '@playwright/test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { RecoveryEvidence } from './recovery-evidence'
import { ready } from './ui'

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
    await page.locator('.effect-heading').first().click()
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
        await page.locator('.sidebar').evaluate(element => { element.scrollTop = 0 })
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
      }
    }
    expect(await readFile(source)).toEqual(original)
  })
})
