import { z } from 'zod'
import { compositionSchema } from './composition'
import { newPreset, presetSchema, snapshotPreset, type Preset } from './preset'

export const editStateSchema = z.strictObject({ preset: presetSchema, composition: compositionSchema })
export type EditState = z.infer<typeof editStateSchema>
export function newEdit(preset: Preset = newPreset()): EditState {
  return { preset: snapshotPreset(preset), composition: { captions: null } }
}
export function snapshotEdit(edit: EditState): EditState {
  return { preset: snapshotPreset(edit.preset), composition: { captions: edit.composition.captions && { ...edit.composition.captions } } }
}
