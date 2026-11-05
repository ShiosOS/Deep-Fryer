import { _electron as electron, expect, type ElectronApplication, type TestInfo } from '@playwright/test'
import type { ChildProcess } from 'node:child_process'
import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { z } from 'zod'
import { closeDiscardingChanges } from './ui'

const checkpointEvent = z.object({
  at: z.number().finite(), kind: z.enum(['request', 'ack', 'error']),
  request: z.number().int(), brightness: z.number().finite().nullable(),
  error: z.string().max(1000).optional()
})
const generation = z.object({ edit: z.object({ preset: z.object({ effects: z.array(z.object({
  kind: z.string(), value: z.number().optional()
})) }) }) })
type Launch = { app: ElectronApplication; launcher: ChildProcess; pids: number[] }
type TimelineEvent = z.infer<typeof checkpointEvent> & { launch: number }

function errorText(error: unknown): string {
  return String(error instanceof Error ? error.stack ?? error.message : error).slice(0, 4000)
}
function live(pid: number): boolean {
  try { process.kill(pid, 0); return true } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ESRCH') return false
    throw error
  }
}

export class RecoveryEvidence {
  private readonly launches: Launch[] = []
  private readonly timeline: TimelineEvent[] = []
  private readonly diagnostics: Array<{ operation: string; error: string }> = []
  private dropped = 0

  private constructor(private readonly testInfo: TestInfo, readonly folder: string, private readonly output: string) {}

  static async create(testInfo: TestInfo, folder: string): Promise<RecoveryEvidence> {
    const output = testInfo.outputPath('recovery-evidence')
    await mkdir(output, { recursive: true })
    return new RecoveryEvidence(testInfo, folder, output)
  }

  async launchObserved(): Promise<ElectronApplication> {
    const profile = join(this.folder, 'profile')
    const executable = process.env.DEEP_FRYER_EXECUTABLE ?? process.env.ELECTRON_EXECUTABLE_PATH
    const app = await electron.launch({ ...(executable ? { executablePath: executable } : {}),
      args: [...(process.env.DEEP_FRYER_EXECUTABLE ? [] : [resolve('.')]), `--user-data-dir=${profile}`],
      env: { ...process.env, ELECTRON_RENDERER_URL: '' } })
    const launch: Launch = { app, launcher: app.process(), pids: [] }
    this.launches.push(launch)
    const index = this.launches.length
    app.on('console', (message) => {
      const text = message.text()
      if (!text.startsWith('RECOVERY_EVIDENCE ')) return
      try {
        const event = checkpointEvent.parse(JSON.parse(text.slice('RECOVERY_EVIDENCE '.length)))
        if (this.timeline.length < 1000) this.timeline.push({ ...event, launch: index })
        else this.dropped += 1
      } catch (error) { this.diagnostic('main event decode', error) }
    })
    launch.pids = await app.evaluate(({ app }) => [...new Set([process.pid, ...app.getAppMetrics().map(({ pid }) => pid)])])
    expect(await app.evaluate(({ app }) => app.getPath('userData'))).toBe(profile)
    await app.evaluate(({ ipcMain }, limit) => {
      const handlers: unknown = Reflect.get(ipcMain, '_invokeHandlers')
      if (!(handlers instanceof Map)) throw new Error('Checkpoint observer requires Electron _invokeHandlers Map')
      const handler: unknown = handlers.get('recovery:checkpoint')
      if (typeof handler !== 'function') throw new Error('Checkpoint handler is unavailable')
      let count = 0
      let request = 0
      function record(kind: 'request' | 'ack' | 'error', id: number, brightness: number | null, error?: unknown) {
        if (count++ >= limit) return
        console.info('RECOVERY_EVIDENCE ' + JSON.stringify({ at: Date.now(), kind, request: id, brightness,
          ...(kind === 'error' ? { error: String(error).slice(0, 1000) } : {}) }))
      }
      ipcMain.removeHandler('recovery:checkpoint')
      ipcMain.handle('recovery:checkpoint', async (event, input: unknown) => {
        const id = ++request
        const edit: unknown = input && typeof input === 'object' ? Reflect.get(input, 'edit') : null
        const preset: unknown = edit && typeof edit === 'object' ? Reflect.get(edit, 'preset') : null
        const effects: unknown = preset && typeof preset === 'object' ? Reflect.get(preset, 'effects') : null
        const effect: unknown = Array.isArray(effects) ? effects.find((item: unknown) => item && typeof item === 'object' && Reflect.get(item, 'kind') === 'brightness') : null
        const value: unknown = effect && typeof effect === 'object' ? Reflect.get(effect, 'value') : null
        const brightness = typeof value === 'number' && Number.isFinite(value) ? value : null
        record('request', id, brightness)
        try {
          const result: unknown = await Reflect.apply(handler, ipcMain, [event, input])
          record('ack', id, brightness)
          return result
        } catch (error) { record('error', id, brightness, error); throw error }
      })
    }, 1000 - this.timeline.length)
    return app
  }

  private diagnostic(operation: string, error: unknown): void {
    if (this.diagnostics.length < 30) this.diagnostics.push({ operation, error: errorText(error) })
  }

  private async attempt(operation: string, action: () => Promise<unknown>): Promise<void> {
    try { await action() } catch (error) { this.diagnostic(operation, error) }
  }

