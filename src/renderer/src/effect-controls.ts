export function intensityFromSlider(position: number): number {
  return Math.round(position <= 50 ? position * 2 : 100 + (position - 50) * 8)
}

export function intensityToSlider(value: number): number {
  return value <= 100 ? value / 2 : 50 + (value - 100) / 8
}

export function isMultiplier(kind: string): boolean {
  return kind === 'contrast' || kind === 'saturation'
}
