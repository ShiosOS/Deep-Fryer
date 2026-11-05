import { _electron as electron, expect, test } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { interruptForRecovery } from './ui'

test('recovery interruption waits for the launcher and Electron processes before profile reuse', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'deep-fryer-process-exit-'))
  const executable = process.env.DEEP_FRYER_EXECUTABLE ?? process.env.ELECTRON_EXECUTABLE_PATH
  const app = await electron.launch({
    ...(executable ? { executablePath: executable } : {}),
    args: [...(process.env.DEEP_FRYER_EXECUTABLE ? [] : [resolve('.')]), `--user-data-dir=${profile}`],
    env: { ...process.env, ELECTRON_RENDERER_URL: '' }
  })
  const launcher = app.process()
  try {
    const page = await app.firstWindow()
    await expect(page.getByRole('heading', { name: 'Open your first image.' })).toBeVisible()
    const pids = await app.evaluate(({ app }) => [...new Set([process.pid, ...app.getAppMetrics().map(({ pid }) => pid)])])
    await interruptForRecovery(app)
    expect(pids.filter((pid) => {
      try { process.kill(pid, 0); return true } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ESRCH') return false
        throw error
      }
    }), 'Electron processes still running when the profile becomes reusable').toEqual([])
    expect(launcher.exitCode).toBe(19)
  } finally {
    await app.close()
    await rm(profile, { recursive: true, force: true })
  }
})
