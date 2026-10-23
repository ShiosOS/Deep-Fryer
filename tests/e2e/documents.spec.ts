import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { PNG } from 'pngjs'
import { spawnSync } from 'node:child_process'

function fixture(width: number, height: number): Buffer {
  const image = new PNG({ width, height })
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    image.data.set([(x * 31 + y * 7) % 256, (x * 11 + y * 43) % 256, (x * 17 + y * 19) % 256, x % 9 === 0 ? 128 : 255], (y * width + x) * 4)
  }
  return PNG.sync.write(image)
}
async function launch(profile: string): Promise<ElectronApplication> {
  const executable = process.env.DEEP_FRYER_EXECUTABLE ?? process.env.ELECTRON_EXECUTABLE_PATH
  const app = await electron.launch({ ...(executable ? { executablePath: executable } : {}),
    args: [...(process.env.DEEP_FRYER_EXECUTABLE ? [] : [resolve('.')]), `--user-data-dir=${profile}`],
    env: { ...process.env, ELECTRON_RENDERER_URL: '' } })
  expect(await app.evaluate(({ app }) => app.getPath('userData'))).toBe(profile)
  return app
}
async function selectOpen(app: ElectronApplication, path: string): Promise<void> {
  await app.evaluate(({ dialog }, selected) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selected] }) }, path)
}
async function selectSave(app: ElectronApplication, path: string): Promise<void> {
  await app.evaluate(({ dialog }, selected) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: selected }) }, path)
}
async function pixels(page: Page): Promise<number[]> {
  return page.getByLabel('Edited full resolution image canvas').evaluate((element) => {
    if (!(element instanceof HTMLCanvasElement)) throw new Error('The preview canvas is missing')
    const context = element.getContext('2d')
    if (!context) throw new Error('The preview context is missing')
    return Array.from(context.getImageData(0, 0, element.width, element.height).data)
  })
}
async function ready(page: Page): Promise<void> { await expect(page.getByRole('button', { name: 'Export PNG' })).toBeEnabled() }
async function exportTo(app: ElectronApplication, page: Page, path: string): Promise<PNG> {
  await selectSave(app, path)
  await page.getByRole('button', { name: 'Export PNG' }).click()
  await expect(page.getByRole('status')).toContainText(`Saved ${path.split(/[\\/]/).pop()}`)
  return PNG.sync.read(await readFile(path))
}

