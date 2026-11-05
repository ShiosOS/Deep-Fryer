import test from 'node:test'
import { execFileSync } from 'node:child_process'

test('bundled Anton font, full license and Unicode coverage match their pinned provenance', () => {
  execFileSync(process.execPath, ['scripts/verify-caption-font.mjs'], { stdio: 'pipe' })
})
