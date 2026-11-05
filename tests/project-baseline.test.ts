import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { test, type TestContext } from 'node:test'
import { createRenderer, ref, shallowRef } from 'vue'
import { useDocumentFiles } from '../src/renderer/src/document-files'
import { projectTargetIdSchema, type DocumentBridge, type EditableDocument, type ProjectSaveResult, type ProjectTarget } from '../src/shared/documents'
import { newPreset } from '../src/shared/preset'
import { newEdit, type EditState } from '../src/shared/edit'

function withCaptions(edit: EditState, top: string): EditState {
  return { ...edit, composition: { captions: { kind: 'top-bottom-v1', font: 'anton-regular-v1', top, bottom: 'Bottom', size: 0.1 } } }
}

function document(name: string): EditableDocument {
  return { source: { name, mime: 'image/png', bytes: new Uint8Array([1, 2, 3]) }, edit: newEdit({ ...newPreset(), seed: 123456 }) }
}

function target(name: string): ProjectTarget { return { id: projectTargetIdSchema.parse(randomUUID()), name } }

function setup(t: TestContext) {
  const a = document('a.png')
  const b = document('b.png')
  const aTarget = target('a.deepfryer')
  const bTarget = target('b.deepfryer')
  const active = shallowRef(a)
  const released: string[] = []
  const events: string[] = []
  let candidate = { document: a, target: aTarget }
  let publishFails = false
  let choice: 'save' | 'discard' | 'cancel' = 'discard'
  const bridge: DocumentBridge = {
    confirmUnsaved: async () => choice,
    onCloseRequested: () => () => {}, replyToClose: async () => {},
    openProject: async () => candidate,
    saveProject: async (input) => { events.push(`save:${input.target}`); return { kind: 'saved', target: aTarget } },
    saveProjectAs: async () => ({ kind: 'cancelled' }),
    releaseProjectTarget: async (id) => { released.push(id); events.push(`release:${id}`) },
    openPreset: async () => null, savePreset: async () => ({ kind: 'cancelled' }),
    recoveryOffer: async () => null, restoreRecovery: async () => b,
    discardRecovery: async () => {}, checkpoint: async () => {}
  }
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  Object.defineProperty(globalThis, 'window', { value: { documentBridge: bridge }, configurable: true })
  const renderer = createRenderer<object, object>({
    patchProp: () => {}, insert: () => {}, remove: () => {}, createElement: () => ({}), createText: () => ({}),
    createComment: () => ({}), setText: () => {}, setElementText: () => {}, parentNode: () => null, nextSibling: () => null
  })
  function createFiles() {
    return useDocumentFiles({ busy: ref(false), fileBusy: ref(false), source: () => active.value.source, edit: () => active.value.edit,
      ready: () => true, gestureActive: () => false, finishGesture: () => {}, cancelPreparation: () => {},
      setOperation: () => {}, finishOperation: () => {}, report: () => {}, applyPreset: () => {},
      publish: async (source, edit, confirm) => {
        if (publishFails) throw new Error('candidate preparation failed')
        if (!await confirm()) return false
        active.value = { source, edit }
        events.push(`publish:${source.name}`)
        return true
      }
    })
  }
  const holder: { files?: ReturnType<typeof createFiles> } = {}
  const app = renderer.createApp({ setup: () => { holder.files = createFiles(); return () => null } })
  app.mount({})
  if (!holder.files) throw new Error('Missing document owner')
  const files = holder.files
  t.after(() => {
    app.unmount()
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow)
    else Reflect.deleteProperty(globalThis, 'window')
  })
  return { a, b, aTarget, bTarget, active, bridge, files, released, events,
    candidateB: () => { candidate = { document: b, target: bTarget } },
    choose: (next: typeof choice) => { choice = next }, failPublish: () => { publishFails = true } }
}

test('a delayed acknowledgement saves only the submitted snapshot while later edits remain dirty', async (t) => {
  const { files, bridge, active, aTarget } = setup(t)
  await files.checkRecovery()
  await files.openProject()
  assert.equal(files.dirty.value, false)
  active.value = { ...active.value, edit: withCaptions(newEdit({ ...active.value.edit.preset, seed: 234567 }), 'Submitted caption') }
  let acknowledge: (result: ProjectSaveResult) => void = () => { throw new Error('Save did not start') }
  let submitted: EditableDocument | undefined
  bridge.saveProject = async (input) => {
    submitted = input.document
    return new Promise((resolve) => { acknowledge = resolve })
  }
  const saving = files.saveProject()
  assert.equal(files.locked.value, true)
  active.value.source.bytes[0] = 99
  active.value.edit.preset.seed = 345678
  assert.ok(active.value.edit.composition.captions)
  active.value.edit.composition.captions.top = 'Later caption'
  active.value.edit.composition.captions.size = 0.16
  assert.ok(submitted)
  assert.equal(submitted.source.bytes[0], 1)
  assert.equal(submitted.edit.preset.seed, 234567)
  assert.equal(submitted.edit.composition.captions?.top, 'Submitted caption')
  assert.equal(submitted.edit.composition.captions?.size, 0.1)
  acknowledge({ kind: 'saved', target: aTarget })
  await saving
  assert.equal(files.dirty.value, true)
  active.value = submitted
  assert.equal(files.dirty.value, false)
})

