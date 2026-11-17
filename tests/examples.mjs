/**
 * Starter projects: every example opens from the ⋯ menu, is a block program
 * for its board with no loose blocks, has a goal, turns into Python, and runs
 * in the simulator without an error. In Spanish too.
 * Run after `npm run build` (Node 24, for the simulator).
 */
import { spawn } from 'node:child_process'
import { chromium } from 'playwright'
import { runHeadless, haveFlight } from '../src/sim/headless.js'

const BASE = process.env.OCB_URL || 'http://localhost:4173/'

async function reachable(url) {
  try {
    return (await fetch(url, { signal: AbortSignal.timeout(1500) })).ok
  } catch {
    return false
  }
}

let server = null
if (!(await reachable(BASE))) {
  server = spawn('npx', ['vite', 'preview', '--port', '4173', '--strictPort'], { stdio: 'ignore' })
  for (let i = 0; i < 40 && !(await reachable(BASE)); i++) await new Promise((r) => setTimeout(r, 250))
}

const problems = []
const check = (ok, label) => {
  console.log(`  ${ok ? 'ok' : 'FAIL'}  ${label}`)
  if (!ok) problems.push(label)
}

const browser = await chromium.launch(process.env.OCB_CHROMIUM ? { executablePath: process.env.OCB_CHROMIUM } : {})
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
page.on('pageerror', (e) => problems.push(`page error: ${e.message}`))
const warnings = []
page.on('console', (m) => {
  if (m.type() === 'warning' || m.type() === 'error') warnings.push(m.text())
})

async function fresh(lang = 'en') {
  await page.goto(`${BASE}?device=loopback&lang=${lang}`, { waitUntil: 'networkidle' })
  await page.evaluate(() => {
    localStorage.clear()
    localStorage.setItem('opencodebot.welcomed.v1', '1')
    localStorage.setItem('opencodebot.device.v1', 'codebot')
  })
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForFunction(() => !!window.openCodeBot)
}

/** Open Learn on a board, with its other examples unfolded; returns every example it lists. */
async function openPicker(device) {
  await page.click('#btn-learn')
  await page.waitForFunction(() => document.getElementById('modal')?.open)
  await page.click(`#modal [data-ex-device="${device}"]`)
  await page.evaluate(() => {
    const more = document.querySelector('#modal .ex-more')
    if (more) more.open = true
  })
  // The examples only: Learn lists mission packs below them, as cards too.
  return page.$$eval('#modal .ex-item[data-example]', (items) =>
    items.map((b) => ({
      id: b.dataset.example,
      title: b.querySelector('.ex-title').textContent,
      goal: b.querySelector('.ex-goal').textContent,
    })),
  )
}

/** Pick one example: it opens as a new file, never asking (the open file is kept). */
async function pick(id) {
  const was = await page.evaluate(() => window.openCodeBot.openFile?.path)
  await page.click(`#modal [data-example="${id}"]`)
  // The dialog shuts at once; its close event, which opens the example, comes a moment later.
  await page.waitForFunction((was) => window.openCodeBot.openFile?.path !== was, was, { timeout: 5000 })
  return was
}

const programs = []
await fresh()

