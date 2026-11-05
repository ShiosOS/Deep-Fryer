import { legacyPresetFixture, legacyPresetField } from './fixtures/legacy-format'
import { newEdit } from '../src/shared/edit'
import { parseProject as v2Reader } from './fixtures/v2-reader/src/main/document-files'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { encodePreset, encodeProject, parsePreset, parseProject } from '../src/main/document-files'
import { parsePreset as oldPresetReader, parseProject as oldProjectReader } from './fixtures/v1-reader/src/main/document-files'

test('real v1 documents retain their source bytes and every native setting and write v3 refused by the old reader', async () => {
  for (const directory of ['v1', 'v1-rich']) {
    const projectText = await readFile(`tests/fixtures/${directory}/baseline.deepfryer`, 'utf8')
    const presetText = await readFile(`tests/fixtures/${directory}/${legacyPresetFixture}`, 'utf8')
    const previous = oldProjectReader(projectText)
    const { version: _version, ...expectedPreset } = previous[legacyPresetField]
    const current = parseProject(projectText)
    assert.deepEqual(current, { source: previous.source, edit: newEdit(expectedPreset) })
    assert.deepEqual(parsePreset(presetText), expectedPreset)
    assert.equal(JSON.parse(encodeProject(current)).version, 3)
    assert.equal(JSON.parse(encodePreset(current.edit.preset)).format, 'deep-fryer-preset')
    assert.throws(() => oldProjectReader(encodeProject(current)), /version is not supported/)
    assert.throws(() => oldPresetReader(encodePreset(current.edit.preset)), /version is not supported/)
  }
})

test('v2 adapts losslessly into v3 and its frozen reader rejects the new envelope', async () => {
  const text = await readFile('tests/fixtures/v2/baseline.deepfryer', 'utf8')
  const prior = v2Reader(text)
  const current = parseProject(text)
  assert.deepEqual(current, { source: prior.source, edit: newEdit(prior.preset) })
  assert.throws(() => v2Reader(encodeProject(current)), /version is not supported/)
})
