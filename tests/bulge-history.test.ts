import assert from 'node:assert/strict'
import test from 'node:test'
import { applyBulge } from '../src/renderer/src/bulge'
import { renderPreset } from '../src/renderer/src/effects'
import { paneToImage, imageToPane, fitView, zoom, pan } from '../src/renderer/src/inspection-geometry'
import { useEditHistory } from '../src/renderer/src/edit-history'
import { newEdit } from '../src/shared/edit'
import type { Preset } from '../src/shared/preset'

Object.defineProperty(globalThis, 'ImageData', { value: class {
  constructor(public data: Uint8ClampedArray, public width: number, public height: number) {}
} })

const point: Extract<Preset['effects'][number], { kind: 'bulge' }> = { id: 'point', kind: 'bulge', enabled: true, mix: 100, x: 0.5, y: 0.5, radius: 0.5, strength: 50 }
const base: Preset = { seed: 42, effects: [point] }

test('a drag is one undo step and a new edit abandons redo', () => {
  const history = useEditHistory(newEdit(base))
  history.begin()
  for (const x of [0.6, 0.7, 0.8]) history.change(newEdit({ ...history.edit.value.preset, effects: [{ ...point, x }] }))
  history.end()
  assert.equal(history.canUndo.value, true)
  assert.equal(history.undo(), true)
  assert.deepEqual(history.edit.value.preset, base)
  assert.equal(history.canUndo.value, false)
  assert.equal(history.redo(), true)
  assert.equal(history.edit.value.preset.effects[0]?.kind, 'bulge')
  assert.equal(history.undo(), true)
  history.change(newEdit({ ...history.edit.value.preset, seed: 7 }))
  assert.equal(history.canRedo.value, false)
  assert.equal(history.redo(), false)
})

test('point mapping survives pan, zoom, and resize', () => {
  const image = { width: 400, height: 300 }
  const pane = { width: 800, height: 600 }
  const point = { x: 240, y: 110 }
  let view = fitView(image, pane)
  view = zoom(view, 1, { x: 400, y: 300 }, image, pane)
  view = pan(view, { x: -35, y: 19 }, image, pane)
  const mapped = paneToImage(view, imageToPane(view, point, pane), pane)
  assert.ok(Math.abs(mapped.x - point.x) < 1e-9)
  assert.ok(Math.abs(mapped.y - point.y) < 1e-9)
})

test('cancel restores confirmed history after undo and during an unfinished gesture', () => {
  const history = useEditHistory(newEdit({ ...base, seed: 1 }))
  history.change(newEdit({ ...base, seed: 2 }))
  history.confirm()
  history.change(newEdit({ ...base, seed: 3 }))
  history.confirm()
  history.undo()
  history.rollback()
  assert.equal(history.edit.value.preset.seed, 3)
  assert.equal(history.undo(), true)
  assert.equal(history.edit.value.preset.seed, 2)
  assert.equal(history.redo(), true)
  history.confirm()
  history.begin()
  history.change(newEdit({ ...base, seed: 4 }))
  history.confirm()
  history.change(newEdit({ ...base, seed: 5 }))
  history.rollback()
  assert.equal(history.edit.value.preset.seed, 4)
  assert.equal(history.undo(), true)
  assert.equal(history.edit.value.preset.seed, 3)
  assert.equal(history.undo(), true)
  assert.equal(history.edit.value.preset.seed, 2)
})

test('signed strength changes distortion direction and bilinear alpha has no hidden color bleed', () => {
  const pixels = new Uint8ClampedArray(9 * 9 * 4)
  for (let y = 0; y < 9; y += 1) for (let x = 0; x < 9; x += 1) pixels.set([x * 25, 0, 0, 255], (y * 9 + x) * 4)
  const source = new ImageData(pixels, 9, 9)
  const bulged = applyBulge(source, { ...point, strength: 100 })
  const pinched = applyBulge(source, { ...point, strength: -100 })
  const offset = (4 * 9 + 5) * 4
  assert.ok(bulged.data[offset]! < source.data[offset]!)
  assert.ok(pinched.data[offset]! > source.data[offset]!)

  pixels.set([255, 0, 0, 0], (4 * 9 + 4) * 4)
  pixels.set([0, 0, 255, 255], (4 * 9 + 5) * 4)
  const transparent = applyBulge(new ImageData(pixels, 9, 9), { ...point, strength: 100 })
  assert.equal(transparent.data[offset], 0)
  assert.ok(transparent.data[offset + 2]! > 240)
  assert.ok(transparent.data[offset + 3]! > 0 && transparent.data[offset + 3]! < 255)
})

test('overlapping points compose in Preset order and undo restores a removed point', async () => {
  const pixels = new Uint8ClampedArray(9 * 9 * 4)
  for (let y = 0; y < 9; y += 1) for (let x = 0; x < 9; x += 1) pixels.set([x * 25, y * 25, 0, 255], (y * 9 + x) * 4)
  const second = { ...point, id: 'second', x: 0.7, y: 0.6, strength: -80 }
  const preset: Preset = { ...base, effects: [point, second] }
  const forward = await renderPreset(new ImageData(pixels, 9, 9), preset)
  const reverse = await renderPreset(new ImageData(pixels, 9, 9), { ...preset, effects: [second, point] })
  assert.notDeepEqual(forward.data, reverse.data)
  const history = useEditHistory(newEdit(preset))
  history.change(newEdit({ ...preset, effects: [point] }))
  history.undo()
  assert.deepEqual(history.edit.value.preset.effects[1], second)
})
