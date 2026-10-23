import assert from 'node:assert/strict'
import test from 'node:test'
import { actualSize, fitView, imageToPane, pan, resizeView, zoom } from '../src/renderer/src/inspection-geometry'

test('anchored zoom and drag keep a landmark in the expected position', () => {
  const image = { width: 1600, height: 1200 }
  const pane = { width: 800, height: 600 }
  const fitted = fitView(image, pane)
  assert.equal(fitted.scale, 0.5)
  assert.deepEqual(fitted.center, { x: 800, y: 600 })

  const actual = actualSize(fitted, image, pane)
  const landmark = { x: 1000, y: 700 }
  assert.deepEqual(imageToPane(actual, landmark, pane), { x: 600, y: 400 })
  const enlarged = zoom(zoom(actual, 1, { x: 600, y: 400 }, image, pane), 1, { x: 600, y: 400 }, image, pane)
  assert.ok(Math.abs(enlarged.scale - 2) < 1e-10)
  assert.ok(Math.abs(enlarged.center.x - 900) < 1e-10)
  assert.ok(Math.abs(enlarged.center.y - 650) < 1e-10)
  const kept = imageToPane(enlarged, landmark, pane)
  assert.ok(Math.abs(kept.x - 600) < 1e-10)
  assert.ok(Math.abs(kept.y - 400) < 1e-10)

  const dragged = pan(enlarged, { x: 40, y: 0 }, image, pane)
  assert.ok(Math.abs(dragged.center.x - 880) < 1e-10)
  const resized = resizeView(dragged, image, { width: 1000, height: 700 })
  assert.equal(resized.scale, dragged.scale)
  assert.deepEqual(resized.center, dragged.center)
})

test('fit never enlarges a small image and detailed resize clamps exposed edges', () => {
  const small = { width: 80, height: 40 }
  const smallFit = fitView(small, { width: 800, height: 600 })
  assert.equal(smallFit.scale, 1)
  assert.equal(pan(smallFit, { x: 40, y: 20 }, small, { width: 800, height: 600 }).mode, 'fit')
  assert.equal(resizeView(fitView(small, { width: 800, height: 600 }), small, { width: 400, height: 300 }).scale, 1)

  const image = { width: 1600, height: 1200 }
  const pane = { width: 800, height: 600 }
  const view = pan(actualSize(fitView(image, pane), image, pane), { x: 1000, y: 1000 }, image, pane)
  assert.deepEqual(view.center, { x: 400, y: 300 })
  assert.deepEqual(resizeView(view, image, { width: 1200, height: 800 }).center, { x: 600, y: 400 })
})

test('zoom out reduces the fitted scale of a supported tall image', () => {
  const image = { width: 1000, height: 16_384 }
  const pane = { width: 550, height: 370 }
  const fitted = fitView(image, pane)
  const reduced = zoom(fitted, -1, { x: pane.width / 2, y: pane.height / 2 }, image, pane)
  assert.ok(Math.abs(reduced.scale - fitted.scale / Math.SQRT2) < 1e-12)
})
