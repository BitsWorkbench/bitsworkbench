/**
 * The Python palette: the blocks' categories beside the Python, each block
 * as the Python it makes; dragged into the editor it lands between lines at
 * an indent Python allows, clicked or chosen with Enter it goes in at the
 * cursor, and either way it brings the imports it needs and one undo takes
 * it back out. Uses the loopback device, so no hardware. Run after `npm run build`.
 */
import { spawn } from 'node:child_process'
import { chromium } from 'playwright'

const BASE = process.env.OCB_URL || 'http://localhost:4173/'
const URL_ = `${BASE}?device=loopback&board=codebot`

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

await page.goto(URL_, { waitUntil: 'networkidle' })
await page.evaluate(() => {
  localStorage.clear()
  localStorage.setItem('opencodebot.welcome.v1', 'off')
  localStorage.setItem('opencodebot.device.v1', 'codebot')
})
await page.reload({ waitUntil: 'networkidle' })
await page.waitForFunction(() => !!window.openCodeBot)

const text = () => page.evaluate(() => window.openCodeBot.pythonEditor.value)
const mode = () => page.evaluate(() => window.openCodeBot.workspace.mode)
const setText = (t) => page.evaluate((t) => { window.openCodeBot.pythonEditor.value = t }, t)
const openCategory = (name) => page.click(`.py-cat:has-text("${name}")`)

/** The marks the editor showed just before the last drag's drop. */
let lastMarks = []

/** Drag a card so its left edge sits `dx` px into line `n`'s text, at `where` of its height (0 top, 1 bottom). */
async function drag(cardText, n, { dx = 0, where = 0.25 } = {}) {
  const exact = new RegExp(`^${cardText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`)
  const card = page.locator('.snippet').filter({ hasText: exact }).first()
  const c = await card.boundingBox()
  const line = page.locator('.cm-line').nth(n - 1)
  const l = await line.boundingBox()
  const grab = { x: 10, y: 8 }
  await page.mouse.move(c.x + grab.x, c.y + grab.y)
  await page.mouse.down()
  await page.mouse.move(c.x + grab.x + 30, c.y + grab.y + 2, { steps: 3 })
  // The editor places by the card's left edge and its first line (14 px down).
  const x = l.x + dx + grab.x
  const y = l.y + l.height * where - 14 + grab.y
  await page.mouse.move(x, y, { steps: 8 })
  const marked = await page.locator('.cm-snippet-marks > div').count()
  lastMarks = await page.$$eval('.cm-snippet-marks > div', (m) => m.map((d) => d.className))
  await page.mouse.up()
  return marked
}

// ------------------------------------------------- the palette is the blocks'
await page.click('#btn-view')
const blockCats = await page.evaluate(() =>
  // CodeTrek's category is hidden in both until an objective has one.
  window.openCodeBot.workspace.workspace.getToolbox().getToolboxItems().filter((i) => i.getName && i.isVisible()).map((i) => i.getName()),
)
const pyCats = await page.$$eval('.py-cat', (b) => b.map((x) => x.textContent))
check(JSON.stringify(blockCats) === JSON.stringify(pyCats), `the Python palette has the blocks' categories (${pyCats.length})`)
await openCategory('Loops')
const loops = await page.$$eval('.snippet', (b) => b.map((x) => x.textContent))
check(loops.includes('while True:\n    pass') && loops.some((s) => s.startsWith('for ')), 'Loops has a while loop and a for loop, as Python')
const shade = await page.evaluate(() => {
  const card = document.querySelector('.snippet')
  const cat = document.querySelector('.py-cat.is-open')
  return [getComputedStyle(card).borderLeftColor, getComputedStyle(cat).borderLeftColor]
})
check(shade[0] === shade[1], 'a card is shaded in its category\'s colour')

// --------------------------------- using one from the read-only view writes Python
await page.click('.snippet:has-text("while True")')
check((await mode()) === 'text', 'clicking a snippet in the read-only Python starts writing Python')
let now = await text()
check(/\nwhile True:\n    pass\n?$/.test(now), 'the snippet goes in at the cursor (the end of the program)')
check(await page.evaluate(() => window.openCodeBot.pythonEditor.selectedText === 'pass'), 'its pass is selected, ready to type over')
check(await page.isHidden('.py-flyout'), 'the flyout closes after use')

