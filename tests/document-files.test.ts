import assert from 'node:assert/strict'
import { mkdtemp, readFile, rename, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { PNG } from 'pngjs'
import { encodePreset, encodeProject, parsePreset, parseProject, readProject, writeDocumentExclusive } from '../src/main/document-files'
import { RecoveryStore } from '../src/main/recovery'
import type { EditableDocument } from '../src/shared/documents'
import { newEffect, newRecipe } from '../src/shared/recipe'

function document(): EditableDocument {
  const image = new PNG({ width: 8, height: 5 })
  image.data.fill(190)
  return { source: { name: 'source.png', mime: 'image/png', bytes: new Uint8Array(PNG.sync.write(image)) },
    recipe: { ...newRecipe(), seed: 123456, effects: [newEffect('noise', 'grain'), { ...newEffect('bulge', 'point'), kind: 'bulge', x: 0.25, y: 0.75, radius: 0.2, strength: -40 }] } }
}

test('a moved portable project embeds exact source bytes and ordered settings without a source path', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'deep-fryer-project-unit-'))
  try {
    const original = document()
    const text = encodeProject(original)
    const path = join(directory, 'original.deepfryer')
    const moved = join(directory, 'moved.deepfryer')
    await writeDocumentExclusive(path, text)
    await rename(path, moved)
    assert.deepEqual(await readProject(moved), original)
    assert.deepEqual(Object.keys(JSON.parse(text).source).sort(), ['base64', 'mime', 'name'])
    await assert.rejects(writeDocumentExclusive(moved, 'replacement'), /already exists/)
    assert.equal(await readFile(moved, 'utf8'), text)
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('presets contain only a versioned recipe and reject invalid, future or image-bearing payloads', () => {
  const original = document()
  const preset = encodePreset(original.recipe)
  assert.deepEqual(parsePreset(preset), original.recipe)
  assert.deepEqual(Object.keys(JSON.parse(preset)).sort(), ['format', 'recipe', 'version'])
  assert.throws(() => parsePreset(preset.replace('"version":1', '"version":2')), /version is not supported/)
  const invalid = JSON.parse(preset)
  invalid.recipe.effects[0].value = 101
  assert.throws(() => parsePreset(JSON.stringify(invalid)), /invalid or unsupported/)
  assert.throws(() => parsePreset(JSON.stringify({ ...JSON.parse(preset), source: original.source })), /invalid or unsupported/)
  assert.throws(() => parseProject(encodeProject(original).replace('"version":1', '"version":999')), /version is not supported/)
  assert.throws(() => parseProject('{'), /not valid JSON/)
})

test('recovery retains two valid generations, ignores a corrupt newest file, and never rotates invalid input over a good checkpoint', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'deep-fryer-recovery-unit-'))
  const validate = (source: EditableDocument['source']): void => { PNG.sync.read(Buffer.from(source.bytes)) }
  try {
    const store = new RecoveryStore(directory, validate)
    assert.equal(await store.initialize(), null)
    const first = document()
    await store.checkpoint(first)
    const second = { ...first, recipe: { ...first.recipe, seed: 654321 } }
    await store.checkpoint(second)
    const previous = await readFile(join(directory, 'previous.deepfryer'), 'utf8')
    assert.deepEqual(parseProject(previous), first)
    assert.deepEqual(await store.restore(), second)
    await assert.rejects(store.checkpoint({ ...second, source: { ...second.source, bytes: new Uint8Array(second.source.bytes.subarray(0, 33)) } }))
    assert.deepEqual(await store.restore(), second)
    await writeFile(join(directory, 'latest.deepfryer'), '{damaged')
    const restarted = new RecoveryStore(directory, validate)
    assert.equal((await restarted.initialize())?.name, first.source.name)
    assert.deepEqual(await restarted.restore(), first)
    await restarted.discard()
    assert.equal(await restarted.initialize(), null)
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('recovery expiration, abandoned temporary files, and clean exit follow the cleanup policy', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'deep-fryer-retention-unit-'))
  try {
    const store = new RecoveryStore(directory, (source) => { PNG.sync.read(Buffer.from(source.bytes)) })
    await store.initialize()
    await store.checkpoint(document())
    await writeFile(join(directory, 'checkpoint-0000.tmp'), 'interrupted write')
    const expired = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000)
    await utimes(join(directory, 'latest.deepfryer'), expired, expired)
    assert.equal(await store.initialize(), null)
    await assert.rejects(readFile(join(directory, 'checkpoint-0000.tmp')), { code: 'ENOENT' })
    await store.checkpoint(document())
    await store.close()
    assert.equal(await store.initialize(), null)
  } finally { await rm(directory, { recursive: true, force: true }) }
})
