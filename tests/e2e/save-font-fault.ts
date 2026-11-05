import type { Page } from '@playwright/test'

export async function prepareMissingCaptionFont(page: Page): Promise<void> {
  // Reload the disposable editor before demo loading can create thumbnail workers with the same URL.
  const [worker] = await Promise.all([
    page.waitForEvent('worker', { predicate: worker => worker.url().includes('effects-worker'), timeout: 5_000 }),
    page.reload()
  ])
  await worker.evaluate(() => {
    const original = globalThis.fetch
    globalThis.fetch = async (input, options) => String(input).endsWith('.ttf')
      ? new Response('Missing test font', { status: 404 }) : original(input, options)
  })
}
