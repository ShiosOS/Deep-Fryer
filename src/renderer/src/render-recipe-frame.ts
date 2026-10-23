import { isNeutralEffect, type Recipe } from '../../shared/recipe'
import type { WorkerRequest, WorkerResponse } from './effects-worker'

export async function prepareProjectFrame(source: ImageData, recipe: Recipe): Promise<ImageData> {
  if (recipe.effects.every(isNeutralEffect)) return source
  const worker = new Worker(new URL('./effects-worker.ts', import.meta.url), { type: 'module' })
  try {
    return await new Promise<ImageData>((resolve, reject) => {
      worker.onerror = () => reject(new Error('The project image could not be processed. Your current edit is unchanged.'))
      worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
        const result = event.data
        if (result.kind === 'failed') reject(new Error(result.message))
        else resolve(new ImageData(result.pixels, result.width, result.height))
      }
      const pixels = new Uint8ClampedArray(source.data)
      const request: WorkerRequest = { kind: 'source', sourceId: 1, width: source.width, height: source.height, pixels, preview: null }
      worker.postMessage(request, [pixels.buffer])
      const render: WorkerRequest = { kind: 'render', sourceId: 1, revision: 1, quality: 'full', recipe }
      worker.postMessage(render)
    })
  } finally { worker.terminate() }
}
