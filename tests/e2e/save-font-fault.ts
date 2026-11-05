import type { Page } from '@playwright/test'

export async function prepareMissingCaptionFont(page: Page): Promise<void> {
  const worker = page.workers().find(worker => worker.url().includes('effects-worker'))
  if (!worker) throw new Error('Rendering worker missing')
  await worker.evaluate(() => {
    const original = globalThis.fetch
    globalThis.fetch = async (input, options) => String(input).endsWith('.ttf')
      ? new Response('Missing test font', { status: 404 }) : original(input, options)
  })
}
