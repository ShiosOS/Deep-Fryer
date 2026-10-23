import { legacyPresetFixture, legacyPresetField } from './fixtures/legacy-format'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { intensityFromSlider, intensityToSlider } from '../src/renderer/src/effect-controls'
import { presetSchema } from '../src/shared/preset'
import { parsePreset } from '../src/main/document-files'
import { readFile } from 'node:fs/promises'

test('half the intensity slider covers zero to neutral and numeric values round trip through its inverse', () => {
  assert.deepEqual([0, 25, 50, 75, 100].map(intensityFromSlider), [0, 50, 100, 300, 500])
  for (let native = 0; native <= 500; native++) assert.equal(intensityFromSlider(intensityToSlider(native)), native)
})

test('5x is valid only in the new domain while the frozen v1 limits still reject it', async () => {
  const effect = { id: 'contrast', kind: 'contrast', enabled: true, mix: 100, value: 500 }
  assert.equal(presetSchema.parse({ seed: 1, effects: [effect] }).effects[0]?.kind, 'contrast')
  assert.equal(presetSchema.safeParse({ seed: 1, effects: [{ ...effect, value: 501 }] }).success, false)
  const old = JSON.parse(await readFile(`tests/fixtures/v1/${legacyPresetFixture}`, 'utf8'))
  old[legacyPresetField].effects = [effect]
  assert.throws(() => parsePreset(JSON.stringify(old)), /invalid or unsupported/)
})
