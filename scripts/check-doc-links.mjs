import { execFileSync } from 'node:child_process'
import { readFile, stat } from 'node:fs/promises'
import { dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path'

const root = process.cwd()
const args = process.argv.slice(2)
const remote = args.includes('--remote')
const requested = args.filter((arg) => arg !== '--remote')
if (requested.some((arg) => arg.startsWith('--'))) throw new Error('Usage: node scripts/check-doc-links.mjs [--remote] [file.md ...]')
const files = requested.length ? requested : [...new Set(execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', '*.md'], { encoding: 'utf8' }).split('\0').filter(Boolean))]
const documents = new Map()
const external = new Map()
const errors = []
let checked = 0

function withoutFences(text) {
  let fence = null
  return text.split('\n').map((line) => {
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/)
    if (!fence && marker) { fence = marker[1]; return '' }
    if (fence) {
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length && !marker[2].trim()) fence = null
      return ''
    }
    return line
  }).join('\n')
}

async function document(path) {
  if (!documents.has(path)) documents.set(path, withoutFences(await readFile(path, 'utf8')))
  return documents.get(path)
}

function anchors(text) {
  const result = new Set()
  const counts = new Map()
  for (const match of text.matchAll(/^ {0,3}#{1,6}\s+(.+?)(?:\s+#+)?\s*$/gm)) {
    const slug = match[1].replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/<[^>]*>/g, '').toLowerCase().replace(/[^\p{L}\p{N}\p{M}_\-\s]/gu, '').replace(/\s/g, '-')
    const count = counts.get(slug) ?? 0
    counts.set(slug, count + 1)
    result.add(count ? `${slug}-${count}` : slug)
  }
  for (const match of text.matchAll(/\bid=["']([^"']+)["']/g)) result.add(match[1])
  return result
}

for (const file of files) {
  const path = resolve(file)
  try {
    const text = await document(path)
    const prose = text.replace(/`+[^`\n]*`+/g, (match) => ' '.repeat(match.length))
    const links = []
    const definitions = new Map()
    const label = (value) => value.trim().replace(/\s+/g, ' ').toLowerCase()
    for (const match of prose.matchAll(/^ {0,3}\[([^\]\n]+)\]:\s*(?:<([^>\n]+)>|(\S+))/gm)) {
      definitions.set(label(match[1]), match[2] ?? match[3])
      links.push({ url: match[2] ?? match[3], index: match.index })
    }
    for (const match of prose.matchAll(/\]\(\s*(?:<([^>\n]+)>|([^\s)]+))(?:\s+["'][^"'\n]*["'])?\s*\)/g)) links.push({ url: match[1] ?? match[2], index: match.index })
    for (const match of prose.matchAll(/!?\[([^\]\n]+)\]\[([^\]\n]*)\]/g)) {
      const url = definitions.get(label(match[2] || match[1]))
      if (url) links.push({ url, index: match.index })
      else errors.push(`${file}:${prose.slice(0, match.index).split('\n').length}: undefined reference ${match[2] || match[1]}`)
    }
    for (const match of prose.matchAll(/<(https?:\/\/[^>\s]+)>|\b(?:href|src)=["']([^"']+)["']/g)) links.push({ url: match[1] ?? match[2], index: match.index })
    for (const { url, index } of links) {
      checked++
      const location = `${file}:${prose.slice(0, index).split('\n').length}`
      try {
        if (/^https?:\/\//i.test(url)) {
          const target = new URL(url)
          target.hash = ''
          external.set(target.href, external.get(target.href) ?? location)
          continue
        }
        if (/^(mailto:|data:)/i.test(url)) continue
        if (/^[a-z][a-z\d+.-]*:/i.test(url) || url.startsWith('//')) throw new Error('unsupported link scheme')
        const [destination, fragment] = url.split('#')
        const target = destination ? resolve(destination.startsWith('/') ? root : dirname(path), decodeURIComponent(destination.replace(/^\//, '').split('?')[0])) : path
        const within = relative(root, target)
        if (within === '..' || within.startsWith(`..${sep}`) || isAbsolute(within)) throw new Error('target is outside the repository')
        await stat(target)
        if (fragment && extname(target).toLowerCase() === '.md' && !anchors(await document(target)).has(decodeURIComponent(fragment))) throw new Error(`missing heading #${fragment}`)
      } catch (error) { errors.push(`${location}: ${url}: ${error.message}`) }
    }
  } catch (error) { errors.push(`${file}: ${error.message}`) }
}

if (remote) {
  const pending = [...external]
  await Promise.all(Array.from({ length: Math.min(4, pending.length) }, async () => {
    while (pending.length) {
      const [url, location] = pending.shift()
      try {
        let response = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(15_000) })
        if (response.status === 405 || response.status === 501) {
          response = await fetch(url, { signal: AbortSignal.timeout(15_000) })
          await response.body?.cancel()
        }
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
      } catch (error) { errors.push(`${location}: ${url}: ${error.message}`) }
    }
  }))
}

if (errors.length) {
  console.error(errors.join('\n'))
  process.exitCode = 1
} else {
  console.log(`Checked ${checked} links in ${files.length} Markdown files; ${remote ? `checked ${external.size} external URLs` : `${external.size} external URLs skipped (run node scripts/check-doc-links.mjs --remote)`}.`)
}
