/**
 * Programs from a teacher's point of view: each is a Python file (my_program.py at
 * first, in this browser), saved by itself, found again after a reload; an
 * old project file opens as a new one; picking another board never asks.
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
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, acceptDownloads: true })
page.on('pageerror', (e) => problems.push(`page error: ${e.message}`))

const modalOpen = () => page.evaluate(() => document.getElementById('modal')?.open)
const blockCount = () => page.evaluate(() => window.openCodeBot.workspace.workspace.getAllBlocks(false).length)

await page.goto(BASE, { waitUntil: 'networkidle' })
await page.evaluate(async () => {
  localStorage.clear()
  // Skip the welcome dialog; this test is about programs and their files.
  localStorage.setItem('opencodebot.welcomed.v1', '1')
  localStorage.setItem('opencodebot.device.v1', 'codebot')
  await new Promise((r) => { const q = indexedDB.deleteDatabase('opencodebot-browser-files'); q.onsuccess = q.onerror = q.onblocked = r })
})
await page.reload({ waitUntil: 'networkidle' })
await page.waitForFunction(() => !!window.openCodeBot)

const fileName = () => page.textContent('#file-name')
const stored = (path) => page.evaluate((p) => window.openCodeBot.stores.browser.read(p).catch(() => null), path)
const python = () => page.evaluate(() => window.openCodeBot._currentPython())
check((await fileName()) === 'my_program.py', 'a first program is the file my_program.py, kept in this browser')
check((await blockCount()) > 0, 'the CodeBot starter program is loaded')
check((await page.title()).startsWith('my_program'), 'the browser tab shows the file')
await page.waitForFunction(() => window.openCodeBot.openFile?.saved)
check((await stored('my_program.py')) === (await python()), 'my_program.py holds the program as Python')

// Work saves itself, a moment after a change.
await page.evaluate(() => window.openCodeBot.workspace.workspace.newBlock('ocb_print').initSvg())
await page.waitForFunction(() => !document.getElementById('file-dirty').hidden).catch(() => {})
check(true, 'a change shows the dot while it waits to be saved')
await page.waitForFunction(() => document.getElementById('file-dirty').hidden, null, { timeout: 4000 }).catch(() => {})
check((await stored('my_program.py')) === (await python()), 'and then is saved, with no Save pressed')

// Ctrl+S saves now, and says so; nothing downloads.
let downloaded = false
page.on('download', () => { downloaded = true })
await page.keyboard.press('Control+s')
await page.waitForSelector('.toast >> text=Saved', { timeout: 3000 }).catch(() => {})
check((await page.isVisible('.toast >> text=Saved')) && !downloaded, 'Ctrl+S saves the file now')

// It all comes back after a reload.
await page.reload({ waitUntil: 'networkidle' })
await page.waitForFunction(() => !!window.openCodeBot)
check((await fileName()) === 'my_program.py' && (await blockCount()) > 0, 'the file and its blocks come back after a reload')

// An old project file opens as a new Python file, beside the open one.
const project = { format: 'opencodebot', version: 1, name: 'Line Follower', device: 'codebot', blocks: { blocks: { languageVersion: 0, blocks: [{ type: 'ocb_on_start', x: 40, y: 40, inputs: { DO: { block: { type: 'ocb_print', inputs: { TEXT: { shadow: { type: 'text', fields: { TEXT: 'hi' } } } } } } } }] } } }
await page.setInputFiles('#file-input', { name: 'line-follower.ocb', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) })
await page.waitForFunction(() => window.openCodeBot.openFile?.path === 'line-follower.py').catch(() => {})
check((await fileName()) === 'line-follower.py', 'an old project file opens as line-follower.py')
check((await stored('line-follower.py'))?.includes("print('hi')") && (await stored('my_program.py')) !== null, 'saved as Python, and my_program.py is kept')

// Back to my_program.py, with nothing pressed but its name.
await page.click('#btn-files')
await page.click('#files-panel .files-item[data-path="my_program.py"]')
await page.waitForFunction(() => window.openCodeBot.openFile?.path === 'my_program.py')
check((await blockCount()) > 2, 'my_program.py opens again as its blocks')
await page.click('#btn-files')

// An empty program, to start the board-switch checks from.
await page.evaluate(() => window.openCodeBot.workspace.workspace.clear())

// Picking another board never asks. The old board's starter, as it came,
// becomes the new board's; a program of the student's stays, and a toast
// names the blocks the new board cannot run.
const pick = async (id) => {
  await page.evaluate((b) => window.openCodeBot._pickTarget(b), id)
  await page.waitForTimeout(300)
}
await pick('codebot') // an empty project: the CodeBot starter
check((await blockCount()) > 0 && (await python()).includes('botcore'), 'an empty project gets the starter')
await pick('codex')
check(!(await modalOpen()), 'picking another board does not ask')
check((await python()).includes('codex'), 'the CodeBot starter, untouched, became the CodeX starter')
await page.evaluate(() => {
  const ws = window.openCodeBot.workspace.workspace
  ws.newBlock('codex_pixels_off').initSvg()
})
const blockTypes = () => page.evaluate(() => window.openCodeBot.workspace.workspace.getAllBlocks(true).map((b) => b.type).join())
const mine = await blockTypes()
await pick('codebot')
check(!(await modalOpen()), 'picking another board with blocks of mine does not ask')
check((await blockTypes()) === mine, 'my program stays as it was')
check(await page.evaluate(() => [...document.querySelectorAll('.toast')].some((t) => /CodeX/.test(t.textContent))), 'a toast names the CodeX blocks a CodeBot cannot run')

await browser.close()
server?.kill()

if (problems.length) {
  console.error('\nFAILURES:')
  for (const p of problems) console.error(' -', p)
  process.exit(1)
}
console.log('\nAll good.')