for (const device of ['codebot', 'codex', 'codeair']) {
  const list = await openPicker(device)
  check(list.length >= 5 && list.length <= 6, `${device}: 5 or 6 examples (${list.length})`)
  check(
    list.every((e) => e.title && e.goal && e.goal.length < 120),
    `${device}: each has a title and a one-line goal`,
  )
  const quick = await page.$$eval('#modal .ex-item[data-example]:not(.ex-more .ex-item)', (items) => items.map((b) => b.dataset.example))
  check(
    quick.length === 2 && quick.join() === list.slice(0, 2).map((e) => e.id).join(),
    `${device}: Learn shows its two easiest as quick starts, the rest folded away (${quick.join(' ')})`,
  )
  await page.keyboard.press('Escape')

  for (const ex of list) {
    warnings.length = 0
    await openPicker(device)
    const was = await pick(ex.id)
    const state = await page.evaluate(async (was) => {
      const app = window.openCodeBot
      const ws = app.workspace.workspace
      const tops = ws.getTopBlocks(false)
      return {
        target: app.workspace.targetId,
        file: app.openFile.path,
        kept: !was || (await app.stores.browser.exists(was)),
        saved: (await app.stores.browser.read(app.openFile.path)) === app._currentPython(),
        blocks: ws.getAllBlocks(false).length,
        types: [...new Set(ws.getAllBlocks(false).map((b) => b.type))],
        loose: tops.filter((b) => !['ocb_on_start', 'ocb_forever'].includes(b.type)).map((b) => b.type),
        python: app._currentPython(),
        mode: app.workspace.mode,
      }
    }, was)
    const label = `${device} "${ex.title}"`
    check(state.target === device && state.mode === 'blocks', `${label}: opens as blocks for ${device}`)
    check(/^[a-z0-9-]+\.py$/.test(state.file) && state.kept && state.saved, `${label}: a new file named for it (${state.file}), saved, and the last one kept`)
    check(state.blocks >= 3 && state.loose.length === 0, `${label}: ${state.blocks} blocks, none loose ${state.loose.join(' ')}`)
    check(warnings.length === 0, `${label}: loads without warnings ${warnings.slice(0, 2).join('; ')}`)
    check(/\S/.test(state.python) && !/\bpass\n?$/.test(state.python.trim()), `${label}: makes Python`)
    programs.push({ device, label, python: state.python, types: state.types })

    // Back from its Python, it is the same program: nothing lost, and the
    // same Python again.
    const back = await page.evaluate((py) => {
      const app = window.openCodeBot
      const r = app.blocksFromPython(py)
      if (!r.ok) return { line: r.line }
      app.workspace.replaceBlocks(r.state)
      return { python: app._currentPython() }
    }, state.python)
    const lines = (s) => s.split('\n').map((l) => l.trim()).filter(Boolean)
    const lost = back.python ? lines(state.python).filter((l) => !lines(back.python).includes(l)) : ['(did not parse)']
    check(lost.length === 0, `${label}: back from Python, no line lost ${lost.slice(0, 2).join(' | ')}`)
    check(back.python === state.python, `${label}: back from Python, the same Python`)
  }
}

// Ordered easy to harder: each board starts with a plain sequence (no loops,
// choices or variables) and ends with a program that decides as it goes.
for (const device of ['codebot', 'codex', 'codeair']) {
  const mine = programs.filter((p) => p.device === device)
  const first = mine[0].types.filter((t) => /^(controls_|variables_|math_change|ocb_forever)/.test(t))
  check(first.length === 0, `${device}: the first example is a plain sequence ${first.join(' ')}`)
  const last = mine.at(-1).types
  check(
    last.includes('controls_if') || last.includes('controls_whileUntil'),
    `${device}: the last example makes choices or waits for something`,
  )
}

// An example never asks: the program open stays in its own file.
await openPicker('codex')
await page.click('#modal [data-example="hello"]')
await page.waitForTimeout(300)
check(!(await page.evaluate(() => document.getElementById('modal')?.open)), 'opening an example over existing blocks does not ask')

// In Spanish the picker, the names and the words in the program are Spanish.
await fresh('es')
const es = await openPicker('codex')
check(es[0]?.title === 'Saluda', `Spanish titles (${es[0]?.title})`)
await pick('hello', es[0]?.title)
check(
  (await page.evaluate(() => window.openCodeBot._currentPython())).includes('¡Hola!'),
  'the program\'s own words are Spanish',
)

await browser.close()
server?.kill()

// Each program runs in the simulator without an error.
console.log('in the simulator')
for (const p of programs) {
  if (p.device === 'codeair' && !haveFlight()) {
    console.log(`  skip  ${p.label} (no CodeAIR flight library: SIM_FLIGHT=1 npm run sim:flight)`)
    continue
  }
  const r = await runHeadless({ kind: p.device, source: p.python, seconds: 8 })
  check(!r.error, `${p.label} runs${r.error ? ': ' + r.error.name + ' ' + r.error.message + ' line ' + r.error.line : ''}`)
}

if (problems.length) {
  console.error('\nFAILURES:')
  for (const p of problems) console.error(' -', p)
  process.exit(1)
}
console.log('\nAll good.')
