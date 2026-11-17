/**
 * A program's other .py files go on the board before it runs, so it can
 * import them: the loopback board shows what was written, and the simulator
 * that `import safety` then works. Never a name the board needs itself
 * (main.py, boot.py, a library module), never a file from another folder,
 * and a file already there as it is is not written again.
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
// One context: the simulator's tab below sees the same files in this browser.
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
await context.addInitScript(() => localStorage.setItem('opencodebot.welcomed.v1', '1'))
const page = await context.newPage()
page.on('pageerror', (e) => problems.push(`page error: ${e.message}`))

const MAIN = 'from codex import *\nimport safety\nsafety.hello()\n'
const SAFETY = 'def hello():\n    print("hello from safety")\n'

/** A folder of files in this browser, its main.py open in Python. */
async function project(files) {
  await page.evaluate(async (files) => {
    const app = window.openCodeBot
    for (const [path, text] of Object.entries(files)) await app.stores.browser.write(path, text)
    await app._openRef({ store: 'browser', path: 'proj/main.py' })
    if (app.workspace.mode !== 'text') app._toText()
  }, files)
  await page.waitForFunction(() => window.openCodeBot.openFile?.path === 'proj/main.py')
}

// Run, as the button does (the loopback's program never ends, so Stop stands in its place).
const run = () => page.evaluate(() => window.openCodeBot._run())
const toasts = () => page.$$eval('.toast', (ts) => ts.map((t) => t.innerText))
const clearToasts = () => page.evaluate(() => document.querySelectorAll('.toast').forEach((t) => t.remove()))

console.log('On a board (loopback)')
await page.goto(`${BASE}?device=loopback&board=codex`, { waitUntil: 'networkidle' })
await page.waitForFunction(() => !!window.openCodeBot)
await page.click('#btn-connect')
await page.waitForFunction(() => window.openCodeBot.device.isConnected)
// Every file the board is sent, in order.
await page.evaluate(() => {
  const board = window.openCodeBot.device.board
  window.__written = []
  const write = board.writeFile.bind(board)
  board.writeFile = (name, text) => (window.__written.push(name), write(name, text))
})
await project({
  'proj/main.py': MAIN,
  'proj/safety.py': SAFETY,
  'proj/colors.py': 'RED = 1\n',
  'proj/boot.py': 'print("boot")\n',
  'proj/notes.txt': 'not Python\n',
  'proj/sub/deep.py': 'x = 1\n',
  'other.py': 'y = 2\n',
})
await run()
await page.waitForFunction(() => window.__written.includes('main.py'))
const first = await page.evaluate(() => [...window.__written])
check(first.includes('safety.py') && first.indexOf('safety.py') < first.indexOf('main.py'), `the program's other .py file goes on the board before it runs (${first.join(', ')})`)
check(!first.includes('colors.py') && !first.includes('boot.py'), 'never a name the board needs itself (a library module, boot.py)')
check(!first.some((n) => /notes|deep|other/.test(n)), 'only .py files, only from its own folder')
check((await page.evaluate(() => window.openCodeBot.device.board.files['safety.py'])) === SAFETY, 'as it is in the folder')
const said = await toasts()
check(said.some((t) => /colors\.py/.test(t) && /boot\.py/.test(t)), 'and it says which files it would not copy, by name')
check((await page.textContent('#terminal-host')).includes('safety.py'), 'and which it copied')

await clearToasts()
await page.evaluate(() => (window.__written.length = 0))
await run()
await page.waitForFunction(() => window.__written.includes('main.py'))
check(!(await page.evaluate(() => window.__written.includes('safety.py'))), 'run again, an unchanged file is not written again')

await page.evaluate((t) => window.openCodeBot.stores.browser.write('proj/safety.py', t), SAFETY.replace('hello from', 'hi from'))
await page.evaluate(() => (window.__written.length = 0))
await run()
await page.waitForFunction(() => window.__written.includes('main.py'))
check(await page.evaluate(() => window.__written.includes('safety.py')), 'changed, it is written again')

console.log('In the simulator')
// A page opened in the simulator, in this browser: the same files.
await page.close()
const sim = await context.newPage()
sim.on('pageerror', (e) => problems.push(`page error: ${e.message}`))
await sim.goto(`${BASE}?device=sim&board=codex`, { waitUntil: 'networkidle' })
await sim.waitForFunction(() => window.openCodeBot?.device.simulating && window.openCodeBot.device.state === 'ready', null, { timeout: 30000 })
await sim.evaluate(async () => {
  const app = window.openCodeBot
  await app._openRef({ store: 'browser', path: 'proj/main.py' })
  if (app.workspace.mode !== 'text') app._toText()
  window.__out = ''
  app.device.addEventListener('data', (e) => (window.__out += new TextDecoder().decode(e.detail)))
})
await sim.evaluate(() => window.openCodeBot._run())
const heard = await sim.waitForFunction(() => /hi from safety/.test(window.__out), null, { timeout: 20000 }).then(() => true, () => false)
check(heard, `import safety finds the folder's safety.py on the simulator's drive (${JSON.stringify((await sim.evaluate(() => window.__out)).slice(-200))})`)

await browser.close()
server?.kill()
if (problems.length) {
  console.error('\nFAILURES:')
  for (const p of problems) console.error(' -', p)
  process.exit(1)
}
console.log('\nAll good.')
