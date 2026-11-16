/**
 * The blocks/text toggle teachers asked for: edit the Python, run what was
 * typed, keep it across a reload, and go back to blocks only after asking.
 * Uses the loopback device, so no hardware. Run after `npm run build`.
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
  localStorage.setItem('opencodebot.welcomed.v1', '1')
  localStorage.setItem('opencodebot.device.v1', 'codebot')
})
await page.reload({ waitUntil: 'networkidle' })
await page.waitForFunction(() => !!window.openCodeBot)

const mode = () => page.evaluate(() => window.openCodeBot.workspace.mode)

// The editor area shows the blocks or the Python, never both
const shows = () =>
  page.evaluate(() => ({
    blocks: !!document.getElementById('blockly-root').offsetParent,
    python: !!document.getElementById('code-pane').offsetParent,
  }))
let view = await shows()
check(view.blocks && !view.python, 'the blocks show at first, not the Python')
check(!(await page.isVisible('.tab[data-tab="python"]')), 'there is no Python tab beside the device')
const toggle = await page.locator('#btn-view').boundingBox()
const palette = await page.locator('.blocklyToolbox').first().boundingBox()
check(
  toggle.x < palette.x + palette.width && toggle.y + toggle.height > palette.y + palette.height - 80,
  'the blocks/Python button sits at the bottom left, under the palette',
)
await page.click('#btn-view')
view = await shows()
check(view.python && !view.blocks, '🐍 Python shows the Python in place of the blocks')
check(!(await page.isVisible('#python-editor')), 'blocks mode shows read-only Python')
check(await page.isVisible('#btn-view'), 'the button stays to go back')
await page.click('#btn-view')
view = await shows()
check(view.blocks && !view.python, '🧩 Blocks brings the blocks back')

// Into text mode
await page.click('#btn-view')
await page.click('#btn-mode')
check((await mode()) === 'text', '"Edit as Python" switches to text mode')
check(await page.isVisible('#python-editor'), 'the Python becomes editable')
view = await shows()
check(view.python && !view.blocks, 'the blocks are out of sight while writing Python')
check(
  await page.evaluate(() => {
    const b = document.getElementById('btn-view').getBoundingClientRect()
    return document.getElementById('btn-view').contains(document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2))
  }),
  'the blocks/Python button is on top of the editor, not under its gutter',
)
const editorText = () => page.evaluate(() => window.openCodeBot.pythonEditor.value)
const seeded = await editorText()
check(seeded.includes('from botcore import *'), 'the editor starts with the blocks\' Python')
check(await page.isVisible('#python-editor .cm-content[aria-label]'), 'the editor is labelled for screen readers')
check((await page.locator('#python-editor .k').count()) > 0, 'the editor colours Python keywords')

// A colon's Enter indents; Tab and Shift+Tab move the line a level
await page.click('#python-editor .cm-content')
await page.keyboard.press('Control+End')
await page.keyboard.type('\nfor i in range(3):\n')
await page.keyboard.type("print('typed by hand'")
let typed = await editorText()
check(typed.includes("\n    print('typed by hand')"), 'Enter after a colon indents four spaces (and the bracket closes itself)')
await page.keyboard.press('Tab')
check((await editorText()).includes("\n        print('typed by hand')"), 'Tab indents four more spaces')
await page.keyboard.press('Shift+Tab')
typed = await editorText()
check(typed.includes("\n    print('typed by hand')") && !typed.includes("\n        print"), 'Shift+Tab takes the indent back')
await page.keyboard.press('Control+z')
// (Ctrl+Y: Playwright's Control+Shift+z sends a lowercase z, unlike a keyboard)
await page.keyboard.press('Control+y')
check((await editorText()) === typed, 'undo and redo')
// Escape, then Tab, leaves the editor
await page.keyboard.press('Escape')
await page.keyboard.press('Tab')
check(!(await page.evaluate(() => document.getElementById('python-editor').contains(document.activeElement))), 'Escape, then Tab, leaves the editor')

// Run sends the typed code
await page.click('#btn-connect')
await page.waitForFunction(() => window.openCodeBot.device.state === 'ready')
await page.keyboard.press('Control+Enter')
await page.waitForFunction(() => window.openCodeBot.device.state === 'running')
// The app's device pairs the page's kind with the simulator; files are the loopback's.
const sent = await page.evaluate(() => window.openCodeBot.device.board.files['main.py'])
check(sent.includes("print('typed by hand')"), 'Run sends the typed Python')

// Survives a reload
await page.waitForTimeout(400)
await page.reload({ waitUntil: 'networkidle' })
await page.waitForFunction(() => !!window.openCodeBot)
check((await mode()) === 'text', 'text mode survives a reload')
check(await page.isVisible('#python-editor'), 'after a reload the typed Python is on screen')
check((await editorText()).includes('typed by hand'), 'the typed code survives a reload')

// Back to blocks (the 🧩 Blocks button) turns the typed Python into blocks
const typedBefore = await editorText()
await page.click('#btn-view')
await page.waitForFunction(() => window.openCodeBot.workspace.mode === 'blocks')
check(!(await page.evaluate(() => document.getElementById('modal')?.open)), 'going back with typed changes does not ask')
check((await shows()).blocks, 'the blocks are on screen again')
const kinds = await page.evaluate(() => window.openCodeBot.workspace.workspace.getAllBlocks(false).map((b) => b.type))
check(kinds.includes('controls_repeat_ext') && kinds.includes('ocb_print'), 'the typed loop came back as blocks')
check(!kinds.includes('ocb_python'), 'with nothing left over as Python')

// Only looked at in blocks: Edit as Python gives back exactly what was typed
await page.click('#btn-view')
await page.click('#btn-mode')
check((await mode()) === 'text', 'Edit as Python again')
check((await editorText()) === typedBefore, 'Python only looked at in blocks comes back exactly as typed')

// Code that does not parse stays Python, with the cursor on the line to fix
await page.evaluate(() => { window.openCodeBot.pythonEditor.value = "print('one')\nprint((\nprint('three')\n" })
await page.click('#btn-mode')
check((await mode()) === 'text', 'Python with a mistake does not go back to blocks')
check(await page.isVisible('.toast >> text=Fix the Python first'), 'and says so')
check(
  await page.evaluate(() => window.openCodeBot.pythonEditor.selectedText.startsWith('print((')),
  'with the line to fix selected',
)

// Fixed, it goes back
await page.evaluate(() => { window.openCodeBot.pythonEditor.value = "print('one')\n" })
await page.click('#btn-mode')
check((await mode()) === 'blocks', 'fixed Python goes back to blocks')

// --- Typed Python counts as work, even with no blocks on the canvas -------
// A student clears the blocks, switches to Python and types. Nothing that
// replaces the project may drop that without asking.
async function freshTyped(url, typed) {
  const p = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  p.on('pageerror', (e) => problems.push(`page error: ${e.message}`))
  await p.goto(url, { waitUntil: 'networkidle' })
  await p.evaluate(() => {
    localStorage.clear()
    localStorage.setItem('opencodebot.welcomed.v1', '1')
    localStorage.setItem('opencodebot.device.v1', 'codebot')
  })
  await p.reload({ waitUntil: 'networkidle' })
  await p.waitForFunction(() => !!window.openCodeBot)
  await p.evaluate(() => window.openCodeBot.workspace.workspace.clear())
  await p.click('#btn-view')
  await p.click('#btn-mode')
  await p.evaluate((text) => { window.openCodeBot.pythonEditor.value = text }, typed)
  return p
}
const TYPED = "print('my own program')\n"
const keeps = (p) =>
  p.evaluate(
    (t) => window.openCodeBot.workspace.mode === 'text' && window.openCodeBot.workspace.pythonText === t,
    TYPED,
  )

{
  const p = await freshTyped(BASE, TYPED)
  await p.click('#btn-new')
  const asked = await p.evaluate(() => document.getElementById('modal')?.open)
  check(asked, 'New asks when only typed Python is there')
  const keepLabel = asked ? await p.textContent('#modal button[value="cancel"]') : ''
  check(keepLabel === 'Keep my program', `New's keep button says "Keep my program" (${keepLabel})`)
  if (asked) await p.click('#modal button[value="cancel"]')
  await p.waitForTimeout(100)
  check(await keeps(p), '"Keep my program" on New keeps the typed Python')
  await p.close()
}
{
  const p = await freshTyped(BASE, TYPED)
  await p.evaluate(() => window.openCodeBot._pickTarget('codex'))
  await p.waitForTimeout(300)
  check(await keeps(p), 'picking another device keeps typed Python (no starter over it)')
  await p.waitForTimeout(400)
  await p.reload({ waitUntil: 'networkidle' })
  await p.waitForFunction(() => !!window.openCodeBot)
  check(await keeps(p), 'and autosave did not overwrite it')
  await p.close()
}
{
  // The board that plugs in is a CodeX, while the project was for CodeBot.
  const p = await freshTyped(`${BASE}?device=loopback&board=codex`, TYPED)
  await p.click('#btn-connect')
  await p.waitForFunction(() => window.openCodeBot.device.state === 'ready')
  await p.waitForTimeout(300)
  check(await keeps(p), 'connecting a different board keeps typed Python')
  await p.close()
}
{
  // A starter program has no name; it must not undo a rename.
  const p = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  await p.goto(BASE, { waitUntil: 'networkidle' })
  await p.evaluate(() => {
    localStorage.clear()
    localStorage.setItem('opencodebot.welcomed.v1', '1')
    localStorage.setItem('opencodebot.device.v1', 'codebot')
  })
  await p.reload({ waitUntil: 'networkidle' })
  await p.waitForFunction(() => !!window.openCodeBot)
  await p.evaluate(() => window.openCodeBot.workspace.workspace.clear())
  await p.fill('#project-name', 'Zoom Zoom')
  await p.press('#project-name', 'Enter')
  await p.evaluate(() => window.openCodeBot._pickTarget('codex'))
  await p.waitForTimeout(300)
  const loaded = await p.evaluate(() => window.openCodeBot.workspace.workspace.getAllBlocks(false).length)
  check(loaded > 0, 'an empty project gets the new device\'s starter program')
  check((await p.inputValue('#project-name')) === 'Zoom Zoom', 'loading a starter keeps the name the student typed')
  await p.close()
}

await browser.close()
server?.kill()

if (problems.length) {
  console.error('\nFAILURES:')
  for (const p of problems) console.error(' -', p)
  process.exit(1)
}
console.log('\nAll good.')
