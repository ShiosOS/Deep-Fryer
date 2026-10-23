import assert from 'node:assert/strict'
import { extractFile, listPackage } from '@electron/asar'
import { readFile, mkdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { PNG } from 'pngjs'

const asar = resolve('release/win-unpacked/resources/app.asar')
const packaged = listPackage(asar)
for (const file of ['resources/icon.png', 'resources/icon.ico']) assert.deepEqual(extractFile(asar, file), await readFile(file))
for (const asset of ['editor-', 'points-', 'contrast-demo-']) assert.ok(packaged.some((path) => path.includes(asset)))
const ico = await readFile('resources/icon.ico')
assert.equal(ico.readUInt16LE(4), 6)
await mkdir('.artifacts/implementation', { recursive: true })
const script = `Add-Type -AssemblyName System.Drawing
$icon = [System.Drawing.Icon]::ExtractAssociatedIcon($args[0])
try { $bitmap = $icon.ToBitmap(); try { $bitmap.Save($args[1], [System.Drawing.Imaging.ImageFormat]::Png) } finally { $bitmap.Dispose() } } finally { $icon.Dispose() }`
const { writeFile } = await import('node:fs/promises')
await writeFile('.artifacts/implementation/extract-icon.ps1', script)
execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', resolve('.artifacts/implementation/extract-icon.ps1'), resolve('release/win-unpacked/Deep Fryer.exe'), resolve('.artifacts/implementation/packaged-icon.png')], { windowsHide: true })
const extracted = PNG.sync.read(await readFile('.artifacts/implementation/packaged-icon.png'))
let matched = false
for (let index = 0; index < 6; index++) {
  const start = 6 + index * 16
  const offset = ico.readUInt32LE(start + 12), length = ico.readUInt32LE(start + 8)
  const expected = PNG.sync.read(ico.subarray(offset, offset + length))
  if (expected.width === extracted.width && expected.height === extracted.height) {
    assert.deepEqual(extracted.data, expected.data)
    matched = true
  }
}
assert.ok(matched, 'The executable icon matches a chosen SVG raster size')
const result = { resources: ['icon.png', 'icon.ico'], mediaPresent: true, executableIcon: `${extracted.width}×${extracted.height}`, iconRgbaSha256: createHash('sha256').update(extracted.data).digest('hex') }
await writeFile('.artifacts/implementation/package-verification.json', JSON.stringify(result, null, 2) + '\n')
console.log(JSON.stringify(result))
