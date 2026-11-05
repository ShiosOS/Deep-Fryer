import { expect, test, type ElectronApplication, type Page, type TestInfo } from '@playwright/test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PNG } from 'pngjs'
import { parseProject } from '../../src/main/document-files'
import type { WorkerResponse } from '../../src/renderer/src/effects-worker'
import { RecoveryEvidence } from './recovery-evidence'
import { section, controls, fileAction, interruptForRecovery, ready } from './ui'

type RecoveryEdit = {
  app: ElectronApplication
  page: Page
  source: string
  bytes: Buffer
  checkpoint: string
  evidence: RecoveryEvidence
}

async function withRecovery(testInfo: TestInfo, action: (edit: RecoveryEdit) => Promise<void>): Promise<void> {
  const folder = await mkdtemp(join(tmpdir(), 'deep-fryer-focused-recovery-'))
  const evidence = await RecoveryEvidence.create(testInfo, folder)
  const image = new PNG({ width: 100, height: 70 })
  for (let y = 0; y < image.height; y += 1) for (let x = 0; x < image.width; x += 1) {
    image.data.set([(x * 31 + y * 7) % 256, (x * 11 + y * 43) % 256, (x * 17 + y * 19) % 256, x % 9 === 0 ? 128 : 255], (y * image.width + x) * 4)
  }
  const bytes = PNG.sync.write(image)
  const source = join(folder, 'original.png')
  let app: ElectronApplication | undefined
  let failed = false
  try {
    await writeFile(source, bytes)
    app = await evidence.launchObserved()
    const page = await app.firstWindow()
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }) }, source)
    await fileAction(page, 'Open image')
    await controls(page)
    const checkpoint = join(folder, 'profile', 'recovery', 'latest.deepfryer')
    await expect.poll(() => brightnessOnDisk(checkpoint)).toBe(0)
    await action({ app, page, source, bytes, checkpoint, evidence })
    expect(await readFile(source)).toEqual(bytes)
    expect(errors).toEqual([])
  } catch (error) {
    failed = true
    await evidence.capture(app, error)
    throw error
  } finally {
    await evidence.close(failed)
    if (!failed) await rm(folder, { recursive: true, force: true })
  }
}

async function brightnessOnDisk(path: string): Promise<number | undefined> {
  try {
    return parseProject(await readFile(path, 'utf8')).edit.preset.effects.find((effect) => effect.kind === 'brightness')?.value
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined
    throw error
  }
}

async function pixels(page: Page): Promise<number[]> {
  return page.getByLabel('Edited full resolution image canvas').evaluate((canvas) => {
    if (!(canvas instanceof HTMLCanvasElement)) throw new Error('Preview canvas is missing')
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Preview context is missing')
    return Array.from(context.getImageData(0, 0, canvas.width, canvas.height).data)
  })
}

async function captionOnDisk(path: string): Promise<string | null> {
  return parseProject(await readFile(path, 'utf8')).edit.composition.captions?.top ?? null
}

