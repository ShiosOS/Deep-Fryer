import type { EditState } from '../../shared/edit'
import { renderPreset } from './effects'
import { renderCaptions } from './caption-rendering'

export async function renderEdit(pixels: ImageData, edit: EditState, frame = { width: pixels.width, height: pixels.height }): Promise<ImageData> {
  const treated = await renderPreset(pixels, edit.preset)
  return edit.composition.captions ? renderCaptions(treated, edit.composition.captions, frame) : treated
}
