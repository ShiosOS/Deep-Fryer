import assert from 'node:assert/strict'
import test from 'node:test'
import { applyPixelEffect, renderRecipe } from '../src/renderer/src/effects'
import { moveEffect, type Recipe } from '../src/shared/recipe'

Object.defineProperty(globalThis, 'ImageData', { value: class {
  constructor(public data: Uint8ClampedArray, public width: number, public height: number) {}
} })

function image(values: number[], width = 1): ImageData {
  return new ImageData(Uint8ClampedArray.from(values), width, values.length / 4 / width)
}

test('effect order changes pixels and keeps instance settings attached', async () => {
  const recipe: Recipe = { version: 1, seed: 1, effects: [
    { id: 'brightness', kind: 'brightness', enabled: true, mix: 100, value: 30 },
    { id: 'levels', kind: 'levels', enabled: true, mix: 100, value: 2 }
  ] }
  const source = image([100, 80, 60, 255])
  const first = await renderRecipe(source, recipe)
  const moved = moveEffect(recipe, 'levels', -1)
  const second = await renderRecipe(source, moved)
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
  const recipe: Recipe = { version: 1, seed: 42, effects: [
    { id: 'sat', kind: 'saturation', enabled: true, mix: 100, value: 70 },
    { id: 'grain', kind: 'noise', enabled: true, mix: 100, value: 60 }
  ] }
  const first = await renderRecipe(source, recipe)
  const second = await renderRecipe(source, recipe)
  const other = await renderRecipe(source, { ...recipe, seed: 43 })
  assert.deepEqual(first.data, second.data)
  assert.notDeepEqual(first.data, other.data)
  assert.equal(recipe.effects[0]?.kind, 'saturation')
  assert.deepEqual(Array.from(source.data.subarray(0, 4)), [100, 110, 120, 255])
})
