import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron, expect } from '@playwright/test'
import { PNG } from 'pngjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
assert.ok(args.length === 0 || (args.length === 2 && args[0] === '--output'), 'Usage: node scripts/capture-product.mjs [--output NEW_DIRECTORY]')
const output = resolve(args[1] ?? join(root, '.artifacts', `product-${new Date().toISOString().replaceAll(':', '-')}`))
await mkdir(dirname(output), { recursive: true })
await mkdir(output)
const demo = join(root, 'src/renderer/src/assets/demo/toast-cat.png')
const source = existsSync(demo) ? demo : join(root, 'src/renderer/src/assets/help/source.jpg')
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')
const report = {
  startedAt: new Date().toISOString(), output, preset: 'Crispy color', seed: 3328622589,
  mode: process.env.DEEP_FRYER_EXECUTABLE ? 'packaged' : 'built',
  executable: process.env.DEEP_FRYER_EXECUTABLE ?? process.env.ELECTRON_EXECUTABLE_PATH ?? null,
  boundaries: { openChooser: 'intercepted', saveChooser: 'not exercised', clipboard: 'not exercised', offline: 'not enforced', teardownDiscard: 'not installed yet' },
  screenshots: [], canvases: [], errors: [], teardown: { processExited: false, profileRemoved: false }
}
let app, profile, child
const stderr = []
const ownedPids = []
try {
  report.head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
  report.helperSha256 = hash(await readFile(fileURLToPath(import.meta.url)))
  report.source = { path: source, sha256: hash(await readFile(source)) }
  profile = await mkdtemp(join(tmpdir(), 'deep-fryer-product-'))
  report.profile = profile
  const env = { ...process.env, ELECTRON_RENDERER_URL: '' }
  delete env.ELECTRON_RUN_AS_NODE
  const executable = process.env.DEEP_FRYER_EXECUTABLE ?? process.env.ELECTRON_EXECUTABLE_PATH
  if (executable) assert.ok((await stat(resolve(executable))).isFile(), 'Electron executable must be a file')
  app = await electron.launch({
    ...(executable ? { executablePath: resolve(executable) } : {}), cwd: root,
    args: [...(process.env.DEEP_FRYER_EXECUTABLE ? [] : [root]), `--user-data-dir=${profile}`], env, timeout: 30_000
  })
  child = app.process()
  child.stderr?.on('data', (bytes) => stderr.push(bytes.toString()))
  app.on('console', (message) => { if (message.type() === 'error') report.errors.push(`main console: ${message.text()}`) })
  const page = await app.firstWindow()
  page.setDefaultTimeout(15_000)
  page.on('pageerror', (error) => report.errors.push(`pageerror: ${error.message}`))
  page.on('console', (message) => { if (message.type() === 'error') report.errors.push(`console: ${message.text()}`) })
  page.on('crash', () => report.errors.push('Renderer crashed'))
  report.doctor = await app.evaluate(({ app, BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0]
    if (!window) throw new Error('Editor window missing')
    return { pid: process.pid, executable: process.execPath, version: app.getVersion(), packaged: app.isPackaged, profile: app.getPath('userData'), url: window.webContents.getURL() }
  })
  assert.equal(resolve(report.doctor.profile), profile)
  assert.equal(report.doctor.packaged, report.mode === 'packaged')
  assert.ok(report.doctor.url.startsWith('file:'), 'Capture must drive built renderer files')
  report.executableSha256 = hash(await readFile(report.doctor.executable))
  const ready = () => expect(page.getByRole('button', { name: 'Export', exact: true })).toBeEnabled()
  async function resize(minimum = false) {
    const size = await app.evaluate(({ BrowserWindow }, minimum) => {
      const window = BrowserWindow.getAllWindows()[0]
      if (minimum) window.setSize(...window.getMinimumSize())
      else window.setContentSize(1120, 720)
      return window.getContentSize()
    }, minimum)
    await expect.poll(() => page.evaluate(() => [innerWidth, innerHeight])).toEqual(size)
  }
  async function theme(mode) {
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await page.getByRole('button', { name: mode, exact: true }).click()
    await expect(page.getByRole('button', { name: 'Done', exact: true })).toBeEnabled()
    await page.getByRole('button', { name: 'Done', exact: true }).click()
    await expect(page.locator('html')).toHaveAttribute('data-appearance', mode.toLowerCase())
  }
  async function screenshot(name) {
    const gallery = page.locator('.look-grid')
    if (await gallery.count()) await expect(gallery).toHaveAttribute('aria-busy', 'false')
    const bytes = await page.screenshot({ path: join(output, name), scale: 'css' })
    const png = PNG.sync.read(bytes)
    const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio }))
    assert.deepEqual([png.width, png.height], [viewport.width, viewport.height])
    const bounds = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds())
    report.screenshots.push({ name, width: png.width, height: png.height, viewport, bounds, sha256: hash(bytes) })
  }
  async function canvas(label, name) {
    const encoded = await page.getByLabel(label, { exact: true }).evaluate((canvas) => canvas.toDataURL('image/png').split(',')[1])
    const bytes = Buffer.from(encoded, 'base64')
    const png = PNG.sync.read(bytes)
    assert.ok(png.width > 0 && png.height > 0)
    await writeFile(join(output, name), bytes, { flag: 'wx' })
    report.canvases.push({ name, width: png.width, height: png.height, sha256: hash(bytes), pixelsSha256: hash(png.data) })
    return png
  }
  await expect(page.getByRole('heading', { name: 'Open your first image.' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Export', exact: true })).toBeDisabled()
  await resize()
  await theme('Dark')
  await screenshot('01-empty-dark.png')
  await app.evaluate(({ dialog }, source) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [source] })
  }, source)
  await page.getByRole('button', { name: 'Choose an image', exact: true }).click()
  await ready()
  await expect(page.locator('.filename')).toContainText(basename(source))
  const before = await canvas('Original full resolution image canvas', 'before.png')
  await screenshot('02-cat-original-dark.png')
  const look = page.getByRole('button', { name: report.preset, exact: true })
  if (await look.count()) await look.click()
  else await page.getByRole('combobox', { name: 'Preset', exact: true }).selectOption(report.preset)
  await ready()
  await page.getByRole('spinbutton', { name: 'Noise pattern', exact: true }).fill(String(report.seed))
  await page.getByRole('spinbutton', { name: 'Noise pattern', exact: true }).blur()
  await ready()
  await page.locator('.sidebar').evaluate((element) => element.scrollTo(0, 0))
  const after = await canvas('Edited full resolution image canvas', 'after.png')
  assert.deepEqual([before.width, before.height], [after.width, after.height])
  assert.notEqual(hash(before.data), hash(after.data), 'Preset must change actual rendered pixels')
  const comparison = new PNG({ width: before.width * 2, height: before.height })
  PNG.bitblt(before, comparison, 0, 0, before.width, before.height, 0, 0)
  PNG.bitblt(after, comparison, 0, 0, after.width, after.height, before.width, 0)
  await writeFile(join(output, 'before-after.png'), PNG.sync.write(comparison), { flag: 'wx' })
  report.comparison = { name: 'before-after.png', width: comparison.width, height: comparison.height, left: 'Original', right: report.preset }
  await screenshot('03-cat-crispy-dark.png')
  await theme('Light')
  await screenshot('04-cat-crispy-light.png')
  await resize(true)
  await screenshot('05-minimum-light.png')
  await resize()
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Export image', exact: true })).toBeVisible()
  await expect(page.getByLabel('Output width', { exact: true })).toHaveValue(String(after.width))
  await expect(page.getByLabel('Output height', { exact: true })).toHaveValue(String(after.height))
  await screenshot('06-export-light.png')
  await page.getByRole('button', { name: 'Close export', exact: true }).click()
  assert.equal(hash(await readFile(source)), report.source.sha256, 'Source must remain byte-identical')
  assert.deepEqual(report.errors, [])
} catch (error) {
  report.errors.push(error.stack ?? String(error))
} finally {
  if (app) {
    try {
      ownedPids.push(...await app.evaluate(({ app }) => app.getAppMetrics().map(({ pid }) => pid)))
      await app.evaluate(({ dialog }) => {
        const chooseDiscard = (options) => {
          const response = options.buttons?.findIndex((button) => /^(discard(?: changes)?|don['’]t save)$/i.test(button.replaceAll('&', '')))
          if (response === undefined || response < 0) throw new Error(`Unexpected teardown dialog: ${JSON.stringify(options)}`)
          return response
        }
        dialog.showMessageBox = async (...args) => ({ response: chooseDiscard(args.at(-1)), checkboxChecked: false })
        dialog.showMessageBoxSync = (...args) => chooseDiscard(args.at(-1))
      })
      report.boundaries.teardownDiscard = 'message box discard intercepted only during teardown; close UX unverified'
      let timer
      try {
        await Promise.race([app.close(), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Electron close exceeded 15 seconds')), 15_000) })])
      } finally { clearTimeout(timer) }
    } catch (error) {
      report.errors.push(`Teardown: ${error.message}`)
      child?.kill()
    }
    try {
      await expect.poll(() => child.exitCode !== null || child.signalCode !== null).toBe(true)
      await expect.poll(() => ownedPids.filter((pid) => {
        try { process.kill(pid, 0); return true } catch (error) { if (error.code === 'ESRCH') return false; throw error }
      })).toEqual([])
      report.teardown.processExited = true
    } catch (error) { report.errors.push(`Process exit: ${error.message}`) }
    report.teardown.pid = child?.pid
    report.teardown.ownedPids = ownedPids
    report.teardown.exitCode = child?.exitCode
    report.teardown.signal = child?.signalCode
  }
  if (profile && (!app || report.teardown.processExited)) {
    try {
      await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
      report.teardown.profileRemoved = await stat(profile).then(() => false, (error) => { if (error.code === 'ENOENT') return true; throw error })
    } catch (error) { report.errors.push(`Profile cleanup: ${error.message}`) }
  }
  await writeFile(join(output, 'electron-stderr.log'), stderr.join(''))
  report.finishedAt = new Date().toISOString()
  report.passed = report.errors.length === 0 && report.teardown.processExited && report.teardown.profileRemoved
  await writeFile(join(output, 'manifest.json'), JSON.stringify(report, null, 2) + '\n')
  for (const shot of report.screenshots) assert.ok((await stat(join(output, shot.name))).size > 0)
  console.log(`${report.passed ? 'PASS' : 'FAIL'} ${join(output, 'manifest.json')}`)
  if (!report.passed) process.exitCode = 1
}
