import type { Effect } from '../../shared/preset'

type Bulge = Extract<Effect, { kind: 'bulge' }>

function sample(input: ImageData, x: number, y: number, output: Uint8ClampedArray, offset: number, mix: number): void {
  const left = Math.floor(Math.max(0, Math.min(input.width - 1, x)))
  const top = Math.floor(Math.max(0, Math.min(input.height - 1, y)))
  const right = Math.min(input.width - 1, left + 1)
  const bottom = Math.min(input.height - 1, top + 1)
  const dx = Math.max(0, Math.min(1, x - left))
  const dy = Math.max(0, Math.min(1, y - top))
  const neighbors = [
    [(top * input.width + left) * 4, (1 - dx) * (1 - dy)],
    [(top * input.width + right) * 4, dx * (1 - dy)],
    [(bottom * input.width + left) * 4, (1 - dx) * dy],
    [(bottom * input.width + right) * 4, dx * dy]
  ]
  const originalAlpha = input.data[offset + 3]! / 255
  let alpha = originalAlpha * (1 - mix)
  const premultiplied = [0, 0, 0]
  for (let channel = 0; channel < 3; channel += 1) premultiplied[channel] = input.data[offset + channel]! * originalAlpha * (1 - mix)
  for (const [neighbor, weight] of neighbors) {
    const contribution = input.data[neighbor! + 3]! / 255 * weight! * mix
    alpha += contribution
    for (let channel = 0; channel < 3; channel += 1) premultiplied[channel]! += input.data[neighbor! + channel]! * contribution
  }
  output[offset + 3] = alpha * 255
  for (let channel = 0; channel < 3; channel += 1) output[offset + channel] = alpha === 0 ? 0 : premultiplied[channel]! / alpha
}

export function applyBulge(input: ImageData, effect: Bulge): ImageData {
  const output = new Uint8ClampedArray(input.data)
  if (!effect.enabled || effect.mix === 0 || effect.strength === 0) return new ImageData(output, input.width, input.height)
  const centerX = effect.x * (input.width - 1)
  const centerY = effect.y * (input.height - 1)
  const radius = effect.radius * Math.min(input.width, input.height)
  const startX = Math.max(0, Math.floor(centerX - radius))
  const endX = Math.min(input.width - 1, Math.ceil(centerX + radius))
  const startY = Math.max(0, Math.floor(centerY - radius))
  const endY = Math.min(input.height - 1, Math.ceil(centerY + radius))
  for (let y = startY; y <= endY; y += 1) for (let x = startX; x <= endX; x += 1) {
    const vx = x - centerX, vy = y - centerY
    const distance = Math.hypot(vx, vy)
    if (distance >= radius || distance === 0) continue
    const falloff = (1 - distance / radius) ** 2
    const sourceDistance = distance * (1 - effect.strength * 0.009 * falloff)
    const sourceX = centerX + vx * sourceDistance / distance
    const sourceY = centerY + vy * sourceDistance / distance
    sample(input, sourceX, sourceY, output, (y * input.width + x) * 4, effect.mix / 100)
  }
  return new ImageData(output, input.width, input.height)
}
