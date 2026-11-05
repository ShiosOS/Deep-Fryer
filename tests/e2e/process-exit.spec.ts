import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { closeDiscardingChanges, interruptForRecovery } from './ui'

function launch(profile: string) {
  const executable = process.env.DEEP_FRYER_EXECUTABLE ?? process.env.ELECTRON_EXECUTABLE_PATH
  return electron.launch({
    ...(executable ? { executablePath: executable } : {}),
    args: [...(process.env.DEEP_FRYER_EXECUTABLE ? [] : [resolve('.')]), `--user-data-dir=${profile}`],
    env: { ...process.env, ELECTRON_RENDERER_URL: '' }
  })
}

async function cleanup(app: ElectronApplication, profile: string): Promise<void> {
  await closeDiscardingChanges(app)
  await rm(profile, { recursive: true, force: true })
}

test('recovery interruption waits for the launcher and Electron processes before profile reuse', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'deep-fryer-process-exit-'))
  const app = await launch(profile)
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
    await cleanup(app, profile)
  }
})

test('recovery interruption failure prevents cleanup from removing the profile even after app.close returns', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'deep-fryer-process-exit-failure-'))
  const app = await launch(profile)
  const launcher = app.process()
  const kill = process.kill
  const page = await app.firstWindow()
  await expect(page.getByRole('heading', { name: 'Open your first image.' })).toBeVisible()
  const pids = await app.evaluate(({ app }) => [...new Set([process.pid, ...app.getAppMetrics().map(({ pid }) => pid)])])
  const blockedPid = await app.evaluate(() => process.pid)
  const marker = join(profile, 'cleanup-proof.txt')
  try {
    await writeFile(marker, 'retain until recorded processes stop')
    process.kill = (...args) => args[0] === blockedPid && args[1] === 0 ? true : kill(...args)
    const interruptionError: unknown = await interruptForRecovery(app).then(() => null, (error: unknown) => error)
    process.kill = kill
    expect(interruptionError).toBeInstanceOf(Error)
    expect(String(interruptionError)).toContain('Interrupted Electron processes must exit before profile reuse')
    expect(launcher.exitCode).toBe(19)
    await app.close()
    await expect(interruptForRecovery(app)).rejects.toBe(interruptionError)
    await expect(cleanup(app, profile)).rejects.toBe(interruptionError)
    expect(await readFile(marker, 'utf8')).toBe('retain until recorded processes stop')
  } finally {
    process.kill = kill
    await app.close()
    await expect.poll(() => pids.filter((pid) => {
      try { kill(pid, 0); return true } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ESRCH') return false
        throw error
      }
    }), { message: 'Real Electron processes must stop before removing the injection fixture' }).toEqual([])
    expect(launcher.exitCode).toBe(19)
    await rm(profile, { recursive: true, force: true })
  }
})
