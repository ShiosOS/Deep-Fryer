import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { test } from 'node:test'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { AppearanceStore } from '../src/main/appearance-store'
import { defaultAppearance } from '../src/shared/appearance'
import { foreground, luminance, themeVariables } from '../src/renderer/src/appearance'

test('appearance serializes replacement writes, drains on close, and retains all six colors and System across restart', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'deep-fryer-appearance-'))
  try {
    const store = new AppearanceStore(directory)
    assert.deepEqual((await store.load()).settings, defaultAppearance())
    const settings = defaultAppearance()
    settings.mode = 'system'
    settings.palettes.light = { selected: 'custom', custom: { accent: '#112233', canvas: '#fafafa', panel: '#aabbcc' } }
    settings.palettes.dark = { selected: 'custom', custom: { accent: '#ffeedd', canvas: '#222222', panel: '#445566' } }
    const first = store.save({ ...settings, mode: 'light' })
    const second = store.save(settings)
    await store.drain()
    await Promise.all([first, second])
    assert.deepEqual((await new AppearanceStore(directory).load()).settings, settings)
    assert.deepEqual(JSON.parse(await readFile(join(directory, 'appearance.json'), 'utf8')).settings, settings)
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('corrupt or future settings are preserved until an explicit reset and write failures reject', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'deep-fryer-appearance-invalid-'))
  try {
    for (const bytes of ['{broken', JSON.stringify({ version: 900, settings: defaultAppearance() })]) {
      await writeFile(join(directory, 'appearance.json'), bytes)
      const store = new AppearanceStore(directory)
      assert.match((await store.load()).notice, /Reset saved settings/)
      await assert.rejects(store.save(defaultAppearance()), /Reset saved settings/)
      assert.equal(await readFile(join(directory, 'appearance.json'), 'utf8'), bytes)
      await store.save(defaultAppearance(), true)
      assert.equal((await new AppearanceStore(directory).load()).notice, '')
    }
    const file = join(directory, 'not-a-directory')
    await writeFile(file, 'keep')
    await assert.rejects(new AppearanceStore(file).save(defaultAppearance(), true))
    assert.equal(await readFile(file, 'utf8'), 'keep')
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('custom palette foregrounds maintain at least 4.5 to 1 contrast across representative colors', () => {
  for (let r = 0; r <= 255; r += 17) for (let g = 0; g <= 255; g += 17) for (let b = 0; b <= 255; b += 17) {
    const color = '#' + [r, g, b].map((value) => value.toString(16).padStart(2, '0')).join('')
    const background = luminance(color), text = luminance(foreground(color))
    assert.ok((Math.max(background, text) + .05) / (Math.min(background, text) + .05) >= 4.5)
    const controls = themeVariables({ panel: color, canvas: color, accent: color }, 'dark', true)
    const control = luminance(controls['--control']!)
    assert.ok((Math.max(background, control) + .05) / (Math.min(background, control) + .05) >= 3)
  }
})
