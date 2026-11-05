import assert from 'node:assert/strict'
import { chmod, copyFile, link, lstat, mkdtemp, open, readFile, readdir, rename, rm, stat, symlink, unlink, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'
import { PNG } from 'pngjs'
import { ProjectTargets } from '../src/main/project-targets'
import { CURRENT_PROJECT_VERSION, encodeProject, parseProject } from '../src/main/document-files'
import { newPreset } from '../src/shared/preset'
import { newEdit } from '../src/shared/edit'
import { projectTargetIdSchema, type EditableDocument } from '../src/shared/documents'
import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { once } from 'node:events'

function document(seed = 123456): EditableDocument {
  const image = new PNG({ width: 8, height: 5 })
  image.data.fill(190)
  return { source: { name: 'source.png', mime: 'image/png', bytes: new Uint8Array(PNG.sync.write(image)) }, edit: newEdit({ ...newPreset(), seed }) }
}

test('authorized ordinary Save replaces the exact project repeatedly and reopens equal documents', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'deep-fryer-target-unit-'))
  try {
    const path = join(directory, 'edit.deepfryer')
    await writeFile(path, encodeProject(document()))
    const targets = new ProjectTargets()
    const opened = await targets.openProject(path, () => {})
    assert.ok(opened.target)
    for (const seed of [234567, 345678]) {
      const submitted = document(seed)
      assert.deepEqual(await targets.save(opened.target.id, submitted), { kind: 'saved', target: opened.target })
      assert.deepEqual(parseProject(await readFile(path, 'utf8')), submitted)
    }
    assert.deepEqual(await readdir(directory), ['edit.deepfryer'])
  } finally { await rm(directory, { recursive: true, force: true }) }
})

async function fixture(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), 'deep-fryer-target-unit-'))
  const path = join(directory, 'edit.deepfryer')
  const original = document()
  const text = encodeProject(original)
  await writeFile(path, text)
  t.after(async () => {
    await chmod(path, 0o666).catch(() => {})
    await rm(directory, { recursive: true, force: true })
  })
  return { directory, path, original, text }
}

const realDisk = { open, lstat: (path: string) => lstat(path, { bigint: true }), rename, unlink }

async function expectCollision(targets: ProjectTargets, path: string, document: EditableDocument): Promise<void> {
  const result = await targets.saveAs(path, document)
  assert.equal(result.kind, 'failed')
  if (result.kind === 'failed') assert.match(result.message, /already exists/)
}

test('capabilities are independent, session scoped, validated before issue, and safely released', async (t) => {
  const { directory, path, original, text } = await fixture(t)
  const targets = new ProjectTargets()
  const a = await targets.openProject(path, () => {})
  assert.ok(a.target)
  const b = await targets.saveAs(join(directory, 'b.deepfryer'), original)
  assert.equal(b.kind, 'saved')
  if (b.kind !== 'saved') throw new Error('Missing saved target')
  assert.notEqual(a.target.id, b.target.id)
  targets.release(b.target.id)
  assert.deepEqual(await targets.save(b.target.id, original), { kind: 'conflict', reason: 'stale' })
  assert.deepEqual(await targets.save(projectTargetIdSchema.parse(randomUUID()), original), { kind: 'conflict', reason: 'stale' })
  assert.deepEqual(await new ProjectTargets().save(a.target.id, original), { kind: 'conflict', reason: 'stale' })
  await assert.rejects(targets.openProject(path, () => { throw new Error('invalid image') }), /invalid image/)
  assert.equal((await targets.save(a.target.id, original)).kind, 'saved')
  targets.clear()
  assert.deepEqual(await targets.save(a.target.id, original), { kind: 'conflict', reason: 'stale' })
  assert.equal(await readFile(path, 'utf8'), text)
})

test('legacy projects have no update capability and Save As creates the current version exclusively', async (t) => {
  const { directory } = await fixture(t)
  const targets = new ProjectTargets()
  const legacy = join(directory, 'legacy.deepfryer')
  await copyFile('tests/fixtures/v1/baseline.deepfryer', legacy)
  const original = await readFile(legacy)
  const opened = await targets.openProject(legacy, () => {})
  assert.equal(opened.target, null)
  await expectCollision(targets, legacy, opened.document)
  const copy = join(directory, 'copy.deepfryer')
  assert.equal((await targets.saveAs(copy, opened.document)).kind, 'saved')
  assert.equal(JSON.parse(await readFile(copy, 'utf8')).version, CURRENT_PROJECT_VERSION)
  assert.deepEqual(await readFile(legacy), original)
})

