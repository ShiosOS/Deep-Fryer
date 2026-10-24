import assert from 'node:assert/strict'
import { test } from 'node:test'
import { copyImageInput, copyImageResult } from '../src/shared/clipboard'
import { MAX_EXPORT_BYTES } from '../src/shared/output'
import { newPreset } from '../src/shared/preset'
import { useImageCopy, type CopySource } from '../src/renderer/src/copy-image'
import type { OutputJob, OutputResponse } from '../src/renderer/src/output'

test('clipboard contract accepts only bounded bytes and a strict copied acknowledgement', () => {
  for (const input of [null, {}, { bytes: [] }, { bytes: new Uint8Array() },
    { bytes: new Uint8Array(MAX_EXPORT_BYTES + 1) }, { bytes: new Uint8Array([1]), format: 'png' }]) {
    assert.equal(copyImageInput.safeParse(input).success, false)
  }
  assert.equal(copyImageInput.safeParse({ bytes: new Uint8Array(MAX_EXPORT_BYTES) }).success, true)
  assert.deepEqual(copyImageResult.parse({ kind: 'copied' }), { kind: 'copied' })
  for (const result of [{ kind: 'saved' }, null, { kind: 'copied', bytes: [] }]) assert.equal(copyImageResult.safeParse(result).success, false)
})

test('copy freezes before awaiting, ignores duplicates, settles disposal and permits retry after worker failure', async (context) => {
  class TestWorker {
    static instances: TestWorker[] = []
    onmessage: ((event: { data: OutputResponse }) => void) | null = null
    onerror: (() => void) | null = null
    onmessageerror: (() => void) | null = null
    job: OutputJob | null = null
    terminated = false
    constructor() { TestWorker.instances.push(this) }
    postMessage(job: OutputJob): void { this.job = job }
    terminate(): void { this.terminated = true }
  }
  let writes = 0
  let acknowledge = () => {}
  const replacements = { Worker: TestWorker, window: { imageBridge: { copyImage: async () => {
    writes += 1
    await new Promise<void>((resolve) => { acknowledge = resolve })
    return { kind: 'copied' }
  } } } }
  for (const [key, value] of Object.entries(replacements)) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, key)
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
    context.after(() => { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key) })
  }
  const bitmap = { width: 5, height: 7 }
  const source: CopySource = { name: 'source.png', mime: 'image/png', bytes: new Uint8Array([1, 2, 3]), bitmap }
  const preset = newPreset()
  const owner = useImageCopy()
  const pending = owner.run({ source, preset })
  assert.equal(owner.phase.value, 'preparing')
  const worker = TestWorker.instances[0]!
  source.bytes.fill(9)
  bitmap.width = 10
  preset.seed += 1
  assert.deepEqual(worker.job?.source.bytes, new Uint8Array([1, 2, 3]))
  assert.deepEqual(worker.job?.options, { format: 'png', width: 5, height: 7 })
  assert.notEqual(worker.job?.preset.seed, preset.seed)
  assert.equal(await owner.run({ source, preset }), 'ignored')
  worker.onerror?.()
  await assert.rejects(pending, /Copy preparation stopped/)
  assert.equal(worker.terminated, true)
  assert.equal(owner.phase.value, 'idle')
  const retry = owner.run({ source, preset })
  const retryWorker = TestWorker.instances[1]!
  owner.dispose()
  assert.equal(await retry, 'ignored')
  assert.equal(retryWorker.terminated, true)
  assert.equal(owner.phase.value, 'idle')
  assert.equal(await owner.run({ source, preset }), 'ignored')
  assert.equal(writes, 0)
  const writingOwner = useImageCopy()
  const writing = writingOwner.run({ source, preset })
  const writingWorker = TestWorker.instances[2]!
  writingWorker.onmessage?.({ data: { kind: 'ready', output: {
    bytes: new Uint8Array([4]), pixels: new Uint8ClampedArray(4),
    options: { format: 'png', width: 10, height: 7 }, sourceName: source.name
  } } })
  await Promise.resolve()
  assert.equal(writingWorker.terminated, true)
  assert.equal(writingOwner.phase.value, 'writing')
  assert.equal(await writingOwner.run({ source, preset }), 'ignored')
  writingOwner.dispose()
  acknowledge()
  assert.equal(await writing, 'ignored')
  assert.equal(writes, 1)
  assert.equal(await writingOwner.run({ source, preset }), 'ignored')
})
