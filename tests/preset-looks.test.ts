import assert from 'node:assert/strict'
import test from 'node:test'
import { isNeutralEffect, presetSchema, type Preset } from '../src/shared/preset'
import { fryAmounts, namedLooks, namedPreset, parameterKey, randomizePreset, scaleFry } from '../src/renderer/src/preset-looks'

test('named looks scale from neutral to their original settings without changing randomness or identities', () => {
  for (const name of namedLooks) {
    const preset = namedPreset(name, 42)
    assert.equal(scaleFry(preset, 0).effects.every(isNeutralEffect), true)
    assert.deepEqual(scaleFry(preset, 100), preset)
    const levels = fryAmounts.map((amount) => scaleFry(preset, amount))
    assert.equal(levels.every((level) => presetSchema.safeParse(level).success && level.seed === 42), true)
    assert.deepEqual(levels[0]!.effects.map((effect) => effect.id), preset.effects.map((effect) => effect.id))
    const contrast = levels.map((level) => level.effects.find((effect) => effect.kind === 'contrast')!.value)
    assert.deepEqual(contrast, [...contrast].sort((left, right) => left - right))
  }
})

test('randomizing preserves individual locks, order and point geometry and remains reproducible', () => {
  const preset: Preset = { ...namedPreset('Crispy color', 42), effects: [...namedPreset('Crispy color', 42).effects,
    { id: 'point', kind: 'bulge', enabled: true, mix: 80, x: 0.23, y: 0.76, radius: 0.32, strength: 50 }
  ] }
  const saturation = preset.effects.find((effect) => effect.kind === 'saturation')!
  const jpeg = preset.effects.find((effect) => effect.kind === 'jpeg')!
  const locks = new Set([parameterKey(saturation, 'value'), parameterKey(jpeg, 'quality')])
  const result = randomizePreset(preset, locks, 23)
  assert.deepEqual(result, randomizePreset(preset, locks, 23))
  assert.equal(result.seed, 23)
  assert.deepEqual(result.effects.find((effect) => effect.kind === 'saturation'), saturation)
  assert.equal(result.effects.find((effect) => effect.kind === 'jpeg')!.quality, jpeg.quality)
  assert.deepEqual(result.effects.map(({ id }) => id), preset.effects.map(({ id }) => id))
  const point = result.effects.find((effect) => effect.kind === 'bulge')!
  assert.deepEqual([point.x, point.y, point.radius, point.mix], [0.23, 0.76, 0.32, 80])
  assert.equal(preset.seed, 42)
})

test('randomization reserves the JPEG pass budget for locked instances', () => {
  const preset = namedPreset('Overcooked', 42)
  const jpeg = preset.effects.find((effect) => effect.kind === 'jpeg')!
  const crowded = { ...preset, effects: [...preset.effects.filter((effect) => effect.kind !== 'jpeg'), { ...jpeg, id: 'locked', passes: 8 }, { ...jpeg, id: 'free', passes: 0 }] }
  for (let seed = 0; seed < 100; seed += 1) {
    const result = randomizePreset(crowded, new Set(['locked:passes']), seed)
    const free = result.effects.find((effect) => effect.id === 'free')
    assert.ok(free?.kind === 'jpeg')
    assert.equal(free.passes, 0)
    assert.equal(presetSchema.safeParse(result).success, true)
  }
})
