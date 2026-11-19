/**
 * The product's name is in one place, src/brand.js: renaming the product is a
 * change to that file. This fails on the name written anywhere else in the
 * code a person's screen comes from (comments are fine, and so are the
 * storage keys, which say opencodebot and must never change). With a built
 * dist/, it also checks the name reached the pages' titles and the manifest.
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { BRAND } from '../src/brand.js'

const problems = []
const check = (ok, label) => {
  console.log(`  ${ok ? 'ok' : 'FAIL'}  ${label}`)
  if (!ok) problems.push(label)
}

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return files(path)
    return /\.(js|mjs|html|css)$/.test(name) ? [path] : []
  })
}

/** The file's text with its comments blanked out (JS and CSS block and line comments, HTML comments). */
function code(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1')
}

const sources = [
  ...files('src').filter((f) => f !== join('src', 'brand.js') && !f.startsWith(join('src', 'sim', 'runtime', 'mp'))),
  'index.html',
  'boards.html',
  'vite.config.js',
]
const names = [BRAND.name, ...BRAND.pastNames]
for (const file of sources) {
  const text = code(readFileSync(file, 'utf8'))
  for (const name of names) {
    const at = text.indexOf(name)
    check(at < 0, `${file} does not write "${name}" (src/brand.js has it)${at < 0 ? '' : `: …${text.slice(Math.max(0, at - 40), at + 40).replace(/\s+/g, ' ')}…`}`)
  }
}

if (existsSync('dist/index.html')) {
  const page = readFileSync('dist/index.html', 'utf8')
  check(page.includes(`<title data-i18n="app.name">${BRAND.name}</title>`), 'the built page is titled with the name')
  check(readFileSync('dist/boards.html', 'utf8').includes(`>${BRAND.name} boards</title>`), 'and so is the boards page')
  check(!page.includes('%BRAND_NAME%'), 'no placeholder is left in the built page')
  const manifest = JSON.parse(readFileSync('dist/manifest.webmanifest', 'utf8'))
  check(manifest.name === BRAND.name && manifest.short_name === BRAND.shortName, 'the installed app is named from brand.js')
} else {
  console.log('  (no dist/: the built pages were not checked)')
}

if (problems.length) {
  console.error('\nFAILURES:')
  for (const p of problems) console.error(' -', p)
  process.exit(1)
}
console.log('All good.')
