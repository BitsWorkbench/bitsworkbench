/**
 * The MicroPython / CircuitPython board in the app, with no hardware: the
 * loopback device as a generic board (`&board=generic`, `&flavor=` for its
 * banner). Checks the picker and its flavor switch, the Pins palette in
 * both palettes, the Python the Pins blocks write in each flavor, the flavor
 * following a connected board's banner, Run sending the program with no file
 * written, the student's own blocks running there, the Blink example, and the
 * simulator saying it has no such board. Run after `npm run build`.
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

async function open(flavor) {
  await page.goto(`${BASE}?device=loopback&board=generic${flavor ? `&flavor=${flavor}` : ''}`, { waitUntil: 'networkidle' })
  await page.evaluate(() => {
    localStorage.clear()
    localStorage.setItem('opencodebot.welcome.v1', 'off')
    localStorage.setItem('opencodebot.device.v1', 'generic')
  })
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForFunction(() => !!window.openCodeBot)
}

const python = () => page.evaluate(() => window.openCodeBot._blocksPython())
const load = (blocks) => page.evaluate((b) => window.openCodeBot.workspace.loadProject({ blocks: { blocks: { languageVersion: 0, blocks: b } } }), blocks)
const toasts = () => page.evaluate(() => [...document.querySelectorAll('.toast-title')].map((e) => e.textContent))
const pressed = () => page.evaluate(() => document.querySelector('#device-menu .dm-flavor button[aria-pressed="true"]')?.textContent)
const pick = (name) =>
  page.evaluate((n) => [...document.querySelectorAll('#device-menu .dm-flavor button')].find((b) => b.textContent === n).click(), name)

const blink = [
  {
    type: 'ocb_forever', x: 40, y: 40,
    inputs: {
      DO: {
        block: {
          type: 'pins_write', fields: { PIN: 'LED' },
          inputs: { ON: { block: { type: 'logic_boolean', fields: { BOOL: 'TRUE' } } } },
          next: { block: { type: 'ocb_wait', inputs: { SECS: { shadow: { type: 'math_number', fields: { NUM: 0.5 } } } } } },
        },
      },
    },
  },
  { type: 'ocb_print', x: 40, y: 300, inputs: { TEXT: { block: { type: 'pins_analog', fields: { PIN: 'A0' } } } } },
]

// ------------------------------------------------------------ the picker
await open()
const picker = await page.evaluate(() => ({
  target: window.openCodeBot.workspace.targetId,
  item: [...document.querySelectorAll('#device-menu .dm-title')].map((e) => e.textContent),
  pins: window.openCodeBot.workspace.workspace.options.languageTree.contents.find((c) => c.toolboxitemid === 'pins'),
  chip: document.getElementById('device-chip-label').textContent,
  myBlocks: window.openCodeBot.workspace.workspace.options.languageTree.contents.some((c) => c.toolboxitemid === 'my-blocks'),
}))
check(picker.target === 'generic', 'the MicroPython / CircuitPython board can be picked')
check(picker.item.includes('MicroPython / CircuitPython board'), 'it is one entry in the device menu')
check(picker.pins?.contents.map((b) => b.type).join() === 'pins_write,pins_read,pins_analog,pins_ms', 'its palette has the four Pins blocks')
check(picker.myBlocks, 'and the student\'s own blocks')
check(picker.chip === 'MicroPython' && (await pressed()) === 'MicroPython', 'before a board is connected it speaks MicroPython')

// ----------------------------------------------------- the Python per flavor
await load(blink)
const mp = await python()
check(
  ['from machine import ADC, Pin', "pin_LED = Pin('LED', Pin.OUT)", "adc_A0 = ADC(Pin('A0'))", 'pin_LED.value(True)', 'print(adc_A0.read_u16())'].every((l) => mp.includes(l)),
  'the Pins blocks write MicroPython',
)
check(!/import board|digitalio/.test(mp), 'and none of CircuitPython')

await pick('CircuitPython')
await page.waitForFunction(() => window.openCodeBot._blocksPython().includes('import board'))
const cp = await python()
// One pin set and read back (a toggle) is claimed once, as an output.
await load([{ type: 'ocb_forever', x: 40, y: 40, inputs: { DO: { block: { type: 'pins_write', fields: { PIN: 'LED' }, inputs: { ON: { block: { type: 'logic_negate', inputs: { BOOL: { block: { type: 'pins_read', fields: { PIN: 'LED' } } } } } } } } } } }])
const toggle = await python()
check(toggle.split('pin_LED = ').length === 2 && toggle.includes('pin_LED.switch_to_output()') && toggle.includes('pin_LED.value = not pin_LED.value'), 'a toggled pin is claimed once, as an output (CircuitPython)')
await pick('MicroPython')
await page.waitForFunction(() => window.openCodeBot._blocksPython().includes('machine'))
const mpToggle = await python()
check(mpToggle.includes("pin_LED = Pin('LED', Pin.OUT)") && mpToggle.includes('pin_LED.value(not pin_LED.value())') && !mpToggle.includes('PULL_UP'), 'and on MicroPython')
await pick('CircuitPython')
await page.waitForFunction(() => window.openCodeBot._blocksPython().includes('import board'))
await load(blink)
check(
  ['import board', 'import digitalio', 'import analogio', 'pin_LED = digitalio.DigitalInOut(board.LED)', 'pin_LED.switch_to_output()', 'adc_A0 = analogio.AnalogIn(board.A0)', 'pin_LED.value = True', 'print(adc_A0.value)'].every((l) => cp.includes(l)),
  'set to CircuitPython, they write CircuitPython',
)
check(!cp.includes('machine'), 'and none of MicroPython')
check((await page.evaluate(() => document.getElementById('device-chip-label').textContent)) === 'CircuitPython', 'the chip says which')

// Both ways back: the CircuitPython program, as Python, is the same blocks.
const back = await page.evaluate(() => {
  const app = window.openCodeBot
  const before = app._blocksPython()
  const r = app.blocksFromPython(before)
  if (!r.ok) return { line: r.line }
  app.workspace.replaceBlocks(r.state)
  // (Blank lines aside: a stack loose beside the forever loop is not spaced from it.)
  const plain = (py) => py.replace(/\n\s*\n/g, '\n')
  return { same: plain(app._blocksPython()) === plain(before), vars: app.workspace.workspace.getVariableMap().getAllVariables().map((v) => v.name) }
})
check(back.same && !back.vars?.length, `its Python comes back as the same blocks, with no pin made a variable ${JSON.stringify(back)}`)

// The Python palette has Pins too, in the flavor.
await page.evaluate(() => window.openCodeBot._toggleView())
await page.waitForSelector('.py-cat[data-id="pins"]')
check(true, 'the Python palette has a Pins category')
await page.evaluate(() => window.openCodeBot._toggleView())

// --------------------------------------------- a board says what it speaks
await open('circuitpython')
await pick('MicroPython')
check((await pressed()) === 'MicroPython', 'set to MicroPython by hand')
await load(blink)
await page.click('#btn-connect')
await page.waitForFunction(() => window.openCodeBot.device.state === 'ready')
await page.waitForFunction(() => document.getElementById('device-chip-label').textContent === 'CircuitPython')
check((await pressed()) === 'CircuitPython', 'a CircuitPython board connected sets CircuitPython')
check((await toasts()).includes('A CircuitPython board'), 'and says so')

await page.click('#btn-run')
await page.waitForFunction(() => window.openCodeBot.device.board.runs.length === 1)
const ran = await page.evaluate(() => ({ code: window.openCodeBot.device.board.runs[0], files: Object.keys(window.openCodeBot.device.board.files) }))
check(ran.code.includes('pin_LED.value = True'), 'Run sends the CircuitPython program')
check(ran.files.length === 0, `and writes no file on the board, not even the program's companions ${ran.files.join(', ')}`)
await page.click('#btn-stop').catch(() => {})

// The student's own block (a grey Python block) runs on it as typed.
await page.evaluate(() => window.openCodeBot.device.stop())
await load([{ type: 'ocb_on_start', x: 40, y: 40, inputs: { DO: { block: { type: 'ocb_python', fields: { CODE: 'print("mine")' } } } } }])
await page.click('#btn-run')
await page.waitForFunction(() => window.openCodeBot.device.board.runs.length === 2)
check((await page.evaluate(() => window.openCodeBot.device.board.runs[1])).includes('print("mine")'), 'a Python block of the student\'s own runs on it')

// Another board's blocks are named before Run, as on any board.
await page.evaluate(() => window.openCodeBot.device.stop())
await load([{ type: 'ocb_on_start', x: 40, y: 40, inputs: { DO: { block: { type: 'codebot_stop' } } } }])
await page.click('#btn-run')
await page.waitForTimeout(300)
check((await page.evaluate(() => window.openCodeBot.device.board.runs.length)) === 2 && (await toasts()).some((t) => /other board|another board|isn.t|not/i.test(t)), 'CodeBot blocks are not sent to it')

// ------------------------------------------------- examples and simulator
const learn = await page.evaluate(() => window.openCodeBot._learnHtml('generic', true, { kept: [], builtins: [] }))
check(learn.includes('data-ex-device="generic"') && learn.includes('Blink') && learn.includes('Button light'), 'Learn has its Blink and button examples')

await page.evaluate(() => window.openCodeBot.device.disconnect())
await page.evaluate(() => window.openCodeBot._toggleSimulate())
await page.waitForTimeout(200)
check(!(await page.evaluate(() => window.openCodeBot.device.simulating)), 'there is no simulator for it')
check((await toasts()).some((t) => /simulat/i.test(t)), 'and the simulator says so')

await browser.close()
server?.kill()
if (problems.length) {
  console.error('\nFAILURES:')
  for (const p of problems) console.error(' -', p)
  process.exit(1)
}
console.log('All good.')
