import { _electron as electron, expect, test } from '@playwright/test'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

test('real v1 project and preset reopen with the baseline full-resolution pixels including JPEG, alpha, ordering and points', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'deep-fryer-legacy-'))
  const app = await electron.launch({ args: [resolve('.'), `--user-data-dir=${folder}`], env: { ...process.env, ELECTRON_RENDERER_URL: '' } })
  try {
    const page = await app.firstWindow()
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
    for (const fixture of ['v1', 'v1-rich']) {
      const expected = JSON.parse(await readFile(`tests/fixtures/${fixture}/expected.json`, 'utf8'))
      for (const [button, filename] of [['Open project', 'baseline.deepfryer'], ['Open image', 'original.png'], ['Load preset', 'baseline.fryrecipe']] as const) {
        await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }) }, resolve(`tests/fixtures/${fixture}/${filename}`))
        await page.getByRole('button', { name: button }).click()
        await expect(page.getByRole('button', { name: 'Export PNG' })).toBeEnabled()
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
