import assert from 'node:assert/strict'
import test from 'node:test'
import { applyPixelEffect, renderPreset } from '../src/renderer/src/effects'
import { moveEffect, type Preset } from '../src/shared/preset'

Object.defineProperty(globalThis, 'ImageData', { value: class {
  constructor(public data: Uint8ClampedArray, public width: number, public height: number) {}
} })

function image(values: number[], width = 1): ImageData {
  return new ImageData(Uint8ClampedArray.from(values), width, values.length / 4 / width)
}

test('effect order changes pixels and keeps instance settings attached', async () => {
  const preset: Preset = { seed: 1, effects: [
    { id: 'brightness', kind: 'brightness', enabled: true, mix: 100, value: 30 },
    { id: 'levels', kind: 'levels', enabled: true, mix: 100, value: 2 }
  ] }
  const source = image([100, 80, 60, 255])
  const first = await renderPreset(source, preset)
  const moved = moveEffect(preset, 'levels', -1)
  const second = await renderPreset(source, moved)
  assert.notDeepEqual(Array.from(first.data), Array.from(second.data))
  assert.deepEqual(moved.effects.map(({ id }) => id), ['levels', 'brightness'])
  assert.equal(moved.effects[1]?.kind, 'brightness')
  assert.deepEqual(Array.from(source.data), [100, 80, 60, 255])
})

test('mix, enabled state, and alpha preserve expected pixels', () => {
  const source = image([100, 80, 60, 128, 5, 7, 9, 0], 2)
  const effect = { id: 'b', kind: 'brightness', enabled: true, mix: 50, value: 20 } as const
  const result = applyPixelEffect(source, effect, 0)
  assert.deepEqual(Array.from(result.data), [126, 106, 86, 128, 5, 7, 9, 0])
  assert.deepEqual(Array.from(applyPixelEffect(source, { ...effect, enabled: false }, 0).data), Array.from(source.data))
})

test('noise is repeatable and does not alter saturation settings or source', async () => {
  const source = image(Array.from({ length: 32 }, () => [100, 110, 120, 255]).flat(), 8)
  const preset: Preset = { seed: 42, effects: [
    { id: 'sat', kind: 'saturation', enabled: true, mix: 100, value: 70 },
    { id: 'grain', kind: 'noise', enabled: true, mix: 100, value: 60 }
  ] }
  const first = await renderPreset(source, preset)
  const second = await renderPreset(source, preset)
  const other = await renderPreset(source, { ...preset, seed: 43 })
  assert.deepEqual(first.data, second.data)
  assert.notDeepEqual(first.data, other.data)
  assert.equal(preset.effects[0]?.kind, 'saturation')
  assert.deepEqual(Array.from(source.data.subarray(0, 4)), [100, 110, 120, 255])
})

test('5x contrast and saturation clip destructively while strength blends the result and preserves alpha', () => {
  const source = image([100, 130, 160, 128])
  const contrast = { id: 'c', kind: 'contrast', enabled: true, mix: 100, value: 500 } as const
  assert.deepEqual(Array.from(applyPixelEffect(source, contrast, 1).data), [0, 138, 255, 128])
  assert.deepEqual(Array.from(applyPixelEffect(source, { ...contrast, mix: 50 }, 1).data), [50, 134, 208, 128])
  assert.deepEqual(Array.from(applyPixelEffect(source, { ...contrast, kind: 'saturation' }, 1).data), [0, 147, 255, 128])
  assert.deepEqual(Array.from(applyPixelEffect(source, { ...contrast, value: 100 }, 1).data), Array.from(source.data))
})
