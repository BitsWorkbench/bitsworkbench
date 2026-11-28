/**
 * firebase.json against the built site: every file the site serves gets
 * exactly one Cache-Control rule, and the right one. A file kept a year
 * ("immutable") must have its content's hash in its name, or a deploy could
 * leave students on an old copy; the pages, the service worker and the
 * mission packs must be checked afresh every time. Run after `npm run build`.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, relative } from 'node:path'

const problems = []
const check = (ok, label) => {
  console.log(`  ${ok ? 'ok' : 'FAIL'}  ${label}`)
  if (!ok) problems.push(label)
}

const hosting = JSON.parse(readFileSync('firebase.json', 'utf8')).hosting
check(hosting.public === 'dist', 'Firebase serves dist/, what the build writes')

/** A Firebase Hosting glob (*, **, @(a|b)) as a RegExp over a path that starts with /. */
function glob(source) {
  let re = ''
  for (let i = 0; i < source.length; i++) {
    const c = source[i]
    if (c === '*' && source[i + 1] === '*') { re += '.*'; i++; if (source[i + 1] === '/') i++ }
    else if (c === '*') re += '[^/]*'
    else if (c === '@' && source[i + 1] === '(') {
      const end = source.indexOf(')', i)
      re += `(${source.slice(i + 2, end).split('|').map((s) => s.replace(/[.+?^${}[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*')).join('|')})`
      i = end
    } else re += c.replace(/[.+?^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`^${source.startsWith('/') || source.startsWith('**') ? '' : '/'}${re}$`)
}

const rules = hosting.headers.map((h) => ({ source: h.source, re: glob(h.source), headers: Object.fromEntries(h.headers.map((x) => [x.key, x.value])) }))
const cacheFor = (path) => rules.filter((r) => r.re.test(path) && r.headers['Cache-Control'])

check(cacheFor('/').length === 1 && cacheFor('/')[0].headers['Cache-Control'] === 'no-cache', 'the site\'s root is checked afresh')

if (!existsSync('dist/index.html')) {
  console.log('  (no dist/: run npm run build to check every file)')
} else {
  const files = []
  const walk = (dir) => readdirSync(dir).forEach((f) => (statSync(join(dir, f)).isDirectory() ? walk(join(dir, f)) : files.push('/' + relative('dist', join(dir, f)).split('\\').join('/'))))
  walk('dist')
  const HASHED = /[-.][A-Za-z0-9_-]{8,}\.[a-z0-9]+$/
  const fresh = ['/index.html', '/boards.html', '/sw.js', '/registerSW.js', '/manifest.webmanifest']
  let unruled = [], twice = [], stale = []
  for (const path of files) {
    const hits = cacheFor(path)
    if (hits.length === 0) unruled.push(path)
    if (hits.length > 1) twice.push(`${path}: ${hits.map((h) => h.source).join(', ')}`)
    const value = hits[0]?.headers['Cache-Control'] ?? ''
    if (value.includes('immutable') && !HASHED.test(path)) stale.push(path)
  }
  check(unruled.length === 0, `every file has a Cache-Control rule${unruled.length ? ': none for ' + unruled.slice(0, 5).join(', ') : ''}`)
  check(twice.length === 0, `no file has two${twice.length ? ': ' + twice.slice(0, 3).join('; ') : ''}`)
  check(stale.length === 0, `only files named by their content are kept a year${stale.length ? ': not ' + stale.slice(0, 5).join(', ') : ''}`)
  for (const path of [...fresh, ...files.filter((f) => f.startsWith('/learn/'))]) {
    if (files.includes(path)) check(cacheFor(path)[0]?.headers['Cache-Control'] === 'no-cache', `${path} is checked afresh`)
  }
  const wasm = files.filter((f) => f.endsWith('.wasm'))
  check(wasm.length > 0 && wasm.every((f) => rules.some((r) => r.re.test(f) && r.headers['Content-Type'] === 'application/wasm')), `the simulator's wasm is served as application/wasm (${wasm.length})`)
  check(files.every((f) => rules.some((r) => r.re.test(f) && r.headers['Referrer-Policy'] === 'no-referrer')), 'no page tells another site where a student came from (Referrer-Policy)')
  // About links licenses/: a page, not the app's shell with its assets missing.
  check(files.includes('/licenses/index.html'), 'licenses/ has a page of its own')
  if (files.includes('/licenses/index.html')) {
    const page = readFileSync('dist/licenses/index.html', 'utf8')
    const local = [...page.matchAll(/href="([^"]+)"/g)].map((m) => m[1]).filter((h) => !/^https?:/.test(h))
    const missing = local.map((h) => new URL(h, 'https://x/licenses/').pathname).filter((p) => p !== '/' && !files.includes(p))
    check(local.length >= 3 && missing.length === 0, `and every file it links is on the site${missing.length ? ': not ' + missing.join(', ') : ''}`)
  }
}

if (problems.length) {
  console.error('\nFAILURES:')
  for (const p of problems) console.error(' -', p)
  process.exit(1)
}
console.log('All good.')
