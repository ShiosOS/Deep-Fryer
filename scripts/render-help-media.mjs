import { build } from 'esbuild'
import { _electron as electron } from '@playwright/test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import gifenc from 'gifenc'

delete process.env.ELECTRON_RUN_AS_NODE
const output = resolve('src/renderer/src/assets/help')
await mkdir(output, { recursive: true })
await mkdir('resources', { recursive: true })
const bundle = await build({ entryPoints: ['src/renderer/src/effects.ts'], bundle: true, format: 'iife', globalName: 'HelpEngine', write: false })
const source = (await readFile(join(output, 'source.jpg'))).toString('base64')
const icon = (await readFile('src/renderer/src/assets/minimal-app-icon.svg')).toString('base64')
const profile = await mkdtemp(join(tmpdir(), 'deep-fryer-media-'))
const app = await electron.launch({ args: [resolve('.'), `--user-data-dir=${profile}`], env: { ...process.env, ELECTRON_RENDERER_URL: '' } })

async function render({ source, icon }) {
  const bitmap = await createImageBitmap(await (await fetch(`data:image/jpeg;base64,${source}`)).blob())
  const width = 480, height = Math.round(bitmap.height * width / bitmap.width)
  const canvas = document.createElement('canvas')
  canvas.width = width; canvas.height = height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  context.drawImage(bitmap, 0, 0, width, height)
  const original = context.getImageData(0, 0, width, height)
  bitmap.close()
  const base = { enabled: true, mix: 100 }
  const effects = {
    brightness: { ...base, id: 'brightness', kind: 'brightness', value: 35 },
    contrast: { ...base, id: 'contrast', kind: 'contrast', value: 500 },
    saturation: { ...base, id: 'saturation', kind: 'saturation', value: 500 },
    levels: { ...base, id: 'levels', kind: 'levels', value: 4 },
    sharpen: { ...base, id: 'sharpen', kind: 'sharpen', value: 200 },
    noise: { ...base, id: 'noise', kind: 'noise', value: 70 },
    jpeg: { ...base, id: 'jpeg', kind: 'jpeg', quality: 8, passes: 3, background: '#ffffff' },
    bulge: { ...base, id: 'bulge', kind: 'bulge', x: .5, y: .5, radius: .45, strength: 85 }
  }
  const images = {}, presets = {}, frames = []
  async function image(name, stack) {
    const preset = { seed: 3328622589, effects: stack }
    const result = await HelpEngine.renderPreset(original, preset)
    context.putImageData(result, 0, 0)
    images[name] = canvas.toDataURL('image/png').split(',')[1]
    presets[name] = preset
  }
  await image('original', [])
  for (const [name, effect] of Object.entries(effects)) await image(name, [effect])
  await image('jpeg-sharpen', [effects.jpeg, effects.sharpen])
  await image('sharpen-jpeg', [effects.sharpen, effects.jpeg])
  const poster = document.createElement('canvas')
  poster.width = width * 3; poster.height = height + 32
  const posterContext = poster.getContext('2d')
  for (const [index, value] of [100, 200, 500].entries()) {
    await image(`contrast-${value}`, [{ ...effects.contrast, value }])
    const frame = document.createElement('canvas')
    frame.width = width; frame.height = height + 32
    const ctx = frame.getContext('2d')
    ctx.drawImage(canvas, 0, 0)
    ctx.fillStyle = '#28232c'; ctx.fillRect(0, height, width, 32)
    ctx.fillStyle = '#f3edf3'; ctx.font = '16px sans-serif'; ctx.fillText(`${value / 100}× contrast`, 14, height + 22)
    frames.push(Array.from(ctx.getImageData(0, 0, width, height + 32).data))
    posterContext.drawImage(frame, index * width, 0)
  }
  images['contrast-poster'] = poster.toDataURL('image/png').split(',')[1]
  const iconImage = new Image()
  iconImage.src = `data:image/svg+xml;base64,${icon}`
  await iconImage.decode()
  const icons = []
  for (const size of [16, 32, 48, 64, 128, 256]) {
    const surface = document.createElement('canvas')
    surface.width = surface.height = size
    surface.getContext('2d').drawImage(iconImage, 0, 0, size, size)
    icons.push({ size, png: surface.toDataURL('image/png').split(',')[1] })
  }
  return { images, presets, frames, icons, width, height: height + 32 }
}

try {
  const result = await app.evaluate(async ({ BrowserWindow }, { code, render, input }) => {
    const window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true } })
    try {
      await window.loadURL('about:blank')
      await window.webContents.executeJavaScript(code)
      return await window.webContents.executeJavaScript(`(${render})(${JSON.stringify(input)})`)
    } finally { window.destroy() }
  }, { code: bundle.outputFiles[0].text, render: render.toString(), input: { source, icon } })
  const hashes = {}
  for (const [name, base64] of Object.entries(result.images)) {
    const bytes = Buffer.from(base64, 'base64')
    await writeFile(join(output, `${name}.png`), bytes)
    hashes[name] = createHash('sha256').update(bytes).digest('hex')
  }
  const gif = gifenc.GIFEncoder()
  for (const frame of result.frames) {
    const rgba = new Uint8Array(frame)
    const palette = gifenc.quantize(rgba, 256)
    gif.writeFrame(gifenc.applyPalette(rgba, palette), result.width, result.height, { palette, delay: 1200, repeat: 0 })
  }
  gif.finish()
  await writeFile(join(output, 'contrast-demo.gif'), gif.bytes())
  const icons = result.icons.map(({ size, png }) => ({ size, bytes: Buffer.from(png, 'base64') }))
  const header = Buffer.alloc(6 + icons.length * 16)
  header.writeUInt16LE(1, 2); header.writeUInt16LE(icons.length, 4)
  let offset = header.length
  icons.forEach(({ size, bytes }, index) => {
    const position = 6 + index * 16
    header[position] = header[position + 1] = size === 256 ? 0 : size
    header.writeUInt16LE(1, position + 4); header.writeUInt16LE(32, position + 6)
    header.writeUInt32LE(bytes.length, position + 8); header.writeUInt32LE(offset, position + 12)
    offset += bytes.length
  })
  await writeFile('resources/icon.ico', Buffer.concat([header, ...icons.map((entry) => entry.bytes)]))
  await writeFile('resources/icon.png', icons.at(-1).bytes)
  await writeFile(join(output, 'manifest.json'), JSON.stringify({ generator: 'scripts/render-help-media.mjs', electron: await app.evaluate(() => process.versions.electron), seed: 3328622589, presets: result.presets, sha256: hashes }, null, 2) + '\n')
  console.log(`Rendered ${Object.keys(hashes).length} examples with the actual engine, a contrast GIF, and six icon sizes.`)
} finally { await app.close(); await rm(profile, { recursive: true, force: true }) }
