import { z } from 'zod'

const colorsSchema = z.strictObject({
  accent: z.string().regex(/^#[0-9a-f]{6}$/i),
  canvas: z.string().regex(/^#[0-9a-f]{6}$/i),
  panel: z.string().regex(/^#[0-9a-f]{6}$/i)
})
const paletteSchema = z.strictObject({ selected: z.enum(['pink', 'custom']), custom: colorsSchema })
export const appearanceSchema = z.strictObject({
  mode: z.enum(['light', 'dark', 'system']),
  palettes: z.strictObject({ light: paletteSchema, dark: paletteSchema })
})
export type Appearance = z.infer<typeof appearanceSchema>
export type PaletteColors = z.infer<typeof colorsSchema>
export const pinkPalettes = {
  light: { accent: '#e9a7cb', canvas: '#f0e9ee', panel: '#fffcfe' },
  dark: { accent: '#efb9d8', canvas: '#1c191f', panel: '#28232c' }
} satisfies Record<'light' | 'dark', PaletteColors>
export function defaultAppearance(): Appearance {
  return { mode: 'dark', palettes: {
    light: { selected: 'pink', custom: { ...pinkPalettes.light } },
    dark: { selected: 'pink', custom: { ...pinkPalettes.dark } }
  } }
}
export const appearanceResultSchema = z.object({ settings: appearanceSchema, notice: z.string() })
export type AppearanceResult = z.infer<typeof appearanceResultSchema>
export type AppearanceBridge = {
  load: () => Promise<AppearanceResult>
  save: (settings: Appearance) => Promise<Appearance>
  reset: () => Promise<Appearance>
}
