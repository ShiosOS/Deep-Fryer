export type Point = Readonly<{ x: number; y: number }>
export type Size = Readonly<{ width: number; height: number }>
export type InspectionView = Readonly<{ mode: 'fit' | 'detail'; scale: number; center: Point }>

const STEP = Math.SQRT2
const MIN_SCALE = 1 / 65_536
const MAX_SCALE = 32

function fitScale(image: Size, pane: Size): number {
  return Math.min(1, pane.width / image.width, pane.height / image.height)
}

export function fitView(image: Size, pane: Size): InspectionView {
  return { mode: 'fit', scale: fitScale(image, pane), center: { x: image.width / 2, y: image.height / 2 } }
}

function clampCenter(center: Point, scale: number, image: Size, pane: Size): Point {
  const axis = (value: number, length: number, extent: number): number => {
    const visible = extent / scale
    return visible >= length ? length / 2 : Math.max(visible / 2, Math.min(length - visible / 2, value))
  }
  return { x: axis(center.x, image.width, pane.width), y: axis(center.y, image.height, pane.height) }
}

export function resizeView(view: InspectionView, image: Size, pane: Size): InspectionView {
  if (pane.width <= 0 || pane.height <= 0) return view
  return view.mode === 'fit' ? fitView(image, pane) : { ...view, center: clampCenter(view.center, view.scale, image, pane) }
}

export function actualSize(view: InspectionView, image: Size, pane: Size): InspectionView {
  return scaleAt(view, 1, { x: pane.width / 2, y: pane.height / 2 }, image, pane)
}

export function zoom(view: InspectionView, direction: 1 | -1, anchor: Point, image: Size, pane: Size): InspectionView {
  return scaleAt(view, view.scale * STEP ** direction, anchor, image, pane)
}

function scaleAt(view: InspectionView, requested: number, anchor: Point, image: Size, pane: Size): InspectionView {
  const scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, requested))
  const fromPaneCenter = { x: anchor.x - pane.width / 2, y: anchor.y - pane.height / 2 }
  const center = {
    x: view.center.x + fromPaneCenter.x / view.scale - fromPaneCenter.x / scale,
    y: view.center.y + fromPaneCenter.y / view.scale - fromPaneCenter.y / scale
  }
  return { mode: 'detail', scale, center: clampCenter(center, scale, image, pane) }
}

export function pan(view: InspectionView, delta: Point, image: Size, pane: Size): InspectionView {
  const requested = { x: view.center.x - delta.x / view.scale, y: view.center.y - delta.y / view.scale }
  const center = clampCenter(requested, view.scale, image, pane)
  return center.x === view.center.x && center.y === view.center.y ? view : { mode: 'detail', scale: view.scale, center }
}

export function imageToPane(view: InspectionView, point: Point, pane: Size): Point {
  return {
    x: pane.width / 2 + (point.x - view.center.x) * view.scale,
    y: pane.height / 2 + (point.y - view.center.y) * view.scale
  }
}

export function imageOrigin(view: InspectionView, pane: Size): Point {
  return imageToPane(view, { x: 0, y: 0 }, pane)
}

export function paneToImage(view: InspectionView, point: Point, pane: Size): Point {
  return {
    x: view.center.x + (point.x - pane.width / 2) / view.scale,
    y: view.center.y + (point.y - pane.height / 2) / view.scale
  }
}
