import { mkdir, readdir, rename, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { MAX_PROJECT_BYTES, type EditableDocument, type RecoveryOffer } from '../shared/documents'
import type { OpenImage } from '../shared/image'
import { encodeProject, parseProject, readDocumentText, writeDocumentExclusive } from './document-files'

const RETENTION_MS = 7 * 24 * 60 * 60 * 1000

export class RecoveryStore {
  private tail: Promise<void> = Promise.resolve()
  private closing = false
  private readonly latest: string
  private readonly previous: string

  constructor(readonly directory: string, private readonly validateSource: (source: OpenImage) => void) {
    this.latest = join(directory, 'latest.deepfryer')
    this.previous = join(directory, 'previous.deepfryer')
  }

  private parse(text: string): EditableDocument {
    const document = parseProject(text)
    this.validateSource(document.source)
    return document
  }

  private async valid(path: string): Promise<{ text: string; document: EditableDocument; savedAt: string } | null> {
    try {
      const details = await stat(path)
      if (Date.now() - details.mtimeMs > RETENTION_MS) { await rm(path, { force: true }); return null }
      const text = await readDocumentText(path, MAX_PROJECT_BYTES)
      return { text, document: this.parse(text), savedAt: details.mtime.toISOString() }
    } catch { return null }
  }

  async initialize(): Promise<RecoveryOffer> {
    await mkdir(this.directory, { recursive: true })
    for (const name of await readdir(this.directory)) {
      if (/^checkpoint-[0-9a-f-]+\.tmp$/.test(name)) await rm(join(this.directory, name), { force: true })
    }
    const generations = await Promise.all([this.valid(this.latest), this.valid(this.previous)])
    const saved = generations[0] ?? generations[1]
    return saved ? { name: saved.document.source.name, savedAt: saved.savedAt, directory: this.directory } : null
  }

  async restore(): Promise<EditableDocument> {
    await this.tail
    const saved = await this.valid(this.latest) ?? await this.valid(this.previous)
    if (!saved) throw new Error('No valid recovery copy remains. Your current document is unchanged.')
    return saved.document
  }

  checkpoint(document: EditableDocument): Promise<void> {
    if (this.closing) return Promise.resolve()
    const operation = this.tail.then(async () => {
      const text = encodeProject(document)
      this.parse(text)
      await mkdir(this.directory, { recursive: true })
      const current = await this.valid(this.latest)
      if (current?.text === text) return
      const temporary = join(this.directory, `checkpoint-${crypto.randomUUID()}.tmp`)
      const backup = join(this.directory, `checkpoint-${crypto.randomUUID()}.tmp`)
      try {
        await writeDocumentExclusive(temporary, text)
        this.parse(await readDocumentText(temporary, MAX_PROJECT_BYTES))
        if (current) {
          await writeDocumentExclusive(backup, current.text)
          await rename(backup, this.previous)
        }
        await rename(temporary, this.latest)
      } finally {
        await rm(temporary, { force: true })
        await rm(backup, { force: true })
      }
    })
    this.tail = operation.catch(() => {})
    return operation
  }

  async discard(): Promise<void> {
    await this.tail
    await rm(this.latest, { force: true })
    await rm(this.previous, { force: true })
  }

  async close(): Promise<void> {
    this.closing = true
    await this.discard()
  }
}
