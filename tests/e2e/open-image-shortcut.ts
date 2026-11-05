import { expect, type Page } from '@playwright/test'

export async function openImageWithShortcut(page: Page): Promise<void> {
  await expect(page.locator('.open-button')).toBeEnabled()
  await page.keyboard.press('Control+o')
}