// ------------------------------------------- a fresh program cannot be undone away
await page.keyboard.press('Control+z')
now = await text()
check(!now.includes('while True') && now.includes('from botcore import *'), 'one undo takes the snippet out, and no more than that')
await page.keyboard.press('Control+z')
check((await text()).includes('from botcore import *'), 'undo never empties the program that switching to Python put there')

// ------------------------------------------------------------- dragging
await setText('from botcore import *\n\nwhile True:\n    leds.user(0xFF)\nprint("done")\n')
await openCategory('Sound')
let marked = await drag('spkr.off()', 4, { where: 0.25 }) // over the top half of line 4
check(marked > 0, 'while dragging, the editor marks where the snippet will land')
now = await text()
check(now.includes('while True:\n    spkr.off()\n    leds.user(0xFF)'), 'dropped under a colon, it goes into the body, indented')

await setText('from botcore import *\n\nwhile True:\n    leds.user(0xFF)\nprint("done")\n')
await openCategory('Sound')
await drag('spkr.off()', 5, { where: 0.25, dx: 0 })
check((await text()).includes('    leds.user(0xFF)\nspkr.off()\nprint("done")'), 'after a body, with the card at the left, it comes out of the loop')
await setText('from botcore import *\n\nwhile True:\n    leds.user(0xFF)\nprint("done")\n')
await openCategory('Sound')
const cw = await page.evaluate(() => window.openCodeBot.pythonEditor.view.defaultCharacterWidth)
await drag('spkr.off()', 5, { where: 0.25, dx: 4 * cw })
check((await text()).includes('    leds.user(0xFF)\n    spkr.off()\nprint("done")'), 'after a body, with the card indented, it stays in the loop')

// a value goes inside a line
await setText('from botcore import *\nx = \n')
await openCategory('Sensors')
{
  const l = await page.locator('.cm-line').nth(1).boundingBox()
  const card = page.locator('.snippet', { hasText: 'ls.read(0)' }).first()
  const c = await card.boundingBox()
  await page.mouse.move(c.x + 5, c.y + 5)
  await page.mouse.down()
  await page.mouse.move(c.x + 40, c.y + 6, { steps: 3 })
  await page.mouse.move(l.x + l.width + 5 - 0, l.y + l.height / 2 - 14 + 5, { steps: 8 })
  await page.mouse.up()
}
check((await text()).includes('x = ls.read(0)'), 'a value snippet goes inside the line')

// ------------------------------------- a loop dropped over code takes it in
const PROGRAM = 'from botcore import *\n\nleds.user(0xFF)\nspkr.pitch(440)\nprint("done")\n'
await setText(PROGRAM)
await openCategory('Loops')
await drag('while True:\n    pass', 3, { where: 0.1 })
now = await text()
check(lastMarks.includes('cm-snippet-wrap'), 'while dragging a loop over code, the code it would take in is shaded')
check(now.startsWith('from botcore import *\n\nwhile True:\n    leds.user(0xFF)\n'), 'a loop dropped with its shape over a line takes that line into its body')
check(!now.includes('pass'), 'the taken code replaces the body\'s pass')
check(now.endsWith('\nprint("done")\n'), 'code the shape does not reach stays where it was')
check(
  await page.evaluate(() => {
    const s = window.openCodeBot.pythonEditor.view.state
    return s.selection.main.empty && s.sliceDoc(s.selection.main.head, s.selection.main.head + 1) === ':'
  }),
  "the cursor waits at the end of the loop's condition",
)
await page.keyboard.press('Control+z')
check((await text()) === PROGRAM, 'one undo puts the code back as it was')

// a statement goes in whole: an if with its body and its else
const IFELSE = 'from botcore import *\n\nif buttons.is_pressed(0):\n    leds.user(0xFF)\nelse:\n    leds.user(0)\nprint("done")\n'
await setText(IFELSE)
await openCategory('Loops')
await drag('while True:\n    pass', 3, { where: 0.1 })
check(
  (await text()).includes('while True:\n    if buttons.is_pressed(0):\n        leds.user(0xFF)\n    else:\n        leds.user(0)\nprint("done")'),
  'an if under the shape goes in whole, with its body and its else',
)

// nothing taken in: dropped on a blank line, or a snippet with no body
await setText('from botcore import *\n\nleds.user(0xFF)\n\nprint("done")\n')
await openCategory('Loops')
await drag('while True:\n    pass', 4, { where: 0.5 })
now = await text()
check(now.includes('leds.user(0xFF)\nwhile True:\n    pass\nprint("done")'), 'dropped on a blank line, a loop takes nothing in')
await setText(PROGRAM)
await openCategory('Loops')
await drag('break', 3, { where: 0.1 })
check(!lastMarks.includes('cm-snippet-wrap') && (await text()).includes('\nbreak\nleds.user(0xFF)'), 'a snippet with no body takes nothing in')

