import assert from 'node:assert/strict'
import { link, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { PNG } from 'pngjs'
import { inspectImage, readImage, writePngExclusive } from '../src/main/image-files'
import { exportPngInput, MAX_FILE_BYTES } from '../src/shared/image'

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
    await writePngExclusive(destination, original)
    assert.deepEqual(await readFile(destination), original)
    for (const path of [source, alias, destination]) {
      await assert.rejects(writePngExclusive(path, original), /already exists/)
      assert.deepEqual(await readFile(path), original)
    }
  } finally {
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
    await assert.rejects(writePngExclusive(path, Buffer.from('not an image')), /PNG or JPEG/)
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
    const input = exportPngInput.parse({ bytes, suggestedName: 'large.png' })
    const destination = join(folder, input.suggestedName)
    await writePngExclusive(destination, input.bytes)
    assert.equal((await stat(destination)).size, bytes.length)
    await assert.rejects(readImage(destination), /64 MiB/)
  } finally {
    await rm(folder, { recursive: true, force: true })
  }
})
