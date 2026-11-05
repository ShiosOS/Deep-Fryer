import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { test } from 'node:test'
import { promisify } from 'node:util'

const run = promisify(execFile)
const checker = resolve('scripts/check-doc-links.mjs')

async function fixture(t, files) {
  const directory = await mkdtemp(join(tmpdir(), 'deep-fryer-doc-links-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  for (const [name, content] of Object.entries(files)) {
    const path = join(directory, name)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, content)
  }
  return directory
}

test('checks local images, encoded paths, reference links, duplicate headings, and HTML anchors', async (t) => {
  const cwd = await fixture(t, {
    'README.md': '# Read me\n[guide](docs/guide.md#repeat-1)\n![sample](image%20one.png)\n[guide][ref]\n[ref]: docs/guide.md#named\n[ref][]\n[site](https://example.invalid/)\n',
    'docs/guide.md': '# Repeat\n# Repeat\n<a id="named"></a>\n',
    'image one.png': 'image fixture'
  })
  const result = await run(process.execPath, [checker, 'README.md'], { cwd })
  assert.match(result.stdout, /Checked 6 links/)
  assert.match(result.stdout, /1 external URLs skipped/)
})

test('reports missing images, missing headings, undefined references, and escaping paths', async (t) => {
  const cwd = await fixture(t, {
    'README.md': '# Read me\n![image](missing.png)\n[guide](guide.md#absent)\n[guide][undefined]\n[escape](../outside.md)\n',
    'guide.md': '# Present\n'
  })
  await assert.rejects(run(process.execPath, [checker, 'README.md'], { cwd }), (error) => {
    assert.equal(error.code, 1)
    assert.match(error.stderr, /README.md:2: missing.png: ENOENT/)
    assert.match(error.stderr, /README.md:3: guide.md#absent: missing heading #absent/)
    assert.match(error.stderr, /README.md:4: undefined reference undefined/)
    assert.match(error.stderr, /README.md:5: ..\/outside.md: target is outside the repository/)
    return true
  })
})

test('ignores inline code and fenced examples while retaining diagnostic line numbers', async (t) => {
  const cwd = await fixture(t, {
    'README.md': '# Read me\n`[code](missing.md)`\n```md\n[example](missing.md)\n```\n~~~\n[example](missing.md)\n~~~\n[real](missing.md)\n'
  })
  await assert.rejects(run(process.execPath, [checker, 'README.md'], { cwd }), (error) => {
    assert.equal(error.code, 1)
    assert.equal(error.stderr.trim().split('\n').length, 1)
    assert.match(error.stderr, /README.md:9: missing.md: ENOENT/)
    return true
  })
})

test('checks remote HTTP status and falls back to GET when HEAD is unsupported', async (t) => {
  const requests = []
  const server = createServer((request, response) => {
    requests.push(`${request.method} ${request.url}`)
    response.statusCode = request.url === '/missing' ? 404 : request.method === 'HEAD' ? 405 : 200
    response.end()
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => new Promise((done) => server.close(done)))
  const origin = `http://127.0.0.1:${server.address().port}`
  const cwd = await fixture(t, { 'README.md': `[remote](${origin}/ok)\n[missing](${origin}/missing)\n` })
  await assert.rejects(run(process.execPath, [checker, '--remote', 'README.md'], { cwd }), (error) => {
    assert.equal(error.code, 1)
    assert.match(error.stderr, /README.md:2: .*\/missing: HTTP 404/)
    assert.equal(error.stderr.trim().split('\n').length, 1)
    return true
  })
  assert.ok(requests.includes('HEAD /ok'))
  assert.ok(requests.includes('GET /ok'))
})
