import assert from 'node:assert/strict'
import { link, mkdir, mkdtemp, open, readFile, rename, rm, stat, writeFile, type FileHandle } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { PNG } from 'pngjs'
import { inspectImage, readImage, writeImageExclusive } from '../src/main/image-files'
import { MAX_FILE_BYTES } from '../src/shared/image'
import { exportImageInput } from '../src/shared/output'

function png(): Buffer {
  const image = new PNG({ width: 3, height: 2 })
  image.data.fill(255)
  return PNG.sync.write(image)
}

test('export creates a new PNG and refuses existing paths and source hard links', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'deep-fryer-protection-'))
  try {
    const source = join(folder, 'source.png')
    const alias = join(folder, 'source-alias.png')
    const destination = join(folder, 'export.png')
    const original = png()
    await writeFile(source, original)
    await link(source, alias)
    await writeImageExclusive(destination, original, 'png')
    assert.deepEqual(await readFile(destination), original)
    for (const path of [source, alias, destination]) {
      await assert.rejects(writeImageExclusive(path, original, 'png'), /already exists/)
      assert.deepEqual(await readFile(path), original)
    }
  } finally {
    await rm(folder, { recursive: true, force: true })
  }
})

const writeFailures: Array<'writeFile' | 'sync'> = ['writeFile', 'sync']
for (const operation of writeFailures) {
  test(`a failed export ${operation} removes only its new destination and permits retry`, async (t) => {
    const folder = await mkdtemp(join(tmpdir(), 'deep-fryer-write-failure-'))
    try {
      const source = join(folder, 'source.png')
      const alias = join(folder, 'source-alias.png')
      const existing = join(folder, 'existing.png')
      const destination = join(folder, 'export.png')
      const bytes = png()
      await writeFile(source, bytes)
      await link(source, alias)
      await writeFile(existing, 'existing output')
      const probe = await open(join(folder, 'probe'), 'wx')
      const prototype: FileHandle = Object.getPrototypeOf(probe)
      await probe.close()
      const failure = new Error(`injected ${operation} failure`)
      const injected = t.mock.method(prototype, operation, async function (this: FileHandle) {
        await this.write(bytes.subarray(0, 16), 0, 16, 0)
        assert.deepEqual(await readFile(destination), operation === 'writeFile' ? bytes.subarray(0, 16) : bytes)
        throw failure
      })

      await assert.rejects(writeImageExclusive(destination, bytes, 'png'), (error) => error === failure)
      assert.equal(injected.mock.callCount(), 1)
      await assert.rejects(readFile(destination), { code: 'ENOENT' })
      for (const path of [source, alias, existing]) {
        await assert.rejects(writeImageExclusive(path, bytes, 'png'), /already exists/)
      }
      assert.deepEqual(await readFile(source), bytes)
      assert.deepEqual(await readFile(alias), bytes)
      assert.equal(await readFile(existing, 'utf8'), 'existing output')
      assert.equal(injected.mock.callCount(), 1)

      injected.mock.restore()
      await writeImageExclusive(destination, bytes, 'png')
      assert.deepEqual(await readFile(destination), bytes)
    } finally {
      t.mock.restoreAll()
      await rm(folder, { recursive: true, force: true })
    }
  })
}

test('failed export cleanup reports the write and removal failures without removing other data', async (t) => {
  const folder = await mkdtemp(join(tmpdir(), 'deep-fryer-cleanup-failure-'))
  try {
    const destination = join(folder, 'export.png')
    const moved = join(folder, 'incomplete.png')
    const bytes = png()
    const probe = await open(join(folder, 'probe'), 'wx')
    const prototype: FileHandle = Object.getPrototypeOf(probe)
    await probe.close()
    const failure = new Error('injected sync failure')
    t.mock.method(prototype, 'sync', async function (this: FileHandle) {
      assert.deepEqual(await readFile(destination), bytes)
      await this.close()
      await rename(destination, moved)
      await mkdir(destination)
      await writeFile(join(destination, 'keep.txt'), 'other data')
      throw failure
    })

    await assert.rejects(writeImageExclusive(destination, bytes, 'png'), (error) => {
      assert.ok(error instanceof AggregateError)
      assert.match(error.message, /incomplete file could not be removed/)
      assert.equal(error.cause, failure)
      assert.equal(error.errors.length, 2)
      assert.equal(error.errors[0], failure)
      assert.ok(error.errors[1] instanceof Error)
      assert.match(error.errors[1].message, /EISDIR/)
      return true
    })
    assert.equal(await readFile(join(destination, 'keep.txt'), 'utf8'), 'other data')
    assert.deepEqual(await readFile(moved), bytes)
  } finally {
    t.mock.restoreAll()
    await rm(folder, { recursive: true, force: true })
  }
})

test('open identifies image contents and does not return its filesystem path', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'deep-fryer-open-'))
  try {
    const path = join(folder, 'image.unusual')
    await writeFile(path, png())
    const image = await readImage(path)
    assert.equal(image.name, 'image.unusual')
    assert.equal(image.mime, 'image/png')
    assert.deepEqual(Object.keys(image).sort(), ['bytes', 'mime', 'name'])
  } finally {
    await rm(folder, { recursive: true, force: true })
  }
})

test('image boundary rejects other formats, oversized files, and decompression dimensions', () => {
  assert.throws(() => inspectImage(Buffer.from('<svg></svg>')), /PNG or JPEG/)
  assert.throws(() => inspectImage(new Uint8Array(MAX_FILE_BYTES + 1)), /64 MiB/)
  const overwide = png()
  overwide.writeUInt32BE(16_385, 16)
  assert.throws(() => inspectImage(overwide), /16,384/)
  const overpixels = png()
  overpixels.writeUInt32BE(6_000, 16)
  overpixels.writeUInt32BE(4_001, 20)
  assert.throws(() => inspectImage(overpixels), /24 million/)
  const malformedJpeg = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0, 1])
  assert.throws(() => inspectImage(malformedJpeg), /damaged/)
})

test('invalid PNG export never creates a destination file', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'deep-fryer-invalid-'))
  try {
    const path = join(folder, 'invalid.png')
    await assert.rejects(writeImageExclusive(path, Buffer.from('not an image'), 'png'), /PNG or JPEG/)
    await assert.rejects(readFile(path), { code: 'ENOENT' })
  } finally {
    await rm(folder, { recursive: true, force: true })
  }
})

test('PNG output may exceed the compressed source limit without relaxing imports', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'deep-fryer-large-output-'))
  try {
    const bytes = Buffer.alloc(MAX_FILE_BYTES + 1)
    png().copy(bytes)
    const input = exportImageInput.parse({ bytes, format: 'png', suggestedName: 'large.png' })
    const destination = join(folder, input.suggestedName)
    await writeImageExclusive(destination, input.bytes, input.format)
    assert.equal((await stat(destination)).size, bytes.length)
    await assert.rejects(readImage(destination), /64 MiB/)
  } finally {
    await rm(folder, { recursive: true, force: true })
  }
})
