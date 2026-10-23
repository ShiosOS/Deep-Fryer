import { open, rm } from 'node:fs/promises'
import { editableDocumentSchema, MAX_PRESET_BYTES, MAX_PROJECT_BYTES, presetFileSchema, projectFileSchema, type EditableDocument } from '../shared/documents'
import { recipeSchema, type Recipe } from '../shared/recipe'
import { inspectImage } from './image-files'

export function parseProject(text: string): EditableDocument {
  let raw: unknown
  try { raw = JSON.parse(text) } catch { throw new Error('This project is not valid JSON. Your current edit is unchanged.') }
  if (typeof raw === 'object' && raw !== null && 'version' in raw && raw.version !== 1) {
    throw new Error('This project version is not supported. Use the app version that saved it. Your current edit is unchanged.')
  }
  const result = projectFileSchema.safeParse(raw)
  if (!result.success) throw new Error('This project is damaged or contains unsupported settings. Your current edit is unchanged.')
  const file = result.data
  const bytes = new Uint8Array(Buffer.from(file.source.base64, 'base64'))
  if (Buffer.from(bytes).toString('base64') !== file.source.base64 || inspectImage(bytes) !== file.source.mime) {
    throw new Error('The project image is damaged or has the wrong format.')
  }
  return { source: { name: file.source.name, mime: file.source.mime, bytes }, recipe: file.recipe }
}

export function encodeProject(document: EditableDocument): string {
  const accepted = editableDocumentSchema.parse(document)
  if (inspectImage(accepted.source.bytes) !== accepted.source.mime) throw new Error('The project image has the wrong format.')
  return JSON.stringify(projectFileSchema.parse({
    format: 'deep-fryer-project', version: 1,
    source: { name: accepted.source.name, mime: accepted.source.mime, base64: Buffer.from(accepted.source.bytes).toString('base64') },
    recipe: accepted.recipe
  }))
}

export function parsePreset(text: string): Recipe {
  let raw: unknown
  try { raw = JSON.parse(text) } catch { throw new Error('This recipe is not valid JSON. Your current recipe is unchanged.') }
  if (typeof raw === 'object' && raw !== null && 'version' in raw && raw.version !== 1) {
    throw new Error('This recipe version is not supported. Your current recipe is unchanged.')
  }
  const result = presetFileSchema.safeParse(raw)
  if (!result.success) throw new Error('This recipe contains invalid or unsupported settings. Your current recipe is unchanged.')
  return result.data.recipe
}

export function encodePreset(recipe: Recipe): string {
  return JSON.stringify(presetFileSchema.parse({ format: 'deep-fryer-recipe', version: 1, recipe: recipeSchema.parse(recipe) }))
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
export const readPreset = async (path: string): Promise<Recipe> => parsePreset(await readDocumentText(path, MAX_PRESET_BYTES))
