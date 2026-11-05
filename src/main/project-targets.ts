import { createHash, randomUUID } from 'node:crypto'
import { lstat, open, rename, unlink } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import type { BigIntStats } from 'node:fs'
import { MAX_PROJECT_BYTES, projectTargetIdSchema, type EditableDocument, type ProjectSaveResult, type ProjectTarget, type ProjectTargetId } from '../shared/documents'
import { CURRENT_PROJECT_VERSION, encodeProject, parseProject, writeDocumentExclusive } from './document-files'

const disk = { open, lstat: (path: string) => lstat(path, { bigint: true }), rename, unlink }
type ProjectDisk = typeof disk
type Snapshot = { stat: BigIntStats; digest: string; text: string }
type AuthorizedTarget = { path: string; snapshot: Snapshot }
type ConflictReason = Extract<ProjectSaveResult, { kind: 'conflict' }>['reason']

function describeFileError(error: unknown, paths: string[]): string {
  const message = error instanceof Error ? error.message : String(error)
  return paths.reduce((safe, path) => safe.replaceAll(path, basename(path)), message)
}

class ProjectConflict extends Error {
  constructor(readonly reason: ConflictReason) { super(reason) }
}

function identity(left: BigIntStats, right: BigIntStats): boolean {
  return left.dev === right.dev && left.ino === right.ino
}

function unchanged(left: Snapshot, right: Snapshot): boolean {
  return identity(left.stat, right.stat) && left.digest === right.digest && left.stat.mode === right.stat.mode &&
    left.stat.mtimeNs === right.stat.mtimeNs && left.stat.ctimeNs === right.stat.ctimeNs
}

function regular(stat: BigIntStats): void {
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1n) throw new ProjectConflict('unsafe')
}

export class ProjectTargets {
  private readonly targets = new Map<ProjectTargetId, AuthorizedTarget>()

  constructor(private readonly fs: ProjectDisk = disk) {}

  private async read(path: string, writable = false): Promise<Snapshot> {
    const before = await this.fs.lstat(path)
    regular(before)
    if (writable && (before.mode & 0o222n) === 0n) throw new ProjectConflict('readonly')
    if (before.size === 0n || before.size > BigInt(MAX_PROJECT_BYTES)) throw new ProjectConflict('changed')
    const file = await this.fs.open(path, writable ? 'r+' : 'r')
    try {
      const stat = await file.stat({ bigint: true })
      regular(stat)
      if (!identity(before, stat)) throw new ProjectConflict('changed')
      if (stat.size === 0n || stat.size > BigInt(MAX_PROJECT_BYTES)) throw new ProjectConflict('changed')
      const bytes = Buffer.alloc(Number(stat.size))
      let offset = 0
      while (offset < bytes.length) {
        const { bytesRead } = await file.read(bytes, offset, bytes.length - offset, offset)
        if (!bytesRead) throw new ProjectConflict('changed')
        offset += bytesRead
      }
      const after = await file.stat({ bigint: true })
      const named = await this.fs.lstat(path)
      regular(named)
      if (!identity(stat, named) || stat.size !== after.size || stat.mtimeNs !== after.mtimeNs || stat.ctimeNs !== after.ctimeNs ||
        after.size !== named.size || after.mtimeNs !== named.mtimeNs || after.ctimeNs !== named.ctimeNs || after.mode !== named.mode) {
        throw new ProjectConflict('changed')
      }
      return { stat: after, digest: createHash('sha256').update(bytes).digest('hex'), text: new TextDecoder('utf-8', { fatal: true }).decode(bytes) }
    } finally { await file.close() }
  }

  private authorize(path: string, snapshot: Snapshot): ProjectTarget {
    const id = projectTargetIdSchema.parse(randomUUID())
    this.targets.set(id, { path, snapshot })
    return { id, name: basename(path) }
  }

