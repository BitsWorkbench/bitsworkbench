/**
 * Builds the four prototypes as single self-contained HTML files (styles, script,
 * mission data and screenshots inside), into ../dist/.
 *   node build.mjs
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PROTO = join(HERE, '../proto')
const DIST = join(HERE, '../dist')
const REPO = join(HERE, '../../..')
mkdirSync(DIST, { recursive: true })
// PROTO_PREFIX="2026-11-21 Mission journey prototype " names the files <prefix>A.html and links them so.
const PREFIX = process.env.PROTO_PREFIX || ''
const fileOf = (d) => `${PREFIX}${d}.html`
const files_ = Object.fromEntries(['A', 'B', 'C', 'D'].map((d) => [d, fileOf(d)]))

const NAMES = {
  A: 'Parity plus: drawer, rail and goals in the sim',
  B: 'Coach card: one instruction in the sim, the rest on request',
  C: 'Guided steps: one action at a time, pointed at',
  D: 'Living sim: guided steps with animation in and around the simulator',
}

const lcx = JSON.parse(readFileSync(join(REPO, 'public/learn/packs/LCX.json'), 'utf8'))
const m = lcx.missions[0]
const lcxData = { id: m.id, title: m.title, flow: m.flow.filter((f) => f.type === 'objective' || f.type === 'quiz') }
const anchors = JSON.parse(readFileSync(join(PROTO, 'anchors.json'), 'utf8'))
const journey = JSON.parse(readFileSync(join(PROTO, 'welcome.journey.json'), 'utf8'))
const es = JSON.parse(readFileSync(join(PROTO, 'welcome.es.json'), 'utf8'))
const css = readFileSync(join(PROTO, 'journey.css'), 'utf8')
const js = readFileSync(join(PROTO, 'journey.js'), 'utf8')
const files = readdirSync(join(PROTO, 'backdrops')).filter((f) => f.endsWith('.jpg'))

for (const dir of ['A', 'B', 'C', 'D']) {
  const wanted = files.filter((f) => {
    const isA = /-a-/.test(f)
    return dir === 'A' ? isA : !isA
  })
  const backdrops = {}
  for (const f of wanted) backdrops[f.replace('.jpg', '')] = `data:image/jpeg;base64,${readFileSync(join(PROTO, 'backdrops', f)).toString('base64')}`
  const data = { anchors, backdrops, journey, es, lcx: lcxData }
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Mission journey ${dir}</title>
<style>${css}</style>
</head>
<body>
<div id="chrome" role="navigation" aria-label="Prototype controls"></div>
<main id="viewport">
  <div id="stage">
    <img id="bd" alt="OpenCodeBot with the CodeX simulator (a screenshot of the real app)">
    <div id="fx" class="fxlayer" aria-hidden="false"></div>
    <div id="hot"></div>
    <div id="ui"></div>
  </div>
</main>
<div id="live" class="sr" aria-live="polite"></div>
<script>window.DIRECTION = ${JSON.stringify(dir)}; window.PROTO_FILES = ${JSON.stringify(files_)}; window.DIRECTION_NAME = ${JSON.stringify(NAMES[dir])}; window.JOURNEY_DATA = ${JSON.stringify(data)};</script>
<script>${js}</script>
</body>
</html>
`
  writeFileSync(join(DIST, fileOf(dir)), html)
  console.log(dir, `${(html.length / 1e6).toFixed(1)} MB`)
}
