import { fileAction, controls } from './ui'
import { _electron as electron, expect, test } from '@playwright/test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

test('5x controls produce stronger pixels, expose native values, and keep effect strength independent', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'deep-fryer-intensity-'))
  const executable = process.env.DEEP_FRYER_EXECUTABLE ?? process.env.ELECTRON_EXECUTABLE_PATH
  const app = await electron.launch({ ...(executable ? { executablePath: executable } : {}), args: [...(process.env.DEEP_FRYER_EXECUTABLE ? [] : [resolve('.')]), `--user-data-dir=${join(folder, 'profile')}`], env: { ...process.env, ELECTRON_RENDERER_URL: '' } })
  try {
    const page = await app.firstWindow()
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }) }, resolve('tests/fixtures/v1/original.png'))
    await fileAction(page, 'Open image')
    const ready = async () => { await expect(page.getByRole('button', { name: 'Export', exact: true })).toBeEnabled() }
    const pixels = () => page.getByLabel('Edited full resolution image canvas').evaluate((canvas) => {
      if (!(canvas instanceof HTMLCanvasElement)) throw new Error('Missing canvas')
      return Array.from(canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data)
    })
    await (await controls(page)).getByRole('spinbutton', { name: 'Contrast value' }).fill('2')
    await ready()
    const two = await pixels()
    await (await controls(page)).getByRole('spinbutton', { name: 'Contrast value' }).fill('5')
    await ready()
    expect(await pixels()).not.toEqual(two)
    await expect(page.getByRole('slider', { name: 'Contrast slider', exact: true })).toHaveAttribute('aria-valuetext', '5.00 times')
    await (await controls(page)).getByRole('spinbutton', { name: 'Saturation value' }).fill('5')
    await (await controls(page)).getByRole('spinbutton', { name: 'Contrast effect strength value' }).fill('62')
    await (await controls(page)).getByRole('spinbutton', { name: 'Contrast effect strength value' }).blur()
    await ready()
    const destination = join(folder, 'five.deepfryer')
    await app.evaluate(({ dialog }, path) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: path }) }, destination)
    await fileAction(page, 'Save project as…')
    await expect(page.getByRole('status')).toContainText('Saved five.deepfryer')
    const saved = JSON.parse(await readFile(destination, 'utf8'))
    expect(saved.preset.effects.find((effect: { kind: string }) => effect.kind === 'contrast')).toMatchObject({ value: 500, mix: 62 })
    expect(saved.preset.effects.find((effect: { kind: string }) => effect.kind === 'saturation')).toMatchObject({ value: 500, mix: 100 })
    await (await controls(page)).getByRole('spinbutton', { name: 'Contrast value' }).fill('1.01')
    await (await controls(page)).getByRole('spinbutton', { name: 'Contrast value' }).blur()
    await expect((await controls(page)).getByRole('spinbutton', { name: 'Contrast value' })).toHaveValue('1.01')
    const slider = page.getByRole('slider', { name: 'Contrast slider', exact: true })
    await slider.focus()
    await page.keyboard.press('Home')
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('ArrowRight')
    await expect((await controls(page)).getByRole('spinbutton', { name: 'Contrast value' })).toHaveValue('0.02')
    await page.keyboard.press('End')
    await page.keyboard.press('ArrowLeft')
    await expect((await controls(page)).getByRole('spinbutton', { name: 'Contrast value' })).toHaveValue('4.99')
    expect(errors).toEqual([])
  } finally { await app.close(); await rm(folder, { recursive: true, force: true }) }
})
