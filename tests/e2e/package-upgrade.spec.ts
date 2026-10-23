import { controls, fileAction, exportImage } from './ui'
import { legacyAction, legacyExportAction, legacyPresetFilename } from '../fixtures/legacy-ui'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { PNG } from 'pngjs'
import { parsePreset, parseProject } from '../../src/main/document-files'

const phase = process.env.DEEP_FRYER_UPGRADE_PHASE
const candidate = phase === 'candidate'
async function visibleControls(page: Page): Promise<Page> { return candidate ? controls(page) : page }

async function launch(folder: string, version: string): Promise<ElectronApplication> {
  const executablePath = process.env.DEEP_FRYER_EXECUTABLE
  if (!executablePath) throw new Error('The upgrade journey requires an installed application executable.')
  const app = await electron.launch({ executablePath, args: [`--user-data-dir=${join(folder, 'profile')}`], env: { ...process.env, ELECTRON_RENDERER_URL: '' } })
  expect(await app.evaluate(({ app }) => app.getVersion())).toBe(version)
  expect(await app.evaluate(({ app }) => app.isPackaged)).toBe(true)
  return app
}

async function open(app: ElectronApplication, page: Page, name: string, path: string): Promise<void> {
  await app.evaluate(({ dialog }, selected) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selected] }) }, path)
  if (candidate) await fileAction(page, name)
  else await page.getByRole('button', { name: legacyAction(name) }).click()
}

async function save(app: ElectronApplication, page: Page, name: string, path: string): Promise<void> {
  await app.evaluate(({ dialog }, selected) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: selected }) }, path)
  if (candidate && name === legacyExportAction) await exportImage(page)
  else if (candidate) await fileAction(page, name)
  else await page.getByRole('button', { name: legacyAction(name) }).click()
  await expect(page.locator('.notice')).toContainText(`Saved ${path.split(/[\\/]/).pop()}`)
}

async function ready(page: Page): Promise<void> { await expect(page.getByRole('button', { name: candidate ? 'Export' : legacyExportAction })).toBeEnabled() }

async function pixels(page: Page): Promise<number[]> {
  return page.getByLabel('Edited full resolution image canvas').evaluate((element) => {
    if (!(element instanceof HTMLCanvasElement)) throw new Error('The edited image canvas is missing.')
    const context = element.getContext('2d')
    if (!context) throw new Error('The edited image context is missing.')
    return Array.from(context.getImageData(0, 0, element.width, element.height).data)
  })
}

async function expectSavedSettings(page: Page): Promise<void> {
  await expect((await visibleControls(page)).getByRole('spinbutton', { name: 'Contrast value' })).toHaveValue(candidate ? '1.45' : '145')
  await expect((await visibleControls(page)).getByRole('spinbutton', { name: 'Noise pattern' })).toHaveValue('3328622589')
  await expect((await visibleControls(page)).getByRole('spinbutton', { name: 'Bulge x value' })).toHaveValue('35')
  await expect((await visibleControls(page)).getByRole('spinbutton', { name: 'Bulge y value' })).toHaveValue('65')
  await expect((await visibleControls(page)).getByRole('spinbutton', { name: 'Bulge radius value' })).toHaveValue('30')
  await expect((await visibleControls(page)).getByRole('spinbutton', { name: 'Bulge strength value' })).toHaveValue('-40')
}