// ---------------------------------------------------- it brings its imports
await setText('from botcore import *\n\nleds.user(0xFF)\n')
await openCategory('Drive')
await drag('motors.run(LEFT, 60)', 3, { where: 0.75 })
now = await text()
check(now.startsWith('from botcore import *\nmotors.enable(True)\n'), 'a motor snippet adds motors.enable(True) after the imports')
await page.keyboard.press('Control+z')
check(!(await text()).includes('motors'), 'and one undo takes out the snippet and what it brought')
await openCategory('Math')
await page.click('.snippet:has-text("random.randint")')
check((await text()).includes('import random'), 'a snippet that needs an import brings it')

// ---------------------------------------------------------------- touch
// Pointer events of type touch: sideways drags a card in; up or down scrolls.
async function touchDrag(cardText, toLine, path) {
  return page.evaluate(
    ({ cardText, toLine, path }) => {
      const card = [...document.querySelectorAll('.snippet')].find((c) => c.textContent === cardText)
      const c = card.getBoundingClientRect()
      const l = document.querySelectorAll('.cm-line')[toLine - 1].getBoundingClientRect()
      const ev = (type, x, y, target) =>
        target.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 7, pointerType: 'touch', button: 0, clientX: x, clientY: y }))
      const x0 = c.x + 10
      const y0 = c.y + 8
      ev('pointerdown', x0, y0, card)
      // Out of the flyout to the right, where the editor shows, as a finger would.
      const right = document.querySelector('.py-flyout').getBoundingClientRect().right + 40
      const end = path === 'sideways' ? [right, l.y + l.height * 0.75 - 6] : [x0 + 2, y0 - 60]
      for (let i = 1; i <= 8; i++) ev('pointermove', x0 + ((end[0] - x0) * i) / 8, y0 + ((end[1] - y0) * i) / 8, window)
      ev('pointerup', end[0], end[1], window)
    },
    { cardText, toLine, path },
  )
}
await setText('from botcore import *\nleds.user(0xFF)\n')
await openCategory('Sound')
await touchDrag('spkr.off()', 2, 'up')
check(!(await text()).includes('spkr.off()'), 'on touch, an upward swipe on a card does not drag it')
await page.click('body', { position: { x: 900, y: 400 } })
await openCategory('Sound')
await touchDrag('spkr.off()', 2, 'sideways')
check((await text()).includes('leds.user(0xFF)\nspkr.off()'), 'on touch, a sideways drag puts the snippet in')

// ------------------------------------------------------------- keyboard
await setText('from botcore import *\n')
await page.focus('.py-cat:has-text("Loops")')
await page.keyboard.press('Enter')
check(await page.evaluate(() => document.activeElement.classList.contains('snippet')), 'Enter on a category goes to its first snippet')
await page.keyboard.press('ArrowDown')
await page.keyboard.press('Escape')
check(
  (await page.isHidden('.py-flyout')) && (await page.evaluate(() => document.activeElement.textContent.includes('Loops'))),
  'Escape closes the flyout and returns to the category',
)
// Each key waits for the focus the one before it moved (a slow runner may lag).
const focusOn = (test) => page.waitForFunction(test, null, { timeout: 5000 }).catch(() => {})
await page.keyboard.press('Enter')
await focusOn(() => document.activeElement.classList.contains('snippet'))
await page.keyboard.press('ArrowDown')
await focusOn(() => document.activeElement.textContent.startsWith('while'))
const focused = await page.evaluate(() => document.activeElement.textContent)
await page.keyboard.press('Enter')
now = await text()
check(now.includes('while True:'), `Enter on a snippet puts it in${now.includes('while True:') ? '' : ` (focused ${JSON.stringify(focused)}; text ${JSON.stringify(now)})`}`)

// ------------------------------------------------- another board, another palette
await page.evaluate(() => window.openCodeBot.workspace.setTarget('codex'))
await page.waitForTimeout(100)
check(await page.isVisible('.py-cat:has-text("Screen")'), "picking CodeX gives CodeX's palette")

await browser.close()
server?.kill()
if (problems.length) {
  console.log('\nFAILURES:')
  for (const p of problems) console.log(` - ${p}`)
  process.exit(1)
}
console.log('\nAll good.')
