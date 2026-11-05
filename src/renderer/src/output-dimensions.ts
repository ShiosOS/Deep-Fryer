import type { OutputOptions } from '../../shared/output'

type Dimensions = Pick<OutputOptions, 'width' | 'height'>

export function proportionalOutputSize({ source, dimension, value }: {
  source: Dimensions
  dimension: keyof Dimensions
  value: number
}): Dimensions {
  return dimension === 'width'
    ? { width: value, height: Math.round(value * source.height / source.width) }
    : { width: Math.round(value * source.width / source.height), height: value }
}
