/**
 * "My blocks": a grey Python block saved from the canvas to the student's
 * own palette category, used again in another project, renamed and removed
 * one by one; kept in this browser only; and the same blocks in the Python
 * palette. Also: the gutter marks show without typing.
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
const requests = []
page.on('request', (r) => requests.push(r))

await page.goto(`${BASE}?device=loopback`, { waitUntil: 'networkidle' })
await page.evaluate(() => {
  localStorage.clear()
  localStorage.setItem('opencodebot.welcomed.v1', '1')
  localStorage.setItem('opencodebot.device.v1', 'codebot')
})
await page.reload({ waitUntil: 'networkidle' })
await page.waitForFunction(() => !!window.openCodeBot)

/** Open the My blocks category; the flyout's texts and grey blocks. */
async function openMine() {
  await page.evaluate(() => {
    const toolbox = window.openCodeBot.workspace.workspace.getToolbox()
    const item = toolbox.getToolboxItems().find((i) => i.getContents?.() === 'MY_BLOCKS')
    toolbox.setSelectedItem(null)
    toolbox.setSelectedItem(item)
  })
  await page.waitForFunction(() => window.openCodeBot.workspace.workspace.getFlyout()?.isVisible())
  return flyout()
}
const flyout = () =>
  page.evaluate(() => {
    const fly = window.openCodeBot.workspace.workspace.getFlyout()
    const ws = fly.getWorkspace()
    return {
      labels: [...document.querySelectorAll('.blocklyFlyout .blocklyFlyoutLabelText')].map((l) => l.textContent),
      blocks: ws.getTopBlocks(true).map((b) => ({ type: b.type, code: b.getFieldValue('CODE'), id: b.id })),
    }
  })
const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem('opencodebot.myblocks.v1') || '[]'))

/** Right-click a block (on the canvas or in the flyout) and choose a menu item. */
async function menu(blockId, text, inFlyout = false) {
  const box = await page.evaluate(
    ({ blockId, inFlyout }) => {
      const ws = window.openCodeBot.workspace.workspace
      const block = (inFlyout ? ws.getFlyout().getWorkspace() : ws).getBlockById(blockId)
      const r = block.getSvgRoot().getBoundingClientRect()
      return { x: r.left + 12, y: r.top + 10 }
    },
    { blockId, inFlyout },
  )
  await page.mouse.click(box.x, box.y, { button: 'right' })
  const item = page.locator('.blocklyContextMenu .blocklyMenuItem', { hasText: text })
  await item.first().waitFor()
  const disabled = (await item.first().getAttribute('aria-disabled')) === 'true'
  if (!disabled) await item.first().click()
  else await page.keyboard.press('Escape')
  return { disabled }
}

// ------------------------------------------------------------ empty, a hint
{
  const empty = await openMine()
  check(empty.blocks.length === 0 && empty.labels.join(' ').includes('Save to My blocks'), `an empty My blocks says how to fill it (${empty.labels.join(' | ')})`)
}

// ------------------------------------------------------- save from the canvas
const greyId = await page.evaluate(() => {
  const app = window.openCodeBot
  app.workspace.workspace.getToolbox().setSelectedItem(null)
  app.workspace.replaceBlocks(app.blocksFromPython('try:\n    leds.user(0xFF)\nexcept OSError:\n    pass\n').state)
  return app.workspace.workspace.getAllBlocks(false).find((b) => b.type === 'ocb_python').id
})
await menu(greyId, 'Save to My blocks')
await page.locator('.toast', { hasText: 'Saved to My blocks' }).first().waitFor()
check(true, 'a grey Python block\'s menu saves it, and says so')
let lib = await saved()
check(lib.length === 1 && lib[0].code === 'try:\n    leds.user(0xFF)\nexcept OSError:\n    pass' && lib[0].name === 'try:', `kept in this browser with its code, named by its first line (${JSON.stringify(lib)})`)
check((await menu(greyId, 'Save to My blocks')).disabled, 'saving the same block again is greyed out')
const notGrey = await page.evaluate(() => {
  const ws = window.openCodeBot.workspace.workspace
  const b = ws.newBlock('ocb_print')
  const { registry } = window.openCodeBotInternals.Blockly.ContextMenuRegistry
  const state = registry.getItem('myBlocksSave').preconditionFn({ block: b })
  b.dispose()
  return state
})
check(notGrey === 'hidden', 'only grey Python blocks offer it')

