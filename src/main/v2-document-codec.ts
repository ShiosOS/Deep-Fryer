import { z } from 'zod'

const base = { id: z.string().min(1), enabled: z.boolean(), mix: z.number().int().min(0).max(100) }
const effectSchema = z.discriminatedUnion('kind', [
  z.object({ ...base, kind: z.literal('brightness'), value: z.number().int().min(-100).max(100) }),
  z.object({ ...base, kind: z.literal('contrast'), value: z.number().int().min(0).max(500) }),
  z.object({ ...base, kind: z.literal('saturation'), value: z.number().int().min(0).max(500) }),
  z.object({ ...base, kind: z.literal('levels'), value: z.number().int().min(2).max(256) }),
  z.object({ ...base, kind: z.literal('sharpen'), value: z.number().int().min(0).max(200) }),
  z.object({ ...base, kind: z.literal('noise'), value: z.number().int().min(0).max(100) }),
  z.object({ ...base, kind: z.literal('jpeg'), quality: z.number().int().min(1).max(100), passes: z.number().int().min(0).max(8), background: z.string().regex(/^#[0-9a-fA-F]{6}$/) }),
  z.object({ ...base, kind: z.literal('bulge'), x: z.number().min(0).max(1), y: z.number().min(0).max(1), radius: z.number().min(0.01).max(1), strength: z.number().int().min(-100).max(100) })
])

const presetSchema = z.object({
  seed: z.number().int().min(0).max(0xffffffff), effects: z.array(effectSchema).max(64, 'Use at most 64 effects')
}).refine((preset) => new Set(preset.effects.map((effect) => effect.id)).size === preset.effects.length, 'Effect identities must be unique')
  .refine((preset) => preset.effects.reduce((count, effect) => count + (effect.kind === 'jpeg' && effect.enabled && effect.mix > 0 ? effect.passes : 0), 0) <= 8, 'Use at most eight active JPEG passes')



import { MAX_FILE_BYTES } from "../shared/image"
const projectFileSchema = z.strictObject({
  format: z.literal('deep-fryer-project'), version: z.literal(2),
  source: z.strictObject({
    name: z.string().min(1).max(1024).refine((name) => !/[\\/]/.test(name), 'Use an image name without a path'),
    mime: z.enum(['image/png', 'image/jpeg']),
    base64: z.string().min(4).max(Math.ceil(MAX_FILE_BYTES / 3) * 4)
  }),
  preset: presetSchema
})
const presetFileSchema = z.strictObject({ format: z.literal('deep-fryer-preset'), version: z.literal(2), preset: presetSchema })

export const decodeV2Project = (raw: unknown) => projectFileSchema.parse(raw)
export const decodeV2Preset = (raw: unknown) => presetFileSchema.parse(raw).preset
