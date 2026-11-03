import { readonly, shallowRef } from 'vue'
import type { OpenImage } from '../../shared/image'
import type { Preset } from '../../shared/preset'
import { freezeOutput, type OutputResponse, type PreparedOutput } from './output'

export type CopySource = OpenImage & { bitmap: Pick<ImageBitmap, 'width' | 'height'> }
export type CopyOutcome = 'copied' | 'ignored'
type CopyPhase = 'idle' | 'preparing' | 'writing'

export function useImageCopy() {
  const phase = shallowRef<CopyPhase>('idle')
  let disposed = false
  let preparation: Worker | null = null
  let cancelPreparation: (() => void) | null = null

  async function run({ source, preset }: { source: CopySource; preset: Preset }): Promise<CopyOutcome> {
    if (disposed || phase.value !== 'idle') return 'ignored'
    phase.value = 'preparing'
    try {
      const job = freezeOutput(source, preset, { format: 'png', width: source.bitmap.width, height: source.bitmap.height })
      const worker = new Worker(new URL('./output-worker.ts', import.meta.url), { type: 'module' })
      preparation = worker
      const output = await new Promise<PreparedOutput | null>((resolve, reject) => {
        cancelPreparation = () => resolve(null)
        worker.onerror = () => reject(new Error('Copy preparation stopped. Reopen the image and try again.'))
        worker.onmessageerror = () => reject(new Error('The copied image could not be prepared. Try again.'))
        worker.onmessage = (event: MessageEvent<OutputResponse>) => {
          if (event.data.kind === 'failed') reject(new Error(event.data.message))
          else resolve(event.data.output)
        }
        worker.postMessage(job, [job.source.bytes.buffer])
      })
      worker.terminate()
      preparation = null
      cancelPreparation = null
      if (disposed || !output) return 'ignored'
      phase.value = 'writing'
      await window.imageBridge.copyImage({ bytes: output.bytes })
      return disposed ? 'ignored' : 'copied'
    } catch (error) {
      if (disposed) return 'ignored'
      throw error
    } finally {
      preparation?.terminate()
      preparation = null
      cancelPreparation = null
      phase.value = 'idle'
    }
  }

  function dispose(): void {
    disposed = true
    cancelPreparation?.()
    preparation?.terminate()
  }

  return { phase: readonly(phase), run, dispose }
}
