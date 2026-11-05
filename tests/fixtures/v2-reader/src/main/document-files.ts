import { open, rm } from 'node:fs/promises'
import { z } from 'zod'
import { editableDocumentSchema, MAX_PRESET_BYTES, MAX_PROJECT_BYTES, type EditableDocument } from '../shared/documents'
import { MAX_FILE_BYTES } from '../shared/image'
import { presetSchema, type Preset } from '../shared/preset'
import { inspectImage } from './image-files'
import { decodeLegacyPreset, decodeLegacyProject } from './legacy-document-codec'

const projectFileSchema = z.strictObject({
  format: z.literal('deep-fryer-project'), version: z.literal(2),
  source: z.strictObject({
    name: z.string().min(1).max(1024).refine((name) => !/[\\/]/.test(name), 'Use an image name without a path'),
    mime: z.enum(['image/png', 'image/jpeg']),
    base64: z.string().min(4).max(Math.ceil(MAX_FILE_BYTES / 3) * 4)
  }),
  preset: presetSchema
})
const presetFileSchema = z.strictObject({ format: z.literal('deep-fryer-preset'), version: z.literal(2), preset: presetSchema })
const versionSchema = z.object({ version: z.union([z.literal(1), z.literal(2)]) })

export function parseProject(text: string): EditableDocument {
  let raw: unknown
  try { raw = JSON.parse(text) } catch { throw new Error('This project is not valid JSON. Your current edit is unchanged.') }
  if (!versionSchema.safeParse(raw).success) {
    throw new Error('This project version is not supported. Use the app version that saved it. Your current edit is unchanged.')
  }
  let file
  try { file = versionSchema.parse(raw).version === 1 ? decodeLegacyProject(raw) : projectFileSchema.parse(raw) }
  catch { throw new Error('This project is damaged or contains unsupported settings. Your current edit is unchanged.') }
  const bytes = new Uint8Array(Buffer.from(file.source.base64, 'base64'))
  if (Buffer.from(bytes).toString('base64') !== file.source.base64 || inspectImage(bytes) !== file.source.mime) {
    throw new Error('The project image is damaged or has the wrong format.')
  }
  return { source: { name: file.source.name, mime: file.source.mime, bytes }, preset: file.preset }
}

export function encodeProject(document: EditableDocument): string {
  const accepted = editableDocumentSchema.parse(document)
  if (inspectImage(accepted.source.bytes) !== accepted.source.mime) throw new Error('The project image has the wrong format.')
  return JSON.stringify(projectFileSchema.parse({
    format: 'deep-fryer-project', version: 2,
    source: { name: accepted.source.name, mime: accepted.source.mime, base64: Buffer.from(accepted.source.bytes).toString('base64') },
    preset: accepted.preset
  }))
}

export function parsePreset(text: string): Preset {
  let raw: unknown
  try { raw = JSON.parse(text) } catch { throw new Error('This preset is not valid JSON. Your current preset is unchanged.') }
  if (!versionSchema.safeParse(raw).success) {
    throw new Error('This preset version is not supported. Your current preset is unchanged.')
  }
  try { return versionSchema.parse(raw).version === 1 ? decodeLegacyPreset(raw) : presetFileSchema.parse(raw).preset }
  catch { throw new Error('This preset contains invalid or unsupported settings. Your current preset is unchanged.') }
}

export function encodePreset(preset: Preset): string {
  return JSON.stringify(presetFileSchema.parse({ format: 'deep-fryer-preset', version: 2, preset: presetSchema.parse(preset) }))
}

export async function readDocumentText(path: string, maximumBytes: number): Promise<string> {
  const file = await open(path, 'r')
  try {
    const before = await file.stat()
    if (!before.isFile() || before.size === 0 || before.size > maximumBytes) throw new Error('This document is empty or exceeds the supported file size.')
    const bytes = Buffer.alloc(before.size)
    let offset = 0
    while (offset < bytes.length) {
      const { bytesRead } = await file.read(bytes, offset, bytes.length - offset, offset)
      if (bytesRead === 0) throw new Error('The document changed while opening. Try again.')
      offset += bytesRead
    }
    const after = await file.stat()
    if (after.size !== before.size || after.mtimeMs !== before.mtimeMs) throw new Error('The document changed while opening. Try again.')
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } finally { await file.close() }
}

export async function writeDocumentExclusive(path: string, text: string): Promise<void> {
  let file
  try { file = await open(path, 'wx') } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'EEXIST') throw new Error('That file already exists. Choose a new name to keep it safe.')
    throw error
  }
  try {
    await file.writeFile(text, 'utf8')
    await file.sync()
  } catch (error) {
    await file.close()
    await rm(path, { force: true })
    throw error
  }
  await file.close()
}

export const readProject = async (path: string): Promise<EditableDocument> => parseProject(await readDocumentText(path, MAX_PROJECT_BYTES))
export const readPreset = async (path: string): Promise<Preset> => parsePreset(await readDocumentText(path, MAX_PRESET_BYTES))
