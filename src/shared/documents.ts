import { z } from 'zod'
import { MAX_FILE_BYTES, openImageResult } from './image'
import { presetSchema } from './preset'

export const MAX_PROJECT_BYTES = Math.ceil(MAX_FILE_BYTES * 4 / 3) + 1024 * 1024
export const MAX_PRESET_BYTES = 256 * 1024
export const editableDocumentSchema = z.object({ source: openImageResult.unwrap(), preset: presetSchema })
export type EditableDocument = z.infer<typeof editableDocumentSchema>
export const saveNameSchema = z.string().trim().min(1).max(200).refine((name) => !/[<>:"/\\|?*\x00-\x1f]/.test(name), 'Use a file name without path separators or reserved characters.')
export const saveProjectInput = z.object({ document: editableDocumentSchema, suggestedName: saveNameSchema })
export const savePresetInput = z.object({ preset: presetSchema, suggestedName: saveNameSchema })

export const recoveryOfferSchema = z.object({ name: z.string(), savedAt: z.string(), directory: z.string() }).nullable()
export type RecoveryOffer = z.infer<typeof recoveryOfferSchema>
export const unsavedChoiceSchema = z.enum(['save', 'discard', 'cancel'])
export const closeRequestSchema = z.string().uuid()
export const closeReplySchema = z.object({ request: closeRequestSchema, decision: z.enum(['cancel', 'close', 'preserve-recovery']) })
export type DocumentBridge = {
  confirmUnsaved: () => Promise<z.infer<typeof unsavedChoiceSchema>>
  onCloseRequested: (listener: (request: string) => void) => () => void
  replyToClose: (reply: z.infer<typeof closeReplySchema>) => Promise<void>
  openProject: () => Promise<EditableDocument | null>
  saveProject: (input: z.infer<typeof saveProjectInput>) => Promise<import('./output').ExportResult>
  openPreset: () => Promise<z.infer<typeof presetSchema> | null>
  savePreset: (input: z.infer<typeof savePresetInput>) => Promise<import('./output').ExportResult>
  recoveryOffer: () => Promise<RecoveryOffer>
  restoreRecovery: () => Promise<EditableDocument>
  discardRecovery: () => Promise<void>
  checkpoint: (document: EditableDocument) => Promise<void>
}
