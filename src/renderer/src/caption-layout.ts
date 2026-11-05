import type { TopBottomCaptions } from '../../shared/composition'
import coverage from './assets/fonts/coverage.json'

export type CaptionFrame = { width: number; height: number }
export type CaptionLine = { text: string; y: number }
export type CaptionBlock = { size: number; outline: number; lines: CaptionLine[] }
type Measure = (text: string, size: number) => { width: number; ascent: number; descent: number }
const graphemes = new Intl.Segmenter('en', { granularity: 'grapheme' })
export class CaptionRenderError extends Error {}

export function captionText(text: string): string {
  return text.normalize('NFC').replace(/\r\n?/g, '\n').replace(/\t/g, ' ')
}

export function unsupportedCaptionGlyphs(text: string): string[] {
  return [...new Set([...captionText(text)].filter((character) => {
    if (character === '\n') return false
    const point = character.codePointAt(0)!
    return !coverage.some(([start, end]) => start !== undefined && end !== undefined && point >= start && point <= end)
  }))]
}

function wrap(text: string, width: number, size: number, measure: Measure): string[] {
  const lines: string[] = []
  for (const paragraph of text.split('\n')) {
    let line = ''
    for (const token of paragraph.match(/\S+\s*|\s+/gu) ?? []) {
      if (measure(line + token.trimEnd(), size).width <= width) { line += token; continue }
      if (line.trim()) { lines.push(line.trimEnd()); line = '' }
      for (const { segment } of graphemes.segment(token)) {
        if (line && measure(line + segment, size).width > width) { lines.push(line.trimEnd()); line = '' }
        line += segment
      }
    }
    lines.push(line.trimEnd())
  }
  return lines
}

export function layoutCaption(text: string, anchor: 'top' | 'bottom', requestedSize: number, frame: CaptionFrame, measure: Measure): CaptionBlock {
  const margin = 35
  function attempt(size: number): CaptionBlock | null {
    const outline = Math.max(2, size * 0.055)
    const width = frame.width - 2 * margin - outline
    const lines = wrap(captionText(text), width, size, measure)
    const metrics = measure(lines.join('') + 'Ágj', size)
    const height = metrics.ascent + metrics.descent
    const advance = Math.max(size * 1.2, height + outline)
    const blockHeight = height + advance * (lines.length - 1) + outline
    if (lines.length > 3 || blockHeight + margin > frame.height * 0.3 || lines.some(line => measure(line, size).width > width)) return null
    const first = anchor === 'top' ? margin + outline / 2 + metrics.ascent : frame.height - margin - outline / 2 - metrics.descent - advance * (lines.length - 1)
    return { size, outline, lines: lines.map((text, index) => ({ text, y: first + index * advance })) }
  }
  const requested = requestedSize * 1000
  const direct = attempt(requested)
  if (direct) return direct
  let minimum = 25
  let maximum = requested
  let fit = attempt(minimum)
  if (!fit) throw new CaptionRenderError(`The ${anchor} caption cannot fit in three lines. Shorten it or remove line breaks. Your text is kept and can be saved in a project.`)
  for (let step = 0; step < 12; step += 1) {
    const middle = (minimum + maximum) / 2
    const candidate = attempt(middle)
    if (candidate) { fit = candidate; minimum = middle } else maximum = middle
  }
  return fit
}

export function layoutCaptions(captions: TopBottomCaptions, frame: CaptionFrame, measure: Measure): CaptionBlock[] {
  const unsupported = unsupportedCaptionGlyphs(captions.top + '\n' + captions.bottom)
  if (unsupported.length) throw new CaptionRenderError(`Anton does not include ${unsupported.slice(0, 6).map(char => `${JSON.stringify(char)} (U+${char.codePointAt(0)!.toString(16).toUpperCase()})`).join(', ')}. Replace these characters to export. Your text is kept and can be saved in a project.`)
  return (['top', 'bottom'] as const).filter(anchor => captions[anchor].trim()).map(anchor => layoutCaption(captions[anchor], anchor, captions.size, frame, measure))
}