for (const change of ['same-size', 'missing', 'readonly', 'replacement', 'hardlink', 'symlink'] as const) {
  test(`ordinary Save refuses ${change} and preserves external content`, async (t) => {
    const { directory, path, original, text } = await fixture(t)
    const targets = new ProjectTargets()
    const opened = await targets.openProject(path, () => {})
    assert.ok(opened.target)
    const external = text.replace('123456', '987654')
    if (change === 'same-size') {
      const before = await stat(path)
      await writeFile(path, external)
      await utimes(path, before.atime, before.mtime)
    } else if (change === 'missing') await unlink(path)
    else if (change === 'readonly') await chmod(path, 0o444)
    else if (change === 'replacement') {
      await rename(path, join(directory, 'old.deepfryer'))
      await writeFile(path, text)
    } else if (change === 'hardlink') await link(path, join(directory, 'alias.deepfryer'))
    else {
      const other = join(directory, 'outside.deepfryer')
      await writeFile(other, external)
      await unlink(path)
      try { await symlink(other, path, 'file') } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'EPERM') { t.skip('Windows symlink privilege is unavailable'); return }
        throw error
      }
    }
    const result = await targets.save(opened.target.id, original)
    assert.equal(result.kind, 'conflict')
    if (change === 'missing') await assert.rejects(readFile(path), { code: 'ENOENT' })
    else assert.equal(await readFile(path, 'utf8'), change === 'same-size' || change === 'symlink' ? external : text)
    assert.equal((await readdir(directory)).some((name) => name.endsWith('.tmp')), false)
    assert.equal((await targets.saveAs(join(directory, 'separate.deepfryer'), original)).kind, 'saved')
  })
}

test('Open and Save As cannot authorize image files, hardlinks or symlinks as writable projects', async (t) => {
  const { directory, path, original, text } = await fixture(t)
  const targets = new ProjectTargets()
  const image = join(directory, 'source.png')
  await writeFile(image, original.source.bytes)
  await assert.rejects(targets.openProject(image, () => {}))
  await expectCollision(targets, image, original)
  assert.deepEqual(await readFile(image), Buffer.from(original.source.bytes))
  const alias = join(directory, 'alias.deepfryer')
  await link(path, alias)
  await assert.rejects(targets.openProject(alias, () => {}))
  await expectCollision(targets, alias, original)
  assert.equal(await readFile(path, 'utf8'), text)
  await unlink(alias)
  try { await symlink(path, alias, 'file') } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'EPERM') { t.skip('Windows symlink privilege is unavailable'); return }
    throw error
  }
  await assert.rejects(targets.openProject(alias, () => {}))
  await expectCollision(targets, alias, original)
  assert.equal(await readFile(path, 'utf8'), text)
})

test('Windows read-only attribute blocks native writable open and ordinary Save', { skip: process.platform !== 'win32' }, async (t) => {
  const { directory, path, original, text } = await fixture(t)
  const targets = new ProjectTargets()
  const opened = await targets.openProject(path, () => {})
  assert.ok(opened.target)
  await chmod(path, 0o444)
  await assert.rejects(open(path, 'r+'), (error: unknown) => error instanceof Error && 'code' in error && (error.code === 'EACCES' || error.code === 'EPERM'))
  assert.deepEqual(await targets.save(opened.target.id, original), { kind: 'conflict', reason: 'readonly' })
  assert.equal(await readFile(path, 'utf8'), text)
  assert.deepEqual(await readdir(directory), ['edit.deepfryer'])
})

test('Windows sharing refusal prevents rename without deleting the destination or leaving a temporary file', { skip: process.platform !== 'win32', timeout: 15000 }, async (t) => {
  const { directory, path, original, text } = await fixture(t)
  const targets = new ProjectTargets()
  const opened = await targets.openProject(path, () => {})
  assert.ok(opened.target)
  const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    "$f=[IO.File]::Open($env:DEEP_FRYER_LOCK_PATH,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::ReadWrite); try { [Console]::WriteLine('locked'); [Console]::Out.Flush(); [Console]::ReadLine() | Out-Null } finally { $f.Dispose() }"
  ], { env: { ...process.env, DEEP_FRYER_LOCK_PATH: path }, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
  const exited = once(child, 'exit')
  try {
    const output = await Promise.race([once(child.stdout, 'data').then(([chunk]) => String(chunk)), exited.then(() => 'exited before locking')])
    assert.match(output, /locked/)
    const result = await targets.save(opened.target.id, original)
    assert.equal(result.kind, 'failed')
    if (result.kind === 'failed') assert.match(result.message, /EPERM|EACCES|EBUSY/)
    assert.equal(await readFile(path, 'utf8'), text)
    assert.deepEqual(await readdir(directory), ['edit.deepfryer'])
  } finally {
    child.stdin.end('\n')
    await exited
    assert.equal(child.exitCode, 0)
  }
  assert.equal((await targets.save(opened.target.id, original)).kind, 'saved')
})

for (const failure of ['create', 'write', 'sync', 'close', 'rename'] as const) {
  test(`${failure} failure retains original bytes and cleans the exclusive temporary file`, async (t) => {
    const { directory, path, original, text } = await fixture(t)
    const fs = { ...realDisk }
    if (failure === 'rename') fs.rename = async () => { throw new Error('injected rename failure') }
    else fs.open = async (...args) => {
      if (args[1] === 'wx' && failure === 'create') throw new Error('injected create failure')
      const file = await open(...args)
      if (args[1] === 'wx' && failure !== 'create') {
        const method = failure === 'write' ? 'writeFile' : failure
        t.mock.method(file, method, async () => { throw new Error(`injected ${failure} failure`) }, { times: 1 })
      }
      return file
    }
    const targets = new ProjectTargets(fs)
    const opened = await targets.openProject(path, () => {})
    assert.ok(opened.target)
    const result = await targets.save(opened.target.id, original)
    assert.equal(result.kind, 'failed')
    if (result.kind === 'failed') assert.match(result.message, new RegExp(`injected ${failure} failure`))
    assert.equal(await readFile(path, 'utf8'), text)
    assert.deepEqual(await readdir(directory), ['edit.deepfryer'])
  })
}

