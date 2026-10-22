import { z } from 'zod'

export const colorSettingsSchema = z.object({
  brightness: z.number().int().min(-100).max(100),
  contrast: z.number().int().min(0).max(200),
  saturation: z.number().int().min(0).max(200),
  levels: z.number().int().min(2).max(256)
})

export type ColorSettings = Readonly<z.infer<typeof colorSettingsSchema>>
export type ColorKey = keyof ColorSettings

export const neutralColorSettings: ColorSettings = Object.freeze({
  brightness: 0,
  contrast: 100,
  saturation: 100,
  levels: 256
})

export const colorControls = [
  { key: 'brightness', label: 'Brightness', min: -100, max: 100 },
  { key: 'contrast', label: 'Contrast', min: 0, max: 200 },
  { key: 'saturation', label: 'Saturation', min: 0, max: 200 },
  { key: 'levels', label: 'Color levels', min: 2, max: 256 }
] as const satisfies ReadonlyArray<{ key: ColorKey; label: string; min: number; max: number }>

export function parseColorSetting(settings: ColorSettings, key: ColorKey, raw: string): ColorSettings | null {
  if (raw.trim() === '') return null
  const value = Number(raw)
  const result = colorSettingsSchema.safeParse({ ...settings, [key]: value })
  return result.success ? result.data : null
}

function clamp(value: number): number {
  return Math.max(0, Math.min(255, value))
}

export function applyColorSettings(source: Uint8ClampedArray, settings: ColorSettings): Uint8ClampedArray<ArrayBuffer> {
  const output = new Uint8ClampedArray(new ArrayBuffer(source.byteLength))
  output.set(source)
  const brightness = settings.brightness * 255 / 100
  const contrast = settings.contrast / 100
  const saturation = settings.saturation / 100
  const levelCount = settings.levels - 1
  for (let index = 0; index < output.length; index += 4) {
    let red = clamp((source[index]! - 128) * contrast + 128 + brightness)
    let green = clamp((source[index + 1]! - 128) * contrast + 128 + brightness)
    let blue = clamp((source[index + 2]! - 128) * contrast + 128 + brightness)
    const luminance = red * 0.2126 + green * 0.7152 + blue * 0.0722
    red = clamp(luminance + (red - luminance) * saturation)
    green = clamp(luminance + (green - luminance) * saturation)
    blue = clamp(luminance + (blue - luminance) * saturation)
    output[index] = Math.round(red * levelCount / 255) * 255 / levelCount
    output[index + 1] = Math.round(green * levelCount / 255) * 255 / levelCount
    output[index + 2] = Math.round(blue * levelCount / 255) * 255 / levelCount
  }
  return output
}

export function renderColorImage(bitmap: ImageBitmap, settings: ColorSettings): ImageData {
  const surface = document.createElement('canvas')
  surface.width = bitmap.width
  surface.height = bitmap.height
  const context = surface.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('The image preview is unavailable. Reopen the app and try again.')
  context.drawImage(bitmap, 0, 0)
  const image = context.getImageData(0, 0, bitmap.width, bitmap.height)
  return new ImageData(applyColorSettings(image.data, settings), image.width, image.height)
}
