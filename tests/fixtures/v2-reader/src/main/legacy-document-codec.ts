import { z } from 'zod'
import { MAX_FILE_BYTES } from '../shared/image'

const base = { id: z.string().min(1), enabled: z.boolean(), mix: z.number().int().min(0).max(100) }
const effectSchema = z.discriminatedUnion('kind', [
  z.object({ ...base, kind: z.literal('brightness'), value: z.number().int().min(-100).max(100) }),
  z.object({ ...base, kind: z.literal('contrast'), value: z.number().int().min(0).max(200) }),
  z.object({ ...base, kind: z.literal('saturation'), value: z.number().int().min(0).max(200) }),
  z.object({ ...base, kind: z.literal('levels'), value: z.number().int().min(2).max(256) }),
  z.object({ ...base, kind: z.literal('sharpen'), value: z.number().int().min(0).max(200) }),
  z.object({ ...base, kind: z.literal('noise'), value: z.number().int().min(0).max(100) }),
  z.object({ ...base, kind: z.literal('jpeg'), quality: z.number().int().min(1).max(100), passes: z.number().int().min(0).max(8), background: z.string().regex(/^#[0-9a-fA-F]{6}$/) }),
  z.object({ ...base, kind: z.literal('bulge'), x: z.number().min(0).max(1), y: z.number().min(0).max(1), radius: z.number().min(0.01).max(1), strength: z.number().int().min(-100).max(100) })
])

const recipeSchema = z.object({
  version: z.literal(1), seed: z.number().int().min(0).max(0xffffffff), effects: z.array(effectSchema).max(64, 'Use at most 64 effects')
}).refine((recipe) => new Set(recipe.effects.map((effect) => effect.id)).size === recipe.effects.length, 'Effect identities must be unique')
  .refine((recipe) => recipe.effects.reduce((count, effect) => count + (effect.kind === 'jpeg' && effect.enabled && effect.mix > 0 ? effect.passes : 0), 0) <= 8, 'Use at most eight active JPEG passes')


const sourceSchema = z.strictObject({
  name: z.string().min(1).max(1024).refine((name) => !/[\\/]/.test(name)),
  mime: z.enum(['image/png', 'image/jpeg']),
  base64: z.string().min(4).max(Math.ceil(MAX_FILE_BYTES / 3) * 4)
})
const projectSchema = z.strictObject({ format: z.literal('deep-fryer-project'), version: z.literal(1), source: sourceSchema, recipe: recipeSchema })
const presetSchema = z.strictObject({ format: z.literal('deep-fryer-recipe'), version: z.literal(1), recipe: recipeSchema })
export const legacyPresetExtension = 'fryrecipe'

export function decodeLegacyProject(input: unknown) {
  const file = projectSchema.parse(input)
  const { version: _version, ...preset } = file.recipe
  return { source: file.source, preset }
}
export function decodeLegacyPreset(input: unknown) {
  const { version: _version, ...preset } = presetSchema.parse(input).recipe
  return preset
}
