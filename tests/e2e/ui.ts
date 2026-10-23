import { expect, type Page } from '@playwright/test'

export async function fileAction(page: Page, name: string): Promise<void> {
  const menu = page.locator(name.includes('preset') ? '.preset-menu' : '.file-menu')
  if (!await menu.getAttribute('open').then((value) => value !== null)) await menu.locator('summary').first().click()
  await page.getByRole('button', { name, exact: name !== 'Open image' }).click()
  if (name.startsWith('Save ')) await page.getByRole('button', { name: 'Save as…', exact: true }).click()
}

export async function controls(page: Page): Promise<Page> {
  await expect(page.locator('.effect-card').first()).toBeVisible()
  for (const selector of ['.effect-card', '.more-controls']) {
    for (const details of await page.locator(selector).all()) {
      if (await details.getAttribute('open') === null) await details.locator('summary').first().click()
    }
  }
  return page
}

export async function openOutput(page: Page): Promise<void> {
  if (!await page.getByRole('dialog', { name: 'Export image', exact: true }).isVisible()) await page.getByRole('button', { name: 'Export', exact: true }).click()
}

export async function exportImage(page: Page): Promise<void> {
  await openOutput(page)
  await page.getByRole('button', { name: 'Save image…' }).click()
  await page.getByRole('button', { name: 'Close export', exact: true }).click()
}

export async function ready(page: Page): Promise<void> {
  await expect(page.getByRole('button', { name: 'Export', exact: true })).toBeEnabled()
}
