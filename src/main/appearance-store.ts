import { mkdir, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { appearanceSchema, defaultAppearance, type Appearance, type AppearanceResult } from '../shared/appearance'
import { readDocumentText, writeDocumentExclusive } from './document-files'

const fileSchema = z.strictObject({ version: z.literal(1), settings: appearanceSchema })

export class AppearanceStore {
  private tail: Promise<unknown> = Promise.resolve()
  private initial: Promise<AppearanceResult> | null = null
  private protectedFile = false
  private readonly path: string

  constructor(private readonly directory: string) { this.path = join(directory, 'appearance.json') }

  load(): Promise<AppearanceResult> {
    this.initial ??= this.read()
    return this.initial
  }

  private async read(): Promise<AppearanceResult> {
    try {
      const file = fileSchema.parse(JSON.parse(await readDocumentText(this.path, 16 * 1024)))
      return { settings: file.settings, notice: '' }
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return { settings: defaultAppearance(), notice: '' }
      this.protectedFile = true
      return { settings: defaultAppearance(), notice: 'Saved settings could not be read. Defaults are active. Reset saved settings to replace the unreadable file.' }
    }
  }

  save(settings: Appearance, reset = false): Promise<Appearance> {
    const accepted = appearanceSchema.parse(settings)
    const operation = this.tail.then(async () => {
      await this.load()
      if (this.protectedFile && !reset) throw new Error('Reset saved settings before replacing the unreadable settings file.')
      await mkdir(this.directory, { recursive: true })
      const temporary = join(this.directory, `appearance-${crypto.randomUUID()}.tmp`)
      try {
        await writeDocumentExclusive(temporary, JSON.stringify({ version: 1, settings: accepted }))
        await rename(temporary, this.path)
      } finally { await rm(temporary, { force: true }) }
      this.protectedFile = false
      this.initial = Promise.resolve({ settings: accepted, notice: '' })
      return accepted
    })
    this.tail = operation.catch(() => {})
    return operation
  }

  async drain(): Promise<void> { await this.tail }
}
