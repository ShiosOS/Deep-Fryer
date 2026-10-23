import { legacyPresetFixture } from '../fixtures/legacy-format'
import { _electron as electron, expect, test } from '@playwright/test'
import { fileAction } from './ui'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

test('real v1 project and preset reopen with the baseline full-resolution pixels including JPEG, alpha, ordering and points', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'deep-fryer-legacy-'))
  const executable = process.env.DEEP_FRYER_EXECUTABLE ?? process.env.ELECTRON_EXECUTABLE_PATH
  const app = await electron.launch({ ...(executable ? { executablePath: executable } : {}), args: [...(process.env.DEEP_FRYER_EXECUTABLE ? [] : [resolve('.')]), `--user-data-dir=${folder}`], env: { ...process.env, ELECTRON_RENDERER_URL: '' } })
  try {
    const page = await app.firstWindow()
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
    for (const fixture of ['v1', 'v1-rich']) {
      const expected = JSON.parse(await readFile(`tests/fixtures/${fixture}/expected.json`, 'utf8'))
      for (const [button, filename] of [['Open project', 'baseline.deepfryer'], ['Open image', 'original.png'], ['Load preset', legacyPresetFixture]] as const) {
        await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }) }, resolve(`tests/fixtures/${fixture}/${filename}`))
        await fileAction(page, button)
        await expect(page.getByRole('button', { name: 'Export', exact: true })).toBeEnabled()
        if (button === 'Open image') continue
        const pixels = await page.getByLabel('Edited full resolution image canvas').evaluate((canvas) => {
          if (!(canvas instanceof HTMLCanvasElement)) throw new Error('Missing canvas')
          return Array.from(canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data)
        })
        expect(pixels).toEqual(expected.pixels)
        expect(createHash('sha256').update(Buffer.from(pixels)).digest('hex')).toBe(expected.rgbaSha256)
      }
    }
    expect(errors).toEqual([])
  } finally { await app.close(); await rm(folder, { recursive: true, force: true }) }
})
