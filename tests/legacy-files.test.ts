import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { encodePreset, encodeProject, parsePreset, parseProject } from '../src/main/document-files'
import { parsePreset as oldPresetReader, parseProject as oldProjectReader } from './fixtures/v1-reader/src/main/document-files'

test('real v1 documents retain their source bytes and every native setting and write v2 refused by the old reader', async () => {
  for (const directory of ['v1', 'v1-rich']) {
    const projectText = await readFile(`tests/fixtures/${directory}/baseline.deepfryer`, 'utf8')
    const presetText = await readFile(`tests/fixtures/${directory}/baseline.fryrecipe`, 'utf8')
    const previous = oldProjectReader(projectText)
    const { version: _version, ...expectedPreset } = previous.recipe
    const current = parseProject(projectText)
    assert.deepEqual(current, { source: previous.source, preset: expectedPreset })
    assert.deepEqual(parsePreset(presetText), expectedPreset)
    assert.equal(JSON.parse(encodeProject(current)).version, 2)
    assert.equal(JSON.parse(encodePreset(current.preset)).format, 'deep-fryer-preset')
    assert.throws(() => oldProjectReader(encodeProject(current)), /version is not supported/)
    assert.throws(() => oldPresetReader(encodePreset(current.preset)), /version is not supported/)
  }
})
