import { z } from 'zod'
import type { ExportImageInput, ExportResult } from './output'

export const MAX_FILE_BYTES = 64 * 1024 * 1024
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

export type OpenImage = NonNullable<z.infer<typeof openImageResult>>
export type ImageBridge = {
  openImage: () => Promise<OpenImage | null>
  pasteImage: () => Promise<OpenImage>
  dropImages: (files: File[]) => Promise<OpenImage>
  exportImage: (input: ExportImageInput) => Promise<ExportResult>
}

export function validateDimensions(width: number, height: number): void {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 ||
    width > MAX_DIMENSION || height > MAX_DIMENSION || width * height > MAX_PIXELS) {
    throw new Error('Use an image up to 16,384 pixels per side and 24 million pixels total.')
  }
}
