import type { EditState } from '../../shared/edit'
import { renderPreset } from './effects'

export async function renderEdit(pixels: ImageData, edit: EditState, _frame = { width: pixels.width, height: pixels.height }): Promise<ImageData> {
  return renderPreset(pixels, edit.preset)
}