test('cleanup failure retains the write cause and identifies the surviving temporary file', async (t) => {
  const { directory, path, original, text } = await fixture(t)
  const targets = new ProjectTargets({ ...realDisk,
    open: async (...args) => {
      const file = await open(...args)
      if (args[1] === 'wx') t.mock.method(file, 'writeFile', async () => { throw new Error('injected write failure') })
      return file
    },
    unlink: async () => { throw new Error('injected cleanup failure') }
  })
  const opened = await targets.openProject(path, () => {})
  assert.ok(opened.target)
  const result = await targets.save(opened.target.id, original)
  assert.equal(result.kind, 'failed')
  if (result.kind === 'failed') {
    assert.match(result.message, /injected write failure/)
    assert.match(result.message, /injected cleanup failure/)
    const temporary = (await readdir(directory)).find((name) => name.endsWith('.tmp'))
    assert.ok(temporary)
    assert.ok(result.message.includes(temporary))
    assert.ok(!result.message.includes(directory))
  }
  assert.equal(await readFile(path, 'utf8'), text)
})

test('the final check catches a same-size edit made while the temporary file is synced', async (t) => {
  const { directory, path, original, text } = await fixture(t)
  const external = text.replace('123456', '987654')
  const targets = new ProjectTargets({ ...realDisk, open: async (...args) => {
    const file = await open(...args)
    if (args[1] === 'wx') {
      const sync = file.sync.bind(file)
      t.mock.method(file, 'sync', async () => { await sync(); await writeFile(path, external) })
    }
    return file
  } })
  const opened = await targets.openProject(path, () => {})
  assert.ok(opened.target)
  assert.deepEqual(await targets.save(opened.target.id, original), { kind: 'conflict', reason: 'changed' })
  assert.equal(await readFile(path, 'utf8'), external)
  assert.deepEqual(await readdir(directory), ['edit.deepfryer'])
})

for (const failure of ['after-rename', 'verification'] as const) {
  test(`${failure} failure explicitly reports an uncertain outcome and revokes the capability`, async (t) => {
    const { directory, path } = await fixture(t)
    let renamed = false
    const targets = new ProjectTargets({ ...realDisk,
      rename: async (...args) => { await rename(...args); renamed = true; if (failure === 'after-rename') throw new Error('injected after rename') },
      lstat: async (path) => { if (renamed && failure === 'verification') throw new Error('injected verification failure'); return realDisk.lstat(path) }
    })
    const opened = await targets.openProject(path, () => {})
    assert.ok(opened.target)
    const submitted = document(234567)
    const result = await targets.save(opened.target.id, submitted)
    assert.equal(result.kind, 'uncertain')
    assert.deepEqual(parseProject(await readFile(path, 'utf8')), submitted)
    assert.deepEqual(await targets.save(opened.target.id, submitted), { kind: 'conflict', reason: 'stale' })
    assert.deepEqual(await readdir(directory), ['edit.deepfryer'])
  })
}

test('verification compares exact bytes even when a changed UTF-8 BOM decodes to the same document', async (t) => {
  const { path, original } = await fixture(t)
  const targets = new ProjectTargets({ ...realDisk, rename: async (...args) => {
    await rename(...args)
    await writeFile(path, '\ufeff' + await readFile(path, 'utf8'))
  } })
  const opened = await targets.openProject(path, () => {})
  assert.ok(opened.target)
  assert.equal((await targets.save(opened.target.id, original)).kind, 'uncertain')
  assert.deepEqual(await targets.save(opened.target.id, original), { kind: 'conflict', reason: 'stale' })
})

test('an exclusive temporary collision is never removed, and file errors do not disclose target paths', async (t) => {
  const { directory, path, original, text } = await fixture(t)
  const targets = new ProjectTargets({ ...realDisk, open: async (...args) => {
    if (args[1] === 'wx') await writeFile(args[0], 'external temporary')
    return open(...args)
  } })
  const opened = await targets.openProject(path, () => {})
  assert.ok(opened.target)
  const result = await targets.save(opened.target.id, original)
  assert.equal(result.kind, 'failed')
  if (result.kind === 'failed') assert.ok(!result.message.includes(directory))
  const temporary = (await readdir(directory)).find((name) => name.endsWith('.tmp'))
  assert.ok(temporary)
  assert.equal(await readFile(join(directory, temporary), 'utf8'), 'external temporary')
  assert.equal(await readFile(path, 'utf8'), text)
  await assert.rejects(targets.openProject(join(directory, 'missing.deepfryer'), () => {}), (error: unknown) => error instanceof Error && !error.message.includes(directory))
})
