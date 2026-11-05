import assert from 'node:assert/strict'
import { test } from 'node:test'
import { freezeOutput } from '../src/renderer/src/output'
import { newPreset } from '../src/shared/preset'
import { outputOptionsSchema } from '../src/shared/output'
import { proportionalOutputSize } from '../src/renderer/src/output-dimensions'

test('proportional output uses the original source ratio for either edited dimension and rounds only the other side', () => {
  const source = { width: 96, height: 64 }
  assert.deepEqual(proportionalOutputSize({ source, dimension: 'width', value: 49 }), { width: 49, height: 33 })
  assert.deepEqual(proportionalOutputSize({ source, dimension: 'height', value: 25 }), { width: 38, height: 25 })
  assert.deepEqual(proportionalOutputSize({ source, dimension: 'height', value: 32 }), { width: 48, height: 32 })
  assert.deepEqual(proportionalOutputSize({ source: { width: 64, height: 96 }, dimension: 'width', value: 20 }), { width: 20, height: 30 })
})

test('coupled output retains invalid edits and derived dimensions for the existing limits to reject', () => {
  for (const value of [0, -1, 1.5, NaN, Infinity, 16385, 6001]) {
    const size = proportionalOutputSize({ source: { width: 96, height: 64 }, dimension: 'width', value })
    assert.equal(outputOptionsSchema.safeParse({ format: 'png', ...size }).success, false)
  }
  for (const { source, dimension, value } of [
    { source: { width: 16384, height: 1 }, dimension: 'width', value: 1 },
    { source: { width: 1, height: 16384 }, dimension: 'height', value: 1 },
    { source: { width: 64, height: 96 }, dimension: 'width', value: 12000 }
  ] as const) {
    const size = proportionalOutputSize({ source, dimension, value })
    assert.equal(outputOptionsSchema.safeParse({ format: 'png', ...size }).success, false)
  }
  const boundary = proportionalOutputSize({ source: { width: 96, height: 64 }, dimension: 'width', value: 6000 })
  assert.deepEqual(boundary, { width: 6000, height: 4000 })
  assert.equal(outputOptionsSchema.safeParse({ format: 'png', ...boundary }).success, true)
})

test('output freezes original bytes, effect settings, and options before asynchronous work', () => {
  const source = { name: 'source.png', mime: 'image/png', bytes: new Uint8Array([1, 2, 3]) } satisfies Parameters<typeof freezeOutput>[0]
  const preset = newPreset()
  const options = { format: 'jpeg', width: 400, height: 300, quality: 42, background: '#123456' } satisfies Parameters<typeof freezeOutput>[2]
  const frozen = freezeOutput(source, preset, options)
  source.bytes.fill(9)
  preset.seed = 123
  preset.effects[0]!.mix = 0
  options.quality = 99
  assert.deepEqual(frozen.source.bytes, new Uint8Array([1, 2, 3]))
  assert.notEqual(frozen.preset.seed, preset.seed)
  assert.equal(frozen.preset.effects[0]!.mix, 100)
  assert.equal(frozen.options.format, 'jpeg')
  if (frozen.options.format === 'jpeg') assert.equal(frozen.options.quality, 42)
})

test('output validates dimensions, pixel budget, compression, and explicit JPEG background', () => {
  for (const options of [
    { format: 'png', width: 0, height: 1 },
    { format: 'png', width: 1.5, height: 2 },
    { format: 'png', width: 16385, height: 1 },
    { format: 'png', width: 6000, height: 4001 },
    { format: 'jpeg', width: 1, height: 1, quality: 50 },
    { format: 'jpeg', width: 1, height: 1, quality: 50, background: 'transparent' },
    { format: 'webp', width: 1, height: 1, quality: 101 }
  ]) assert.equal(outputOptionsSchema.safeParse(options).success, false)
  assert.equal(outputOptionsSchema.safeParse({ format: 'png', width: 6000, height: 4000 }).success, true)
})
