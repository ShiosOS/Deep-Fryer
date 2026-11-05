import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { compositionSchema, type TopBottomCaptions } from '../src/shared/composition'
import { editStateSchema, newEdit, snapshotEdit } from '../src/shared/edit'
import { encodeProject, parseProject, encodePreset } from '../src/main/document-files'
import { useEditHistory } from '../src/renderer/src/edit-history'
import { freezeOutput } from '../src/renderer/src/output'
import { captionText, layoutCaptions, unsupportedCaptionGlyphs } from '../src/renderer/src/caption-layout'

const captions: TopBottomCaptions = { kind: 'top-bottom-v1', font: 'anton-regular-v1', top: 'Keep My\nCase', bottom: 'Café', size: 0.1 }

test('caption layout preserves words, graphemes and explicit lines within separate bands', () => {
  const measure = (text: string, size: number) => ({ width: [...text].length * size * 0.6, ascent: size * 0.8, descent: size * 0.2 })
  for (const frame of [{ width: 1000, height: 1800 }, { width: 1800, height: 1000 }]) {
    const blocks = layoutCaptions({ ...captions, top: 'Keep My\nCase', bottom: 'longword'.repeat(8) }, frame, measure)
    assert.equal(blocks.length, 2)
    assert.deepEqual(blocks[0]!.lines.map(line => line.text), ['Keep My', 'Case'])
    assert.equal(blocks[1]!.lines.map(line => line.text).join(''), 'longword'.repeat(8))
    assert.ok(blocks.every(block => block.lines.length <= 3 && block.size >= 25 && block.size <= 100))
    assert.ok(blocks[0]!.lines.every(line => line.y < frame.height * 0.3))
    assert.ok(blocks[1]!.lines.every(line => line.y > frame.height * 0.7))
  }
  assert.throws(() => layoutCaptions({ ...captions, top: 'a\nb\nc\nd' }, { width: 1000, height: 1000 }, measure), /cannot fit in three lines/)
  assert.equal(captionText('Cafe\u0301\r\nToast'), 'Café\nToast')
  assert.deepEqual(unsupportedCaptionGlyphs('Café Đẹp\nToast'), [])
  assert.deepEqual(unsupportedCaptionGlyphs('字🙂🙂'), ['字', '🙂'])
})

test('caption schema bounds text and size, rejects unknown contracts and canonicalizes whitespace', () => {
  assert.deepEqual(compositionSchema.parse({ captions: { ...captions, top: ' \n\t', bottom: '' } }), { captions: null })
  assert.equal(compositionSchema.parse({ captions }).captions?.top, captions.top)
  for (const invalid of [{ size: 0.03 }, { size: 0.17 }, { top: 'a'.repeat(513) }, { font: 'Impact' }, { kind: 'crop' }, { path: 'C:/font.ttf' }]) {
    assert.equal(compositionSchema.safeParse({ captions: { ...captions, ...invalid } }).success, false)
  }
  assert.equal(compositionSchema.safeParse({ captions: { ...captions, top: '字🙂\n'.repeat(50) } }).success, true)
  assert.equal(editStateSchema.safeParse({ ...newEdit(), crop: null }).success, false)
})

test('one edit history groups a field session and retains captions through preset changes', () => {
  const initial = newEdit()
  const history = useEditHistory(initial)
  history.begin()
  for (const top of ['K', 'Ke', 'Keep']) history.change({ ...history.edit.value, composition: { captions: { ...captions, top } } })
  history.end()
  const captionEdit = snapshotEdit(history.edit.value)
  history.change({ ...history.edit.value, preset: { ...initial.preset, seed: 43 } })
  assert.equal(history.edit.value.composition.captions?.top, 'Keep')
  history.undo()
  assert.deepEqual(history.edit.value, captionEdit)
  history.undo()
  assert.deepEqual(history.edit.value, initial)
  history.redo()
  assert.deepEqual(history.edit.value, captionEdit)
  assert.equal(history.canUndo.value, true)
  captionEdit.composition.captions!.top = 'mutated'
  captionEdit.preset.effects[0]!.mix = 0
  assert.equal(history.edit.value.composition.captions?.top, 'Keep')
  assert.equal(history.edit.value.preset.effects[0]?.mix, 100)
})

test('v3 projects and frozen output preserve complete edits; v2 presets exclude composition', async () => {
  const document = parseProject(await readFile('tests/fixtures/v2/baseline.deepfryer', 'utf8'))
  document.edit.composition.captions = { ...captions, top: '字🙂\n'.repeat(50) }
  const frozen = freezeOutput(document.source, document.edit, { format: 'png', width: 120, height: 80 })
  const encoded = encodeProject(document)
  assert.deepEqual(Object.keys(JSON.parse(encoded)).sort(), ['edit', 'format', 'source', 'version'])
  assert.deepEqual(parseProject(encoded), document)
  const preset = JSON.parse(encodePreset(document.edit.preset))
  assert.equal(preset.version, 2)
  assert.equal(preset.composition, undefined)
  document.edit.composition.captions.top = 'changed'
  document.edit.preset.seed = 0
  document.source.bytes[0] = 0
  assert.notEqual(frozen.edit.composition.captions?.top, 'changed')
  assert.notEqual(frozen.edit.preset.seed, 0)
  assert.notEqual(frozen.source.bytes[0], 0)
})
