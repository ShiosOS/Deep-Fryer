import assert from 'node:assert/strict'
import { test } from 'node:test'
import { freezeOutput } from '../src/renderer/src/output'
import { newRecipe } from '../src/shared/recipe'
import { outputOptionsSchema } from '../src/shared/output'

test('output freezes original bytes, effect settings, and options before asynchronous work', () => {
  const source = { name: 'source.png', mime: 'image/png', bytes: new Uint8Array([1, 2, 3]) } satisfies Parameters<typeof freezeOutput>[0]
  const recipe = newRecipe()
  const options = { format: 'jpeg', width: 400, height: 300, quality: 42, background: '#123456' } satisfies Parameters<typeof freezeOutput>[2]
  const frozen = freezeOutput(source, recipe, options)
  source.bytes.fill(9)
  recipe.seed = 123
  recipe.effects[0]!.mix = 0
  options.quality = 99
  assert.deepEqual(frozen.source.bytes, new Uint8Array([1, 2, 3]))
  assert.notEqual(frozen.recipe.seed, recipe.seed)
  assert.equal(frozen.recipe.effects[0]!.mix, 100)
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
