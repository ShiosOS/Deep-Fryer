import assert from 'node:assert/strict'
import { mkdtemp, open, lstat, rename, unlink, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'
import { PNG } from 'pngjs'
import { ProjectTargets } from '../src/main/project-targets'
import { encodeProject } from '../src/main/document-files'
import { newEdit } from '../src/shared/edit'
import { aclFixture } from './windows-acl-fixture'
import { windowsProjectSecurity } from '../src/main/windows-project-security'
import type { EditableDocument } from '../src/shared/documents'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const realDisk = { lstat: (p: string) => lstat(p, { bigint: true }), rename: async (_from: string, _to: string, replace: () => Promise<void>) => replace(), unlink, open }

async function fixture(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), 'df-acl-repair-'))
  t.after(() => rm(directory, { recursive: true }))
  const path = join(directory, 'private.deepfryer')
  const png = new PNG({ width: 2, height: 2 }); png.data.fill(190)
  const document: EditableDocument = { source: { name: 'private.png', mime: 'image/png', bytes: new Uint8Array(PNG.sync.write(png)) }, edit: newEdit() }
  const text = encodeProject(document)
  await writeFile(path, text)
  await aclFixture(directory, 'broaden-directory')
  return { directory, path, document, text }
}

for (const permissions of ['private', 'explicit-deny', 'inherited', 'unprotected-deny'] as const) {
test(`Windows ${permissions} DACL is present before first temporary write and after ordinary Save`, { skip: process.platform !== 'win32' }, async (t) => {
  const { directory, path, document } = await fixture(t)
  if (permissions === 'private' || permissions === 'explicit-deny') await aclFixture(path, 'private')
  if (permissions === 'explicit-deny' || permissions === 'unprotected-deny') await aclFixture(path, 'deny')
  const before = await aclFixture(path, 'read')
  let observed = false
  const targets = new ProjectTargets({ ...realDisk, open: async (...args) => {
    const file = await open(...args)
    if (String(args[0]).endsWith('.tmp')) {
      const write = file.writeFile.bind(file)
      t.mock.method(file, 'writeFile', async (...input: Parameters<typeof write>) => {
        observed = true
        assert.equal((await file.stat()).size, 0)
        assert.equal(await aclFixture(String(args[0]), 'read'), before, 'empty temporary must already have destination security')
        t.diagnostic(JSON.stringify({ stage: 'before-first-write', permissions, security: before, bytes: 0 }))
        return write(...input)
      })
    }
    return file
  } })
  const opened = await targets.openProject(path, () => {})
  assert.ok(opened.target)
  const result = await targets.save(opened.target.id, { ...document, edit: { ...document.edit, preset: { ...document.edit.preset, seed: 987654 } } })
  assert.equal(result.kind, 'saved', JSON.stringify(result))
  assert.equal(observed, true)
  assert.equal(await aclFixture(path, 'read'), before)
  assert.deepEqual(await readdir(directory), ['private.deepfryer'])
  assert.match(await readFile(path, 'utf8'), /987654/)
})
}

for (const when of ['after-open', 'after-write'] as const) {
test(`Windows permission changes ${when} refuse ordinary Save without changing project bytes`, async (t) => {
  const { directory, path, document, text } = await fixture(t)
  await aclFixture(path, 'private')
  const targets = new ProjectTargets({ ...realDisk, open: async (...args) => {
    const file = await open(...args)
    if (String(args[0]).endsWith('.tmp') && when === 'after-write') {
      const sync = file.sync.bind(file)
      t.mock.method(file, 'sync', async () => { await sync(); await aclFixture(path, 'change') })
    }
    return file
  } })
  const opened = await targets.openProject(path, () => {})
  assert.ok(opened.target)
  if (when === 'after-open') await aclFixture(path, 'change')
  const result = await targets.save(opened.target.id, { ...document, edit: { ...document.edit, preset: { ...document.edit.preset, seed: 987654 } } })
  assert.ok(result.kind === 'failed' || result.kind === 'conflict', JSON.stringify(result))
  assert.equal(await readFile(path, 'utf8'), text)
  assert.deepEqual(await readdir(directory), ['private.deepfryer'])
})
}

for (const operation of ['inspect', 'prepare'] as const) {
test(`Windows ${operation} failure refuses before a content-bearing temporary and leaves Save As usable`, async (t) => {
  const { directory, path, document, text } = await fixture(t)
  const security = { ...windowsProjectSecurity, [operation]: async () => { throw new Error('injected ACL read/set failure') } }
  const targets = new ProjectTargets(realDisk, security)
  const opened = await targets.openProject(path, () => {})
  assert.ok(opened.target)
  const result = await targets.save(opened.target.id, document)
  assert.equal(result.kind, 'failed')
  if (result.kind === 'failed') assert.match(result.message, /Save As/)
  assert.equal(await readFile(path, 'utf8'), text)
  assert.deepEqual(await readdir(directory), ['private.deepfryer'])
  assert.equal((await targets.saveAs(join(directory, 'copy.deepfryer'), document)).kind, 'saved')
})
}

