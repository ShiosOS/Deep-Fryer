import { expect, test, type BrowserContext, type ElectronApplication, type Page } from '@playwright/test'
import type { BaseWindow, MessageBoxOptions } from 'electron'
import { attachProjectBoundaries, recordProjectBoundaries } from './project-diagnostics'

const recoveryInterruptions = new WeakMap<ElectronApplication, Promise<void>>()
const tracedApplications = new WeakMap<ElectronApplication, { context: BrowserContext; pid: number | undefined }>()

export async function traceElectron(app: ElectronApplication): Promise<void> {
  await app.firstWindow()
  await recordProjectBoundaries(app)
  const context = app.context()
  await context.tracing.start({ screenshots: true, snapshots: true })
  tracedApplications.set(app, { context, pid: app.process().pid })
}

export async function finishElectronTrace(app: ElectronApplication): Promise<void> {
  const trace = tracedApplications.get(app)
  if (!trace) return
  tracedApplications.delete(app)
  await attachProjectBoundaries(app)
  const page = app.windows().find(page => !page.isClosed())
  if (page) {
    const state = await page.locator('.editor').evaluate(editor => ({
      status: editor.querySelector('.notice')?.textContent,
      dirty: !!editor.querySelector('.unsaved-indicator'),
      fileActions: [...editor.querySelectorAll('.file-menu button')].map(button => ({
        text: button.textContent, disabled: button.hasAttribute('disabled')
      }))
    }), undefined, { timeout: 2_000 }).catch(error => ({ diagnosticError: String(error) }))
    await test.info().attach('before-electron-teardown', { body: JSON.stringify(state), contentType: 'application/json' })
  }
  await trace.context.tracing.stop({ path: test.info().outputPath(`electron-${trace.pid}-trace.zip`) }).catch(async error => {
    if (app.windows().some(page => !page.isClosed())) throw error
    await test.info().attach('electron-trace-ended-with-window', { body: String(error), contentType: 'text/plain' })
  })
}

// One Windows helper: 15s response deadline after spawn, 6s startup allowance,
// and 4s for disk, IPC and UI completion. This is an observation budget, not an SLA.
export const PROJECT_FILE_OPERATION_MS = 15_000 + 6_000 + 4_000

export async function fileOperationComplete(page: Page): Promise<void> {
  await expect(page.locator('.open-button')).toBeEnabled({ timeout: PROJECT_FILE_OPERATION_MS })
}

export async function projectSaved(page: Page, message = 'Saved'): Promise<void> {
  await fileOperationComplete(page)
  await expect(page.locator('.notice')).toContainText(message)
  await expect(page.getByLabel('Unsaved project', { exact: true })).toHaveCount(0)
}

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
  const interruption = recoveryInterruptions.get(app)
  if (interruption) return interruption
  await finishElectronTrace(app)
  if (app.windows().length > 0) await chooseUnsaved(app, 'discard')
  await app.close()
}

export function interruptForRecovery(app: ElectronApplication): Promise<void> {
  const existing = recoveryInterruptions.get(app)
  if (existing) return existing
  const interruption = stopForRecovery(app)
  recoveryInterruptions.set(app, interruption)
  return interruption
}

async function stopForRecovery(app: ElectronApplication): Promise<void> {
  await finishElectronTrace(app)
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
  if (name.endsWith(' as…')) await page.getByRole('button', { name: 'Save as…', exact: true }).click()
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
