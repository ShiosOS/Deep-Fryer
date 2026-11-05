import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'

const directory = 'src/renderer/src/assets/fonts'
const bytes = await readFile(`${directory}/Anton-Regular.ttf`)
const provenance = JSON.parse(await readFile(`${directory}/provenance.json`, 'utf8'))
for (const [name, sha] of Object.entries(provenance.sha256)) {
  assert.equal(createHash('sha256').update(await readFile(`${directory}/${name}`)).digest('hex'), sha, name)
}
let cmap = 0
for (let index = 0; index < bytes.readUInt16BE(4); index += 1) {
  const entry = 12 + index * 16
  if (bytes.toString('ascii', entry, entry + 4) === 'cmap') cmap = bytes.readUInt32BE(entry + 8)
}
assert.ok(cmap)
const points = new Set()
for (let index = 0; index < bytes.readUInt16BE(cmap + 2); index += 1) {
  const entry = cmap + 4 + index * 8
  const platform = bytes.readUInt16BE(entry)
  const encoding = bytes.readUInt16BE(entry + 2)
  if (!(platform === 0 || platform === 3 && [1, 10].includes(encoding))) continue
  const table = cmap + bytes.readUInt32BE(entry + 4)
  const format = bytes.readUInt16BE(table)
  if (format === 4) {
    const segments = bytes.readUInt16BE(table + 6) / 2
    const end = table + 14
    const start = end + segments * 2 + 2
    const delta = start + segments * 2
    const offsets = delta + segments * 2
    for (let segment = 0; segment < segments; segment += 1) {
      for (let point = bytes.readUInt16BE(start + segment * 2); point <= bytes.readUInt16BE(end + segment * 2); point += 1) {
        const offset = bytes.readUInt16BE(offsets + segment * 2)
        let glyph = offset ? bytes.readUInt16BE(offsets + segment * 2 + offset + 2 * (point - bytes.readUInt16BE(start + segment * 2))) : point
        if (!offset || glyph) glyph = (glyph + bytes.readInt16BE(delta + segment * 2)) & 0xffff
        if (glyph && point !== 0xffff) points.add(point)
      }
    }
  } else if (format === 12) {
    for (let group = 0; group < bytes.readUInt32BE(table + 12); group += 1) {
      const offset = table + 16 + group * 12
      for (let point = bytes.readUInt32BE(offset); point <= bytes.readUInt32BE(offset + 4); point += 1) {
        if (bytes.readUInt32BE(offset + 8) + point - bytes.readUInt32BE(offset)) points.add(point)
      }
    }
  }
}
const ranges = []
for (const point of [...points].sort((a, b) => a - b)) {
  const last = ranges.at(-1)
  if (last && point === last[1] + 1) last[1] = point
  else ranges.push([point, point])
}
const coverage = JSON.stringify(ranges) + '\n'
if (process.argv.includes('--write-coverage')) await writeFile(`${directory}/coverage.json`, coverage)
else assert.equal(await readFile(`${directory}/coverage.json`, 'utf8'), coverage)
console.log(`Verified pinned Anton bytes and ${points.size} supported code points.`)
