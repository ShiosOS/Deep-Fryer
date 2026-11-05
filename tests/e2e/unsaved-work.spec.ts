import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { PNG } from 'pngjs'
import { controls, fileAction, ready } from './ui'

async function launch(profile: string): Promise<ElectronApplication> {
  return electron.launch({ args: [resolve('.'), `--user-data-dir=${profile}`], env: { ...process.env, ELECTRON_RENDERER_URL: '' } })
}

async function choose(app: ElectronApplication, response: number): Promise<void> {
  await app.evaluate(({ dialog }, response) => {
    dialog.showMessageBox = async () => ({ response, checkboxChecked: false })
  }, response)
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
  await choose(app, 1).catch(() => {})
  await app.close().catch(() => {})
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
    await expect.poll(async () => readFile(checkpoint, 'utf8').then((text) => JSON.parse(text).preset.effects[0].value).catch(() => null)).toBe(25)
    await choose(app, 2)
    await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0]?.close() }).catch(() => {})
    await page.waitForTimeout(300).catch(() => {})
    expect(page.isClosed(), 'Cancel must keep the unsaved editor open').toBe(false)
    expect(JSON.parse(await readFile(checkpoint, 'utf8')).preset.effects[0].value).toBe(25)
  } finally { await cleanup(app, folder) }
})