test('portable project moves without its source, preset scales to another image, and incompatible files preserve the current edit', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'deep-fryer-documents-'))
  const source = join(folder, 'original.png')
  const larger = join(folder, 'another-size.png')
  const project = join(folder, 'edit.deepfryer')
  const moved = join(folder, 'moved.deepfryer')
  const preset = join(folder, 'look.frypreset')
  const bytes = fixture(120, 80)
  await writeFile(source, bytes)
  await writeFile(larger, fixture(240, 160))
  const app = await launch(join(folder, 'profile'))
  try {
    const page = await app.firstWindow()
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await selectOpen(app, source)
    await page.getByRole('button', { name: 'Open image' }).click()
    await page.getByRole('spinbutton', { name: 'Contrast value' }).fill('145')
    await ready(page)
    await page.getByRole('combobox', { name: 'Add effect' }).selectOption('noise')
    await page.getByRole('spinbutton', { name: 'Noise value', exact: true }).fill('35')
    await ready(page)
    await page.getByRole('combobox', { name: 'Add effect' }).selectOption('bulge')
    await page.getByRole('spinbutton', { name: 'Bulge x value' }).fill('30')
    await page.getByRole('spinbutton', { name: 'Bulge y value' }).fill('70')
    await page.getByRole('spinbutton', { name: 'Bulge strength value' }).fill('-45')
    await page.getByRole('spinbutton', { name: 'Bulge strength value' }).blur()
    await ready(page)
    const before = await pixels(page)
    await selectSave(app, project)
    await page.getByRole('button', { name: 'Save project as…' }).click()
    await expect(page.getByRole('status')).toContainText('Saved edit.deepfryer')
    const savedProject = JSON.parse(await readFile(project, 'utf8'))
    expect(Buffer.from(savedProject.source.base64, 'base64')).toEqual(bytes)
    expect(Object.keys(savedProject.source).sort()).toEqual(['base64', 'mime', 'name'])
    await selectSave(app, preset)
    await page.getByRole('button', { name: 'Save preset as…' }).click()
    await expect(page.getByRole('status')).toContainText('Saved look.frypreset')
    const savedPreset = JSON.parse(await readFile(preset, 'utf8'))
    expect(Object.keys(savedPreset).sort()).toEqual(['format', 'preset', 'version'])
    expect(savedPreset.preset).toEqual(savedProject.preset)
    expect(savedPreset.preset.effects.find((effect: { kind: string }) => effect.kind === 'bulge')).toMatchObject({ x: 0.3, y: 0.7, strength: -45 })
    await rename(project, moved)
    await rm(source)
    await selectOpen(app, larger)
    await page.getByRole('button', { name: 'Open image' }).click()
    await ready(page)
    await selectOpen(app, moved)
    await page.getByRole('button', { name: 'Open project' }).click()
    await ready(page)
    expect(await pixels(page)).toEqual(before)
    await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled()
    expect(Array.from((await exportTo(app, page, join(folder, 'reopened.png'))).data)).toEqual(before)

    await selectSave(app, moved)
    await page.getByRole('button', { name: 'Save project as…' }).click()
    await expect(page.getByRole('status')).toContainText('already exists')
    expect(JSON.parse(await readFile(moved, 'utf8'))).toEqual(savedProject)
    const incompatible = join(folder, 'future.deepfryer')
    const broken = join(folder, 'broken.deepfryer')
    await writeFile(incompatible, JSON.stringify({ ...savedProject, version: 100 }))
    await writeFile(broken, JSON.stringify({ ...savedProject, source: { ...savedProject.source, base64: bytes.subarray(0, 33).toString('base64') } }))
    for (const invalid of [incompatible, broken]) {
      await selectOpen(app, invalid)
      await page.getByRole('button', { name: 'Open project' }).click()
      await expect(page.locator('.notice.error')).toBeVisible()
      expect(await pixels(page)).toEqual(before)
    }
    await selectOpen(app, larger)
    await page.getByRole('button', { name: 'Open image' }).click()
    await ready(page)
    await selectOpen(app, preset)
    await page.getByRole('button', { name: 'Load preset', exact: true }).click()
    await ready(page)
    await expect(page.getByRole('spinbutton', { name: 'Contrast value' })).toHaveValue('145')
    await expect(page.getByRole('spinbutton', { name: 'Bulge x value' })).toHaveValue('30')
    await expect(page.getByRole('spinbutton', { name: 'Noise pattern' })).toHaveValue(String(savedPreset.preset.seed))
    const largerPixels = await pixels(page)
    const futurePreset = join(folder, 'future.frypreset')
    await writeFile(futurePreset, JSON.stringify({ ...savedPreset, version: 200 }))
    await selectOpen(app, futurePreset)
    await page.getByRole('button', { name: 'Load preset', exact: true }).click()
    await expect(page.getByRole('status')).toContainText('version is not supported')
    expect(await pixels(page)).toEqual(largerPixels)
    await selectOpen(app, larger)
    await page.getByRole('button', { name: 'Open image' }).click()
    await ready(page)
    await selectOpen(app, preset)
    await page.getByRole('button', { name: 'Load preset', exact: true }).click()
    await ready(page)
    expect(await pixels(page)).toEqual(largerPixels)
    const exported = await exportTo(app, page, join(folder, 'scaled-look.png'))
    expect([exported.width, exported.height]).toEqual([240, 160])
    expect(Array.from(exported.data)).toEqual(largerPixels)
    await page.setViewportSize({ width: 1260, height: 950 })
    await page.locator('.sidebar').evaluate((element) => { element.scrollTop = 0 })
    await mkdir('.artifacts', { recursive: true })
    await page.screenshot({ path: '.artifacts/portable-project.png' })
    expect(errors).toEqual([])
  } finally { await app.close(); await rm(folder, { recursive: true, force: true }) }
})

