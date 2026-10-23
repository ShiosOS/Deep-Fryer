import assert from 'node:assert/strict'
import test from 'node:test'
import { isNeutralEffect, recipeSchema, type Recipe } from '../src/renderer/src/recipe'
import { fryAmounts, namedLooks, namedRecipe, parameterKey, randomizeRecipe, scaleFry } from '../src/renderer/src/recipe-looks'

test('named looks scale from neutral to their original settings without changing randomness or identities', () => {
  for (const name of namedLooks) {
    const recipe = namedRecipe(name, 42)
    assert.equal(scaleFry(recipe, 0).effects.every(isNeutralEffect), true)
    assert.deepEqual(scaleFry(recipe, 100), recipe)
    const levels = fryAmounts.map((amount) => scaleFry(recipe, amount))
    assert.equal(levels.every((level) => recipeSchema.safeParse(level).success && level.seed === 42), true)
    assert.deepEqual(levels[0]!.effects.map((effect) => effect.id), recipe.effects.map((effect) => effect.id))
    const contrast = levels.map((level) => level.effects.find((effect) => effect.kind === 'contrast')!.value)
    assert.deepEqual(contrast, [...contrast].sort((left, right) => left - right))
  }
})

test('randomizing preserves individual locks, order and point geometry and remains reproducible', () => {
  const recipe: Recipe = { ...namedRecipe('Crispy color', 42), effects: [...namedRecipe('Crispy color', 42).effects,
    { id: 'point', kind: 'bulge', enabled: true, mix: 80, x: 0.23, y: 0.76, radius: 0.32, strength: 50 }
  ] }
  const saturation = recipe.effects.find((effect) => effect.kind === 'saturation')!
  const jpeg = recipe.effects.find((effect) => effect.kind === 'jpeg')!
  const locks = new Set([parameterKey(saturation, 'value'), parameterKey(jpeg, 'quality')])
  const result = randomizeRecipe(recipe, locks, 23)
  assert.deepEqual(result, randomizeRecipe(recipe, locks, 23))
  assert.equal(result.seed, 23)
  assert.deepEqual(result.effects.find((effect) => effect.kind === 'saturation'), saturation)
  assert.equal(result.effects.find((effect) => effect.kind === 'jpeg')!.quality, jpeg.quality)
  assert.deepEqual(result.effects.map(({ id }) => id), recipe.effects.map(({ id }) => id))
  const point = result.effects.find((effect) => effect.kind === 'bulge')!
  assert.deepEqual([point.x, point.y, point.radius, point.mix], [0.23, 0.76, 0.32, 80])
  assert.equal(recipe.seed, 42)
})

test('randomization reserves the JPEG pass budget for locked instances', () => {
  const recipe = namedRecipe('Overcooked', 42)
  const jpeg = recipe.effects.find((effect) => effect.kind === 'jpeg')!
  const crowded = { ...recipe, effects: [...recipe.effects.filter((effect) => effect.kind !== 'jpeg'), { ...jpeg, id: 'locked', passes: 8 }, { ...jpeg, id: 'free', passes: 0 }] }
  for (let seed = 0; seed < 100; seed += 1) {
    const result = randomizeRecipe(crowded, new Set(['locked:passes']), seed)
    const free = result.effects.find((effect) => effect.id === 'free')
    assert.ok(free?.kind === 'jpeg')
    assert.equal(free.passes, 0)
    assert.equal(recipeSchema.safeParse(result).success, true)
  }
})