  async capture(app: ElectronApplication | undefined, error: unknown): Promise<void> {
    await this.attempt('failure capture', async () => { await this.captureBeforeClose(app, error) })
    await this.receipt('before-close')
  }

  private async captureBeforeClose(app: ElectronApplication | undefined, error: unknown): Promise<void> {
    await this.attempt('primary error', () => writeFile(join(this.output, 'primary-error.txt'), errorText(error)))
    for (const name of ['latest', 'previous']) {
      await this.attempt(`${name} generation`, async () => {
        const source = join(this.folder, 'profile', 'recovery', `${name}.deepfryer`)
        const destination = join(this.output, `${name}.deepfryer`)
        const details = await stat(source)
        if (details.size > 64 * 1024 * 1024) throw new Error('Synthetic generation exceeds 64 MiB capture limit')
        await copyFile(source, destination)
        await this.testInfo.attach(`recovery-${name}`, { path: destination, contentType: 'application/json' })
        let brightness: number | null = null
        let parsed = false
        await this.attempt(`${name} scalar parse`, async () => {
          const result = generation.parse(JSON.parse(await readFile(destination, 'utf8')))
          brightness = result.edit.preset.effects.find((effect) => effect.kind === 'brightness')?.value ?? null
          parsed = true
        })
        await writeFile(join(this.output, `${name}-stat.json`), JSON.stringify({ at: Date.now(), size: details.size,
          mtimeMs: details.mtimeMs, parsed, brightness }, null, 2))
      })
    }
    const page = app?.windows().find((page) => !page.isClosed())
    if (page) {
      await this.attempt('public DOM', async () => {
        const dom = await page.evaluate(() => {
          const brightness = document.querySelector('input[aria-label="Brightness value"]')
          const active = document.activeElement
          const button = [...document.querySelectorAll('button')].find((button) => button.textContent?.trim() === 'Export')
          return { at: Date.now(), brightness: brightness instanceof HTMLInputElement ? brightness.value.slice(0, 100) : null,
            documentHasFocus: document.hasFocus(), activeTag: active?.tagName ?? null,
            activeLabel: active?.getAttribute('aria-label')?.slice(0, 200) ?? null,
            notice: [...document.querySelectorAll('.notice, [role="status"], [role="note"]')].slice(0, 10).map((element) => element.textContent?.slice(0, 1000)),
            exportDisabled: button?.disabled ?? null }
        })
        await writeFile(join(this.output, 'dom.json'), JSON.stringify(dom, null, 2))
      })
      await this.attempt('screenshot', () => page.screenshot({ path: join(this.output, 'failure.png'), timeout: 3000 }))
    } else this.diagnostic('public DOM and screenshot', 'No live page available')
  }

  async close(failed: boolean): Promise<void> {
    let cleanupError: unknown
    for (const launch of this.launches) {
      try { await closeDiscardingChanges(launch.app) } catch (error) {
        cleanupError ??= error
        this.diagnostic('close owned app', error)
      }
    }
    try {
      await expect.poll(() => this.launches.map(({ launcher, pids }, index) => ({
        launch: index + 1, launcherExited: launcher.exitCode !== null || launcher.signalCode !== null,
        livePids: pids.filter(live)
      })).filter(({ launcherExited, livePids }) => !launcherExited || livePids.length > 0),
      { message: 'All retained recovery launchers and recorded PIDs must exit before profile removal' }).toEqual([])
    } catch (error) { cleanupError ??= error; this.diagnostic('exit proof', error) }
    await this.receipt('after-close')
    if (cleanupError && !failed) throw cleanupError
  }

  private async receipt(stage: string): Promise<void> {
    await this.attempt(`${stage} receipt`, async () => {
      const path = join(this.output, `${stage}.json`)
      await writeFile(path, JSON.stringify({ at: Date.now(), folder: this.folder, timeline: this.timeline, dropped: this.dropped,
        diagnostics: this.diagnostics, launches: this.launches.map(({ launcher, pids }, index) => ({
          launch: index + 1, launcherPid: launcher.pid, exitCode: launcher.exitCode, signalCode: launcher.signalCode,
          pids, livePids: pids.filter(live)
        })), limits: [
          'Setup adds main IPC evaluations and wraps private Electron handler lookup before test actions.',
          'Wrapper adds scalar console emission and an awaited handler reaction; scheduling can change.',
          'At most 1000 scalar IPC events retained. No source bytes or security descriptors in the ledger.',
          'Private recovery queue/depth, renderer timers, accepted render revisions, gestures and rename completion are unobserved.',
          'Generation copies are real synthetic bytes read before clean close, sequential and not an atomic disk snapshot.',
          'DOM and screenshot are post-failure observations. Recorded PIDs are launch-time main/metrics PIDs only.'
        ] }, null, 2))
      await this.testInfo.attach(`recovery-${stage}`, { path, contentType: 'application/json' })
    })
    if (this.diagnostics.length > 0) {
      try { await this.testInfo.attach(`recovery-${stage}-diagnostic-errors`, { body: JSON.stringify(this.diagnostics), contentType: 'application/json' }) }
      catch (error) { console.error('Recovery diagnostic attachment failed', errorText(error)) }
    }
  }
}
