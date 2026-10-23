import { z } from 'zod'
import { MAX_FILE_BYTES, openImageResult } from './image'
import { recipeSchema } from './recipe'

export const MAX_PROJECT_BYTES = Math.ceil(MAX_FILE_BYTES * 4 / 3) + 1024 * 1024
export const MAX_PRESET_BYTES = 256 * 1024
export const editableDocumentSchema = z.object({ source: openImageResult.unwrap(), recipe: recipeSchema })
export type EditableDocument = z.infer<typeof editableDocumentSchema>

export const projectFileSchema = z.strictObject({
  format: z.literal('deep-fryer-project'), version: z.literal(1),
  source: z.strictObject({
    name: z.string().min(1).max(1024).refine((name) => !/[\\/]/.test(name), 'Use an image name without a path'),
    mime: z.enum(['image/png', 'image/jpeg']),
    base64: z.string().min(4).max(Math.ceil(MAX_FILE_BYTES / 3) * 4)
  }),
  recipe: recipeSchema
})
export const presetFileSchema = z.strictObject({ format: z.literal('deep-fryer-recipe'), version: z.literal(1), recipe: recipeSchema })
export const recoveryOfferSchema = z.object({ name: z.string(), savedAt: z.string(), directory: z.string() }).nullable()
export type RecoveryOffer = z.infer<typeof recoveryOfferSchema>
export type DocumentBridge = {
  openProject: () => Promise<EditableDocument | null>
  saveProject: (document: EditableDocument) => Promise<import('./output').ExportResult>
  openPreset: () => Promise<z.infer<typeof recipeSchema> | null>
  savePreset: (recipe: z.infer<typeof recipeSchema>, imageName: string) => Promise<import('./output').ExportResult>
  recoveryOffer: () => Promise<RecoveryOffer>
  restoreRecovery: () => Promise<EditableDocument>
  discardRecovery: () => Promise<void>
  checkpoint: (document: EditableDocument) => Promise<void>
}
