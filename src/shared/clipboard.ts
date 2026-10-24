import { z } from 'zod'
import { MAX_EXPORT_BYTES } from './output'

export const copyImageInput = z.strictObject({
  bytes: z.instanceof(Uint8Array).refine(
    (bytes) => bytes.byteLength > 0 && bytes.byteLength <= MAX_EXPORT_BYTES,
    'Use an output within the 128 MiB size limit.'
  )
})
export const copyImageResult = z.strictObject({ kind: z.literal('copied') })
export type CopyImageInput = z.infer<typeof copyImageInput>
export type CopyImageResult = z.infer<typeof copyImageResult>
