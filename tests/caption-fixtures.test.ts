import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { parseProject, parsePreset } from './fixtures/v2-reader/src/main/document-files'

test('immutable base v2 reader, files and reference pixels keep their captured hashes', async () => {
  const manifest = JSON.parse(await readFile('tests/fixtures/v2/manifest.json', 'utf8'))
  for (const [path, sha] of Object.entries(manifest.files)) {
    assert.equal(createHash('sha256').update(await readFile(path)).digest('hex'), sha, path)
  }
  const document = parseProject(await readFile('tests/fixtures/v2/baseline.deepfryer', 'utf8'))
  assert.deepEqual(document.source.bytes, new Uint8Array(await readFile('tests/fixtures/v2/original.png')))
  assert.deepEqual(document.preset, parsePreset(await readFile('tests/fixtures/v2/baseline.frypreset', 'utf8')))
})
