import { expect, type ElectronApplication, type Page } from '@playwright/test'
import { exportImage, fileAction } from '../e2e/ui'
import { legacyAction, legacyExportAction } from './legacy-ui'

export async function saveUpgradeFile({ app, page, name, path, candidate }: {
  app: ElectronApplication; page: Page; name: string; path: string; candidate: boolean
}): Promise<void> {
  await app.evaluate(({ dialog }, selected) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: selected }) }, path)
  if (candidate && name === legacyExportAction) await exportImage(page)
  else if (candidate) await fileAction(page, name)
  else await page.getByRole('button', { name: legacyAction(name) }).click()
  await expect(page.locator('.notice')).toContainText(`Saved ${path.split(/[\\/]/).pop()}`)
}
