import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { _electron as electron, expect } from '@playwright/test'
import { encodeProject, encodePreset, parseProject } from '../src/main/document-files.ts'

const base = 'e2276f3109077299c94698f2f87747a8901c322d'
assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), base, 'Capture only on the untouched base')
const destination = 'tests/fixtures/v2'
await mkdir(destination)
await mkdir('.artifacts/caption-base', { recursive: true })
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const manifest = { base, files: {}, outer: [], content: [] }
for (const path of ['main/document-files.ts', 'main/legacy-document-codec.ts', 'main/image-files.ts', 'shared/documents.ts', 'shared/image.ts', 'shared/preset.ts', 'shared/output.ts']) {
  const bytes = execFileSync('git', ['show', `${base}:src/${path}`])
  const target = `tests/fixtures/v2-reader/src/${path}`
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, bytes)
  manifest.files[target] = hash(bytes)
}
const document = parseProject(await readFile('tests/fixtures/v1-rich/baseline.deepfryer', 'utf8'))
for (const effect of document.preset.effects) {
  if (effect.kind === 'contrast') effect.value = 450
  if (effect.kind === 'saturation') effect.value = 375
}
await writeFile(`${destination}/baseline.deepfryer`, encodeProject(document))
await writeFile(`${destination}/baseline.frypreset`, encodePreset(document.preset))
await writeFile(`${destination}/original.png`, document.source.bytes)
const profile = await mkdtemp(join(tmpdir(), 'deep-fryer-caption-base-'))
const env = { ...process.env, ELECTRON_RENDERER_URL: '' }
delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({ args: [resolve('.'), `--user-data-dir=${profile}`], env })
const child = app.process()
try {
  const page = await app.firstWindow()
  await expect(page.getByRole('button', { name: 'Choose an image', exact: true })).toBeEnabled()
  await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }) }, resolve(`${destination}/baseline.deepfryer`))
  await page.getByRole('button', { name: 'File', exact: true }).click()
  await page.getByRole('button', { name: 'Open project', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Export', exact: true })).toBeEnabled()
  const frame = await page.getByLabel('Edited full resolution image canvas').evaluate(canvas => ({ width: canvas.width, height: canvas.height, pixels: Array.from(canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data), png: canvas.toDataURL('image/png').split(',')[1] }))
  await writeFile(`${destination}/baseline.png`, Buffer.from(frame.png, 'base64'))
  await writeFile(`${destination}/expected.json`, JSON.stringify({ width: frame.width, height: frame.height, pixels: frame.pixels, rgbaSha256: hash(Buffer.from(frame.pixels)) }))
  await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }) }, resolve('src/renderer/src/assets/demo/toast-cat.png'))
  await page.getByRole('button', { name: 'File', exact: true }).click()
  await page.getByRole('button', { name: 'Open image', exact: false }).click()
  await expect(page.getByRole('button', { name: 'Export', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: 'Crispy color', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Export', exact: true })).toBeEnabled()
  const sizes = await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0]
    window.setSize(900, 620)
    return { outer: window.getSize(), content: window.getContentSize() }
  })
  Object.assign(manifest, sizes)
  await page.screenshot({ path: '.artifacts/caption-base/actual-editor.png' })
  for (const variant of ['stacked', 'tabbed']) {
    await page.evaluate(variant => {
      document.querySelector('#caption-prototype')?.remove()
      const box = document.createElement('section')
      box.id = 'caption-prototype'
      box.style.cssText = 'padding:0 0 16px;border-bottom:1px solid var(--line);margin-bottom:16px'
      box.innerHTML = variant === 'stacked' ? '<h3>Captions</h3><label>Top<textarea>WHEN THE TOAST</textarea></label><label>Bottom<textarea>IS A LITTLE TOO CRISPY</textarea></label><details><summary>Text size</summary><input type="range"></details><button>Clear captions</button>' : '<h3>Captions</h3><div><button>Top</button> <button>Bottom</button></div><textarea>WHEN THE TOAST</textarea><label>Text size<input type="range"></label><button>Clear captions</button>'
      for (const input of box.querySelectorAll('textarea')) input.style.cssText = 'display:block;resize:vertical;width:100%;height:52px;margin:6px 0 10px;padding:8px;font:13px Segoe UI;background:var(--paper);color:var(--text);border:1px solid var(--line);border-radius:8px'
      document.querySelector('.sidebar').prepend(box)
      document.querySelector('.sidebar').scrollTop = 0
    }, variant)
    await page.screenshot({ path: `.artifacts/caption-base/${variant}.png` })
  }
  for (const name of ['baseline.deepfryer', 'baseline.frypreset', 'original.png', 'baseline.png', 'expected.json']) manifest.files[`${destination}/${name}`] = hash(await readFile(`${destination}/${name}`))
  await writeFile(`${destination}/manifest.json`, JSON.stringify(manifest, null, 2) + '\n')
} finally {
  await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false }) })
  await app.close()
  assert.equal(child.exitCode, 0)
  await rm(profile, { recursive: true, force: true })
}
