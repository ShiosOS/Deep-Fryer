import { isNeutralEffect, type Effect, type Preset } from '../../shared/preset'
import { applyBulge } from './bulge'

function clamp(value: number): number { return Math.max(0, Math.min(255, value)) }

function effectNoiseSeed(seed: number, id: string): number {
  let hash = seed
  for (let index = 0; index < id.length; index += 1) hash = Math.imul(hash ^ id.charCodeAt(index), 16777619)
  return hash
}

function noiseValue(seed: number, pixel: number): number {
  let hash = seed ^ pixel
  hash ^= hash >>> 16
  hash = Math.imul(hash, 0x7feb352d)
  hash ^= hash >>> 15
  hash = Math.imul(hash, 0x846ca68b)
  return ((hash ^ (hash >>> 16)) >>> 0) / 0xffffffff * 2 - 1
}

export function applyPixelEffect(input: ImageData, effect: Exclude<Effect, { kind: 'jpeg' } | { kind: 'bulge' }>, seed: number): ImageData {
  const output = new Uint8ClampedArray(input.data)
  if (!effect.enabled || effect.mix === 0) return new ImageData(output, input.width, input.height)
  const mix = effect.mix / 100
  const width = input.width
  const noiseSeed = effectNoiseSeed(seed, effect.id)
  for (let offset = 0; offset < output.length; offset += 4) {
    const alpha = input.data[offset + 3]!
    if (alpha === 0) continue
    const red = input.data[offset]!, green = input.data[offset + 1]!, blue = input.data[offset + 2]!
    let nextRed = red, nextGreen = green, nextBlue = blue
    switch (effect.kind) {
      case 'brightness': {
        const change = effect.value * 255 / 100
        nextRed = clamp(red + change)
        nextGreen = clamp(green + change)
        nextBlue = clamp(blue + change)
        break
      }
      case 'contrast': {
        const amount = effect.value / 100
        nextRed = clamp((red - 128) * amount + 128)
        nextGreen = clamp((green - 128) * amount + 128)
        nextBlue = clamp((blue - 128) * amount + 128)
        break
      }
      case 'saturation': {
        const luma = red * 0.2126 + green * 0.7152 + blue * 0.0722
        const amount = effect.value / 100
        nextRed = clamp(luma + (red - luma) * amount)
        nextGreen = clamp(luma + (green - luma) * amount)
        nextBlue = clamp(luma + (blue - luma) * amount)
        break
      }
      case 'levels': {
        const steps = effect.value - 1
        nextRed = Math.round(red * steps / 255) * 255 / steps
        nextGreen = Math.round(green * steps / 255) * 255 / steps
        nextBlue = Math.round(blue * steps / 255) * 255 / steps
        break
      }
      case 'noise': {
        const change = noiseValue(noiseSeed, offset / 4) * effect.value * 1.28
        nextRed = clamp(red + change)
        nextGreen = clamp(green + change)
        nextBlue = clamp(blue + change)
        break
      }
      case 'sharpen': {
        const x = (offset / 4) % width
        const y = Math.floor(offset / 4 / width)
        let count = 0
        const sums = [0, 0, 0]
        for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]] satisfies Array<[number, number]>) {
          const nx = x + dx, ny = y + dy
          if (nx < 0 || ny < 0 || nx >= width || ny >= input.height) continue
          const adjacent = (ny * width + nx) * 4
          const weight = input.data[adjacent + 3]! / 255
          if (weight === 0) continue
          for (let channel = 0; channel < 3; channel += 1) sums[channel]! += input.data[adjacent + channel]! * weight
          count += weight
        }
        if (count > 0) {
          const amount = effect.value / 100
          nextRed = clamp(red + (red - sums[0]! / count) * amount)
          nextGreen = clamp(green + (green - sums[1]! / count) * amount)
          nextBlue = clamp(blue + (blue - sums[2]! / count) * amount)
        }
        break
      }
    }
    output[offset] = red + (nextRed - red) * mix
    output[offset + 1] = green + (nextGreen - green) * mix
    output[offset + 2] = blue + (nextBlue - blue) * mix
  }
  return new ImageData(output, input.width, input.height)
}

async function applyJpeg(input: ImageData, effect: Extract<Effect, { kind: 'jpeg' }>): Promise<ImageData> {
  if (!effect.enabled || effect.mix === 0 || effect.passes === 0) return new ImageData(new Uint8ClampedArray(input.data), input.width, input.height)
  const surface = new OffscreenCanvas(input.width, input.height)
  const context = surface.getContext('2d', { willReadFrequently: true })
  const composite = new OffscreenCanvas(input.width, input.height)
  const compositeContext = composite.getContext('2d', { willReadFrequently: true })
  if (!context || !compositeContext) throw new Error('JPEG processing is unavailable.')
  let result = input
  for (let pass = 0; pass < effect.passes; pass += 1) {
    context.putImageData(result, 0, 0)
    compositeContext.fillStyle = effect.background
    compositeContext.fillRect(0, 0, input.width, input.height)
    compositeContext.drawImage(surface, 0, 0)
    const blob = await composite.convertToBlob({ type: 'image/jpeg', quality: effect.quality / 100 })
    if (blob.type !== 'image/jpeg') throw new Error('JPEG encoding failed.')
    const bitmap = await createImageBitmap(blob)
    try {
      context.clearRect(0, 0, input.width, input.height)
      context.drawImage(bitmap, 0, 0)
      result = context.getImageData(0, 0, input.width, input.height)
    } finally { bitmap.close() }
  }
  if (effect.mix === 100) return result
  const mixed = new Uint8ClampedArray(input.data.length)
  const amount = effect.mix / 100
  for (let index = 0; index < mixed.length; index += 4) {
    const inputAlpha = input.data[index + 3]! / 255
    const resultAlpha = result.data[index + 3]! / 255
    const alpha = inputAlpha * (1 - amount) + resultAlpha * amount
    for (let channel = 0; channel < 3; channel += 1) {
      mixed[index + channel] = alpha === 0 ? 0 : (input.data[index + channel]! * inputAlpha * (1 - amount) + result.data[index + channel]! * resultAlpha * amount) / alpha
    }
    mixed[index + 3] = alpha * 255
  }
  return new ImageData(mixed, input.width, input.height)
}

export async function renderPreset(source: ImageData, preset: Preset): Promise<ImageData> {
  let result = new ImageData(new Uint8ClampedArray(source.data), source.width, source.height)
  for (const effect of preset.effects) {
    if (isNeutralEffect(effect)) continue
    result = effect.kind === 'jpeg' ? await applyJpeg(result, effect) : effect.kind === 'bulge' ? applyBulge(result, effect) : applyPixelEffect(result, effect, preset.seed)
  }
  return result
}
