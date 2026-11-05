import { z } from 'zod'
import { MAX_DIMENSION, MAX_PIXELS } from './image'

export const MAX_EXPORT_BYTES = 128 * 1024 * 1024
const dimensions = {
  width: z.number().int().min(1).max(MAX_DIMENSION),
  height: z.number().int().min(1).max(MAX_DIMENSION)
}
const quality = z.number().int().min(1).max(100)
export const outputOptionsSchema = z.discriminatedUnion('format', [
  z.object({ ...dimensions, format: z.literal('png') }),
  z.object({ ...dimensions, format: z.literal('jpeg'), quality, background: z.string().regex(/^#[0-9a-fA-F]{6}$/) }),
  z.object({ ...dimensions, format: z.literal('webp'), quality })
]).refine((options) => options.width * options.height <= MAX_PIXELS, 'Use at most 24 million output pixels.')

export type OutputOptions = z.infer<typeof outputOptionsSchema>
export const outputFormats = {
  png: { label: 'PNG', mime: 'image/png', extension: 'png' },
  jpeg: { label: 'JPEG', mime: 'image/jpeg', extension: 'jpg' },
  webp: { label: 'WebP', mime: 'image/webp', extension: 'webp' }
} as const

export const exportImageInput = z.object({
  bytes: z.instanceof(Uint8Array).refine((bytes) => bytes.byteLength > 0 && bytes.byteLength <= MAX_EXPORT_BYTES, 'Use an output within the 128 MiB size limit.'),
  format: z.enum(['png', 'jpeg', 'webp']),
  suggestedName: z.string().min(1).max(1024)
})
export const exportImageResult = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('saved'), name: z.string() }),
  z.object({ kind: z.literal('cancelled') })
])
export type ExportResult = z.infer<typeof exportImageResult>
export type ExportImageInput = z.infer<typeof exportImageInput>
