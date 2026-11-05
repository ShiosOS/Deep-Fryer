import type { TopBottomCaptions } from '../../shared/composition'
import { CaptionRenderError, layoutCaptions, type CaptionFrame } from './caption-layout'

const fontFamily = 'DeepFryerAntonV1'
let fontReady: Promise<void> | null = null

async function loadFont(): Promise<void> {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      (async () => {
        const response = await fetch(new URL('./assets/fonts/Anton-Regular.ttf', import.meta.url), { signal: controller.signal })
        if (!response.ok) throw new Error('Font asset unavailable')
        const face = await new FontFace(fontFamily, await response.arrayBuffer()).load()
        const scope: object = globalThis
        const fonts = 'fonts' in scope ? scope.fonts : typeof document !== 'undefined' ? document.fonts : null
        if (!fonts || typeof fonts !== 'object' || !('add' in fonts) || typeof fonts.add !== 'function') throw new Error('Worker font loading unavailable')
        fonts.add(face)
      })(),
      new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('Font load timed out')) }, 5000) })
    ])
  } catch {
    throw new CaptionRenderError('The bundled Anton font could not load. Retry the preview or reopen Deep Fryer. Your captions are kept and can be saved in a project.')
  } finally { clearTimeout(timer) }
}

export async function renderCaptions(pixels: ImageData, captions: TopBottomCaptions, frame: CaptionFrame): Promise<ImageData> {
  fontReady ??= loadFont().catch(error => { fontReady = null; throw error })
  await fontReady
  const surface = new OffscreenCanvas(pixels.width, pixels.height)
  const context = surface.getContext('2d', { willReadFrequently: true })
  if (!context) throw new CaptionRenderError('Caption preview is unavailable. Your text is kept and can be saved in a project.')
  const shorter = Math.min(frame.width, frame.height)
  const normalized = { width: frame.width / shorter * 1000, height: frame.height / shorter * 1000 }
  const blocks = layoutCaptions(captions, normalized, (text, size) => {
    context.font = `${size}px ${fontFamily}`
    const metrics = context.measureText(text)
    return { width: Math.max(metrics.width, metrics.actualBoundingBoxLeft + metrics.actualBoundingBoxRight), ascent: metrics.actualBoundingBoxAscent, descent: metrics.actualBoundingBoxDescent }
  })
  context.scale(pixels.width / normalized.width, pixels.height / normalized.height)
  context.textAlign = 'center'
  context.textBaseline = 'alphabetic'
  context.lineJoin = 'round'
  context.strokeStyle = '#000000'
  context.fillStyle = '#ffffff'
  for (const block of blocks) {
    context.font = `${block.size}px ${fontFamily}`
    context.lineWidth = block.outline
    for (const line of block.lines) {
      context.strokeText(line.text, normalized.width / 2, line.y)
      context.fillText(line.text, normalized.width / 2, line.y)
    }
  }
  const glyphs = context.getImageData(0, 0, pixels.width, pixels.height).data
  const output = new Uint8ClampedArray(pixels.data)
  for (let index = 0; index < glyphs.length; index += 4) {
    const glyphAlpha = glyphs[index + 3]! / 255
    if (glyphAlpha === 0) continue
    const sourceAlpha = output[index + 3]! / 255
    const alpha = glyphAlpha + sourceAlpha * (1 - glyphAlpha)
    for (let channel = 0; channel < 3; channel += 1) output[index + channel] = Math.round((glyphs[index + channel]! * glyphAlpha + output[index + channel]! * sourceAlpha * (1 - glyphAlpha)) / alpha)
    output[index + 3] = Math.round(alpha * 255)
  }
  return new ImageData(output, pixels.width, pixels.height)
}
