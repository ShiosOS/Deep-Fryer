import { expect, type ElectronApplication, type Page } from '@playwright/test'
import type { BaseWindow, MessageBoxOptions } from 'electron'

export async function chooseUnsaved(app: ElectronApplication, choice: 'save' | 'discard' | 'cancel'): Promise<void> {
  await app.evaluate(({ dialog }, choice) => {
    const original = dialog.showMessageBox
    dialog.showMessageBox = async (windowOrOptions: BaseWindow | MessageBoxOptions, suppliedOptions?: MessageBoxOptions) => {
      dialog.showMessageBox = original
      const options = suppliedOptions ?? windowOrOptions
      if (!('buttons' in options) || options.buttons?.join('|') !== 'Save project|Discard|Cancel') throw new Error('Unexpected native prompt')
      return { response: choice === 'save' ? 0 : choice === 'discard' ? 1 : 2, checkboxChecked: false }
    }
  }, choice)
}

export async function closeDiscardingChanges(app: ElectronApplication): Promise<void> {
  await chooseUnsaved(app, 'discard')
  await app.close()
}

export async function interruptForRecovery(app: ElectronApplication): Promise<void> {
  const launcher = app.process()
  const pids = await app.evaluate(({ app }) => [...new Set([process.pid, ...app.getAppMetrics().map(({ pid }) => pid)])])
  await app.evaluate(({ app }) => app.exit(19)).catch(() => {})
  await app.close()
  await expect.poll(() => pids.filter((pid) => {
    try { process.kill(pid, 0); return true } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ESRCH') return false
      throw error
    }
  }), { message: 'Interrupted Electron processes must exit before profile reuse' }).toEqual([])
  await expect.poll(() => launcher.exitCode).toBe(19)
}

export async function fileAction(page: Page, name: string): Promise<void> {
  const menu = page.locator(name.includes('preset') ? '.preset-menu' : '.file-menu')
  if (!await menu.getAttribute('open').then((value) => value !== null)) await menu.locator('summary').first().click()
  await page.getByRole('button', { name, exact: name !== 'Open image' }).click()
  if (name.startsWith('Save ')) await page.getByRole('button', { name: 'Save as…', exact: true }).click()
}

export async function controls(page: Page): Promise<Page> {
  await ready(page)
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