test('installed packages preserve prior projects and presets across upgrade, restart and return to the older application', async () => {
  test.skip(!phase, 'Run the previous, candidate and return phases around actual Windows installations.')
  test.setTimeout(90_000)
  const folder = process.env.DEEP_FRYER_UPGRADE_DIRECTORY
  if (!folder || !['previous', 'candidate', 'return'].includes(phase ?? '')) throw new Error('Choose an upgrade directory and a supported package phase.')
  await mkdir(folder, { recursive: true })
  const sourcePath = join(folder, 'original.png')
  const projectPath = join(folder, 'previous.deepfryer')
  const presetPath = join(folder, legacyPresetFilename)
  const continuedPath = join(folder, 'continued-in-candidate.deepfryer')
  const baselinePath = join(folder, 'previous.png')
  let app = await launch(folder, phase === 'candidate' ? '0.3.0' : '0.2.0')
  const errors: string[] = []
  try {
    let page = await app.firstWindow()
    page.on('pageerror', (error) => errors.push(error.message))
    await expect(page.locator('.open-button')).toBeEnabled()
    if (phase === 'previous') {
      const image = new PNG({ width: 120, height: 80 })
      for (let y = 0; y < image.height; y += 1) for (let x = 0; x < image.width; x += 1) {
        image.data.set([(x * 31 + y * 7) % 256, (x * 11 + y * 43) % 256, (x * 17 + y * 19) % 256, x % 9 === 0 ? 128 : 255], (y * image.width + x) * 4)
      }
      const source = PNG.sync.write(image)
      await writeFile(sourcePath, source, { flag: 'wx' })
      await open(app, page, 'Open image', sourcePath)
      await (await visibleControls(page)).getByRole('spinbutton', { name: 'Contrast value' }).fill('145')
      await page.getByRole('combobox', { name: 'Add effect' }).selectOption('noise')
      await (await visibleControls(page)).getByRole('spinbutton', { name: 'Noise value', exact: true }).fill('23')
      await (await visibleControls(page)).getByRole('spinbutton', { name: 'Noise pattern' }).fill('3328622589')
      await (await visibleControls(page)).getByRole('spinbutton', { name: 'Noise pattern' }).blur()
      await ready(page)
      await page.getByRole('combobox', { name: 'Add effect' }).selectOption('bulge')
      for (const [name, value] of [['Bulge x value', '35'], ['Bulge y value', '65'], ['Bulge radius value', '30'], ['Bulge strength value', '-40']] as const) {
        await (await visibleControls(page)).getByRole('spinbutton', { name }).fill(value)
      }
      await (await visibleControls(page)).getByRole('spinbutton', { name: 'Bulge strength value' }).blur()
      await ready(page)
      await expectSavedSettings(page)
      await save(app, page, 'Save project as…', projectPath)
      await save(app, page, 'Save preset as…', presetPath)
      await save(app, page, legacyExportAction, baselinePath)
      const project = parseProject(await readFile(projectPath, 'utf8'))
      const preset = parsePreset(await readFile(presetPath, 'utf8'))
      expect(Buffer.from(project.source.bytes)).toEqual(source)
      expect(preset).toEqual(project.preset)
      expect(Array.from(PNG.sync.read(await readFile(baselinePath)).data)).toEqual(await pixels(page))
    } else {
      const projectBytes = await readFile(projectPath)
      const presetBytes = await readFile(presetPath)
      const source = await readFile(sourcePath)
      const project = parseProject(projectBytes.toString('utf8'))
      const preset = parsePreset(presetBytes.toString('utf8'))
      const expected = PNG.sync.read(await readFile(baselinePath))
      await open(app, page, 'Open project', projectPath)
      await ready(page)
      await expectSavedSettings(page)
      expect(await pixels(page)).toEqual(Array.from(expected.data))
      const exportedPath = join(folder, `${phase}-${Date.now()}.png`)
      await save(app, page, legacyExportAction, exportedPath)
      const exported = PNG.sync.read(await readFile(exportedPath))
      expect([exported.width, exported.height]).toEqual([expected.width, expected.height])
      expect(exported.data).toEqual(expected.data)
      await open(app, page, 'Open image', sourcePath)
      await ready(page)
      await open(app, page, 'Load preset', presetPath)
      await ready(page)
      await expectSavedSettings(page)
      expect(await pixels(page)).toEqual(Array.from(expected.data))
      if (phase === 'candidate') {
        await (await visibleControls(page)).getByRole('spinbutton', { name: 'Brightness value' }).fill('25')
        await (await visibleControls(page)).getByRole('spinbutton', { name: 'Brightness value' }).blur()
        await ready(page)
        const continuedPixels = await pixels(page)
        await save(app, page, 'Save project as…', continuedPath)
        await app.close()
        app = await launch(folder, '0.3.0')
        page = await app.firstWindow()
        page.on('pageerror', (error) => errors.push(error.message))
        await open(app, page, 'Open project', continuedPath)
        await ready(page)
        await expectSavedSettings(page)
        await expect((await visibleControls(page)).getByRole('spinbutton', { name: 'Brightness value' })).toHaveValue('25')
        expect(await pixels(page)).toEqual(continuedPixels)
        for (const [name, document, filename] of [['Open project', project, 'future.deepfryer'], ['Load preset', preset, 'future.frypreset']] as const) {
          const futurePath = join(folder, filename)
          const futureBytes = Buffer.from(JSON.stringify({ ...document, version: 999 }))
          await writeFile(futurePath, futureBytes, { flag: 'wx' })
          await open(app, page, name, futurePath)
          await expect(page.locator('.notice.error')).toContainText('version is not supported')
          expect(await pixels(page)).toEqual(continuedPixels)
          expect(await readFile(futurePath)).toEqual(futureBytes)
        }
      } else {
        const continuedBytes = await readFile(continuedPath)
        const beforeRefusal = await pixels(page)
        await open(app, page, 'Open project', continuedPath)
        await expect(page.locator('.notice.error')).toContainText('version is not supported')
        expect(await pixels(page)).toEqual(beforeRefusal)
        expect(await readFile(continuedPath)).toEqual(continuedBytes)
      }
      expect(await readFile(projectPath)).toEqual(projectBytes)
      expect(await readFile(presetPath)).toEqual(presetBytes)
      expect(await readFile(sourcePath)).toEqual(source)
      expect(Buffer.from(project.source.bytes)).toEqual(source)
    }
    expect(errors).toEqual([])
    const record = { phase, applicationVersion: await app.evaluate(({ app }) => app.getVersion()), sourceSha256: createHash('sha256').update(await readFile(sourcePath)).digest('hex'), projectSha256: createHash('sha256').update(await readFile(projectPath)).digest('hex'), presetSha256: createHash('sha256').update(await readFile(presetPath)).digest('hex') }
    await writeFile(join(folder, `${phase}-result.json`), JSON.stringify(record, null, 2))
  } finally { await app.close().catch(() => {}) }
})
