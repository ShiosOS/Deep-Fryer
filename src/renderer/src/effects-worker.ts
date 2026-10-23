import { renderRecipe } from './effects'
import { recipeSchema, type Recipe } from './recipe'

export type WorkerRequest =
  | { kind: 'source'; sourceId: number; width: number; height: number; pixels: Uint8ClampedArray<ArrayBuffer>; preview: { width: number; height: number; pixels: Uint8ClampedArray<ArrayBuffer> } | null }
  | { kind: 'render'; sourceId: number; revision: number; recipe: Recipe; quality: 'preview' | 'full' }

export type WorkerResponse =
  | { kind: 'rendered'; sourceId: number; revision: number; quality: 'preview' | 'full'; width: number; height: number; pixels: Uint8ClampedArray<ArrayBuffer> }
  | { kind: 'failed'; sourceId: number; revision: number; quality: 'preview' | 'full'; message: string }

let source: ImageData | null = null
let preview: ImageData | null = null
let sourceId = -1
let running = false
let pending: Array<Extract<WorkerRequest, { kind: 'render' }>> = []

async function drain(): Promise<void> {
  running = true
  while (pending.length > 0) {
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    const request = pending.shift()
    if (!request) break
    if (request.sourceId !== sourceId || !source) continue
    const current = request.quality === 'preview' && preview ? preview : source
    try {
      const recipe = recipeSchema.parse(request.recipe)
      const result = await renderRecipe(current, recipe)
      const response: WorkerResponse = { kind: 'rendered', sourceId: request.sourceId, revision: request.revision, quality: request.quality, width: result.width, height: result.height, pixels: result.data }
      self.postMessage(response, { transfer: [result.data.buffer] })
    } catch (error) {
      const response: WorkerResponse = { kind: 'failed', sourceId: request.sourceId, revision: request.revision, quality: request.quality, message: error instanceof Error ? error.message : 'Image processing failed.' }
      self.postMessage(response)
    }
  }
  running = false
}

self.onmessage = (event: MessageEvent<WorkerRequest>): void => {
  const request = event.data
  if (request.kind === 'source') {
    source = new ImageData(request.pixels, request.width, request.height)
    preview = request.preview ? new ImageData(request.preview.pixels, request.preview.width, request.preview.height) : null
    sourceId = request.sourceId
    pending = []
    return
  }
  if (request.sourceId !== sourceId) return
  pending = pending.filter((queued) => queued.sourceId === request.sourceId &&
    queued.revision === request.revision && queued.quality !== request.quality)
  pending.push(request)
  if (!running) void drain()
}
