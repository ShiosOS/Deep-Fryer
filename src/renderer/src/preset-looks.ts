import { newEffect, presetSchema, type Effect, type Preset } from '../../shared/preset'

export const namedLooks = ['Crispy color', 'Noisy photocopy', 'Overcooked'] as const
export type NamedLook = typeof namedLooks[number]
export const fryAmounts = [20, 40, 60, 80, 100] as const
export type RandomParameter = 'value' | 'quality' | 'passes' | 'strength'

export function parameterKey(effect: Effect, parameter: RandomParameter): string { return `${effect.id}:${parameter}` }
export function randomParameters(effect: Effect): ReadonlyArray<{ key: RandomParameter; label: string }> {
  if (effect.kind === 'jpeg') return [{ key: 'quality', label: 'JPEG quality' }, { key: 'passes', label: 'JPEG passes' }]
  if (effect.kind === 'bulge') return [{ key: 'strength', label: 'Point strength' }]
  const labels = { brightness: 'Brightness', contrast: 'Contrast', saturation: 'Saturation', levels: 'Color levels', sharpen: 'Sharpen', noise: 'Noise' }
  return [{ key: 'value', label: labels[effect.kind] }]
}

export function namedPreset(name: NamedLook, seed: number): Preset {
  const settings = {
    'Crispy color': { brightness: 8, contrast: 150, saturation: 135, levels: 48, sharpen: 80, noise: 10, quality: 60, passes: 1 },
    'Noisy photocopy': { brightness: 10, contrast: 175, saturation: 0, levels: 8, sharpen: 60, noise: 40, quality: 35, passes: 2 },
    'Overcooked': { brightness: 20, contrast: 195, saturation: 175, levels: 12, sharpen: 150, noise: 55, quality: 15, passes: 3 }
  }[name]
  return presetSchema.parse({ seed, effects: [
    { ...newEffect('brightness'), id: 'look-brightness', value: settings.brightness },
    { ...newEffect('contrast'), id: 'look-contrast', value: settings.contrast },
    { ...newEffect('saturation'), id: 'look-saturation', value: settings.saturation },
    { ...newEffect('levels'), id: 'look-levels', value: settings.levels },
    { ...newEffect('sharpen'), id: 'look-sharpen', value: settings.sharpen },
    { ...newEffect('noise'), id: 'look-noise', value: settings.noise },
    { ...newEffect('jpeg'), id: 'look-jpeg', quality: settings.quality, passes: settings.passes }
  ] })
}

export function scaleFry(preset: Preset, amount: number): Preset {
  const fraction = Math.max(0, Math.min(100, amount)) / 100
  const scale = (value: number, neutral = 0): number => Math.round(neutral + (value - neutral) * fraction)
  const effects = preset.effects.map((effect): Effect => {
    switch (effect.kind) {
      case 'brightness': case 'sharpen': case 'noise': return { ...effect, value: scale(effect.value) }
      case 'contrast': case 'saturation': return { ...effect, value: scale(effect.value, 100) }
      case 'levels': return { ...effect, value: scale(effect.value, 256) }
      case 'jpeg': return { ...effect, quality: scale(effect.quality, 100), passes: scale(effect.passes) }
      case 'bulge': return { ...effect, strength: scale(effect.strength) }
    }
  })
  return { ...preset, effects }
}

export function randomizePreset(preset: Preset, locks: ReadonlySet<string>, seed: number): Preset {
  let state = seed >>> 0
  function integer(minimum: number, maximum: number): number {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return minimum + Math.floor(state / 0x100000000 * (maximum - minimum + 1))
  }
  const locked = (effect: Effect, key: RandomParameter): boolean => locks.has(parameterKey(effect, key))
  let passesLeft = 8 - preset.effects.reduce((sum, effect) => sum + (effect.kind === 'jpeg' && effect.enabled && effect.mix > 0 && locked(effect, 'passes') ? effect.passes : 0), 0)
  const effects = preset.effects.map((effect): Effect => {
    if (effect.kind === 'jpeg') {
      const active = effect.enabled && effect.mix > 0
      const passes = locked(effect, 'passes') ? effect.passes : integer(0, active ? Math.min(3, passesLeft) : 3)
      if (active && !locked(effect, 'passes')) passesLeft -= passes
      return { ...effect, quality: locked(effect, 'quality') ? effect.quality : integer(8, 75), passes }
    }
    if (effect.kind === 'bulge') return { ...effect, strength: locked(effect, 'strength') ? effect.strength : integer(-85, 85) }
    if (locked(effect, 'value')) return { ...effect }
    switch (effect.kind) {
      case 'brightness': return { ...effect, value: integer(-10, 35) }
      case 'contrast': return { ...effect, value: integer(100, 195) }
      case 'saturation': return { ...effect, value: integer(40, 180) }
      case 'levels': return { ...effect, value: integer(3, 64) }
      case 'sharpen': return { ...effect, value: integer(0, 160) }
      case 'noise': return { ...effect, value: integer(0, 65) }
    }
  })
  return presetSchema.parse({ ...preset, seed, effects })
}