  async openProject(path: string, validate: (document: EditableDocument) => void): Promise<{ document: EditableDocument; target: ProjectTarget | null }> {
    try {
      const snapshot = await this.read(path)
      const document = parseProject(snapshot.text)
      validate(document)
      const version: unknown = JSON.parse(snapshot.text).version
      return { document, target: version === CURRENT_PROJECT_VERSION ? this.authorize(path, snapshot) : null }
    } catch (error) {
      if (error instanceof ProjectConflict) throw new Error('The project changed while opening or is not a regular, unlinked file. Your current edit is unchanged.')
      throw new Error(describeFileError(error, [path]), { cause: error })
    }
  }

  async saveAs(path: string, document: EditableDocument): Promise<ProjectSaveResult> {
    const text = encodeProject(document)
    try { await writeDocumentExclusive(path, text) } catch (error) {
      return { kind: 'failed', message: describeFileError(error, [path]) }
    }
    try {
      const snapshot = await this.read(path)
      if (snapshot.digest !== createHash('sha256').update(text).digest('hex')) throw new ProjectConflict('changed')
      return { kind: 'saved', target: this.authorize(path, snapshot) }
    } catch {
      return { kind: 'uncertain', message: 'The new project was written, but could not be verified. Reopen it or use Save As to make a separate copy.' }
    }
  }

  async save(id: ProjectTargetId, document: EditableDocument): Promise<ProjectSaveResult> {
    const target = this.targets.get(id)
    if (!target) return { kind: 'conflict', reason: 'stale' }
    const text = encodeProject(document)
    const temporary = join(dirname(target.path), `.deep-fryer-${randomUUID()}.tmp`)
    let file: Awaited<ReturnType<typeof open>> | null = null
    let created = false
    let renameAttempted = false
    let renamed = false
    try {
      if (!unchanged(target.snapshot, await this.read(target.path, true))) throw new ProjectConflict('changed')
      file = await this.fs.open(temporary, 'wx', Number(target.snapshot.stat.mode & 0o777n))
      created = true
      await file.writeFile(text, 'utf8')
      await file.sync()
      const written = await file.stat({ bigint: true })
      await file.close()
      file = null
      if (!unchanged(target.snapshot, await this.read(target.path, true))) throw new ProjectConflict('changed')
      renameAttempted = true
      await this.fs.rename(temporary, target.path)
      renamed = true
      created = false
      const snapshot = await this.read(target.path)
      if (!identity(written, snapshot.stat) || snapshot.digest !== createHash('sha256').update(text).digest('hex')) throw new ProjectConflict('changed')
      target.snapshot = snapshot
      return { kind: 'saved', target: { id, name: basename(target.path) } }
    } catch (error) {
      let uncertain = renamed
      if (renameAttempted && !renamed) {
        try { uncertain = !unchanged(target.snapshot, await this.read(target.path)) } catch { uncertain = true }
      }
      const failures: string[] = []
      const detail = (cause: unknown): string => describeFileError(cause, [target.path, temporary])
      if (file) {
        try { await file.close() } catch (cause) { failures.push(`Temporary file close failed: ${detail(cause)}`) }
      }
      if (created) {
        try { await this.fs.unlink(temporary) } catch (cause) {
          if (!(cause instanceof Error && 'code' in cause && cause.code === 'ENOENT')) {
            failures.push(`Temporary file ${basename(temporary)} could not be removed: ${detail(cause)}`)
          }
        }
      }
      if (uncertain) {
        this.release(id)
        return { kind: 'uncertain', message: `The project may have been replaced, but the save could not be verified. Reopen it or use Save As to make a separate copy. ${[detail(error), ...failures].join(' ')}` }
      }
      if (!failures.length) {
        if (error instanceof ProjectConflict) return { kind: 'conflict', reason: error.reason }
        if (error instanceof Error && 'code' in error && !renameAttempted) {
          if (error.code === 'ENOENT') return { kind: 'conflict', reason: 'missing' }
          if (error.code === 'EACCES' || error.code === 'EPERM') return { kind: 'conflict', reason: 'readonly' }
        }
      }
      return { kind: 'failed', message: `Project save failed. Use Save As to make a separate copy. ${[detail(error), ...failures].join(' ')}` }
    }
  }

  release(id: ProjectTargetId): void { this.targets.delete(id) }
  clear(): void { this.targets.clear() }
}
