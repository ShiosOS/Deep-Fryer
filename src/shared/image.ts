import { z } from 'zod'

export const MAX_FILE_BYTES = 64 * 1024 * 1024
export const MAX_PNG_EXPORT_BYTES = 128 * 1024 * 1024
export const MAX_DIMENSION = 16_384
export const MAX_PIXELS = 24_000_000

const imageBytes = z.instanceof(Uint8Array).refine(
  (bytes) => bytes.byteLength > 0 && bytes.byteLength <= MAX_FILE_BYTES,
  'Choose an image smaller than 64 MiB.'
)

export const openImageResult = z.object({
  name: z.string().min(1).max(1024),
  mime: z.enum(['image/png', 'image/jpeg']),
  bytes: imageBytes
}).nullable()

export const exportPngInput = z.object({
  bytes: z.instanceof(Uint8Array).refine(
    (bytes) => bytes.byteLength > 0 && bytes.byteLength <= MAX_PNG_EXPORT_BYTES,
    'The exported PNG exceeds the 128 MiB output limit.'
  ),
  suggestedName: z.string().min(1).max(1024)
})

export const exportPngResult = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('saved'), name: z.string() }),
  z.object({ kind: z.literal('cancelled') })
])

export type OpenImage = NonNullable<z.infer<typeof openImageResult>>
export type ExportResult = z.infer<typeof exportPngResult>
export type ImageBridge = {
  openImage: () => Promise<OpenImage | null>
  exportPng: (bytes: Uint8Array, suggestedName: string) => Promise<ExportResult>
}

export function validateDimensions(width: number, height: number): void {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 ||
    width > MAX_DIMENSION || height > MAX_DIMENSION || width * height > MAX_PIXELS) {
    throw new Error('Use an image up to 16,384 pixels per side and 24 million pixels total.')
  }
}
