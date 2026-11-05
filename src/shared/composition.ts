import { z } from 'zod'

export const MAX_CAPTION_UNITS = 512
export const DEFAULT_CAPTION_SIZE = 0.1
const captionText = z.string().max(MAX_CAPTION_UNITS, 'Use at most 512 characters per caption.')
export const topBottomCaptionsSchema = z.strictObject({
  kind: z.literal('top-bottom-v1'),
  font: z.literal('anton-regular-v1'),
  top: captionText,
  bottom: captionText,
  size: z.number().min(0.04).max(0.16)
})
export const compositionSchema = z.strictObject({
  captions: topBottomCaptionsSchema.nullable().transform((captions) =>
    captions && (captions.top.trim() || captions.bottom.trim()) ? captions : null)
})
export type TopBottomCaptions = z.infer<typeof topBottomCaptionsSchema>
export type Composition = z.infer<typeof compositionSchema>
