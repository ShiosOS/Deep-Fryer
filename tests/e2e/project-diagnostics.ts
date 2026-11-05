import { test, type ElectronApplication } from '@playwright/test'

export async function recordProjectBoundaries(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ ipcMain }) => {
    const events: { at: number; event: string; detail: string | number | null }[] = []
    const state = { events, dropped: 0 }
    Reflect.set(globalThis, '__projectBoundaries', state)
    const log = (event: string, detail: string | number | null = null): void => {
      if (state.events.length < 512) state.events.push({ at: Date.now(), event, detail })
      else state.dropped++
    }
    const handlers = Reflect.get(ipcMain, '_invokeHandlers')
    if (!(handlers instanceof Map)) throw new Error('Electron IPC handler map unavailable')
    for (const channel of ['document:open-project', 'document:save-project', 'document:save-project-as']) {
      const original = handlers.get(channel)
      if (typeof original !== 'function') throw new Error(`Missing ${channel} handler`)
      ipcMain.removeHandler(channel)
      ipcMain.handle(channel, async (...args) => {
        log(`${channel}:entry`)
        try {
          const result = await original(...args)
          log(`${channel}:result`, result?.kind ?? (result ? 'opened' : 'cancelled'))
          return result
        } catch (error) {
          log(`${channel}:error`, error instanceof Error ? error.name : 'unknown')
          throw error
        }
      })
    }
    const cp = process.getBuiltinModule('node:child_process')
    const spawn = cp.spawn
    Reflect.set(cp, 'spawn', (...args: Parameters<typeof spawn>) => {
      const relevant = args[0].toLowerCase().endsWith('powershell.exe')
      if (relevant) log('helper:before-spawn')
      const child = spawn(...args)
      if (!relevant) return child
      log('helper:after-spawn', child.pid ?? null)
      let output = ''
      child.stdout?.on('data', (chunk: Buffer) => {
        output = (output + chunk.toString()).slice(-131072)
        let end: number
        while ((end = output.indexOf('\n')) !== -1) {
          const line = output.slice(0, end)
          output = output.slice(end + 1)
          try {
            const response: unknown = JSON.parse(line)
            if (typeof response === 'object' && response && 'kind' in response && typeof response.kind === 'string') {
              log('helper:response', response.kind)
            }
          } catch { log('helper:non-json-response') }
        }
      })
      child.on('error', () => log('helper:process-error'))
      child.on('exit', code => log('helper:exit', code))
      child.on('close', code => log('helper:close', code))
      return child
    })
  })
}

export async function attachProjectBoundaries(app: ElectronApplication): Promise<void> {
  if (app.windows().every(page => page.isClosed())) return
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const state = await Promise.race([
      app.evaluate(() => Reflect.get(globalThis, '__projectBoundaries')),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Main process boundary read exceeded 2 seconds')), 2_000) })
    ]).catch(error => ({ diagnosticError: String(error) }))
    await test.info().attach('project-boundaries', { body: JSON.stringify(state), contentType: 'application/json' })
  } finally { clearTimeout(timer) }
}
