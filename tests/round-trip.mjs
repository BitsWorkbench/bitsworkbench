/**
 * Python back to blocks. The backbone: every block in every board's palette,
 * with every choice in its dropdowns, made into Python and turned back, is
 * the same block making the same Python. Then the cases around it: Python
 * with no block stays as Python blocks, comments go on blocks, a student's
 * own way of writing a block's line still finds the block.
 * Run after `npm run build`.
 */
import { spawn } from 'node:child_process'
import { chromium } from 'playwright'

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

await page.goto(`${BASE}?device=loopback`, { waitUntil: 'networkidle' })
await page.evaluate(() => {
  localStorage.clear()
  localStorage.setItem('opencodebot.welcomed.v1', '1')
  localStorage.setItem('opencodebot.device.v1', 'codebot')
})
await page.reload({ waitUntil: 'networkidle' })
await page.waitForFunction(() => !!window.openCodeBot)

/** Blocks whose way back comes in a later change: their Python stays as Python blocks. */
const NOT_YET = ['controls_for', 'controls_forEach', 'lists_create_with', 'lists_getIndex', 'lists_setIndex', 'lists_length', 'text_join']

// Helpers in the page: a block program's Python, and the same program back from it.
await page.evaluate(() => {
  const app = window.openCodeBot
  /** A workspace state with the ids and places taken out, variables by name. */
  window.rtShape = (state) => {
    const names = Object.fromEntries((state.variables || []).map((v) => [v.id, v.name]))
    const shape = (b) => {
      if (!b) return null
      const out = { type: b.type }
      if (b.extraState) out.extraState = b.extraState
      if (b.fields) {
        out.fields = Object.fromEntries(
          Object.entries(b.fields).map(([k, v]) => [k, v && typeof v === 'object' ? names[v.id] ?? v.name : v]),
        )
      }
      if (b.inputs) {
        out.inputs = Object.fromEntries(Object.entries(b.inputs).map(([k, v]) => [k, shape(v.block || v.shadow)]))
      }
      if (b.icons?.comment) out.comment = b.icons.comment.text
      if (b.next) out.next = shape(b.next.block)
      return out
    }
    return JSON.stringify((state.blocks?.blocks || []).map(shape))
  }
  /** Load a state, then send its Python back: { before, after, python, back, line }. */
  window.rtTrip = (state) => {
    app.workspace.loadProject({ blocks: state })
    const python = app._blocksPython()
    const before = window.rtShape(app.workspace.toProject().blocks)
    const r = app.blocksFromPython(python)
    if (!r.ok) return { python, line: r.line }
    app.workspace.replaceBlocks(r.state)
    return { python, before, after: window.rtShape(app.workspace.toProject().blocks), back: app._blocksPython() }
  }
  /** Python straight to blocks: the shape, the Python again, or the line it stopped at. */
  window.rtFrom = (python) => {
    const r = app.blocksFromPython(python)
    if (!r.ok) return { line: r.line }
    app.workspace.replaceBlocks(r.state)
    return { shape: JSON.parse(window.rtShape(app.workspace.toProject().blocks)), back: app._blocksPython() }
  }
})

/** Another board, from an empty canvas, so nothing asks to keep blocks. */
async function board(id) {
  await page.evaluate((b) => {
    window.openCodeBot.workspace.workspace.clear()
    window.openCodeBot._pickTarget(b)
  }, id)
  await page.waitForFunction((b) => window.openCodeBot.workspace.targetId === b, id)
}

// ------------------------------------------------- every block, every choice
for (const id of ['codebot', 'codex', 'codeair']) {
  await board(id)
  const result = await page.evaluate((NOT_YET) => {
    const ws = window.openCodeBot.workspace.workspace
    const seen = new Set()
    const items = []
    for (const cat of ws.options.languageTree.contents) {
      for (const item of cat.contents || []) {
        if (item.kind !== 'block' || NOT_YET.includes(item.type)) continue
        if (['ocb_on_start', 'ocb_forever', 'ocb_python'].includes(item.type)) continue
        const key = item.type + JSON.stringify(item.extraState || {})
        if (seen.has(key)) continue
        seen.add(key)
        items.push(item)
      }
    }
    const failures = []
    let trips = 0
    for (const item of items) {
      // Its dropdowns and their choices.
      const probe = ws.newBlock(item.type)
      const output = !!probe.outputConnection
      const drops = []
      // An empty slot has no Python of its own (an empty "if" makes `if False:`),
      // so each slot with no default holds a piece of Python.
      const filled = {}
      for (const input of probe.inputList) {
        if (input.type === 1 && !item.inputs?.[input.name]) {
          filled[input.name] = { block: { type: 'ocb_python_value', fields: { CODE: 'ready' } } }
        }
      }
      for (const input of probe.inputList) {
        for (const f of input.fieldRow) {
          if (f.name && typeof f.getOptions === 'function' && typeof f.getVariable !== 'function') {
            drops.push({ name: f.name, options: f.getOptions(false).map(([, v]) => v) })
          }
        }
      }
      probe.dispose()
      let combos = [{}]
      for (const d of drops) combos = combos.flatMap((c) => d.options.map((v) => ({ ...c, [d.name]: v })))
      for (const fields of combos) {
        const block = { type: item.type, ...(item.extraState ? { extraState: item.extraState } : {}) }
        block.inputs = { ...JSON.parse(JSON.stringify(item.inputs || {})), ...filled }
        if (Object.keys(fields).length) block.fields = fields
        const stmt = output ? { type: 'ocb_print', inputs: { TEXT: { block } } } : block
        const state = { blocks: { languageVersion: 0, blocks: [{ type: 'ocb_on_start', x: 40, y: 40, inputs: { DO: { block: stmt } } }] } }
        const r = window.rtTrip(state)
        trips++
        const label = `${item.type} ${JSON.stringify(fields)}`
        if (r.line) failures.push(`${label}: did not parse at line ${r.line}`)
        else if (r.before !== r.after) failures.push(`${label}: came back as ${r.after.slice(0, 300)}`)
        else if (r.python !== r.back) failures.push(`${label}: its Python changed`)
      }
    }
    return { failures, trips, blocks: items.length }
  }, NOT_YET)
  check(result.failures.length === 0, `${id}: ${result.blocks} blocks, ${result.trips} block and choice pairs, each back from its Python as itself`)
  for (const f of result.failures.slice(0, 12)) console.log(`        ${f}`)
}

