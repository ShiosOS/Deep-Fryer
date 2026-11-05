import type { Page } from '@playwright/test'

export async function openImageWithShortcut(page: Page): Promise<void> {
  await page.keyboard.press('Control+o')
}