test('caption-only ordinary Save establishes the complete saved baseline without replacing the preset', async (t) => {
  const { files, bridge, active, aTarget } = setup(t)
  await files.checkRecovery()
  await files.openProject()
  const before = active.value
  active.value = { ...before, edit: withCaptions(before.edit, 'Caption only') }
  assert.equal(files.dirty.value, true)
  let submitted: EditableDocument | undefined
  bridge.saveProject = async input => { submitted = input.document; return { kind: 'saved', target: aTarget } }
  await files.saveProject()
  assert.ok(submitted)
  assert.equal(submitted.edit.composition.captions?.top, 'Caption only')
  assert.deepEqual(submitted.edit.preset, before.edit.preset)
  assert.equal(files.dirty.value, false)
  active.value = before
  assert.equal(files.dirty.value, true)
  active.value = submitted
  assert.equal(files.dirty.value, false)
})

for (const outcome of ['cancel', 'failed-publication', 'save', 'conflict'] as const) {
  test(`candidate ${outcome} releases only the correct capability and preserves the saved baseline`, async (t) => {
    const { files, bridge, active, aTarget, bTarget, candidateB, choose, failPublish, released, events } = setup(t)
    await files.checkRecovery()
    await files.openProject()
    const savedA = active.value
    active.value = { ...active.value, edit: withCaptions(active.value.edit, 'Keep A captions') }
    const submitted: EditableDocument[] = []
    bridge.saveProject = async input => { submitted.push(input.document); events.push(`save:${input.target}`); return { kind: 'saved', target: aTarget } }
    candidateB()
    choose(outcome === 'save' || outcome === 'conflict' ? 'save' : 'cancel')
    if (outcome === 'failed-publication') failPublish()
    if (outcome === 'conflict') bridge.saveProject = async () => ({ kind: 'conflict', reason: 'changed' })
    await files.openProject()
    if (outcome === 'save') {
      assert.equal(active.value.source.name, 'b.png')
      assert.deepEqual(released, [aTarget.id])
      assert.ok(events.indexOf(`save:${aTarget.id}`) < events.indexOf('publish:b.png'))
      assert.ok(events.indexOf('publish:b.png') < events.indexOf(`release:${aTarget.id}`))
      assert.equal(files.target.value?.id, bTarget.id)
      assert.equal(files.dirty.value, false)
      assert.equal(submitted[0]?.edit.composition.captions?.top, 'Keep A captions')
    } else {
      assert.deepEqual(released, [bTarget.id])
      assert.equal(files.target.value?.id, aTarget.id)
      assert.equal(files.dirty.value, true)
      assert.equal(active.value.edit.composition.captions?.top, 'Keep A captions')
      active.value = savedA
      assert.equal(files.dirty.value, false)
    }
  })
}

test('image replacement and recovery release a target after publication and remain unsaved', async (t) => {
  const { files, b, aTarget, released } = setup(t)
  await files.checkRecovery()
  await files.openProject()
  await files.load(async () => b.source)
  assert.deepEqual(released, [aTarget.id])
  assert.equal(files.target.value, null)
  assert.equal(files.dirty.value, true)
  await files.openProject()
  await files.restoreRecovery()
  assert.deepEqual(released, [aTarget.id, aTarget.id])
  assert.equal(files.target.value, null)
  assert.equal(files.dirty.value, true)
})

for (const result of [
  { kind: 'cancelled' }, { kind: 'failed', message: 'write failed' },
  { kind: 'conflict', reason: 'changed' }, { kind: 'uncertain', message: 'verification failed' }
] satisfies ProjectSaveResult[]) {
  test(`${result.kind} acknowledgement retains the previous baseline and target`, async (t) => {
    const { files, bridge, active, aTarget, released } = setup(t)
    await files.checkRecovery()
    await files.openProject()
    const saved = active.value
    active.value = { ...saved, edit: newEdit({ ...saved.edit.preset, seed: 234567 }) }
    bridge.saveProject = async () => result
    await files.saveProject()
    assert.equal(files.dirty.value, true)
    assert.equal(files.target.value?.id, aTarget.id)
    assert.deepEqual(released, [])
    active.value = saved
    assert.equal(files.dirty.value, false)
  })
}
