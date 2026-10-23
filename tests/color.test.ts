import assert from 'node:assert/strict'
import { test } from 'node:test'
import { applyColorSettings, neutralColorSettings, parseColorSetting } from '../src/renderer/src/color'

test('each color value is checked at the input boundary without committing an invalid setting', () => {
  for (const [key, raw] of [
    ['brightness', '101'], ['contrast', '-1'], ['saturation', '201'], ['levels', '1'], ['levels', '2.5'], ['contrast', 'NaN']
  ] as const) {
    assert.equal(parseColorSetting(neutralColorSettings, key, raw), null)
  }
  assert.deepEqual(parseColorSetting(neutralColorSettings, 'contrast', '150'), { ...neutralColorSettings, contrast: 150 })
  assert.deepEqual(parseColorSetting(neutralColorSettings, 'saturation', '50'), { ...neutralColorSettings, saturation: 50 })
})

test('combined settings transform RGB from a fresh source and preserve alpha', () => {
  const source = new Uint8ClampedArray([200, 100, 50, 77, 40, 80, 120, 255])
  const unchanged = applyColorSettings(source, neutralColorSettings)
  assert.deepEqual(unchanged, source)
  const changed = applyColorSettings(source, { brightness: 0, contrast: 150, saturation: 0, levels: 256 })
  assert.deepEqual(Array.from(changed), [112, 112, 112, 77, 48, 48, 48, 255])
  assert.deepEqual(Array.from(source), [200, 100, 50, 77, 40, 80, 120, 255])
  const reduced = applyColorSettings(source, { ...neutralColorSettings, levels: 2 })
  assert.deepEqual(Array.from(reduced), [255, 0, 0, 77, 0, 0, 0, 255])
})
