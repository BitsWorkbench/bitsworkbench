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
  check(page.includes(`<title data-i18n="app.title">${BRAND.name} Beta</title>`), 'the built page is titled with the name, in Beta')
  check(readFileSync('dist/boards.html', 'utf8').includes(`>${BRAND.name} boards</title>`), 'and so is the boards page')
  check(!/%[A-Z_]+%/.test(page), 'no placeholder is left in the built page')
  // The link preview (Slack, social sites): crawlers read the HTML alone.
  const meta = (attr, key) => page.match(new RegExp(`<meta ${attr}="${key}" content="([^"]*)"`))?.[1]
  const description = (await import('../src/i18n/en.js')).default['app.description']
  check(meta('name', 'description') === description && meta('property', 'og:description') === description &&
    meta('name', 'twitter:description') === description, 'the description and its og: and twitter: copies are en.js\'s')
  check(meta('property', 'og:title') === `${BRAND.name} Beta` && meta('name', 'twitter:title') === `${BRAND.name} Beta`, 'the preview is titled as the page is')
  const image = `${BRAND.site}/social-card.png`
  check(/^https:\/\/[^/]+$/.test(BRAND.site) && meta('property', 'og:image') === image && meta('name', 'twitter:image') === image,
    'the preview picture is an absolute address on the site')
  check(meta('name', 'twitter:card') === 'summary_large_image', 'and shown large')
  const png = existsSync('dist/social-card.png') && readFileSync('dist/social-card.png')
  check(png && png.readUInt32BE(16) === 1200 && png.readUInt32BE(20) === 630, 'the picture is published, at 1200 x 630')
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
