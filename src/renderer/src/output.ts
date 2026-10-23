import { openImageResult, validateDimensions, type OpenImage } from '../../shared/image'
import { MAX_EXPORT_BYTES, outputFormats, outputOptionsSchema, type OutputOptions } from '../../shared/output'
import { presetSchema, type Preset } from '../../shared/preset'
import { renderPreset } from './effects'

export type OutputJob = { source: OpenImage; preset: Preset; options: OutputOptions }
export type PreparedOutput = { bytes: Uint8Array<ArrayBuffer>; pixels: Uint8ClampedArray<ArrayBuffer>; options: OutputOptions; sourceName: string }
export type OutputResponse = { kind: 'ready'; output: PreparedOutput } | { kind: 'failed'; message: string }

export function freezeOutput(source: OpenImage, preset: Preset, options: OutputOptions): OutputJob {
  return { source: { name: source.name, mime: source.mime, bytes: new Uint8Array(source.bytes) }, preset: presetSchema.parse(preset), options: outputOptionsSchema.parse(options) }
}

export async function prepareOutput(job: OutputJob): Promise<PreparedOutput> {
  const source = openImageResult.parse(job.source)
  if (!source) throw new Error('Open an image before preparing an output.')
  const options = outputOptionsSchema.parse(job.options)
  const preset = presetSchema.parse(job.preset)
  const bitmap = await createImageBitmap(new Blob([new Uint8Array(source.bytes).buffer], { type: source.mime }), { imageOrientation: 'from-image' })
  try {
    validateDimensions(bitmap.width, bitmap.height)
    const surface = new OffscreenCanvas(options.width, options.height)
    const context = surface.getContext('2d', { willReadFrequently: true })
    if (!context) throw new Error('The output image could not be prepared. Try again.')
    context.imageSmoothingEnabled = true
    context.imageSmoothingQuality = 'high'
    context.drawImage(bitmap, 0, 0, options.width, options.height)
    const result = await renderPreset(context.getImageData(0, 0, options.width, options.height), preset)
    context.putImageData(result, 0, 0)
    if (options.format === 'jpeg') {
      context.globalCompositeOperation = 'destination-over'
      context.fillStyle = options.background
      context.fillRect(0, 0, options.width, options.height)
      context.globalCompositeOperation = 'source-over'
    }
    const format = outputFormats[options.format]
    const blob = await surface.convertToBlob({ type: format.mime, ...('quality' in options ? { quality: options.quality / 100 } : {}) })
    if (blob.type !== format.mime) throw new Error(`${format.label} encoding is unavailable on this computer.`)
    if (blob.size > MAX_EXPORT_BYTES) throw new Error('The output exceeds 128 MiB. Choose smaller dimensions.')
    const bytes = new Uint8Array(await blob.arrayBuffer())
    const decoded = await createImageBitmap(blob)
    try {
      context.clearRect(0, 0, options.width, options.height)
      context.drawImage(decoded, 0, 0)
      return { bytes, pixels: context.getImageData(0, 0, options.width, options.height).data, options, sourceName: source.name }
    } finally { decoded.close() }
  } finally { bitmap.close() }
}
