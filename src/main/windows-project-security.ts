import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { z } from 'zod'

const snapshotSchema = z.object({ kind: z.literal('snapshot'), security: z.string().min(1).max(65536), fileId: z.string().regex(/^\d+$/), directories: z.string().regex(/^\d+:\d+(\/\d+:\d+)*$/) })
const responseSchema = z.discriminatedUnion('kind', [snapshotSchema,
  z.object({ kind: z.literal('prepared'), fileId: z.string().regex(/^\d+$/) }),
  z.object({ kind: z.literal('replaced') }),
  z.object({ kind: z.literal('error'), stage: z.enum(['inspect', 'prepare', 'replace']), code: z.number().int(), created: z.boolean() })
])
export type ProjectSecuritySnapshot = z.infer<typeof snapshotSchema>
type Response = z.infer<typeof responseSchema>
type SecurityRequest = { kind: 'inspect'; path: string } | (Omit<ProjectSecuritySnapshot, 'kind'> & { kind: 'prepare'; path: string; temporary: string })
export type ProjectSecurityLease = { fileId: bigint; replace(): Promise<void>; dispose(): Promise<void> }

export class ProjectSecurityError extends Error {
  constructor(message: string, readonly created = false) { super(message) }
}

async function helper(request: SecurityRequest) {
  if (process.platform !== 'win32') throw new ProjectSecurityError('Secure ordinary Save requires Windows. Use Save As.')
  const system = process.env.SystemRoot
  if (!system) throw new ProjectSecurityError('Windows security helper is unavailable. Use Save As.')
  const script = await readFile(join(__dirname, '../../resources/windows-project-security.ps1'), 'utf8')
    .catch(() => { throw new ProjectSecurityError('Windows security helper resource is unavailable. Use Save As.') })
  const launcher = "[Console]::InputEncoding = [Text.UTF8Encoding]::new($false); & ([ScriptBlock]::Create([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String([Console]::ReadLine()))))"
  const child = spawn(join(system, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(launcher, 'utf16le').toString('base64')],
    { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, PSModulePath: join(system, 'System32/WindowsPowerShell/v1.0/Modules') } })
  let failure: Error | null = null
  let ended = false
  let pending: { resolve(value: Response): void; reject(error: Error): void } | null = null
  const queue: Response[] = []
  const fail = (error: Error): void => {
    failure ??= error
    pending?.reject(error)
    pending = null
  }
  const timeout = setTimeout(() => { fail(new ProjectSecurityError('Windows security helper timed out. Use Save As.')); child.kill() }, 15000)
  const closed = new Promise<number | null>((resolve) => child.once('close', (code) => {
    ended = true
    clearTimeout(timeout)
    if (pending) fail(new ProjectSecurityError('Windows security helper ended without a valid acknowledgement. Use Save As.'))
    resolve(code)
  }))
  child.on('error', () => fail(new ProjectSecurityError('Windows security helper is unavailable. Use Save As.')))
  child.stdin.on('error', () => fail(new ProjectSecurityError('Windows security helper input failed. Use Save As.')))
  let outputBytes = 0
  const lines = createInterface({ input: child.stdout })
  child.stdout.on('data', (chunk: Buffer) => {
    outputBytes += chunk.length
    if (outputBytes > 131072) { fail(new ProjectSecurityError('Invalid Windows security helper output. Use Save As.')); child.kill() }
  })
  child.stderr.on('data', (chunk: Buffer) => {
    outputBytes += chunk.length
    if (outputBytes > 131072) { fail(new ProjectSecurityError('Windows security helper failed. Use Save As.')); child.kill() }
  })
  lines.on('line', (line) => {
    try {
      const raw: unknown = JSON.parse(line)
      const result = responseSchema.parse(raw)
      if (pending) { pending.resolve(result); pending = null } else queue.push(result)
    } catch { fail(new ProjectSecurityError('Invalid Windows security helper output. Use Save As.')); child.kill() }
  })
  child.stdin.write(Buffer.from(script, 'utf8').toString('base64') + '\n' + JSON.stringify(request) + '\n')
  return {
    async next(): Promise<Response> {
      if (failure) throw failure
      const result = queue.shift() ?? await new Promise<Response>((resolve, reject) => {
        if (ended) reject(new ProjectSecurityError('Windows security helper ended without a valid acknowledgement. Use Save As.'))
        else pending = { resolve, reject }
      })
      if (result.kind === 'error') throw new ProjectSecurityError(`Windows project security ${result.stage} failed (code ${result.code}). Reopen the project or use Save As.`, result.created)
      return result
    },
    replace() { child.stdin.write('replace\n') },
    async finish() {
      child.stdin.end()
      const code = await closed
      if (failure) throw failure
      if (code !== 0) throw new ProjectSecurityError('Windows security helper did not exit successfully. Use Save As.')
    },
    async dispose() { if (!ended) child.stdin.end('abort\n'); await closed; lines.close() }
  }
}

export const windowsProjectSecurity = {
  async inspect(path: string): Promise<ProjectSecuritySnapshot> {
    const worker = await helper({ kind: 'inspect', path })
    try {
      const result = snapshotSchema.parse(await worker.next())
      await worker.finish()
      return result
    } finally { await worker.dispose() }
  },
  async prepare(path: string, temporary: string, snapshot: ProjectSecuritySnapshot): Promise<ProjectSecurityLease> {
    const worker = await helper({ ...snapshot, kind: 'prepare', path, temporary })
    try {
      const result = await worker.next()
      if (result.kind !== 'prepared') throw new ProjectSecurityError('Missing secured temporary acknowledgement. Use Save As.')
      return { fileId: BigInt(result.fileId),
        async replace() {
          worker.replace()
          const result = await worker.next()
          if (result.kind !== 'replaced') throw new ProjectSecurityError('Missing secure replacement acknowledgement. Use Save As.')
          await worker.finish()
        },
        dispose: () => worker.dispose()
      }
    } catch (error) { await worker.dispose(); throw error }
  }
}