test('unavailable native helper refuses before temporary creation, and a later valid save still works', async (t) => {
  const { directory, path, document, text } = await fixture(t)
  const targets = new ProjectTargets()
  const opened = await targets.openProject(path, () => {})
  assert.ok(opened.target)
  const system = process.env.SystemRoot
  try {
    process.env.SystemRoot = join(directory, 'missing-windows')
    const result = await targets.save(opened.target.id, document)
    assert.equal(result.kind, 'failed')
    if (result.kind === 'failed') assert.match(result.message, /helper is unavailable/)
    assert.equal(await readFile(path, 'utf8'), text)
    assert.deepEqual(await readdir(directory), ['private.deepfryer'])
  } finally { if (system) process.env.SystemRoot = system; else delete process.env.SystemRoot }
  assert.equal((await targets.save(opened.target.id, document)).kind, 'saved')
})

test('a failed temp cleanup retains only a file with the original restrictive DACL', async (t) => {
  const { directory, path, document, text } = await fixture(t)
  const before = await aclFixture(path, 'private')
  const targets = new ProjectTargets({ ...realDisk,
    rename: async () => { throw new Error('injected replacement refusal') },
    unlink: async () => { throw new Error('injected cleanup failure') }
  })
  const opened = await targets.openProject(path, () => {})
  assert.ok(opened.target)
  const result = await targets.save(opened.target.id, document)
  assert.equal(result.kind, 'failed')
  const temporary = (await readdir(directory)).find((name) => name.endsWith('.tmp'))
  assert.ok(temporary)
  assert.equal(await aclFixture(join(directory, temporary), 'read'), before)
  assert.equal(await readFile(join(directory, temporary), 'utf8'), text)
  assert.equal(await readFile(path, 'utf8'), text)
  if (result.kind === 'failed') {
    assert.match(result.message, /injected replacement refusal/)
    assert.match(result.message, /injected cleanup failure/)
    assert.ok(result.message.includes(temporary))
    assert.ok(!result.message.includes(directory))
  }
})

test('the security lease prevents directory and temporary name substitution before content write', async (t) => {
  const { directory, path, document } = await fixture(t)
  const targets = new ProjectTargets({ ...realDisk, open: async (...args) => {
    const file = await open(...args)
    if (String(args[0]).endsWith('.tmp')) {
      await assert.rejects(rename(directory, directory + '-moved'))
      await assert.rejects(rename(String(args[0]), join(directory, 'stolen.tmp')))
    }
    return file
  } })
  const opened = await targets.openProject(path, () => {})
  assert.ok(opened.target)
  assert.equal((await targets.save(opened.target.id, document)).kind, 'saved')
})

test('a directory junction is refused before any temporary file is created', async (t) => {
  const { directory, path, document, text } = await fixture(t)
  const alias = directory + '-junction'
  await symlink(directory, alias, 'junction')
  t.after(() => rm(alias))
  const targets = new ProjectTargets()
  const opened = await targets.openProject(join(alias, 'private.deepfryer'), () => {})
  assert.ok(opened.target)
  assert.equal((await targets.save(opened.target.id, document)).kind, 'failed')
  assert.equal(await readFile(path, 'utf8'), text)
  assert.deepEqual(await readdir(directory), ['private.deepfryer'])
})

for (const denied of ['acl-read', 'secure-create'] as const) {
test(`native Windows ${denied} denial fails closed without a temporary file`, async (t) => {
  const { directory, path, document, text } = await fixture(t)
  await aclFixture(path, 'private')
  const targets = new ProjectTargets()
  const opened = await targets.openProject(path, () => {})
  assert.ok(opened.target)
  const original = await open(path, 'r')
  try {
    if (denied === 'acl-read') {
      await aclFixture(path, 'deny-read')
      await assert.rejects(windowsProjectSecurity.inspect(path))
    } else await aclFixture(directory, 'deny-create')
    const result = await targets.save(opened.target.id, document)
    assert.ok(result.kind === 'failed' || result.kind === 'conflict', JSON.stringify(result))
    assert.equal(await original.readFile('utf8'), text)
    assert.deepEqual(await readdir(directory), ['private.deepfryer'])
  } finally { await original.close() }
})
}

test('an explicit Windows integrity label is refused instead of discarded during replacement', async (t) => {
  const { directory, path, document, text } = await fixture(t)
  const targets = new ProjectTargets()
  const opened = await targets.openProject(path, () => {})
  assert.ok(opened.target)
  await promisify(execFile)(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32/icacls.exe'),
    [path, '/setintegritylevel', 'M'], { windowsHide: true, timeout: 10000 })
  await assert.rejects(windowsProjectSecurity.inspect(path))
  const result = await targets.save(opened.target.id, document)
  assert.ok(result.kind === 'failed' || result.kind === 'conflict', JSON.stringify(result))
  assert.equal(await readFile(path, 'utf8'), text)
  assert.deepEqual(await readdir(directory), ['private.deepfryer'])
})
