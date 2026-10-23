import { _electron as electron, expect, test } from '@playwright/test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

test('5x controls produce stronger pixels, expose native values, and keep effect strength independent', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'deep-fryer-intensity-'))
  const app = await electron.launch({ args: [resolve('.'), `--user-data-dir=${join(folder, 'profile')}`], env: { ...process.env, ELECTRON_RENDERER_URL: '' } })
  try {
    const page = await app.firstWindow()
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }) }, resolve('tests/fixtures/v1/original.png'))
    await page.getByRole('button', { name: 'Open image' }).click()
    const ready = async () => { await expect(page.getByRole('button', { name: 'Export PNG' })).toBeEnabled() }
    const pixels = () => page.getByLabel('Edited full resolution image canvas').evaluate((canvas) => {
      if (!(canvas instanceof HTMLCanvasElement)) throw new Error('Missing canvas')
      return Array.from(canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data)
    })
    await page.getByRole('spinbutton', { name: 'Contrast value' }).fill('2')
    await ready()
    const two = await pixels()
    await page.getByRole('spinbutton', { name: 'Contrast value' }).fill('5')
    await ready()
    expect(await pixels()).not.toEqual(two)
    await expect(page.getByRole('slider', { name: 'Contrast slider', exact: true })).toHaveAttribute('aria-valuetext', '5.00 times')
    await page.getByRole('spinbutton', { name: 'Saturation value' }).fill('5')
    await page.getByRole('spinbutton', { name: 'Contrast effect strength value' }).fill('62')
    await page.getByRole('spinbutton', { name: 'Contrast effect strength value' }).blur()
    await ready()
    const destination = join(folder, 'five.deepfryer')
    await app.evaluate(({ dialog }, path) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: path }) }, destination)
    await page.getByRole('button', { name: 'Save project as…' }).click()
    await expect(page.getByRole('status')).toContainText('Saved five.deepfryer')
    const saved = JSON.parse(await readFile(destination, 'utf8'))
    expect(saved.preset.effects.find((effect: { kind: string }) => effect.kind === 'contrast')).toMatchObject({ value: 500, mix: 62 })
    expect(saved.preset.effects.find((effect: { kind: string }) => effect.kind === 'saturation')).toMatchObject({ value: 500, mix: 100 })
    await page.getByRole('spinbutton', { name: 'Contrast value' }).fill('1.01')
    await page.getByRole('spinbutton', { name: 'Contrast value' }).blur()
    await expect(page.getByRole('spinbutton', { name: 'Contrast value' })).toHaveValue('1.01')
    expect(errors).toEqual([])
  } finally { await app.close(); await rm(folder, { recursive: true, force: true }) }
})
