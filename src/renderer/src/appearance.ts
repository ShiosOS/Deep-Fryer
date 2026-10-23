import { computed, onUnmounted, ref, watchEffect } from 'vue'
import { appearanceSchema, defaultAppearance, pinkPalettes, type PaletteColors, type Appearance } from '../../shared/appearance'
import { describeError } from './document-files'

export function luminance(hex: string): number {
  const linear = [1, 3, 5].map((start) => {
    const value = Number.parseInt(hex.slice(start, start + 2), 16) / 255
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  })
  return linear[0]! * 0.2126 + linear[1]! * 0.7152 + linear[2]! * 0.0722
}
export function foreground(background: string): string { return luminance(background) > 0.179 ? '#000000' : '#ffffff' }
export function themeVariables(colors: PaletteColors, mode: 'light' | 'dark', custom: boolean): Record<string, string> {
  const ink = custom ? foreground(colors.panel) : mode === 'dark' ? '#f3edf3' : '#3a2c38'
  const contrast = (Math.max(luminance(colors.accent), luminance(colors.panel)) + 0.05) / (Math.min(luminance(colors.accent), luminance(colors.panel)) + 0.05)
  return {
    '--panel': colors.panel, '--canvas': colors.canvas, '--accent': colors.accent,
    '--text': ink, '--canvas-text': custom ? foreground(colors.canvas) : ink,
    '--on-accent': foreground(colors.accent), '--control': custom ? contrast >= 3 ? colors.accent : ink : mode === 'dark' ? colors.accent : '#b46795',
    '--muted': custom ? ink : mode === 'dark' ? '#b1a2b2' : '#786374',
    '--paper': `color-mix(in srgb, ${colors.panel} 94%, ${ink})`,
    '--line': `color-mix(in srgb, ${colors.panel} 78%, ${ink})`,
    '--soft': `color-mix(in srgb, ${colors.panel} 86%, ${colors.accent})`,
    '--focus': ink
  }
}

export function useAppearance() {
  const settings = ref<Appearance>(defaultAppearance())
  const notice = ref('')
  const loaded = ref(false)
  const saving = ref(false)
  const preference = window.matchMedia('(prefers-color-scheme: dark)')
  const systemDark = ref(preference.matches)
  const mode = computed(() => settings.value.mode === 'system' ? systemDark.value ? 'dark' : 'light' : settings.value.mode)
  const changed = () => { systemDark.value = preference.matches }
  preference.addEventListener('change', changed)
  onUnmounted(() => preference.removeEventListener('change', changed))
  watchEffect(() => {
    const palette = settings.value.palettes[mode.value]
    const colors = palette.selected === 'custom' ? palette.custom : pinkPalettes[mode.value]
    const root = document.documentElement
    root.dataset.appearance = mode.value
    root.style.colorScheme = mode.value
    for (const [key, value] of Object.entries(themeVariables(colors, mode.value, palette.selected === 'custom'))) root.style.setProperty(key, value)
  })
  async function load(): Promise<void> {
    try { const result = await window.appearanceBridge.load(); settings.value = result.settings; notice.value = result.notice }
    catch (error) { notice.value = describeError(error) }
    finally { loaded.value = true }
  }
  async function save(next: Appearance, reset = false): Promise<void> {
    if (saving.value) return
    saving.value = true
    try {
      settings.value = reset ? await window.appearanceBridge.reset() : await window.appearanceBridge.save(appearanceSchema.parse(next))
      notice.value = ''
    } catch (error) { notice.value = describeError(error) }
    finally { saving.value = false }
  }
  return { settings, mode, loaded, notice, saving, load, save }
}
