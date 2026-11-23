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
import { BRAND } from '../src/brand.js'

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
  localStorage.setItem('opencodebot.welcome.v1', 'off')
  localStorage.setItem('opencodebot.device.v1', 'codebot')
})
await page.reload({ waitUntil: 'networkidle' })
await page.waitForFunction(() => !!window.openCodeBot)

/**
 * Inputs a block needs filled to say what it is: `len(x)` of something
 * unknown reads as a text's length, so "length of list" gets a list.
 */
// A value worked out as the program runs (here `n`), as these blocks are for:
// with a fixed number, their Python is the dropdown block's, which it comes back as.
const byValue = { NUM: { block: { type: 'ocb_python_value', fields: { CODE: 'n' } } } }
const FILL = {
  lists_length: { VALUE: { block: { type: 'lists_create_with', extraState: { itemCount: 0 } } } },
  codebot_led_set: byValue,
  codebot_ls_led_set: byValue,
}

// Helpers in the page: a block program's Python, and the same program back from it.
await page.evaluate(() => {
  const app = window.openCodeBot
  /** A workspace state with the ids and places taken out, variables by name. */
  window.rtShape = (state) => {
    const names = Object.fromEntries((state.variables || []).map((v) => [v.id, v.name]))
    const shape = (b) => {
      if (!b) return null
      const out = { type: b.type }
      // A function's parameters carry ids new at every load (argId), and
      // fields named by them: the names are what say what the block is.
      const argIds = new Set((b.extraState?.params || []).map((p) => p.argId).filter(Boolean))
      if (b.extraState) {
        out.extraState = argIds.size
          ? { ...b.extraState, params: b.extraState.params.map(({ argId, ...p }) => p) }
          : b.extraState
      }
      if (b.fields) {
        out.fields = Object.fromEntries(
          Object.entries(b.fields)
            .filter(([k]) => !argIds.has(k))
            .map(([k, v]) => [k, v && typeof v === 'object' ? names[v.id] ?? v.name : v]),
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
  const result = await page.evaluate((FILL) => {
    const ws = window.openCodeBot.workspace.workspace
    const seen = new Set()
    const items = []
    for (const cat of ws.options.languageTree.contents) {
      for (const item of cat.contents || []) {
        if (item.kind !== 'block') continue
        if (['ocb_on_start', 'ocb_forever', 'ocb_python'].includes(item.type)) continue
        const key = item.type + JSON.stringify(item.extraState || {})
        if (seen.has(key)) continue
        seen.add(key)
        items.push(item)
      }
    }
    // The Variables category fills itself in; its blocks, as the palette makes them.
    items.push(
      { kind: 'block', type: 'variables_set' },
      { kind: 'block', type: 'variables_get' },
      { kind: 'block', type: 'math_change', inputs: { DELTA: { shadow: { type: 'math_number', fields: { NUM: 1 } } } } },
    )
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
        // A random place to take, remove, set or insert at: Blockly writes helper
        // code for these, which comes back as Python blocks.
        if (fields.WHERE === 'RANDOM' && fields.MODE !== 'GET') continue
        const block = { type: item.type, ...(item.extraState ? { extraState: item.extraState } : {}) }
        block.inputs = { ...JSON.parse(JSON.stringify(item.inputs || {})), ...filled, ...(FILL[item.type] || {}) }
        if (Object.keys(fields).length) block.fields = fields
        // The first, the last or a random item has no index.
        if (['FIRST', 'LAST', 'RANDOM'].includes(fields.WHERE)) delete block.inputs.AT
        // "remove" is a statement, not a value.
        const statement = item.type === 'lists_getIndex' && fields.MODE === 'REMOVE'
        if (statement) block.extraState = { isStatement: true }
        const stmt = output && !statement ? { type: 'ocb_print', inputs: { TEXT: { block } } } : block
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
  }, FILL)
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
  // The curriculum's lines (Python with Robots, CodeX's missions) are blocks.
  const bot = await from('from botcore import *\nn_led = 0\nleds.user_num(n_led, True)\nleds.ls_num(n_led, False)\nleds.ls(0b01110)\nmotors.enable(False)\n')
  const types = JSON.stringify(bot.shape)
  check(['codebot_led_set', 'codebot_ls_led_set', 'codebot_ls_leds_pattern', 'codebot_motors_enable'].every((t) => types.includes(`"${t}"`)) && !types.includes('ocb_python'), 'LEDs by a variable, a line sensor pattern and motor power are blocks')
  check(bot.back.includes('leds.ls(0b01110)'), 'and the pattern stays binary')
  await board('codex')
  const cx = await from('from codex import *\ndisplay.show(pics.HEART)\naudio.mp3("sounds/africa")\n')
  const cxt = JSON.stringify(cx.shape)
  check(cxt.includes('"codex_pic"') && cxt.includes('"codex_mp3"') && !cxt.includes('ocb_python'), 'a CodeX picture and a sound file are blocks')
  await board('codebot')
}
{
  // `from time import sleep`: then `sleep(1)` is the wait block, as `time.sleep(1)` is,
  // and the line goes once the blocks import time themselves.
  const r = await from('from botcore import *\nfrom time import sleep\nleds.user(0xFF)\nsleep(1)\n')
  const wait = r.shape[0].inputs.DO.next
  check(wait?.type === 'ocb_wait', `after from time import sleep, sleep(1) is the wait block (${wait?.type})`)
  check(!r.back.includes('from time import sleep') && /^import time$/m.test(r.back) && r.back.includes('time.sleep(1)'), 'and the blocks write it as import time and time.sleep(1)')
  const as = await from('from time import sleep as pause\npause(2)\n')
  check(as.shape[0].inputs.DO.type === 'ocb_wait', 'an import under another name works too')
  const kept = await from('from time import sleep\nsleep(1)\ntry:\n    sleep(2)\nexcept OSError:\n    pass\n')
  check(kept.back.includes('from time import sleep') && kept.back.includes('    sleep(2)'), 'the import stays while Python left as Python uses the name')
  const own = await from('from time import sleep\nsleep = 3\nsleep(1)\n')
  check(!JSON.stringify(own.shape).includes('ocb_wait'), 'a name the program sets itself is not the import')
  const plain = await from('sleep(1)\n')
  check(!JSON.stringify(plain.shape).includes('ocb_wait'), 'without the import, sleep(1) is not the wait block')
  // Anything else binding the name, or the module's name, keeps the program's own Python
  // (a variable named time would hide the import time the blocks write).
  const shadows = {
    'a variable named time': 'from time import sleep\nsleep(1)\ntime = 3\nprint(time)\n',
    'a loop variable named time': 'from time import sleep\nfor time in range(2):\n    sleep(1)\n',
    'a def named time': 'from time import sleep\ndef time():\n    return 1\nsleep(1)\n',
    'a nested def named sleep': 'from time import sleep\ndef f():\n    def sleep(x):\n        print(x)\n    sleep(1)\nf()\n',
    'a tuple assignment': 'from time import sleep\na, sleep = 1, print\nsleep(1)\n',
    'a class named sleep': 'from time import sleep\nclass sleep:\n    pass\nsleep(1)\n',
    'another import of the name': 'from time import sleep\nimport os as sleep\nsleep(1)\n',
    'except ... as sleep': 'from time import sleep\ntry:\n    pass\nexcept Exception as sleep:\n    pass\nsleep(1)\n',
    'sleep passed as a value': 'from time import sleep\nf = sleep\nsleep(1)\n',
    'time.sleep replaced': 'from time import sleep\nsleep(1)\ntime.sleep = print\nsleep(2)\n',
  }
  for (const [what, src] of Object.entries(shadows)) {
    const s = await from(src)
    check(!/\btime\.sleep\(/.test(s.back) && !JSON.stringify(s.shape).includes('ocb_wait'), `${what}: sleep stays as written`)
  }
}
{
  // A block may leave out what its library defaults (define.js omit), meaning the same.
  await board('codex')
  const r = await from('from codex import *\npixels.set(0, RED)\npixels.set(1, GREEN, 70)\npixels.set(2, BLUE, brightness=30)\npixels.fill(WHITE)\ndisplay.print("Hi")\n')
  const set0 = r.shape[0].inputs.DO
  check(set0.type === 'codex_pixel_set' && set0.fields.BRIGHT === 10, `pixels.set(0, RED) is the NeoPixel block at the library's brightness, 10 (${set0.type} ${set0.fields?.BRIGHT})`)
  check(set0.next.fields.BRIGHT === 70 && set0.next.next.fields.BRIGHT === 30, 'brightness given by position or by name is the field')
  check(set0.next.next.next.type === 'codex_pixels_fill' && set0.next.next.next.fields.BRIGHT === 10, 'pixels.fill(WHITE) too')
  const print = set0.next.next.next.next
  check(print.type === 'codex_print', `display.print("Hi") is the print block, in its default white (${print.type})`)
  // The library's default brightness stays left out, as the student wrote it; another is written.
  check(/^pixels\.set\(0, RED\)$/m.test(r.back) && /^pixels\.fill\(WHITE\)$/m.test(r.back), `a brightness left out stays left out (${JSON.stringify(r.back.split('\n').filter((l) => l.startsWith('pixels')))})`)
  check(r.back.includes('pixels.set(1, GREEN, brightness=70)') && r.back.includes("display.print('Hi', WHITE)"), 'and any other is written in full')
  const odd = await from('from codex import *\npixels.set(0, RED, glow=3)\n')
  check(!JSON.stringify(odd.shape).includes('codex_pixel_set'), 'an argument the block does not know stays Python')
  const wrong = await from('from codex import *\npixels.fill(brightness=20, RED)\npixels.set(0, RED, brightness=5, brightness=50)\n')
  check(!/codex_pixel(s_fill|_set)/.test(JSON.stringify(wrong.shape)), 'a call Python would refuse (a positional after a keyword, a keyword twice) stays as typed')
  await board('codebot')
}
{
  // CodeX's and CodeAIR's modules bring the colours, as CodeSpace's programs assume:
  // the blocks write no `from colors import *`, and a file that has it opens clean.
  await board('codex')
  const r = await from('from codex import *\nfrom colors import *\npixels.fill(RED)\n')
  check(!r.back.includes('from colors import'), `CodeX's blocks write no from colors import * (${JSON.stringify(r.back.split('\n').slice(3, 6))})`)
  check(!JSON.stringify(r.shape).includes('ocb_python'), 'and a file with it opens as blocks, not a grey line')
  await board('codebot')
}
{
  // A line break in a string comes back as one: Blockly's own quoting wrote a
  // backslash and a line break, which Python reads as no break at all.
  const r = await from('print("one\\ntwo")\n')
  check(r.back.includes("print('one\\ntwo')"), `a "\\n" in a string stays "\\n" (${JSON.stringify(r.back.split('\n').slice(-3).join('\n'))})`)
}
{
  // An octal escape is the character it names; a \N{name} escape is not read, so the
  // line keeps its own text rather than a wrong value.
  const octal = await from('print("\\101\\0")\n')
  check(octal.back.includes("print('A\\x00')") || octal.back.includes("print('A\\0')"), `"\\101" is "A" and "\\0" a NUL (${JSON.stringify(octal.back.split('\n').slice(-2).join('\n'))})`)
  const named = await from('print("\\N{BULLET} one")\n')
  check(named.back.includes('print("\\N{BULLET} one")'), `"\\N{BULLET}" stays as written (${JSON.stringify(named.back.split('\n').slice(-2).join('\n'))})`)
}
{
  // A break with code after it (a CodeTrek chunk cut from inside a loop): no block can follow
  // the break block, so that break stays Python; a break that ends its loop is the block.
  let r = null
  try {
    r = await from('x = 1\nbreak\n\npixels.off()\n')
  } catch (err) {
    check(false, `a break with code after it converts (${err.message})`)
  }
  if (r) {
    check(r.back.includes('break') && r.back.includes('pixels.off()'), `a break with code after it converts, and comes back (${JSON.stringify(r.back.split('\n').slice(-4).join('\n'))})`)
    check(!JSON.stringify(r.shape).includes('controls_flow_statements'), 'that break is a Python block')
  }
  const ends = await from('while True:\n    if x:\n        break\n')
  check(JSON.stringify(ends.shape).includes('controls_flow_statements'), 'a break that ends its loop is the break block')
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
  check(!leds.next.comment, 'a comment after the last line is on no block')
  check(r.back.includes('# lights on\nleds.user(0xFF)  # all of them\n'), `and come back where they were, above and at the end of the line${r.back.includes('# all of them') ? '' : ': ' + r.back}`)
  const notes = await page.evaluate(() => window.openCodeBot.workspace.workspace.getTopComments().map((c) => c.getText()))
  check(JSON.stringify(notes) === '["the end"]', `it is a note on the workspace (${JSON.stringify(notes)})`)
  check(r.back.endsWith('spkr.pitch(440)\n\n# the end\n'), 'written after the program')
}
{
  // An end-of-line comment on a block with a body, and on a function.
  const src = 'def go():  # off we go\n    pass\n\nwhile True:  # for ever\n    print(1)  # one\n\n# first note\n# still the first\n\n# second note\n'
  const r = await from(src)
  check(r.back.includes('def go():  # off we go\n') && r.back.includes('while True:  # for ever\n    print(1)  # one\n'), `the end of a def, a loop and a line inside it (${r.back.split('\n').slice(-12).join(' | ')})`)
  const notes = await page.evaluate(() => window.openCodeBot.workspace.workspace.getTopComments().map((c) => c.getText()).sort())
  check(JSON.stringify(notes) === '["first note\\nstill the first","second note"]', `comment lines one after another are one note (${JSON.stringify(notes)})`)
  check(r.back.endsWith('# first note\n# still the first\n\n# second note\n'), 'notes come back in order')
  const only = await from('# just an idea\n')
  check(!only.shape.length && only.back.endsWith('# just an idea\n') && !only.back.includes('Add some blocks'), 'a program of only a comment is a note')
}
{
  // Comments added in block mode are Python comments: on a block, above its
  // line; on the workspace, after the program. A changed end-of-line comment
  // goes above.
  const r = await page.evaluate(() => {
    const app = window.openCodeBot
    const { Blockly } = window.openCodeBotInternals
    const ws = app.workspace.workspace
    ws.clear()
    app.workspace.replaceBlocks(app.blocksFromPython('print(1)  # one\nprint(2)\n').state)
    const [one, two] = ws.getAllBlocks(true).filter((b) => b.type === 'ocb_print')
    const menu = Blockly.ContextMenuRegistry.registry.getItem('blockComment')
    const offered = menu.preconditionFn({ block: two, focusedNode: two }) === 'enabled'
    two.setCommentText('two, from blocks')
    const note = new Blockly.comments.RenderedWorkspaceComment(ws)
    note.setText('a note from blocks')
    note.moveTo(new Blockly.utils.Coordinate(40, 2000))
    const first = app._blocksPython()
    one.setCommentText('one, changed')
    return { offered, first, second: app._blocksPython() }
  })
  check(r.offered, 'a block offers "Add Comment"')
  check(r.first.includes('print(1)  # one\n# two, from blocks\nprint(2)\n\n# a note from blocks\n'), `a block's comment goes above it; a note goes after the program${r.first.includes('# two') ? '' : ': ' + r.first}`)
  check(r.second.includes('# one, changed\nprint(1)\n'), 'an end-of-line comment changed in blocks goes above its line')
}
{
  // Stacks keep their places when the Python changes; new ones line up below.
  const r = await page.evaluate(() => {
    const app = window.openCodeBot
    const { Blockly } = window.openCodeBotInternals
    const ws = app.workspace.workspace
    ws.clear()
    app.workspace.replaceBlocks(app.blocksFromPython('def hop():\n    pass\n\nprint(1)\n').state)
    const at = (type) => ws.getTopBlocks(false).find((b) => b.type === type)
    at('procedures_defnoreturn').moveTo(new Blockly.utils.Coordinate(500, 30))
    at('ocb_on_start').moveTo(new Blockly.utils.Coordinate(520, 400))
    app.workspace.replaceBlocks(app.blocksFromPython('def hop():\n    print(0)\n\nprint(2)\nwhile True:\n    pass\n').state)
    const xy = (type) => { const p = at(type).getRelativeToSurfaceXY(); return [p.x, p.y] }
    const keep = { def: xy('procedures_defnoreturn'), start: xy('ocb_on_start'), forever: xy('ocb_forever'), startBottom: at('ocb_on_start').getBoundingRectangle().bottom }
    // The old places would put "forever" above "on start": tidied instead.
    at('ocb_on_start').moveTo(new Blockly.utils.Coordinate(520, 900))
    at('ocb_forever').moveTo(new Blockly.utils.Coordinate(520, 600))
    app.workspace.replaceBlocks(app.blocksFromPython('def hop():\n    print(0)\n\nprint(3)\nwhile True:\n    pass\n').state)
    const order = ws.getTopBlocks(true).map((b) => b.type)
    return { keep, order, python: app._blocksPython() }
  })
  check(r.keep.def.join() === '500,30' && r.keep.start.join() === '520,400', `a function and "on start" keep their places (${JSON.stringify(r.keep)})`)
  check(r.keep.forever[0] === 500 && r.keep.forever[1] > r.keep.startBottom, `a new "forever" lines up below them (${r.keep.forever})`)
  check(r.order.join() === 'procedures_defnoreturn,ocb_on_start,ocb_forever' && /print\(3\)\n+while True:/.test(r.python), `places that would change the program's order are tidied instead (${r.order}; ${r.python.slice(-60)})`)
}
{
  await board('codex')
  const r = await from('from codex import *\naudio.pitch(523, 0.3)  # C5\n')
  const note = r.shape[0].inputs.DO
  check(note.type === 'codex_note' && !note.comment, 'a note\'s own "# C5" is part of its block, not a comment')
  await board('codebot')
}
{
  // Variables and counting.
  const r = await from('x = 0\nx += 2\nx -= 1\nprint(x)\nfor i in range(5):\n    print(i)\nfor n in range(10, 0, -2):\n    pass\nfor count in range(3):\n    x += 1\n')
  const names = JSON.stringify(types(r.shape))
  check(
    names === JSON.stringify(['ocb_on_start', 'variables_set', 'math_number', 'math_change', 'math_number', 'math_change', 'math_number', 'ocb_print', 'variables_get',
      'controls_for', 'math_number', 'math_number', 'math_number', 'ocb_print', 'variables_get', 'controls_for', 'math_number', 'math_number', 'math_number',
      'controls_repeat_ext', 'math_number', 'math_change', 'math_number']),
    `set, change (+= and -=), get, count with, repeat (${names})`,
  )
  const counts = JSON.stringify(r.shape).match(/"FROM":\{[^}]*\}\},"TO":\{[^}]*\}\},"BY":\{[^}]*\}/g)
  check(
    counts?.length === 2 && /"NUM":0.*"NUM":4.*"NUM":1/.test(counts[0]) && /"NUM":10.*"NUM":1.*"NUM":2/.test(counts[1]),
    'range(5) counts 0 to 4 by 1; range(10, 0, -2) counts 10 down to 1 by 2',
  )
  check(r.back.includes('for i in range(5):') && r.back.includes('for n in range(10, 0, -2):'), 'and both make the same range again')
  check(r.back.includes('x += 2\nx -= 1\n') && !r.back.includes('isinstance'), '"change by" writes x += 2 and x -= 1, as typed')
  const each = await from('for word in words:\n    print(word)\n')
  check(each.shape[0].inputs.DO.type === 'controls_forEach' && each.shape[0].inputs.DO.fields.VAR === 'word', 'for word in words is "for each word in list"')
  const notVar = await from('print(RED)\n')
  check(notVar.shape[0].inputs.DO.inputs.TEXT.type !== 'variables_get', 'a name the program never sets is not a variable')
}
{
  // Lists and joining text, written the way a student would.
  const src = "items = [3, 1, 2]\nitems.append(4)\nitems[0] = 5\nprint(items[-1])\nprint(items.pop())\nprint(len(items))\nprint('n=' + str(len(items)) + '!')\n"
  const r = await from(src)
  const t = types(r.shape)
  check(t.includes('lists_create_with') && t.includes('lists_setIndex') && t.includes('lists_getIndex') && t.includes('lists_length') && t.includes('text_join'),
    `list, append, set, get, pop, length and join are blocks (${t.join(' ')})`)
  check(!t.includes('ocb_python') && !t.includes('ocb_python_value'), 'with nothing left as Python')
  check(r.back.endsWith(src.replace(/^items = /, 'items = ')) || r.back.includes(src), `and make the same Python again${r.back.includes(src) ? '' : ': ' + r.back.split('\n').slice(-8).join(' | ')}`)
  const idx = await from('items = [1]\nprint(items[i])\n')
  check(JSON.stringify(idx.shape).includes('"ocb_python_value"'), 'an index Python counts from 0 by a name (items[i]) stays Python, as the blocks count from 1')
}
{
  // Functions, as the palette makes them: each kind of function block, made
  // into Python and back, is itself again (Blockly puts them above the rest).
  const num = (n) => ({ block: { type: 'math_number', fields: { NUM: n } } })
  const get = (name) => ({ block: { type: 'variables_get', fields: { VAR: { id: `py-var-${name}` } } } })
  const ifReturn = (value, cond, out) => ({
    type: 'procedures_ifreturn',
    extraState: `<mutation value="${value}"></mutation>`,
    inputs: { CONDITION: { block: { type: 'logic_boolean', fields: { BOOL: cond } } }, ...(out ? { VALUE: out } : {}) },
  })
  const state = {
    variables: ['a', 'b', 'x'].map((name) => ({ name, id: `py-var-${name}` })),
    blocks: {
      languageVersion: 0,
      blocks: [
        {
          type: 'procedures_defnoreturn', x: 40, y: 40, fields: { NAME: 'do something' },
          extraState: { params: [{ name: 'a', id: 'py-var-a' }, { name: 'b', id: 'py-var-b' }] },
          icons: { comment: { text: 'Describe this function...', pinned: false } },
          inputs: { STACK: { block: { type: 'math_change', fields: { VAR: { id: 'py-var-x' } }, inputs: { DELTA: get('a') }, next: { block: ifReturn(0, 'TRUE') } } } },
        },
        {
          type: 'procedures_defreturn', x: 40, y: 300, fields: { NAME: 'twice' },
          extraState: { params: [{ name: 'a', id: 'py-var-a' }] },
          inputs: {
            STACK: { block: ifReturn(1, 'FALSE', num(0)) },
            RETURN: { block: { type: 'math_arithmetic', fields: { OP: 'MULTIPLY' }, inputs: { A: get('a'), B: num(2) } } },
          },
        },
        { type: 'procedures_defnoreturn', x: 40, y: 500, fields: { NAME: 'nothing yet' } },
        { type: 'procedures_defreturn', x: 40, y: 600, fields: { NAME: 'answer' }, inputs: { RETURN: num(42) } },
        {
          type: 'ocb_on_start', x: 40, y: 700,
          inputs: { DO: { block: {
            type: 'procedures_callnoreturn', extraState: { name: 'do something', params: ['a', 'b'] }, inputs: { ARG0: num(2), ARG1: get('x') },
            next: { block: { type: 'procedures_callnoreturn', extraState: { name: 'nothing yet', params: [] },
              next: { block: { type: 'ocb_print', inputs: { TEXT: { block: { type: 'procedures_callreturn', extraState: { name: 'twice', params: ['a'] }, inputs: { ARG0: { block: { type: 'procedures_callreturn', extraState: { name: 'answer', params: [] } } } } } } } } } } },
          } } },
        },
      ],
    },
  }
  const r = await page.evaluate((s) => window.rtTrip(s), state)
  check(!r.line && r.before === r.after, `functions with and without a value, parameters, "if return" and calls come back as themselves${r.before === r.after ? '' : ': ' + r.after?.slice(0, 300)}`)
  check(r.python === r.back, 'and make the same Python')
  check(/def do_something\(a, b\):\n {4}global x\n/.test(r.python), `a block named "do something" is def do_something, with the global line Blockly writes`)

  // Written by a student: no `global` line, a call before its def, a def
  // the blocks cannot hold, and a function that clashes with a variable.
  const typed = await from('def blink_twice(n):\n    count = n * 2\n    print(count)\n\nblink_twice(3)\nx = add(1, 2)\ndef add(a, b=0):\n    return a + b\n')
  const t = types(typed.shape)
  check(typed.shape[0].type === 'procedures_defnoreturn' && typed.shape[0].fields.NAME === 'blink twice', `a def is a function block named with spaces ("${typed.shape[0].fields?.NAME}")`)
  check(t.includes('procedures_callnoreturn') && !t.includes('procedures_callreturn'), 'its call is a call block; a call of a def with a default stays Python')
  check(typed.back.includes('def blink_twice(n):\n    global count, x\n    count = n * 2\n'), 'Blockly adds the global line a function block writes')
  check(typed.back.includes('def add(a, b=0):\n    return a + b'), 'a def with a default stays Python, as typed')
  const clash = await from('def shout():\n    pass\nx = 1\ndef x():\n    pass\n')
  check(JSON.stringify(clash.shape).match(/procedures_defnoreturn/g)?.length === 1, 'a function named like a variable stays Python')
  check(clash.back.includes('def x():\n    pass'), 'and keeps its name')
}
{
  // The program's frame: header left out, a last `while True:` is forever.
  const r = await from(`# Made with ${BRAND.name} 💚 Blocks in, Python out.\n` + '# Device: CodeBot CB3\n\nfrom botcore import *\nimport time\n\nleds.user(0xFF)\nwhile True:\n    time.sleep(1)\n')
  check(JSON.stringify(types(r.shape)) === JSON.stringify(['ocb_on_start', 'codebot_leds_all', 'ocb_forever', 'ocb_wait', 'math_number']), 'header left out; on start, then forever')
  // A file saved under a past name starts with that name's banner: still the blocks' own.
  for (const past of ['# Made with LabBlocks 💚 — blocks in, Python out.', '# Made with OpenCodeBot 💚 — blocks in, Python out.', '# Made with Anyname 💚 Blocks in, Python out.']) {
    const old = await from(`${past}\n# Device: CodeBot CB3\n\nfrom botcore import *\n\nleds.user(0xFF)\n`)
    check(JSON.stringify(types(old.shape)) === JSON.stringify(['ocb_on_start', 'codebot_leds_all']), `a past banner is left out too (${past.match(/with (\w+)/)[1]})`)
  }
  const own = await from('# Made with love 💚 for my class\n\nfrom botcore import *\n\nleds.user(0xFF)\n')
  check(own.back.includes('# Made with love 💚 for my class'), "a student's own comment that starts the same way stays")
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