// ------------------------------------------- in the category, in any project
let mine = await openMine()
check(mine.labels.includes('try:') && mine.blocks.length === 1 && mine.blocks[0].code.startsWith('try:'), 'the category shows it under its name')
await page.evaluate(() => {
  const app = window.openCodeBot
  app.workspace.workspace.getToolbox().setSelectedItem(null)
  app.workspace.workspace.clear()
})
await page.reload({ waitUntil: 'networkidle' })
await page.waitForFunction(() => !!window.openCodeBot)
mine = await openMine()
check(mine.blocks.length === 1, 'still there after a reload, with a different project open')

// A block taken from the category is an ordinary grey block.
const copied = await page.evaluate(() => {
  const app = window.openCodeBot
  const ws = app.workspace.workspace
  const flyBlock = ws.getFlyout().getWorkspace().getTopBlocks(false)[0]
  const state = window.openCodeBotInternals.Blockly.serialization.blocks.save(flyBlock)
  return window.openCodeBotInternals.Blockly.serialization.blocks.append(state, ws).id
})
await page.waitForFunction((id) => !window.openCodeBot.workspace.workspace.getBlockById(id).data, copied)
check(true, 'taken from the category, it does not carry the library\'s id into the project')

// ------------------------------------------------------- rename and remove
await menu(mine.blocks[0].id, 'Rename', true)
// Blockly's own prompt, in the page.
const input = page.locator('dialog.blocklyDialog .blocklyDialogInput')
await input.waitFor()
await input.fill('Safe lights')
await input.press('Enter')
await page.waitForFunction(() => JSON.parse(localStorage.getItem('opencodebot.myblocks.v1'))[0].name === 'Safe lights')
mine = await flyout()
check(mine.labels.includes('Safe lights'), 'renamed, and the open category shows the new name')
await page.evaluate(() => {
  const app = window.openCodeBot
  app.myBlocks.add({ code: 'f"{1 + 1} wheels"', value: true })
})
await page.waitForFunction(() => window.openCodeBot.workspace.workspace.getFlyout().getWorkspace().getTopBlocks(false).length === 2)
mine = await flyout()
check(mine.blocks.map((b) => b.type).join() === 'ocb_python,ocb_python_value', 'a piece of Python is saved as a value block')
await menu(mine.blocks[0].id, 'Remove from My blocks', true)
await page.waitForFunction(() => JSON.parse(localStorage.getItem('opencodebot.myblocks.v1')).length === 1)
lib = await saved()
check(lib.length === 1 && lib[0].value === true, 'removed one by one; the other stays')

// ------------------------------------------------------- the Python palette
await page.evaluate(() => window.openCodeBot.workspace.workspace.getToolbox().setSelectedItem(null))
await page.click('#btn-view')
await page.locator('.py-cat', { hasText: 'My blocks' }).click()
const card = page.locator('.py-snippets li', { hasText: 'wheels' })
await card.waitFor()
check((await card.locator('.snippet-name').textContent()).includes('wheels'), 'the Python palette shows it, with its name')
await page.evaluate(() => {
  const app = window.openCodeBot
  for (const i of app.myBlocks.list()) app.myBlocks.remove(i.id)
})
await page.locator('.py-snippets .py-hint').waitFor()
check(true, 'and a hint once the library is empty')

// --------------------------------------- the gutter marks, without typing
await page.evaluate(() => {
  const app = window.openCodeBot
  app.workspace.replaceBlocks(app.blocksFromPython('import math\nprint(1)\n').state)
})
await page.click('#btn-mode')
await page.waitForFunction(() => window.openCodeBot.pythonEditor.markedLines().length > 0)
const marked = await page.evaluate(() => {
  const ed = window.openCodeBot.pythonEditor
  return ed.markedLines().map((l) => ed.view.state.doc.line(l).text)
})
check(marked.join() === 'import math', `switching to Python marks its lines with no block, without typing (${marked.join()})`)
await page.reload({ waitUntil: 'networkidle' })
await page.waitForFunction(() => window.openCodeBot?.workspace.mode === 'text')
await page.waitForFunction(() => window.openCodeBot.pythonEditor.markedLines().length > 0)
check(true, 'and so does opening the page with typed Python')

// ------------------------------------------------------------- no upload
const origin = new URL(BASE).origin
const away = requests.filter((r) => !r.url().startsWith(origin) && !r.url().startsWith('data:') && !r.url().startsWith('blob:'))
check(away.length === 0, `My blocks never leave the browser (${away.map((r) => r.url()).slice(0, 3).join(' ')})`)

await browser.close()
server?.kill()

if (problems.length) {
  console.error('\nFAILURES:')
  for (const p of problems) console.error(' -', p)
  process.exit(1)
}
console.log('\nAll good.')
