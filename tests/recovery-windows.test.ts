import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { PNG } from 'pngjs'
import { parseProject, readProject } from '../src/main/document-files'
import { RecoveryStore } from '../src/main/recovery'

const windows = process.platform === 'win32'
const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

async function lock(path: string) {
  const script = '$f=[IO.File]::Open($env:RECOVERY_LOCK_PATH,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::ReadWrite); try { [Console]::Out.WriteLine("locked"); [Console]::Out.Flush(); [Console]::In.ReadLine() | Out-Null } finally { $f.Dispose() }'
  const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    windowsHide: true, env: { ...process.env, RECOVERY_LOCK_PATH: path }, stdio: ['pipe', 'pipe', 'pipe']
  })
  let stderr = ''
  child.stderr.setEncoding('utf8').on('data', (chunk: string) => { stderr += chunk })
  const exited = new Promise<void>((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', (code, signal) => code === 0 ? resolve() : reject(new Error(`Lock helper exited ${code}/${signal}: ${stderr}`)))
  })
  const [chunk] = await Promise.race([once(child.stdout, 'data'), exited.then(() => { throw new Error('Lock helper exited before handshake') })])
  assert.match(String(chunk), /locked/)
  return async () => { child.stdin.end('\n'); await exited }
}

async function fixture() {
  return parseProject(await readFile('tests/fixtures/v1/baseline.deepfryer', 'utf8'))
}

test('Windows recovery retries a locked generation and close drains admitted writes', { skip: !windows }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'fryer-retry-'))
  let release: (() => Promise<void>) | undefined
  try {
    const store = new RecoveryStore(directory, (source) => { PNG.sync.read(Buffer.from(source.bytes)) })
    const first = await fixture()
    const second = { ...first, source: { ...first.source, name: 'second.png' } }
    const third = { ...first, source: { ...first.source, name: 'third.png' } }
    await store.initialize()
    await store.checkpoint(first)
    release = await lock(join(directory, 'latest.deepfryer'))
    assert.deepEqual(await readProject(join(directory, 'latest.deepfryer')), first)
    const write = store.checkpoint(second)
    const queued = store.checkpoint(third)
    const close = store.close(true)
    const drained = Promise.all([write, queued, close])
    void drained.catch(() => {})
    await pause(250)
    await release(); release = undefined
    await drained
    assert.deepEqual(await readProject(join(directory, 'latest.deepfryer')), third)
    assert.deepEqual(await readProject(join(directory, 'previous.deepfryer')), second)
  } finally {
    if (release) await release()
    await rm(directory, { recursive: true, force: true })
  }
})

test('Windows recovery rejects a persistent lock and preserves a valid generation', { skip: !windows }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'fryer-locked-'))
  let release: (() => Promise<void>) | undefined
  try {
    const store = new RecoveryStore(directory, (source) => { PNG.sync.read(Buffer.from(source.bytes)) })
    const first = await fixture()
    const second = { ...first, source: { ...first.source, name: 'second.png' } }
    await store.initialize()
    await store.checkpoint(first)
    release = await lock(join(directory, 'latest.deepfryer'))
    await assert.rejects(store.checkpoint(second), (error: unknown) => error instanceof Error && 'code' in error && ['EPERM', 'EACCES', 'EBUSY'].includes(String(error.code)))
    assert.deepEqual(await store.restore(), first)
    assert.deepEqual(await readProject(join(directory, 'previous.deepfryer')), first)
  } finally {
    if (release) await release()
    await rm(directory, { recursive: true, force: true })
  }
})
