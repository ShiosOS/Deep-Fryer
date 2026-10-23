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

export const presetSchema = z.object({
  seed: z.number().int().min(0).max(0xffffffff), effects: z.array(effectSchema).max(64, 'Use at most 64 effects')
}).refine((preset) => new Set(preset.effects.map((effect) => effect.id)).size === preset.effects.length, 'Effect identities must be unique')
  .refine((preset) => preset.effects.reduce((count, effect) => count + (effect.kind === 'jpeg' && effect.enabled && effect.mix > 0 ? effect.passes : 0), 0) <= 8, 'Use at most eight active JPEG passes')

export type Effect = z.infer<typeof effectSchema>
export type Preset = z.infer<typeof presetSchema>
export type EffectKind = Effect['kind']

export const effectOptions: ReadonlyArray<{ kind: EffectKind; label: string; min?: number; max?: number }> = [
  { kind: 'brightness', label: 'Brightness', min: -100, max: 100 },
  { kind: 'contrast', label: 'Contrast', min: 0, max: 500 },
  { kind: 'saturation', label: 'Saturation', min: 0, max: 500 },
  { kind: 'levels', label: 'Color levels', min: 2, max: 256 },
  { kind: 'sharpen', label: 'Sharpen', min: 0, max: 200 },
  { kind: 'noise', label: 'Noise', min: 0, max: 100 },
  { kind: 'jpeg', label: 'JPEG damage' },
  { kind: 'bulge', label: 'Bulge / pinch' }
]

export function newEffect(kind: EffectKind, id: string = crypto.randomUUID()): Effect {
  const common = { id, enabled: true, mix: 100 }
  switch (kind) {
    case 'brightness': return { ...common, kind, value: 0 }
    case 'contrast': return { ...common, kind, value: 100 }
    case 'saturation': return { ...common, kind, value: 100 }
    case 'levels': return { ...common, kind, value: 256 }
    case 'sharpen': return { ...common, kind, value: 0 }
    case 'noise': return { ...common, kind, value: 0 }
    case 'jpeg': return { ...common, kind, quality: 50, passes: 0, background: '#ffffff' }
    case 'bulge': return { ...common, kind, x: 0.5, y: 0.5, radius: 0.25, strength: 50 }
  }
}

export function newPreset(): Preset {
  return { seed: crypto.getRandomValues(new Uint32Array(1))[0]!, effects: [
    newEffect('brightness'), newEffect('contrast'), newEffect('saturation'), newEffect('levels')
  ] }
}

export function isNeutralEffect(effect: Effect): boolean {
  if (!effect.enabled || effect.mix === 0) return true
  switch (effect.kind) {
    case 'brightness': case 'sharpen': case 'noise': return effect.value === 0
    case 'contrast': case 'saturation': return effect.value === 100
    case 'levels': return effect.value === 256
    case 'jpeg': return effect.passes === 0
    case 'bulge': return effect.strength === 0
  }
}

export function moveEffect(preset: Preset, id: string, direction: -1 | 1): Preset {
  const index = preset.effects.findIndex((effect) => effect.id === id)
  const other = index + direction
  if (index < 0 || other < 0 || other >= preset.effects.length) return preset
  const effects = [...preset.effects]
  ;[effects[index], effects[other]] = [effects[other]!, effects[index]!]
  return { ...preset, effects }
}

export function replaceEffect(preset: Preset, changed: Effect): Preset {
  return { ...preset, effects: preset.effects.map((effect) => effect.id === changed.id ? changed : effect) }
}
