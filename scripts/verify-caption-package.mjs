import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { _electron as electron, expect } from '@playwright/test'
import { extractFile, listPackage } from '@electron/asar'

const executable = resolve(process.argv[2] ?? '.artifacts/caption-package/win-unpacked/Deep Fryer.exe')
const output = resolve(process.argv[3] ?? '.artifacts/caption-packaged-proof')
await mkdir(output)
const profile = await mkdtemp(join(tmpdir(), 'deep-fryer-caption-package-'))
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const report = { executable, profile, head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), passed: false, errors: [] }
const env = { ...process.env, ELECTRON_RENDERER_URL: '' }
delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({ executablePath: executable, args: [`--user-data-dir=${profile}`], env })
const child = app.process()
const stderr = []
child.stderr?.on('data', bytes => stderr.push(bytes.toString()))
try {
  report.runtime = await app.evaluate(({ app, BrowserWindow }) => ({ version: app.getVersion(), packaged: app.isPackaged, executable: process.execPath, profile: app.getPath('userData'), url: BrowserWindow.getAllWindows()[0].webContents.getURL() }))
  assert.equal(report.runtime.packaged, true)
  assert.equal(resolve(report.runtime.executable), executable)
  assert.equal(resolve(report.runtime.profile), profile)
  assert.ok(report.runtime.url.includes('app.asar'))
  report.executableSha256 = hash(await readFile(executable))
  const archive = join(executable, '..', 'resources', 'app.asar')
  report.asarSha256 = hash(await readFile(archive))
  const fontPath = listPackage(archive).find(path => /Anton-Regular-.*\.ttf$/.test(path))
  assert.ok(fontPath)
  report.fontSha256 = hash(extractFile(archive, fontPath.replace(/^[\\/]/, '')))
  assert.equal(report.fontSha256, 'a4ba3a92350ebb031da0cb47630ac49eb265082ca1bc0450442f4a83ab947cab')
  const page = await app.firstWindow()
  page.on('pageerror', error => report.errors.push(error.message))
  await page.getByRole('button', { name: 'Try demo', exact: true }).click()
  const ready = () => expect(page.getByRole('button', { name: 'Export', exact: true })).toBeEnabled()
  await ready()
  const pixels = () => page.getByLabel('Edited full resolution image canvas').evaluate(async canvas => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data))).join(','))
  report.beforePixels = await pixels()
  await page.locator('.caption-controls > summary').click()
  await page.getByRole('textbox', { name: 'Top caption', exact: true }).fill('BUNDLED FONT')
  await page.getByRole('textbox', { name: 'Bottom caption', exact: true }).fill('Café without a network font')
  await page.getByRole('textbox', { name: 'Bottom caption', exact: true }).blur()
  await ready()
  report.afterPixels = await pixels()
  assert.notEqual(report.beforePixels, report.afterPixels)
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(900, 620))
  report.window = await app.evaluate(({ BrowserWindow }) => ({ outer: BrowserWindow.getAllWindows()[0].getSize(), content: BrowserWindow.getAllWindows()[0].getContentSize() }))
  await page.screenshot({ path: join(output, 'captions.png') })
  await page.getByRole('button', { name: 'Help', exact: true }).click()
  await page.getByRole('tab', { name: 'Licenses', exact: true }).click()
  await expect(page.locator('.font-license')).toHaveText(await readFile('src/renderer/src/assets/fonts/OFL.txt', 'utf8'))
  await page.screenshot({ path: join(output, 'license.png') })
  assert.deepEqual(report.errors, [])
  report.passed = true
} finally {
  await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false }) })
  await app.close()
  report.processExited = child.exitCode === 0
  if (report.processExited) await rm(profile, { recursive: true, force: true })
  await writeFile(join(output, 'electron-stderr.log'), stderr.join(''))
  await writeFile(join(output, 'manifest.json'), JSON.stringify(report, null, 2))
  assert.equal(report.processExited, true)
}
console.log(join(output, 'manifest.json'))