test('unexpected process stop restores the last valid generation, falls back from corruption, and discard removes both recovery copies', async () => {
  test.setTimeout(90_000)
  const folder = await mkdtemp(join(tmpdir(), 'deep-fryer-recovery-'))
  const profile = join(folder, 'profile')
  const source = join(folder, 'recover-me.png')
  const recovery = join(profile, 'recovery')
  await writeFile(source, fixture(100, 70))
  let app = await launch(profile)
  try {
    let page = await app.firstWindow()
    await selectOpen(app, source)
    await page.getByRole('button', { name: 'Open image' }).click()
    await ready(page)
    await page.getByRole('spinbutton', { name: 'Brightness value' }).fill('25')
    await page.getByRole('spinbutton', { name: 'Brightness value' }).blur()
    await ready(page)
    const first = await pixels(page)
    await expect(page.getByRole('note')).toContainText('Recovery saved')
    await page.getByRole('spinbutton', { name: 'Brightness value' }).fill('50')
    await page.getByRole('spinbutton', { name: 'Brightness value' }).blur()
    await ready(page)
    await expect.poll(async () => JSON.parse(await readFile(join(recovery, 'latest.deepfryer'), 'utf8')).preset.effects[0].value).toBe(50)
    expect(JSON.parse(await readFile(join(recovery, 'previous.deepfryer'), 'utf8')).preset.effects[0].value).toBe(25)
    await rm(source)
    await app.evaluate(({ app }) => app.exit(19)).catch(() => {})
    app = await launch(profile)
    page = await app.firstWindow()
    const offeredBytes = await readFile(join(recovery, 'latest.deepfryer'))
    const replacement = join(folder, 'replacement.png')
    await writeFile(replacement, fixture(40, 30))
    await app.evaluate(({ ipcMain }, offer) => {
      ipcMain.removeHandler('recovery:offer')
      ipcMain.handle('recovery:offer', () => new Promise((resolve) => {
        Reflect.set(globalThis, '__releaseRecoveryLookup', () => resolve(offer))
      }))
    }, { name: 'recover-me.png', savedAt: new Date().toISOString(), directory: recovery })
    await page.reload()
    await expect(page.locator('.open-button')).toBeDisabled()
    await selectOpen(app, replacement)
    await page.keyboard.press('Control+o')
    await page.waitForTimeout(1100)
    expect(await readFile(join(recovery, 'latest.deepfryer'))).toEqual(offeredBytes)
    await app.evaluate(() => {
      const release = Reflect.get(globalThis, '__releaseRecoveryLookup')
      if (typeof release !== 'function') throw new Error('The delayed recovery request was not received')
      release()
    })
    await expect(page.getByRole('alertdialog')).toContainText('recover-me.png')
    await mkdir('.artifacts', { recursive: true })
    await page.screenshot({ path: '.artifacts/recovery-prompt.png' })
    await page.getByRole('button', { name: 'Restore work' }).click()
    await expect(page.getByRole('alertdialog')).toHaveCount(0)
    await ready(page)
    await expect(page.getByRole('spinbutton', { name: 'Brightness value' })).toHaveValue('50')
    const latest = await pixels(page)
    expect(Array.from((await exportTo(app, page, join(folder, 'recovered.png'))).data)).toEqual(latest)
    await app.evaluate(({ app }) => app.exit(19)).catch(() => {})
    await writeFile(join(recovery, 'latest.deepfryer'), 'interrupted and corrupt')
    app = await launch(profile)
    page = await app.firstWindow()
    await expect(page.getByRole('alertdialog')).toBeVisible()
    await page.getByRole('button', { name: 'Restore work' }).click()
    await ready(page)
    await expect(page.getByRole('spinbutton', { name: 'Brightness value' })).toHaveValue('25')
    expect(await pixels(page)).toEqual(first)
    await app.evaluate(({ app }) => app.exit(19)).catch(() => {})
    app = await launch(profile)
    page = await app.firstWindow()
    await expect(page.getByRole('alertdialog')).toBeVisible()
    await page.getByRole('button', { name: 'Discard recovery' }).click()
    await expect(page.getByRole('alertdialog')).toHaveCount(0)
    expect(await readdir(recovery)).toEqual([])
    await expect(page.getByRole('heading', { name: 'Open your first image.' })).toBeVisible()
  } finally { await app.close().catch(() => {}); await rm(folder, { recursive: true, force: true }) }
})

test('a second application cannot own or delete the live profile recovery', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'deep-fryer-profile-owner-'))
  const profile = join(folder, 'profile')
  const source = join(folder, 'live-edit.png')
  await writeFile(source, fixture(50, 40))
  let app = await launch(profile)
  try {
    let page = await app.firstWindow()
    await selectOpen(app, source)
    await page.getByRole('button', { name: 'Open image' }).click()
    await ready(page)
    await expect(page.getByRole('note')).toContainText('Recovery saved')
    const checkpoint = join(profile, 'recovery', 'latest.deepfryer')
    const saved = await readFile(checkpoint)
    await app.evaluate(({ app }) => {
      Reflect.set(globalThis, '__secondInstanceCount', 0)
      app.on('second-instance', () => Reflect.set(globalThis, '__secondInstanceCount', Number(Reflect.get(globalThis, '__secondInstanceCount')) + 1))
    })
    const executable = await app.evaluate(() => process.execPath)
    const second = spawnSync(executable, [...(process.env.DEEP_FRYER_EXECUTABLE ? [] : [resolve('.')]), `--user-data-dir=${profile}`], {
      env: { ...process.env, ELECTRON_RENDERER_URL: '' }, timeout: 10_000, windowsHide: true, encoding: 'utf8'
    })
    expect(second.error).toBeUndefined()
    expect(second.status, second.stderr).toBe(0)
    await expect.poll(() => app.evaluate(() => Reflect.get(globalThis, '__secondInstanceCount'))).toBe(1)
    expect(await readFile(checkpoint)).toEqual(saved)
    await app.evaluate(({ app }) => app.exit(19)).catch(() => {})
    app = await launch(profile)
    page = await app.firstWindow()
    await expect(page.getByRole('alertdialog')).toContainText('live-edit.png')
    await page.getByRole('button', { name: 'Restore work' }).click()
    await ready(page)
    await expect(page.locator('.filename')).toHaveText('live-edit.png')
  } finally { await app.close().catch(() => {}); await rm(folder, { recursive: true, force: true }) }
})

