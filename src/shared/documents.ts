import { z } from 'zod'
import { MAX_FILE_BYTES, openImageResult } from './image'
import { presetSchema } from './preset'

export const MAX_PROJECT_BYTES = Math.ceil(MAX_FILE_BYTES * 4 / 3) + 1024 * 1024
export const MAX_PRESET_BYTES = 256 * 1024
export const editableDocumentSchema = z.object({ source: openImageResult.unwrap(), preset: presetSchema })
export type EditableDocument = z.infer<typeof editableDocumentSchema>

export const recoveryOfferSchema = z.object({ name: z.string(), savedAt: z.string(), directory: z.string() }).nullable()
export type RecoveryOffer = z.infer<typeof recoveryOfferSchema>
export type DocumentBridge = {
  openProject: () => Promise<EditableDocument | null>
  saveProject: (document: EditableDocument) => Promise<import('./output').ExportResult>
  openPreset: () => Promise<z.infer<typeof presetSchema> | null>
  savePreset: (preset: z.infer<typeof presetSchema>, imageName: string) => Promise<import('./output').ExportResult>
  recoveryOffer: () => Promise<RecoveryOffer>
  restoreRecovery: () => Promise<EditableDocument>
  discardRecovery: () => Promise<void>
  checkpoint: (document: EditableDocument) => Promise<void>
}