for (const mode of ['pending', 'failed'] as const) {
  test(`${mode} caption rendering preserves accepted focused text without persisting IME drafts`, async ({}, testInfo) => {
    await withRecovery(testInfo, async ({ page, checkpoint }) => {
      const worker = page.workers().find(worker => worker.url().includes('effects-worker'))
      if (!worker) throw new Error('Persistent rendering worker is missing')
      await worker.evaluate(mode => {
        const original = globalThis.fetch
        globalThis.fetch = async (input, options) => {
          if (String(input).endsWith('.ttf')) {
            Reflect.set(globalThis, '__idleRecoveryFontRequested', true)
            if (mode === 'failed') return new Response('Missing test font', { status: 404 })
            await new Promise<void>(resolve => { Reflect.set(globalThis, '__releaseIdleRecoveryFont', resolve) })
          }
          return original(input, options)
        }
      }, mode)
      await section(page, 'Captions')
      const top = page.getByRole('textbox', { name: 'Top caption', exact: true })
      await top.fill('GO')
      await expect.poll(() => worker.evaluate(() => Reflect.get(globalThis, '__idleRecoveryFontRequested') === true)).toBe(true)
      if (mode === 'failed') await expect(page.locator('.caption-controls [role=alert]')).toContainText('bundled Anton font could not load')
      await expect(top).toBeFocused()
      await expect.poll(() => captionOnDisk(checkpoint)).toBe('GO')
      await expect(page.getByRole('button', { name: 'Export', exact: true })).toBeDisabled()
      const session = await page.context().newCDPSession(page)
      await top.press('Control+a')
      await session.send('Input.imeSetComposition', { text: '草', selectionStart: 1, selectionEnd: 1 })
      await expect(top).toHaveValue('草')
      await page.waitForTimeout(1100)
      expect(await captionOnDisk(checkpoint)).toBe('GO')
      await session.send('Input.insertText', { text: 'OK' })
      await expect.poll(() => captionOnDisk(checkpoint)).toBe('OK')
      await expect(top).toBeFocused()
      await testInfo.attach(`${mode}-caption-checkpoint`, { path: checkpoint, contentType: 'application/json' })
      if (mode === 'pending') {
        await worker.evaluate(() => {
          const release: unknown = Reflect.get(globalThis, '__releaseIdleRecoveryFont')
          if (typeof release !== 'function') throw new Error('Pending font request was not held')
          release()
        })
        await ready(page)
        await page.getByRole('button', { name: 'Undo', exact: true }).click()
        await ready(page)
        await expect(top).toHaveValue('')
        await expect.poll(() => captionOnDisk(checkpoint)).toBe(null)
      }
      await session.detach()
    })
  })
}

test('focused accepted numeric edit checkpoints without blur and recovers after forced exit', async ({}, testInfo) => {
  await withRecovery(testInfo, async ({ app, page, source, bytes, checkpoint, evidence }) => {
    const brightness = page.getByRole('spinbutton', { name: 'Brightness value' })
    await brightness.fill('25')
    await brightness.blur()
    await ready(page)
    await expect.poll(() => brightnessOnDisk(checkpoint)).toBe(25)
    const before = await pixels(page)
    await page.bringToFront()
    await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0]?.focus() })
    await brightness.fill('50')
    await ready(page)
    const accepted = await pixels(page)
    expect(accepted).not.toEqual(before)
    await expect(brightness).toBeFocused()
    await expect.poll(() => brightnessOnDisk(checkpoint)).toBe(50)
    await expect(brightness).toBeFocused()
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isFocused())).toBe(true)
    const recoveredDocument = parseProject(await readFile(checkpoint, 'utf8'))
    expect(Buffer.from(recoveredDocument.source.bytes)).toEqual(bytes)
    expect(await readFile(source)).toEqual(bytes)
    await testInfo.attach('focused-checkpoint-50', { path: checkpoint, contentType: 'application/json' })
    await page.screenshot({ path: testInfo.outputPath('focused-50.png') })
    await interruptForRecovery(app)
    const restored = await evidence.launchObserved()
    const restoredPage = await restored.firstWindow()
    await expect(restoredPage.getByRole('alertdialog')).toContainText('original.png')
    await restoredPage.getByRole('button', { name: 'Restore work' }).click()
    await controls(restoredPage)
    await expect(restoredPage.getByRole('spinbutton', { name: 'Brightness value' })).toHaveValue('50')
    expect(await pixels(restoredPage)).toEqual(accepted)
  })
})

test('focus without a change preserves a pending recovery checkpoint', async ({}, testInfo) => {
  await withRecovery(testInfo, async ({ page, checkpoint }) => {
    const brightness = page.getByRole('spinbutton', { name: 'Brightness value' })
    await brightness.fill('50')
    await brightness.blur()
    await ready(page)
    expect(await brightnessOnDisk(checkpoint)).toBe(0)
    await brightness.focus()
    await expect.poll(() => brightnessOnDisk(checkpoint)).toBe(50)
    await expect(brightness).toBeFocused()
    await testInfo.attach('focus-only-checkpoint-50', { path: checkpoint, contentType: 'application/json' })
  })
})

