import assert from 'node:assert/strict'
import { mkdtemp, open, lstat, rename, unlink, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { PNG } from 'pngjs'
import { ProjectTargets } from '../src/main/project-targets'
import { encodeProject } from '../src/main/document-files'
import { newPreset } from '../src/shared/preset'
import { aclFixture } from './windows-acl-fixture'

test('Windows restrictive DACL is present before first temporary write and after ordinary Save', { skip: process.platform !== 'win32' }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'df-acl-repair-'))
  const path = join(directory, 'private.deepfryer')
  const png = new PNG({ width: 2, height: 2 }); png.data.fill(190)
  const document = { source: { name: 'private.png', mime: 'image/png' as const, bytes: new Uint8Array(PNG.sync.write(png)) }, preset: newPreset() }
  await writeFile(path, encodeProject(document))
  await aclFixture(directory, 'broaden-directory')
  const before = await aclFixture(path, 'private')
  let observed = false
  const targets = new ProjectTargets({ lstat: (p) => lstat(p, { bigint: true }), rename, unlink, open: async (...args) => {
    const file = await open(...args)
    if (String(args[0]).endsWith('.tmp')) {
      observed = true
      try {
        assert.equal((await file.stat()).size, 0)
        assert.equal(await aclFixture(String(args[0]), 'read'), before, 'empty temporary must already have destination security')
      } catch (error) { await file.close(); throw error }
    }
    return file
  } })
  try {
    const opened = await targets.openProject(path, () => {})
    assert.ok(opened.target)
    const result = await targets.save(opened.target.id, { ...document, preset: { ...document.preset, seed: 987654 } })
    assert.equal(result.kind, 'saved', JSON.stringify(result))
    assert.equal(observed, true)
    assert.equal(await aclFixture(path, 'read'), before)
    assert.deepEqual(await readdir(directory), ['private.deepfryer'])
    assert.match(await readFile(path, 'utf8'), /987654/)
  } finally { await rm(directory, { recursive: true }) }
})
