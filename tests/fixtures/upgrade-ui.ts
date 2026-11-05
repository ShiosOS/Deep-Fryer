import { expect, type ElectronApplication, type Page } from '@playwright/test'
import { exportImage, fileAction, projectSaved, PROJECT_FILE_OPERATION_MS } from '../e2e/ui'
import { legacyAction, legacyExportAction } from './legacy-ui'

export async function saveUpgradeFile({ app, page, name, path, candidate }: {
  app: ElectronApplication; page: Page; name: string; path: string; candidate: boolean
}): Promise<void> {
  const project = candidate && name === 'Save project as…'
  if (project) await expect(page.locator('.open-button')).toBeEnabled()
  // Observe this action's enabled -> disabled transition, including saves too fast to poll while busy.
  const initiation = project ? await page.locator('.open-button').evaluateHandle(button => {
    const state = { started: false, button, observer: new MutationObserver(records => {
      if (records.some(record => record.oldValue === null)) {
        state.started = true
        state.observer.disconnect()
      }
    }) }
    state.observer.observe(button, { attributes: true, attributeFilter: ['disabled'], attributeOldValue: true })
    return state
  }) : null
  try {
    await app.evaluate(({ dialog }, selected) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: selected }) }, path)
    if (candidate && name === legacyExportAction) await exportImage(page)
    else if (candidate) await fileAction(page, name)
    else await page.getByRole('button', { name: legacyAction(name) }).click()
    const message = `Saved ${path.split(/[\\/]/).pop()}`
    if (initiation) {
      await expect.poll(() => initiation.evaluate(state => state.started && !state.button.hasAttribute('disabled')), {
        message: 'This upgrade save must start and complete a new file operation', timeout: PROJECT_FILE_OPERATION_MS
      }).toBe(true)
      await projectSaved(page, message)
      await expect(page.locator('.notice')).toHaveText(`${message}.`)
    } else await expect(page.locator('.notice')).toContainText(message)
  } finally {
    if (initiation) {
      await initiation.evaluate(state => state.observer.disconnect())
      await initiation.dispose()
    }
  }
}