test('invalid numeric drafts preserve the last accepted schema-valid recovery preset', async ({}, testInfo) => {
  await withRecovery(testInfo, async ({ page, checkpoint }) => {
    const brightness = page.getByRole('spinbutton', { name: 'Brightness value' })
    await brightness.fill('50')
    await ready(page)
    const accepted = await pixels(page)
    await brightness.fill('999')
    await expect(brightness).toHaveAttribute('aria-invalid', 'true')
    await expect.poll(() => brightnessOnDisk(checkpoint)).toBe(50)
    for (const draft of ['', '999']) {
      await brightness.fill(draft)
      await expect(brightness).toHaveAttribute('aria-invalid', 'true')
      await page.waitForTimeout(1100)
      expect(await brightnessOnDisk(checkpoint)).toBe(50)
      expect(await pixels(page)).toEqual(accepted)
      await expect(brightness).toBeFocused()
    }
    await testInfo.attach('invalid-draft-checkpoint-50', { path: checkpoint, contentType: 'application/json' })
    await brightness.fill('50')
    await brightness.blur()
  })
})

test('a paused slider gesture checkpoints while retaining one undo group', async ({}, testInfo) => {
  await withRecovery(testInfo, async ({ page, checkpoint }) => {
    const slider = page.getByRole('slider', { name: 'Brightness slider', exact: true })
    const brightness = page.getByRole('spinbutton', { name: 'Brightness value' })
    await slider.scrollIntoViewIfNeeded()
    const bounds = await slider.boundingBox()
    if (!bounds) throw new Error('Brightness slider bounds are missing')
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
    await page.mouse.down()
    try {
      await page.mouse.move(bounds.x + bounds.width * 0.65, bounds.y + bounds.height / 2, { steps: 5 })
      await ready(page)
      const paused = Number(await brightness.inputValue())
      expect(paused).toBeGreaterThan(0)
      await expect.poll(() => brightnessOnDisk(checkpoint)).toBe(paused)
      await page.mouse.move(bounds.x + bounds.width * 0.8, bounds.y + bounds.height / 2, { steps: 5 })
      await ready(page)
      expect(Number(await brightness.inputValue())).toBeGreaterThan(paused)
    } finally { await page.mouse.up() }
    const finalValue = await brightness.inputValue()
    await page.getByRole('button', { name: 'Undo', exact: true }).click()
    await ready(page)
    await expect(brightness).toHaveValue('0')
    await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled()
    await page.getByRole('button', { name: 'Redo', exact: true }).click()
    await ready(page)
    await expect(brightness).toHaveValue(finalValue)
  })
})

for (const mode of ['pending', 'failed', 'stale'] as const) {
  test(`${mode} full response cannot checkpoint an unaccepted preset`, async ({}, testInfo) => {
    await withRecovery(testInfo, async ({ page, checkpoint }) => {
      await page.addInitScript((mode) => {
        const NativeWorker = window.Worker
        window.Worker = class extends NativeWorker {
          constructor(...args: ConstructorParameters<typeof Worker>) {
            super(...args)
            this.addEventListener('message', (event: MessageEvent<WorkerResponse>) => {
              const result = event.data
              const input = document.querySelector('input[aria-label="Brightness value"]')
              if (!event.isTrusted || result.kind !== 'rendered' || result.quality !== 'full' || !(input instanceof HTMLInputElement) || input.value !== '50') return
              event.stopImmediatePropagation()
              document.documentElement.dataset.recoveryFault = mode
              if (mode === 'pending') return
              const data: WorkerResponse = mode === 'failed'
                ? { kind: 'failed', sourceId: result.sourceId, revision: result.revision, quality: 'full', message: 'Injected full render failure', category: 'image' }
                : { ...result, revision: result.revision - 1 }
              this.dispatchEvent(new MessageEvent('message', { data }))
            })
          }
        }
      }, mode)
      await page.reload()
      await page.getByRole('button', { name: 'Restore work' }).click()
      await controls(page)
      const brightness = page.getByRole('spinbutton', { name: 'Brightness value' })
      await brightness.fill('50')
      await expect(page.locator('html')).toHaveAttribute('data-recovery-fault', mode)
      await brightness.blur()
      await expect(page.getByRole('button', { name: 'Export', exact: true })).toBeDisabled()
      await page.waitForTimeout(1100)
      expect(await brightnessOnDisk(checkpoint)).toBe(0)
      await testInfo.attach(`${mode}-checkpoint-0`, { path: checkpoint, contentType: 'application/json' })
      await brightness.fill('60')
      await ready(page)
      await expect.poll(() => brightnessOnDisk(checkpoint)).toBe(60)
    })
  })
}
