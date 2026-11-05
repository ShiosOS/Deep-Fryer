import type { Page } from '@playwright/test'
import { randomUUID } from 'node:crypto'

export async function prepareMissingCaptionFont(page: Page): Promise<void> {
  const setupId = randomUUID()
  const init = await page.addInitScript(setupId => {
    const OriginalWorker = globalThis.Worker
    const generation = crypto.randomUUID()
    Reflect.set(globalThis, setupId, { generation, OriginalWorker })
    globalThis.Worker = class extends OriginalWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        const source = new URL(url, location.href)
        const effects = source.pathname.includes('effects-worker')
        if (effects) source.hash = `${setupId}/${generation}`
        super(effects ? source : url, options)
        // App.vue creates its persistent worker first, before any demo or thumbnail work.
        if (effects) globalThis.Worker = OriginalWorker
      }
    }
  }, setupId)
  try {
    const [worker] = await Promise.all([
      page.waitForEvent('worker', {
        predicate: worker => new URL(worker.url()).hash.startsWith(`#${setupId}/`), timeout: 5_000
      }),
      page.reload()
    ])
    const generation: unknown = await page.evaluate(setupId => Reflect.get(globalThis, setupId)?.generation, setupId)
    const hash = `#${setupId}/${generation}`
    if (typeof generation !== 'string' || new URL(worker.url()).hash !== hash) {
      throw new Error('Caption font worker does not belong to the current document')
    }
    await worker.evaluate(hash => {
      if (location.hash !== hash) throw new Error('Caption font worker generation changed')
      const original = globalThis.fetch
      globalThis.fetch = async (input, options) => String(input).endsWith('.ttf')
        ? new Response('Missing test font', { status: 404 }) : original(input, options)
    }, hash)
  } finally {
    await init.dispose()
    await page.evaluate(setupId => {
      const state = Reflect.get(globalThis, setupId)
      if (state) {
        globalThis.Worker = state.OriginalWorker
        Reflect.deleteProperty(globalThis, setupId)
      }
    }, setupId)
  }
}