test('paste uses stubbed clipboard contents and a real Chromium file drop uses the standard Electron file path bridge', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'deep-fryer-paste-'))
  const bytes = fixture(80, 60)
  const app = await launch(join(folder, 'profile'))
  try {
    const page = await app.firstWindow()
    await app.evaluate(({ clipboard, ClipboardItem }, encoded) => {
      const bytes = Buffer.from(encoded, 'base64')
      clipboard.read = async () => [new ClipboardItem({ 'image/png': new Blob([bytes], { type: 'image/png' }) })]
    }, bytes.toString('base64'))
    await page.getByRole('button', { name: 'Paste image', exact: true }).click()
    await ready(page)
    await expect(page.locator('.filename')).toHaveText('Clipboard image.png')
    await page.getByRole('spinbutton', { name: 'Brightness value' }).fill('20')
    await page.getByRole('spinbutton', { name: 'Brightness value' }).blur()
    await ready(page)
    const edited = await pixels(page)
    await app.evaluate(({ clipboard }) => { clipboard.read = async () => [] })
    await page.keyboard.press('Control+v')
    await expect(page.getByRole('status')).toContainText('clipboard does not contain')
    expect(await pixels(page)).toEqual(edited)
    await page.locator('.editor').evaluate((element) => { element.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: new DataTransfer() })) })
    await expect(page.getByRole('status')).toContainText('Drop exactly one')
    expect(await pixels(page)).toEqual(edited)
    expect(Array.from((await exportTo(app, page, join(folder, 'pasted.png'))).data)).toEqual(edited)
    const dropped = join(folder, 'dropped.png')
    await writeFile(dropped, bytes)
    await page.evaluate(() => {
      const input = document.createElement('input')
      input.id = 'test-file-drop'
      input.type = 'file'
      input.hidden = true
      document.body.append(input)
    })
    await page.locator('#test-file-drop').setInputFiles(dropped)
    await page.locator('.editor').evaluate((element) => {
      const input = document.getElementById('test-file-drop')
      if (!(input instanceof HTMLInputElement) || !input.files?.[0]) throw new Error('The test file was not loaded by Chromium')
      const transfer = new DataTransfer()
      transfer.items.add(input.files[0])
      element.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }))
    })
    await expect(page.locator('.filename')).toHaveText('dropped.png')
    await ready(page)
    expect(await readFile(dropped)).toEqual(bytes)
    expect(Array.from((await exportTo(app, page, join(folder, 'dropped-export.png'))).data)).toEqual(await pixels(page))
  } finally { await app.close(); await rm(folder, { recursive: true, force: true }) }
})

test('a disposable CI machine pastes an actual Windows clipboard image without stubbing Electron', async () => {
  test.skip(process.env.CI !== 'true', 'The native clipboard check runs on a disposable CI machine to avoid replacing personal clipboard data.')
  const folder = await mkdtemp(join(tmpdir(), 'deep-fryer-native-clipboard-'))
  const bytes = fixture(72, 48)
  const app = await launch(join(folder, 'profile'))
  try {
    const page = await app.firstWindow()
    await app.evaluate(async ({ clipboard, ClipboardItem }, encoded) => {
      await clipboard.write([new ClipboardItem({ 'image/png': new Blob([Buffer.from(encoded, 'base64')], { type: 'image/png' }) })])
    }, bytes.toString('base64'))
    await page.getByRole('button', { name: 'Paste image', exact: true }).click()
    await ready(page)
    await expect(page.locator('.filename')).toHaveText('Clipboard image.png')
    const exported = await exportTo(app, page, join(folder, 'native-paste.png'))
    expect([exported.width, exported.height]).toEqual([72, 48])
    expect(Array.from(exported.data)).toEqual(await pixels(page))
    await app.evaluate(async ({ clipboard }) => { await clipboard.writeText('Unusable clipboard content') })
    await page.keyboard.press('Control+v')
    await expect(page.getByRole('status')).toContainText('clipboard does not contain')
    await expect(page.locator('.filename')).toHaveText('Clipboard image.png')
  } finally {
    await app.evaluate(({ clipboard }) => clipboard.clear()).catch(() => {})
    await app.close()
    await rm(folder, { recursive: true, force: true })
  }
})