// ----------------------------------------------------------- the cases around it
await board('codebot')
const from = (python) => page.evaluate((p) => window.rtFrom(p), python)
const types = (shape) => JSON.stringify(shape).match(/"type":"\w+"/g).map((s) => s.slice(8, -1))

{
  // A student writes a block's line their own way.
  const r = await from('from botcore import *\nmotors.enable(True)\nmotors.run(LEFT, -40)\nmotors.run(RIGHT, -40)\n')
  const drive = r.shape[0].inputs.DO
  check(drive.type === 'codebot_drive' && drive.fields.DIR === 'backward' && drive.inputs.POWER.fields.NUM === 40, '-40 on both wheels is "drive backward 40"')
}
{
  // Python with no block: a whole statement, and a piece of one.
  const r = await from('try:\n    leds.user(0xFF)\nexcept OSError:\n    pass\nprint(f"{1 + 1} wheels")\n')
  const first = r.shape[0].inputs.DO
  check(first.type === 'ocb_python' && first.fields.CODE === 'try:\n    leds.user(0xFF)\nexcept OSError:\n    pass', 'a statement with no block is a Python block holding its exact text, all its lines')
  const print = first.next
  check(print.type === 'ocb_print' && print.inputs.TEXT.type === 'ocb_python_value' && print.inputs.TEXT.fields.CODE === 'f"{1 + 1} wheels"', 'a piece with no block is a Python value in its block\'s slot')
  check(r.back.includes('try:\n    leds.user(0xFF)\nexcept OSError:\n    pass\nprint(f"{1 + 1} wheels")'), 'and both make the same Python again')
}
{
  // A piece of Python inside arithmetic keeps its brackets.
  const r = await from('print(2 * (len(x) + 1))\n')
  check(r.back.includes('print(2 * (len(x) + 1))'), 'a Python piece keeps the brackets its place needs')
}
{
  // Comments go on blocks, and a note's own name is not a comment.
  const r = await from('from botcore import *\n# lights on\nleds.user(0xFF)  # all of them\nspkr.pitch(440)\n# the end\n')
  const leds = r.shape[0].inputs.DO
  check(leds.comment === 'lights on\nall of them', 'comments above and at the end of a line go on that line\'s block')
  check(leds.next.comment === 'the end', 'a comment after the last line goes on the block before it')
  check(r.back.includes('# lights on\n# all of them\nleds.user(0xFF)'), 'and come back as Python comments')
}
{
  await board('codex')
  const r = await from('from codex import *\naudio.pitch(523, 0.3)  # C5\n')
  const note = r.shape[0].inputs.DO
  check(note.type === 'codex_note' && !note.comment, 'a note\'s own "# C5" is part of its block, not a comment')
  await board('codebot')
}
{
  // The program's frame: header left out, a last `while True:` is forever.
  const r = await from('# Made with Codacious 💚 Blocks in, Python out.\n# Device: CodeBot CB3\n\nfrom botcore import *\nimport time\n\nleds.user(0xFF)\nwhile True:\n    time.sleep(1)\n')
  check(JSON.stringify(types(r.shape)) === JSON.stringify(['ocb_on_start', 'codebot_leds_all', 'ocb_forever', 'ocb_wait', 'math_number']), 'header left out; on start, then forever')
  const kept = await from('import math\nprint(math.pi)\n')
  check(kept.shape[0].inputs.DO.fields?.CODE === 'import math', 'an import the blocks do not make stays, as a Python block')
}
{
  // Where to fix: the line the mistake is on.
  const bad = await from("print('one')\nprint((\nprint('three')\n")
  check(bad.line === 2, `an unclosed bracket names its line (${bad.line})`)
  const bad2 = await from("print('one')\nif True\n    print('two')\n")
  check(bad2.line === 2, `a missing colon names its line (${bad2.line})`)
}

await browser.close()
server?.kill()

if (problems.length) {
  console.error('\nFAILURES:')
  for (const p of problems) console.error(' -', p)
  process.exit(1)
}
console.log('\nAll good.')
